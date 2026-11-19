import { describe, expect, it } from "vitest";
import { alarmLevel } from "./alarm";

describe("alarmLevel", () => {
  it("a real danger alarm is at full level and a power cut is a soft chime, whatever the quiet hours", () => {
    expect(alarmLevel({ testMode: false, testVolume: 20, loud: true }, true)).toBe(1);
    expect(alarmLevel({ testMode: false, testVolume: 20, loud: false }, true)).toBe(0.35);
  });

  it("a test plays at its chosen volume and stays silent in quiet hours, so a test never wakes anyone", () => {
    expect(alarmLevel({ testMode: true, testVolume: 40, loud: true }, false)).toBe(0.4);
    expect(alarmLevel({ testMode: true, testVolume: 40, loud: true }, true)).toBe(0);
    expect(alarmLevel({ testMode: true, testVolume: 500, loud: true }, false)).toBe(1);
    expect(alarmLevel({ testMode: true, testVolume: -5, loud: true }, false)).toBe(0);
  });
});
