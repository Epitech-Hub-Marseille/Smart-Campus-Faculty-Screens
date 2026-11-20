import { describe, expect, it } from "vitest";
import { ALARM_RATE, alarmCycle } from "./alarmSynth";

const KINDS = ["fire", "biohazard", "nuclear", "bomb", "seismic", "power"];
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x: Float32Array, from: number, to: number) => {
  const a = Math.round(from * ALARM_RATE);
  const b = Math.round(to * ALARM_RATE);
  let sum = 0;
  for (let i = a; i < b; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / (b - a));
};
/** Strength of one frequency in a stretch (Goertzel). */
function level(x: Float32Array, hz: number, from: number, to: number) {
  const w = (2 * Math.PI * hz) / ALARM_RATE;
  let s1 = 0;
  let s2 = 0;
  for (let i = Math.round(from * ALARM_RATE); i < Math.round(to * ALARM_RATE); i++) {
    const s0 = x[i]! + 2 * Math.cos(w) * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2);
}

describe("the alarms", () => {
  it("each kind has a loop of its own that is audible, finite, under full scale and at least two seconds", () => {
    const loops = KINDS.map((kind) => alarmCycle(kind));
    loops.forEach((x, i) => {
      expect(x.length, KINDS[i]).toBeGreaterThanOrEqual(ALARM_RATE * 2);
      expect(x.every(Number.isFinite), KINDS[i]).toBe(true);
      expect(peak(x), KINDS[i]).toBeLessThanOrEqual(0.9001);
      expect(peak(x), KINDS[i]).toBeGreaterThan(0.8);
    });
    for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) expect(loops[i]).not.toEqual(loops[j]);
  });

  it("repeat without a click: a loop begins and ends on silence", () => {
    for (const kind of KINDS) {
      const x = alarmCycle(kind);
      expect(Math.abs(x[0]!), kind).toBeLessThan(0.02);
      expect(Math.abs(x[x.length - 1]!), kind).toBeLessThan(0.02);
    }
  });

  it("fire is the evacuation rhythm: three half-second pulses half a second apart, then one and a half seconds of silence", () => {
    const x = alarmCycle("fire");
    expect(x.length).toBe(ALARM_RATE * 4);
    for (const start of [0, 1, 2]) {
      expect(rms(x, start + 0.05, start + 0.45)).toBeGreaterThan(0.3);
      expect(rms(x, start + 0.55, start + 0.95)).toBeLessThan(0.01);
    }
    expect(rms(x, 2.6, 3.95)).toBeLessThan(0.01);
  });

  it("bomb alternates a high and a low tone", () => {
    const x = alarmCycle("bomb");
    expect(level(x, 990, 0.05, 0.3)).toBeGreaterThan(level(x, 660, 0.05, 0.3) * 4);
    expect(level(x, 660, 0.4, 0.65)).toBeGreaterThan(level(x, 990, 0.4, 0.65) * 4);
  });

  it("the power cut is quiet next to a danger alarm's sharpness: a bell that dies away", () => {
    const x = alarmCycle("power");
    expect(rms(x, 0.02, 0.3)).toBeGreaterThan(rms(x, 1.0, 1.15));
  });

  it("a kind from a newer server still sounds, like a fire", () => {
    expect(alarmCycle("alien-landing")).toEqual(alarmCycle("fire"));
  });

  it("are the same at any rate", () => {
    expect(alarmCycle("seismic", 16_000).length).toBe(16_000 * 3.6);
    expect(alarmCycle("seismic", 16_000).every(Number.isFinite)).toBe(true);
  });
});
