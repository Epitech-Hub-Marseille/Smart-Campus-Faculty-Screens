import { ALARM_RATE, alarmCycle } from "./alarmSynth";

/**
 * The alarm of an emergency, made in the browser so it works with the network down and cannot be tampered with in
 * transit (the same choice as the door units). Each kind of emergency has its own pattern (see `alarmSynth.ts`), drawn
 * once and looped.
 */
export interface Alarm {
  start(kind: string, level: number): void;
  stop(): void;
}

/** A browser that does not allow sound without a touch (the kiosk is started so that it does) starts the sound suspended: any touch lets it through. */
const GESTURES = ["pointerdown", "keydown", "touchstart", "click"] as const;
const RESUME_EVERY_MS = 500;

export function createAlarm(makeContext: () => AudioContext = () => new AudioContext()): Alarm {
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let release: (() => void) | null = null;

  return {
    start(kind, level) {
      this.stop();
      if (level <= 0) return;
      try {
        ctx = makeContext();
        // A kiosk starts with autoplay allowed. In a normal browser the context stays suspended, and so the alarm silent, until the
        // page has been touched: it is asked again every half second and at every touch for as long as the alarm lasts.
        const context = ctx;
        const wake = () => context.state === "suspended" && void context.resume().catch(() => undefined);
        wake();
        const timer = setInterval(wake, RESUME_EVERY_MS);
        for (const type of GESTURES) window.addEventListener(type, wake, true);
        release = () => {
          clearInterval(timer);
          for (const type of GESTURES) window.removeEventListener(type, wake, true);
        };
        const samples = alarmCycle(kind);
        const buffer = ctx.createBuffer(1, samples.length, ALARM_RATE);
        buffer.copyToChannel(samples, 0);
        const master = ctx.createGain();
        master.gain.value = Math.min(1, level);
        master.connect(ctx.destination);
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(master);
        source.start();
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
      ctx = null;
    },
  };
}

/** How loud the alarm is: a real alert at its natural level, a test at the chosen volume and silent in quiet hours. */
export function alarmLevel(e: { testMode: boolean; testVolume: number; loud: boolean }, inQuietHours: boolean): number {
  if (e.testMode) return inQuietHours ? 0 : Math.min(100, Math.max(0, e.testVolume)) / 100;
  return e.loud ? 1 : 0.35;
}
