import { ALARM_RATE, alarmCycle } from "./alarmSynth";
import { setBlocked } from "./sounds";

/**
 * The alarm of an emergency, made in the browser so it works with the network down and cannot be tampered with in
 * transit (the same choice as the door units). Each kind of emergency has its own pattern (see `alarmSynth.ts`), drawn
 * once and looped.
 */
export interface Alarm {
  start(kind: string, level: number): void;
  stop(): void;
  /** Steps the alarm back (quieter and muffled) so a voice can be understood over it, and brings it back. */
  duck(on: boolean): void;
}

/** While a voice speaks the alarm is at a fifth of its level and loses everything above 700 Hz: still there, but no longer in the way. */
export const DUCK_GAIN = 0.2;
export const DUCK_CUTOFF_HZ = 700;
const OPEN_CUTOFF_HZ = 20_000;
const DUCK_SECONDS = 0.12;

/** A browser that does not allow sound without a touch (the kiosk is started so that it does) starts the sound suspended: any touch lets it through. */
const GESTURES = ["pointerdown", "keydown", "touchstart", "click"] as const;
const RESUME_EVERY_MS = 500;

export function createAlarm(makeContext: () => AudioContext = () => new AudioContext()): Alarm {
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let release: (() => void) | null = null;
  let master: GainNode | null = null;
  let muffle: BiquadFilterNode | null = null;
  let base = 0;
  let ducked = false;

  const applyDuck = () => {
    if (!ctx || !master || !muffle) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(ducked ? base * DUCK_GAIN : base, now, DUCK_SECONDS);
    muffle.frequency.setTargetAtTime(ducked ? DUCK_CUTOFF_HZ : OPEN_CUTOFF_HZ, now, DUCK_SECONDS);
  };

  return {
    start(kind, level) {
      this.stop();
      if (level <= 0) return;
      try {
        ctx = makeContext();
        // A kiosk starts with autoplay allowed. In a normal browser the context stays suspended, and so the alarm silent, until the
        // page has been touched: it is asked again every half second and at every touch for as long as the alarm lasts.
        const context = ctx;
        const wake = () => {
          if (context.state === "suspended") void context.resume().catch(() => undefined);
          // The page tells whoever is in front of it that the browser is keeping the alarm silent.
          setBlocked("alarm", context.state === "suspended");
        };
        wake();
        const timer = setInterval(wake, RESUME_EVERY_MS);
        for (const type of GESTURES) window.addEventListener(type, wake, true);
        release = () => {
          setBlocked("alarm", false);
          clearInterval(timer);
          for (const type of GESTURES) window.removeEventListener(type, wake, true);
        };
        const samples = alarmCycle(kind);
        const buffer = ctx.createBuffer(1, samples.length, ALARM_RATE);
        buffer.copyToChannel(samples, 0);
        base = Math.min(1, level);
        master = ctx.createGain();
        muffle = ctx.createBiquadFilter();
        muffle.type = "lowpass";
        muffle.frequency.value = OPEN_CUTOFF_HZ;
        master.gain.value = base;
        master.connect(muffle);
        muffle.connect(ctx.destination);
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(master);
        source.start();
        // A voice may already be speaking when the alarm starts.
        if (ducked) applyDuck();
      } catch {
        // No audio output: the screen is still a screen.
      }
    },
    stop() {
      release?.();
      release = null;
      try {
        source?.stop();
        void ctx?.close();
      } catch {
        // already stopped
      }
      source = null;
      master = null;
      muffle = null;
      ctx = null;
    },
    duck(on) {
      ducked = on;
      applyDuck();
    },
  };
}

/** How loud the alarm is: a real alert at its natural level, a test at the chosen volume and silent in quiet hours. */
export function alarmLevel(e: { testMode: boolean; testVolume: number; loud: boolean }, inQuietHours: boolean): number {
  if (e.testMode) return inQuietHours ? 0 : Math.min(100, Math.max(0, e.testVolume)) / 100;
  return e.loud ? 1 : 0.35;
}
