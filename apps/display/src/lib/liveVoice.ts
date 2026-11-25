import { setBlocked } from "./sounds";

/** The rate of the voice the server sends. */
const SAMPLE_RATE = 16_000;
/**
 * How far ahead of "now" the first slice is scheduled, and the cushion the later ones keep: the network delivers the voice in
 * uneven bursts, and a player that played each slice the moment it arrived would crackle at every gap.
 */
const LEAD_SECONDS = 0.18;

type Context = Pick<AudioContext, "state" | "currentTime" | "destination" | "resume" | "createBuffer" | "createBufferSource" | "createGain">;

/** 16-bit little-endian PCM (base64) as floats in [-1, 1]. */
export function decodePcm16(base64: string): Float32Array {
  const raw = atob(base64);
  const out = new Float32Array(Math.floor(raw.length / 2));
  for (let i = 0; i < out.length; i++) {
    const v = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    out[i] = (v > 32767 ? v - 65536 : v) / 32768;
  }
  return out;
}

export interface LivePlayer {
  start(streamId: string): void;
  chunk(streamId: string, data: string): void;
  end(streamId: string): void;
}

/**
 * Plays a live announcement as it arrives: each slice is queued to start exactly when the previous one ends. `onSpeaking` is told
 * when the voice begins and when it has fully played out, so the alarm can step back for as long as someone is speaking.
 * A browser that has not been touched keeps the audio context suspended: it is resumed at once and at the next touch, and the
 * page says sound is blocked meanwhile (the same notice as for other sounds).
 */
export function createLivePlayer(onSpeaking: (speaking: boolean) => void, makeContext: () => Context = () => new AudioContext()): LivePlayer {
  let context: Context | null = null;
  let current: string | null = null;
  let nextAt = 0;
  let speaking = false;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;

  const setSpeaking = (on: boolean) => {
    if (on === speaking) return;
    speaking = on;
    onSpeaking(on);
  };

  const ensure = (): Context => {
    context ??= makeContext();
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
      setBlocked("live", true);
      const retry = () => {
        window.removeEventListener("pointerdown", retry, true);
        window.removeEventListener("keydown", retry, true);
        void context?.resume().then(() => setBlocked("live", false)).catch(() => undefined);
      };
      window.addEventListener("pointerdown", retry, true);
      window.addEventListener("keydown", retry, true);
    } else {
      setBlocked("live", false);
    }
    return context;
  };

  /** The voice is over once the last queued slice has played, not when the last one arrived. */
  const scheduleDone = () => {
    if (doneTimer) clearTimeout(doneTimer);
    const wait = context ? Math.max(0, nextAt - context.currentTime) : 0;
    doneTimer = setTimeout(() => setSpeaking(false), wait * 1000 + 250);
  };

  return {
    start(streamId) {
      current = streamId;
      nextAt = 0;
      ensure();
      setSpeaking(true);
    },
    chunk(streamId, data) {
      // A slice of a stream that was never announced (the start was missed) is taken up all the same: late is better than silent.
      if (current !== streamId) {
        current = streamId;
        nextAt = 0;
      }
      const ctx = ensure();
      const samples = decodePcm16(data);
      if (samples.length === 0) return;
      const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      // Behind the clock means the cushion ran dry: start again with a fresh one rather than playing the slice late and cutting.
      if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + LEAD_SECONDS;
      source.start(nextAt);
      nextAt += samples.length / SAMPLE_RATE;
      setSpeaking(true);
      scheduleDone();
    },
    end(streamId) {
      if (current !== streamId) return;
      current = null;
      scheduleDone();
    },
  };
}
