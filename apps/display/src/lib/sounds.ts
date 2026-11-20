/**
 * The sounds the agent asks the page to play (an announcement, a chime): kept so an alarm can stop them at once and so none
 * starts while it sounds.
 */
const playing = new Set<HTMLAudioElement>();
let silenced = false;

export function playSound(src: string, volume: number): void {
  if (silenced) return;
  const audio = new Audio(src);
  audio.volume = Math.min(1, Math.max(0, volume / 100));
  playing.add(audio);
  const done = () => playing.delete(audio);
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  void audio.play().catch(done);
}

/** While `on`, nothing is played, and what is playing stops. */
export function silenceSounds(on: boolean): void {
  silenced = on;
  if (!on) return;
  for (const audio of playing) audio.pause();
  playing.clear();
}
