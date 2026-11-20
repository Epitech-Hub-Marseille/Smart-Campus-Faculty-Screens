/**
 * The alarm of each kind of emergency, drawn as one loop of samples from a few oscillators, so a screen needs no sound files:
 * the alarm works with the network down, starts at once and cannot be changed in transit. The door units draw the same
 * alarms (`AlarmSynth.kt`), with the same numbers.
 *
 * Each pattern follows the convention people already know for its meaning, but the sounds are our own:
 *  - fire: the evacuation "temporal 3" rhythm of ISO 8201 (three pulses of 0.5 s with 0.5 s between, then 1.5 s of silence);
 *  - bomb: a two-tone "hi-lo", the European signal to leave calmly and at once;
 *  - biohazard: a slow wail, up and down, the signal to stay where you are;
 *  - nuclear: a deep steady horn with a slow fall, the civil defence "alert" idea, to shelter now;
 *  - seismic: a fast yelp over a low rumble;
 *  - power: a soft three-note chime, nobody is in danger.
 * Pulses are built from odd harmonics (a hollow, carrying sound that a small speaker reproduces) and every one has a short
 * attack and release, so there is no click, and each loop ends in silence or on its own first note, so it repeats seamlessly.
 */
export const ALARM_RATE = 22_050;

/** Headroom under full scale, so a speaker amplifier does not clip the loudest note. */
const PEAK = 0.9;

type Harmonics = readonly (readonly [number, number])[];

/** A hollow, carrying voice: odd harmonics falling away like a square wave. */
const HOLLOW: Harmonics = [[1, 1], [3, 0.33], [5, 0.2], [7, 0.1]];
const HORN: Harmonics = [[1, 1], [2, 0.5], [3, 0.35], [4, 0.15]];
const SIREN: Harmonics = [[1, 1], [2, 0.25], [3, 0.12]];
const BELL: Harmonics = [[1, 1], [2.76, 0.35], [5.4, 0.12]];

interface ToneOptions {
  from: number;
  to?: number;
  gain?: number;
  harmonics?: Harmonics;
  attack?: number;
  release?: number;
  /** Per second, e.g. 5 for a slow wobble; depth is the share of the level it removes. */
  tremolo?: readonly [number, number];
  /** Time constant of a fall (a struck bell), in seconds; 0 for a held note. */
  decay?: number;
}

class Track {
  readonly samples: Float32Array;
  constructor(readonly seconds: number, readonly rate: number) {
    this.samples = new Float32Array(Math.round(seconds * rate));
  }

  /** Adds one note of `length` seconds at `at`; the pitch moves linearly from `from` to `to`. */
  tone(at: number, length: number, { from, to = from, gain = 1, harmonics = HOLLOW, attack = 0.01, release = 0.03, tremolo, decay = 0 }: ToneOptions) {
    const start = Math.round(at * this.rate);
    const count = Math.round(length * this.rate);
    const norm = harmonics.reduce((sum, [, level]) => sum + level, 0);
    // Harmonics above what the rate can carry would fold back into the sound as noise.
    const usable = harmonics.filter(([multiple]) => Math.max(from, to) * multiple < this.rate * 0.45);
    let phase = 0;
    for (let n = 0; n < count; n++) {
      const index = start + n;
      if (index >= this.samples.length) break;
      const t = n / this.rate;
      phase += (2 * Math.PI * (from + (to - from) * (n / count))) / this.rate;
      let voice = 0;
      for (const [multiple, level] of usable) voice += level * Math.sin(multiple * phase);
      let envelope = Math.min(1, t / attack) * Math.min(1, (length - t) / release);
      if (decay > 0) envelope *= Math.exp(-t / decay);
      if (tremolo) envelope *= 1 - tremolo[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremolo[0] * t));
      this.samples[index]! += (voice / norm) * envelope * gain;
    }
  }

  /** Scales the loop to the headroom, as 16-bit-safe floats. */
  render(): Float32Array<ArrayBuffer> {
    let max = 1e-9;
    for (const v of this.samples) max = Math.max(max, Math.abs(v));
    return this.samples.map((v) => (v / max) * PEAK);
  }
}

/** ISO 8201 temporal 3: pulse, pause, pulse, pause, pulse, then a long silence: 4 s in all. */
function fire(rate: number) {
  const t = new Track(4, rate);
  for (let i = 0; i < 3; i++) t.tone(i * 1, 0.5, { from: 960, harmonics: HOLLOW, attack: 0.006, release: 0.02 });
  return t;
}

/** Hi-lo: four pairs of a high and a low tone, then a breath: 3.2 s. */
function bomb(rate: number) {
  const t = new Track(3.2, rate);
  for (let i = 0; i < 4; i++) {
    t.tone(i * 0.7, 0.35, { from: 990, harmonics: SIREN, attack: 0.008, release: 0.02 });
    t.tone(i * 0.7 + 0.35, 0.35, { from: 660, harmonics: SIREN, attack: 0.008, release: 0.02 });
  }
  return t;
}

/** A slow wail: up for two seconds, down for two, with a slight tremble: 4 s. */
function biohazard(rate: number) {
  const t = new Track(4, rate);
  t.tone(0, 2, { from: 520, to: 880, harmonics: SIREN, attack: 0.03, release: 0.03, tremolo: [5, 0.2] });
  t.tone(2, 2, { from: 880, to: 520, harmonics: SIREN, attack: 0.03, release: 0.03, tremolo: [5, 0.2] });
  return t;
}

/** A deep horn that slowly falls and swells again, with a short high ping when it starts: 4 s. */
function nuclear(rate: number) {
  const t = new Track(4, rate);
  t.tone(0, 3.4, { from: 330, to: 262, harmonics: HORN, attack: 0.06, release: 0.2, tremolo: [3, 0.18] });
  t.tone(0, 0.25, { from: 1760, gain: 0.3, harmonics: SIREN, attack: 0.004, release: 0.15 });
  return t;
}

/** A fast yelp (a quick rising sweep, eight times) over a low rumble, then a pause: 3.6 s. */
function seismic(rate: number) {
  const t = new Track(3.6, rate);
  for (let i = 0; i < 8; i++) t.tone(i * 0.3, 0.27, { from: 700, to: 1500, harmonics: SIREN, attack: 0.005, release: 0.03 });
  t.tone(0, 2.5, { from: 95, to: 85, gain: 0.55, harmonics: [[1, 1], [2, 0.8], [3, 0.5], [4, 0.3]], attack: 0.1, release: 0.3, tremolo: [8, 0.5] });
  return t;
}

/** A soft, falling three-note bell. Not a siren: people are informed, not in danger. 6 s. */
function power(rate: number) {
  const t = new Track(6, rate);
  [659, 523, 440].forEach((hz, i) => t.tone(i * 0.6, 1.4, { from: hz, harmonics: BELL, attack: 0.006, release: 0.5, decay: 0.5 }));
  return t;
}

const PATTERNS: Record<string, (rate: number) => Track> = { fire, bomb, biohazard, nuclear, seismic, power };

/** One loop of the alarm of `kind`. A kind a newer server invents is still an alarm: it sounds like a fire. */
export function alarmCycle(kind: string, rate = ALARM_RATE): Float32Array<ArrayBuffer> {
  return (PATTERNS[kind] ?? fire)(rate).render();
}
