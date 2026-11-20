/**
 * The sounds the agent asks the page to play (an announcement, a chime): kept so an alarm can stop them at once and so none
 * starts while it sounds. The one exception is an urgent read-out, the voice of the emergency itself: it is heard through the
 * alarm, and the alarm steps back for as long as it plays (see `onUrgentSound`).
 */
const playing = new Set<HTMLAudioElement>();
const urgentPlaying = new Set<HTMLAudioElement>();
let silenced = false;
let duck: (on: boolean) => void = () => undefined;

/** Called with true when an urgent read-out starts and with false when the last one has ended. */
export function onUrgentSound(listener: (speaking: boolean) => void): void {
  duck = listener;
}

export function playSound(src: string, volume: number, urgent = false): void {
  if (silenced && !urgent) return;
  const audio = new Audio(src);
  audio.volume = Math.min(1, Math.max(0, volume / 100));
  const set = urgent ? urgentPlaying : playing;
  set.add(audio);
  if (urgent && urgentPlaying.size === 1) duck(true);
  const done = () => {
    if (!set.delete(audio)) return;
    if (urgent && urgentPlaying.size === 0) duck(false);
  };
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  void audio.play().catch(done);
}

/** While `on`, nothing but an urgent read-out is played, and what is playing stops. */
export function silenceSounds(on: boolean): void {
  silenced = on;
  if (!on) return;
  for (const audio of playing) audio.pause();
  playing.clear();
}
