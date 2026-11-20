// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { alarmLevel, createAlarm } from "./alarm";

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

/** Just enough of the Web Audio API to see what the alarm does with it. */
function fakeContext(state: "running" | "suspended") {
  const ctx = {
    state,
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    destination: {},
    createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
    createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), loop: false, buffer: null })),
  };
  return ctx as unknown as AudioContext & typeof ctx;
}

describe("the alarm in a browser that keeps sound suspended", () => {
  afterEach(() => vi.useRealTimers());

  it("starts the loop, and asks again for sound every half second and at every touch until the alarm stops", () => {
    vi.useFakeTimers();
    const ctx = fakeContext("suspended");
    const alarm = createAlarm(() => ctx);
    alarm.start("fire", 1);
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(ctx.resume).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resume).toHaveBeenCalledTimes(4);
    alarm.stop();
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resume).toHaveBeenCalledTimes(4);
    expect(ctx.close).toHaveBeenCalled();
  });

  it("does not ask when the sound is already running, and plays nothing at level 0", () => {
    vi.useFakeTimers();
    const running = fakeContext("running");
    const alarm = createAlarm(() => running);
    alarm.start("seismic", 1);
    vi.advanceTimersByTime(2000);
    expect(running.resume).not.toHaveBeenCalled();
    alarm.stop();
    const silent = fakeContext("running");
    createAlarm(() => silent).start("fire", 0);
    expect(silent.createBufferSource).not.toHaveBeenCalled();
  });
});
