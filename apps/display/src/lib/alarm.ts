/**
 * The alarm of an emergency, made in the browser so it works with the network down and cannot be tampered with in
 * transit (the same choice as the door units). A danger alarm is a siren; a power cut is a soft chime.
 */
export interface Alarm {
  start(loud: boolean, level: number): void;
  stop(): void;
}

export function createAlarm(makeContext: () => AudioContext = () => new AudioContext()): Alarm {
  let ctx: AudioContext | null = null;
  let stopFn: (() => void) | null = null;

  return {
    start(loud, level) {
      this.stop();
      if (level <= 0) return;
      try {
        ctx = makeContext();
        // A kiosk starts with autoplay allowed; a normal browser needs a gesture, which is fine for development.
        void ctx.resume().catch(() => undefined);
        const master = ctx.createGain();
        master.gain.value = Math.min(1, level);
        master.connect(ctx.destination);

        if (loud) {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          const sweep = ctx.createOscillator();
          const depth = ctx.createGain();
          sweep.frequency.value = 0.9; // about one whoop a second
          depth.gain.value = 230;
          osc.frequency.value = 820;
          sweep.connect(depth).connect(osc.frequency);
          const tone = ctx.createGain();
          tone.gain.value = 0.55;
          osc.connect(tone).connect(master);
          osc.start();
          sweep.start();
          stopFn = () => (osc.stop(), sweep.stop());
        } else {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = 660;
          const pulse = ctx.createGain();
          pulse.gain.value = 0;
          osc.connect(pulse).connect(master);
          osc.start();
          // A short chime every two seconds.
          const id = setInterval(() => {
            const t = ctx!.currentTime;
            pulse.gain.cancelScheduledValues(t);
            pulse.gain.setValueAtTime(0, t);
            pulse.gain.linearRampToValueAtTime(0.8, t + 0.05);
            pulse.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
          }, 2_000);
          stopFn = () => (clearInterval(id), osc.stop());
        }
      } catch {
        // No audio output: the screen is still a screen.
      }
    },
    stop() {
      try {
        stopFn?.();
        void ctx?.close();
      } catch {
        // already stopped
      }
      stopFn = null;
      ctx = null;
    },
  };
}

/** How loud the alarm is: a real alert at its natural level, a test at the chosen volume and silent in quiet hours. */
export function alarmLevel(e: { testMode: boolean; testVolume: number; loud: boolean }, inQuietHours: boolean): number {
  if (e.testMode) return inQuietHours ? 0 : Math.min(100, Math.max(0, e.testVolume)) / 100;
  return e.loud ? 1 : 0.35;
}
