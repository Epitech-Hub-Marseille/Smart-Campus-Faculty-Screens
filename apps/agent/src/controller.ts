import { isCommandType, ulid, type ServerMessage, type WireScene } from "@smartcampus/protocol";
import { ackPayload, nackPayload, statePayload } from "./reply.js";
import type { EnrollmentStatus, LiveMessage, ViewState } from "@smartcampus/faculty-local";
import { visibleEndNotice } from "@smartcampus/faculty-local";
import type { AssetCache } from "./assets/cache.js";
import type { LinkEvent, MessageSink } from "./link/deviceLink.js";
import { errorMessage, log } from "./log.js";
import { activateCarousel, applyCommand, applyDesired, assetsOfScenes, fontsOfTheme, neededAssets, prune, toViewState, type AgentState } from "./state.js";

/** Recent command ids kept so a replayed command is acknowledged again but never run twice. */
const REMEMBERED_IDS = 200;

export interface ControllerDeps {
  initial: AgentState;
  /** Previously handled command ids, from disk. */
  seen: string[];
  assets: AssetCache;
  /** Sounds live apart from the playlist's files, so collecting one never removes the other. */
  sounds: AssetCache;
  saveState: (state: AgentState) => void;
  saveSeen: (ids: string[]) => void;
  /** Receives every new view of the screen, and the sounds to play. */
  publish: (message: LiveMessage) => void;
  now?: () => number;
  version: string;
}

const inQuietHours = (hhmm: { enabled: boolean; from: string; to: string }, at: Date) => {
  if (!hhmm.enabled) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = toMin(hhmm.from);
  const to = toMin(hhmm.to);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
};

/**
 * Turns what the server sends into the state the page draws, one command at a time: validated by the protocol
 * package before it gets here, applied, acknowledged once, reported back. Long work (downloads) never blocks the
 * link, so an emergency that arrives during a video download is on the screen at once.
 */
export class Controller {
  private state: AgentState;
  private sink: MessageSink | null = null;
  private readonly seen: string[];
  private phase: ViewState["phase"] = "starting";
  private enrollment: ViewState["enrollment"] = null;
  private online = false;
  private offlineSince: number | null;
  private weather: ViewState["weather"] = null;
  private carouselJob: AbortController | null = null;
  private readonly clock: () => number;

  constructor(private readonly deps: ControllerDeps) {
    this.clock = deps.now ?? Date.now;
    this.state = deps.initial;
    this.seen = [...deps.seen];
    this.offlineSince = this.clock();
  }

  get snapshot(): AgentState {
    return this.state;
  }

  view(): ViewState {
    const st = this.state;
    return toViewState(st, {
      phase: this.phase,
      enrollment: this.enrollment,
      online: this.online,
      offlineSince: this.offlineSince,
      weather: this.weather,
      urlOf: (ref) => `/media/${this.deps.assets.fileName(ref)}`,
      has: (ref) => this.deps.assets.has(ref),
    });
  }

  private emit() {
    this.deps.publish({ type: "state", state: this.view() });
  }

  setEnrollment(status: EnrollmentStatus, fingerprint: string, message?: string) {
    this.phase = "enrolling";
    this.enrollment = { status, fingerprint, ...(message && { message }) };
    this.emit();
  }

  setWeather(weather: ViewState["weather"]) {
    this.weather = weather;
    this.emit();
  }

  /** The device clock corrected by the server's, for signing requests and judging expiry. */
  clockOffsetMs = () => this.state.clockOffsetMs;

  private change(next: AgentState) {
    this.state = next;
    this.deps.saveState(next);
    this.emit();
  }

  /** Called every so often: drops what expired and frees files nothing needs any more. */
  housekeeping() {
    const pruned = prune(this.state, this.clock());
    if (pruned !== this.state) this.change(pruned);
    this.deps.assets.collect(neededAssets(this.state));
    this.deps.sounds.collectOlderThan(60 * 60_000, this.clock());
  }

  async onEvent(event: LinkEvent): Promise<void> {
    if (event.type === "connected") {
      this.sink = event.sink;
      this.online = true;
      this.offlineSince = null;
      this.phase = "running";
      this.enrollment = null;
      this.emit();
    } else if (event.type === "disconnected") {
      this.sink = null;
      this.online = false;
      this.offlineSince = this.offlineSince ?? this.clock();
      // A running content download is for the previous session; the next one asks again.
      this.carouselJob?.abort();
      this.emit();
    } else {
      await this.handle(event.message);
    }
  }

  private async handle(message: ServerMessage): Promise<void> {
    if (message.type === "session.ready") {
      this.change(applyDesired(this.state, message.payload.desired, message.payload.serverTime, this.clock()));
      void this.ensureLogo();
      void this.ensureThemeFonts();
      this.report();
      return;
    }
    // A live announcement goes straight to the page: never stored, never acknowledged, and one that is missed is simply missed.
    if (message.type === "live.start") return this.deps.publish({ type: "live", event: "start", streamId: message.payload.streamId, from: message.payload.from });
    if (message.type === "live.chunk") return this.deps.publish({ type: "live", event: "chunk", streamId: message.payload.streamId, data: message.payload.data });
    if (message.type === "live.end") return this.deps.publish({ type: "live", event: "end", streamId: message.payload.streamId });
    // Answers to device messages: this device sends none of those, so nothing to do.
    if (!isCommandType(message.type)) return;

    if (this.seen.includes(message.id)) {
      this.ack(message.id); // the server did not see our first ack: repeat it, do not run the command again
      return;
    }

    switch (message.type) {
      case "carousel.set":
        // Not awaited: a download of minutes must not hold up the commands behind it.
        void this.activateCarousel(message.id, message.payload.scenes, message.payload.updatedAt);
        return;
      case "audio.play":
        void this.playAudio(message);
        return;
      case "theme.set":
        this.change(applyCommand(this.state, message, this.clock()));
        void this.ensureThemeFonts();
        break;
      case "faculty.config.set":
        this.change(applyCommand(this.state, message, this.clock()));
        void this.ensureLogo();
        break;
      default:
        // Everything else either changes the state at once or is meant for another kind of device (room status, door
        // display config, reservations, readers): acknowledged, not acted on.
        this.change(applyCommand(this.state, message, this.clock()));
    }
    this.remember(message.id);
    this.ack(message.id);
    this.report();
  }

  /**
   * A new carousel replaces the old one only when every file in it is downloaded and verified, so the screen keeps
   * showing the previous one during the download and never shows a half-loaded one. A newer carousel cancels this.
   * Streams, radios and web pages have no file to fetch: the page loads them itself.
   */
  private async activateCarousel(id: string, scenes: WireScene[], updatedAt: number): Promise<void> {
    this.carouselJob?.abort();
    const job = new AbortController();
    this.carouselJob = job;
    try {
      const refs = assetsOfScenes(scenes);
      for (const ref of refs) await this.deps.assets.ensure(ref, job.signal);
      if (job.signal.aborted) return;
      this.change(activateCarousel(this.state, scenes, updatedAt));
      this.remember(id);
      this.ack(id);
      log("info", "carousel active", { scenes: scenes.length, files: refs.length });
      this.report();
      this.deps.assets.collect(neededAssets(this.state));
    } catch (err) {
      if (job.signal.aborted) return;
      this.remember(id);
      this.sink?.send("nack", nackPayload(id, `content download failed: ${errorMessage(err)}`));
      log("warn", "carousel not activated", { error: errorMessage(err) });
    } finally {
      if (this.carouselJob === job) this.carouselJob = null;
    }
  }

  private async playAudio(message: Extract<ServerMessage, { type: "audio.play" }>): Promise<void> {
    const { announcementId, assetId, sha256, size, urgent, emergencyId } = message.payload;
    const quiet = inQuietHours(this.state.audio.quietHours, new Date(this.clock() + this.state.clockOffsetMs));
    if (quiet && !urgent) {
      // Acknowledged on purpose: the server must not replay a broadcast we deliberately stayed silent for.
      this.remember(message.id);
      this.ack(message.id);
      return;
    }
    try {
      const name = await this.deps.sounds.ensureAudio(assetId, sha256, size, new AbortController().signal);
      this.remember(message.id);
      this.ack(message.id);
      // An urgent read-out is heard at full volume, like the alarm.
      this.deps.publish({ type: "audio", id: announcementId, src: `/audio/${name}`, volume: urgent ? 100 : this.state.audio.volume, ...((urgent || emergencyId) && { urgent: true }) });
    } catch (err) {
      this.remember(message.id);
      this.sink?.send("nack", nackPayload(message.id, `download failed: ${errorMessage(err)}`));
    }
  }

  private async ensureLogo(): Promise<void> {
    const logo = this.state.config.site.logo;
    if (!logo) return;
    try {
      await this.deps.assets.ensure(logo, new AbortController().signal);
      this.emit();
    } catch (err) {
      // A logo that cannot be fetched is not worth refusing the configuration for: the header just has none.
      log("warn", "logo not available", { error: errorMessage(err) });
    }
  }

  /**
   * Downloads the font files of the theme. The page gets the theme at once and each font as soon as its file is verified,
   * so a slow download never delays the colours. A font that cannot be fetched is skipped: the page keeps its own.
   */
  private async ensureThemeFonts(): Promise<void> {
    for (const ref of fontsOfTheme(this.state.theme)) {
      try {
        await this.deps.assets.ensure(ref, new AbortController().signal);
        this.emit();
      } catch (err) {
        log("warn", "theme font not available", { error: errorMessage(err) });
      }
    }
  }

  private remember(id: string) {
    this.seen.push(id);
    while (this.seen.length > REMEMBERED_IDS) this.seen.shift();
    this.deps.saveSeen(this.seen);
  }

  private ack(ref: string) {
    this.sink?.send("ack", ackPayload(ref));
  }

  /** Sends what the console draws its live view from. */
  report(): void {
    const st = this.state;
    const now = this.clock() + st.clockOffsetMs;
    const notice = visibleEndNotice(st.endNotice ? { ...st.endNotice } : null, now);
    this.sink?.send(
      "state.report",
      statePayload({
        configApplied: true,
        screen: "on",
        scenes: st.carousel.scenes.map((s) => s.id),
        carouselUpdatedAt: st.carousel.updatedAt,
        announcements: Object.keys(st.announcements),
        ...(st.emergency && { emergency: st.emergency.emergencyId }),
        ...(notice && { endNotice: true }),
        volume: st.audio.volume,
        ...(this.offlineSince !== null && { offlineSince: this.offlineSince }),
      }),
      ulid(),
    );
  }
}
