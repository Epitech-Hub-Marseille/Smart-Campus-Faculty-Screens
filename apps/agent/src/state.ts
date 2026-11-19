import {
  announceShow,
  audioSettingsSet,
  EMERGENCY_CATALOGUE,
  emergencySet,
  facultyConfig,
  type AssetRef,
  type EmergencyKind,
  type FacultyConfig,
  type PayloadOf,
  type ServerMessage,
  type ThemeSpec,
  type WireScene,
  themeSet,
} from "@smartcampus/protocol";
import type { ConfigView, EmergencyView, SceneView, ViewState } from "@smartcampus/faculty-local";

type Faculty = PayloadOf<"faculty.content.set">;
type Announce = PayloadOf<"announce.show">;
type Emergency = PayloadOf<"emergency.set">;
type AudioSettings = PayloadOf<"audio.settings.set">;

/** How long the end-of-emergency notice stays when the server does not say. */
export const END_NOTICE_DEFAULT_MS = 120_000;
// The server's bounds. A value outside them is clamped rather than trusted: a bad one must not pin the screen.
const END_NOTICE_MIN_MS = 10_000;
const END_NOTICE_MAX_MS = 900_000;

/** Everything the agent keeps between runs. Persisted after every change so a restart shows the last known state. */
export interface AgentState {
  config: FacultyConfig;
  faculty: Faculty | null;
  /** The ACTIVE carousel: every file of it was downloaded and verified before it replaced the previous one. */
  carousel: { scenes: WireScene[]; updatedAt: number };
  /** The visual theme the server chose for this screen, or null for the page's own look. */
  theme: ThemeSpec | null;
  announcements: Record<string, Announce>;
  emergency: Emergency | null;
  endNotice: { emergencyId: string; message: string; shownAt: number; durationMs: number } | null;
  audio: AudioSettings;
  clockOffsetMs: number;
}

export const initialState = (): AgentState => ({
  config: facultyConfig.parse({}),
  faculty: null,
  carousel: { scenes: [], updatedAt: 0 },
  theme: null,
  announcements: {},
  emergency: null,
  endNotice: null,
  audio: audioSettingsSet.shape.payload.parse({ volume: 80, quietHours: {} }),
  clockOffsetMs: 0,
});

/** Reads a saved state back, field by field, so one corrupt field does not cost the whole screen its memory. */
export function reviveState(raw: unknown): AgentState {
  const base = initialState();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const config = facultyConfig.safeParse(r.config);
  const audio = audioSettingsSet.shape.payload.safeParse(r.audio);
  const emergency = emergencySet.shape.payload.safeParse(r.emergency);
  const carousel = r.carousel as AgentState["carousel"] | undefined;
  // Checked again on the way back from disk: a file that was edited by hand must not put unchecked CSS on a wall.
  const theme = themeSet.shape.payload.safeParse({ theme: r.theme ?? null });
  return {
    ...base,
    ...(config.success && { config: config.data }),
    ...(audio.success && { audio: audio.data }),
    emergency: emergency.success ? emergency.data : null,
    faculty: (r.faculty as Faculty | null) ?? null,
    carousel: carousel && Array.isArray(carousel.scenes) ? carousel : base.carousel,
    theme: theme.success ? theme.data.theme : null,
    announcements: typeof r.announcements === "object" && r.announcements ? (r.announcements as Record<string, Announce>) : {},
    endNotice: (r.endNotice as AgentState["endNotice"]) ?? null,
    clockOffsetMs: typeof r.clockOffsetMs === "number" ? r.clockOffsetMs : 0,
  };
}

/**
 * The desired state sent at the start of a session. It is complete, so what it leaves out is over: no emergency in it
 * means the alert ended, even if the clear was missed during an outage.
 */
export function applyDesired(state: AgentState, desired: Record<string, unknown>, serverTime: number, deviceNow: number): AgentState {
  const config = facultyConfig.safeParse(desired.facultyConfig);
  const audio = audioSettingsSet.shape.payload.safeParse(desired.audioSettings);
  const emergency = emergencySet.shape.payload.safeParse(desired.emergency);
  // Complete state: a desired state without a theme means the theme was taken away, even if the command was missed.
  const theme = themeSet.shape.payload.safeParse({ theme: desired.theme ?? null });
  const announcements: Record<string, Announce> = {};
  for (const value of Object.values((desired.announcements as Record<string, unknown> | undefined) ?? {})) {
    const a = announceShow.shape.payload.safeParse(value);
    if (a.success) announcements[a.data.announcementId] = a.data;
  }
  return {
    ...state,
    ...(config.success && { config: config.data }),
    ...(audio.success && { audio: audio.data }),
    theme: theme.success ? theme.data.theme : state.theme,
    announcements,
    emergency: emergency.success ? emergency.data : null,
    endNotice: emergency.success ? null : state.endNotice,
    clockOffsetMs: serverTime - deviceNow,
  };
}

/** Applies a command that changes state at once. `carousel.set` and `audio.play` are handled by the controller, which downloads first. */
export function applyCommand(state: AgentState, message: ServerMessage, deviceNow: number): AgentState {
  switch (message.type) {
    case "faculty.config.set":
      return { ...state, config: message.payload.config };
    case "theme.set":
      return { ...state, theme: message.payload.theme };
    case "faculty.content.set":
      return { ...state, faculty: message.payload };
    case "audio.settings.set":
      return { ...state, audio: message.payload };
    case "announce.show":
      return { ...state, announcements: { ...state.announcements, [message.payload.announcementId]: message.payload } };
    case "announce.clear": {
      const { [message.payload.announcementId]: _gone, ...rest } = state.announcements;
      return { ...state, announcements: rest };
    }
    case "emergency.set":
      return { ...state, emergency: message.payload, endNotice: null };
    case "emergency.clear": {
      // A clear for an alert we no longer show (a newer one took over) must not end the newer one.
      if (state.emergency?.emergencyId !== message.payload.emergencyId) return state;
      const { message: text, noticeSeconds } = message.payload;
      const durationMs = noticeSeconds ? Math.min(END_NOTICE_MAX_MS, Math.max(END_NOTICE_MIN_MS, noticeSeconds * 1000)) : END_NOTICE_DEFAULT_MS;
      return {
        ...state,
        emergency: null,
        endNotice: text ? { emergencyId: message.payload.emergencyId, message: text, shownAt: deviceNow + state.clockOffsetMs, durationMs } : null,
      };
    }
    default:
      return state;
  }
}

/** Replaces the active carousel. Called only once all of its files are verified. */
export const activateCarousel = (state: AgentState, scenes: WireScene[], updatedAt: number): AgentState => ({ ...state, carousel: { scenes, updatedAt } });

/** The files a scene needs: tiles name them as `settings.asset`. Other kinds (streams, pages) are fetched by the page itself. */
export const assetsOfScenes = (scenes: readonly WireScene[]): AssetRef[] => {
  const refs = new Map<string, AssetRef>();
  for (const scene of scenes) {
    for (const tile of scene.tiles) {
      const asset = assetOf(tile.settings);
      if (asset) refs.set(asset.assetId, asset);
    }
  }
  return [...refs.values()];
};

/** A tile's file, if its settings carry one. The protocol checked its shape for the kinds it knows; for others it is ignored. */
const assetOf = (settings: Record<string, unknown>): AssetRef | null => {
  const a = settings.asset as Partial<AssetRef> | undefined;
  return a && typeof a.assetId === "string" && typeof a.sha256 === "string" && typeof a.size === "number" && typeof a.mime === "string" ? (a as AssetRef) : null;
};

/** Drops what has expired so the saved state does not grow forever. */
export function prune(state: AgentState, deviceNow: number): AgentState {
  const now = deviceNow + state.clockOffsetMs;
  const announcements = Object.fromEntries(Object.entries(state.announcements).filter(([, a]) => a.expiresAt === undefined || a.expiresAt > now));
  const endNotice = state.endNotice && state.endNotice.shownAt + state.endNotice.durationMs > now ? state.endNotice : null;
  const changed = Object.keys(announcements).length !== Object.keys(state.announcements).length || endNotice !== state.endNotice;
  return changed ? { ...state, announcements, endNotice } : state;
}

/** The font files of the current theme. */
export const fontsOfTheme = (theme: ThemeSpec | null): AssetRef[] => Object.values(theme?.fonts ?? {});

/** Every file the state needs on disk: the carousel's media, the logo and the theme's fonts. Anything else can be deleted. */
export function neededAssets(state: AgentState): AssetRef[] {
  const refs = [...assetsOfScenes(state.carousel.scenes), ...fontsOfTheme(state.theme)];
  return state.config.site.logo ? [...refs, state.config.site.logo] : refs;
}

/** The theme as the page gets it (`fonts` may be missing in a state saved before themes had fonts). A font whose file is not verified yet is left out: the page keeps its own font until it is. */
function themeView(theme: ThemeSpec, rt: Runtime): NonNullable<ViewState["theme"]> {
  const fonts: NonNullable<NonNullable<ViewState["theme"]>["fonts"]> = {};
  for (const [slot, ref] of Object.entries(theme.fonts ?? {})) if (rt.has(ref)) fonts[slot as keyof typeof fonts] = rt.urlOf(ref);
  return {
    id: theme.id,
    name: theme.name,
    version: theme.version,
    tokens: theme.tokens,
    ...(Object.keys(fonts).length > 0 && { fonts }),
    ...(theme.emergency && { emergency: theme.emergency }),
    ...(theme.css && { css: theme.css }),
  };
}

export interface Runtime {
  phase: ViewState["phase"];
  enrollment: ViewState["enrollment"];
  online: boolean;
  offlineSince: number | null;
  weather: ViewState["weather"];
  /** Local URL of a cached file. */
  urlOf: (ref: Pick<AssetRef, "assetId" | "mime">) => string;
  /** Whether a file is on disk: a scene whose file is missing is left out rather than shown broken. */
  has: (ref: AssetRef) => boolean;
}

const emergencyView = (e: Emergency): EmergencyView => {
  const info = EMERGENCY_CATALOGUE[e.kind as EmergencyKind];
  return { ...e, color: info?.color ?? "#ff5a36", loud: info?.loud ?? true };
};

const configView = (c: FacultyConfig): ConfigView => ({
  site: { name: c.site.name, subtitle: c.site.subtitle, zone: c.site.zone, assemblyPoint: c.site.assemblyPoint, emergencyNumber: c.site.emergencyNumber },
  carousel: { enabled: c.carousel.enabled },
  widgets: c.widgets,
  service: c.service,
});

/** What the kiosk page is given: everything it draws, nothing it could misuse. */
export function toViewState(state: AgentState, rt: Runtime): ViewState {
  const scenes: SceneView[] = [];
  for (const scene of state.carousel.scenes) {
    const tiles: SceneView["tiles"] = [];
    let ready = true;
    for (const tile of scene.tiles) {
      const asset = assetOf(tile.settings);
      // A scene whose file is not on disk is left out rather than shown with a hole.
      if (asset && !rt.has(asset)) ready = false;
      // The page gets the local URL of the file, not its id or hash: it has no use for them.
      const { asset: _asset, ...settings } = tile.settings;
      tiles.push({ id: tile.id, kind: tile.kind, settings, ...(asset && { src: rt.urlOf(asset) }) });
    }
    if (!ready) continue;
    scenes.push({
      id: scene.id,
      name: scene.name,
      layout: scene.layout,
      durationSeconds: scene.durationSeconds,
      ...(scene.startsAt !== undefined && { startsAt: scene.startsAt }),
      ...(scene.endsAt !== undefined && { endsAt: scene.endsAt }),
      tiles,
    });
  }
  const logo = state.config.site.logo;
  return {
    phase: rt.phase,
    enrollment: rt.enrollment,
    online: rt.online,
    offlineSince: rt.offlineSince,
    clockOffsetMs: state.clockOffsetMs,
    config: configView(state.config),
    faculty: state.faculty,
    scenes,
    announcements: Object.values(state.announcements).map((a) => ({
      id: a.announcementId,
      ...(a.title && { title: a.title }),
      text: a.text,
      priority: a.priority,
      ...(a.expiresAt !== undefined && { expiresAt: a.expiresAt }),
    })),
    emergency: state.emergency ? emergencyView(state.emergency) : null,
    endNotice: state.endNotice ? { message: state.endNotice.message, shownAt: state.endNotice.shownAt, durationMs: state.endNotice.durationMs } : null,
    weather: state.config.widgets.weather ? rt.weather : null,
    theme: state.theme ? themeView(state.theme, rt) : null,
    logoUrl: logo && rt.has(logo) ? rt.urlOf(logo) : null,
    audio: state.audio,
  };
}
