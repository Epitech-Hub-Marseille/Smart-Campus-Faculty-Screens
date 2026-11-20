/**
 * The sounds the agent asks the page to play (an announcement, a chime): kept so an alarm can stop them at once and so none
 * starts while it sounds. The one exception is an urgent read-out, the voice of the emergency itself: it is heard through the
 * alarm, and the alarm steps back for as long as it plays (see `onUrgentSound`).
 *
 * A browser that has not been touched yet refuses to play anything (the kiosk is started so that it does not). A refused sound
 * is held, the page says so (see `soundBlocked`), and the first touch plays what is still worth hearing.
 */
const playing = new Set<HTMLAudioElement>();
const urgentPlaying = new Set<HTMLAudioElement>();
let silenced = false;
let duck: (on: boolean) => void = () => undefined;

/** Called with true when an urgent read-out starts and with false when the last one has ended. */
export function onUrgentSound(listener: (speaking: boolean) => void): void {
  duck = listener;
}

// ---- sound refused by the browser ----

/** A read-out that arrives minutes before anybody touches the screen would be an old message: it is dropped after this long. */
export const BLOCKED_SOUND_MAX_AGE_MS = 60_000;
const GESTURES = ["pointerdown", "keydown", "touchstart", "click"] as const;

interface Held {
  src: string;
  volume: number;
  urgent: boolean;
  at: number;
}
let held: Held[] = [];
const blockers = new Set<string>();
const listeners = new Set<() => void>();
let waiting = false;

const notify = () => listeners.forEach((l) => l());

/** Whether the browser is keeping sound from the screen until it is touched. For the page to say so. */
export const soundBlocked = () => blockers.size > 0;
export function subscribeBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `who` says what is blocked ("alarm", "sound"); the notice stays up while any of them is. */
export function setBlocked(who: string, on: boolean): void {
  if (on === blockers.has(who)) return;
  if (on) blockers.add(who);
  else blockers.delete(who);
  notify();
}

function touched() {
  for (const type of GESTURES) window.removeEventListener(type, touched, true);
  waiting = false;
  const items = held;
  held = [];
  setBlocked("sound", false);
  for (const item of items) if (Date.now() - item.at < BLOCKED_SOUND_MAX_AGE_MS) playSound(item.src, item.volume, item.urgent);
}

function hold(item: Held) {
  held.push(item);
  setBlocked("sound", true);
  if (waiting) return;
  waiting = true;
  for (const type of GESTURES) window.addEventListener(type, touched, true);
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
  void audio.play().catch((err: unknown) => {
    done();
    if ((err as { name?: string } | null)?.name === "NotAllowedError") hold({ src, volume, urgent, at: Date.now() });
  });
}

/** While `on`, nothing but an urgent read-out is played, and what is playing stops. */
export function silenceSounds(on: boolean): void {
  silenced = on;
  if (!on) return;
  for (const audio of playing) audio.pause();
  playing.clear();
}
