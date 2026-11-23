// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLivePlayer, decodePcm16 } from "./liveVoice";
import { soundBlocked } from "./sounds";

const b64 = (samples: number[]) => {
  const bytes = new Uint8Array(samples.length * 2);
  samples.forEach((v, i) => new DataView(bytes.buffer).setInt16(i * 2, v, true));
  return btoa(String.fromCharCode(...bytes));
};

function fakeContext(state: "running" | "suspended", time = { now: 0 }) {
  const starts: number[] = [];
  const ctx = {
    state,
    get currentTime() {
      return time.now;
    },
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createBuffer: vi.fn((_c: number, length: number) => ({ length, copyToChannel: vi.fn() })),
    createGain: vi.fn(),
    createBufferSource: vi.fn(() => ({ buffer: null as unknown, connect: vi.fn(), start: (at: number) => starts.push(at) })),
  };
  return { ctx: ctx as unknown as Parameters<typeof createLivePlayer>[1] extends (() => infer C) | undefined ? C : never, raw: ctx, starts };
}

describe("decodePcm16", () => {
  it("reads little-endian signed samples", () => {
    const out = decodePcm16(b64([0, 16384, -16384, 32767, -32768]));
    expect(Array.from(out).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0.5, -0.5, 1, -1]);
  });
});

describe("the live player", () => {
  afterEach(() => vi.useRealTimers());

  it("queues each slice to begin where the previous one ends, with a cushion at the start", () => {
    const time = { now: 10 };
    const { ctx, starts } = fakeContext("running", time);
    const player = createLivePlayer(() => undefined, () => ctx);
    player.start("s1");
    player.chunk("s1", b64(new Array(1600).fill(100))); // 0.1 s
    player.chunk("s1", b64(new Array(1600).fill(100)));
    expect(starts[0]).toBeCloseTo(10.18, 3);
    expect(starts[1]).toBeCloseTo(10.28, 3);
  });

  it("starts again with a fresh cushion when the voice fell behind, instead of playing late", () => {
    const time = { now: 0 };
    const { ctx, starts } = fakeContext("running", time);
    const player = createLivePlayer(() => undefined, () => ctx);
    player.chunk("s1", b64(new Array(1600).fill(1)));
    time.now = 5;
    player.chunk("s1", b64(new Array(1600).fill(1)));
    expect(starts[1]).toBeCloseTo(5.18, 3);
  });

  it("says when someone is speaking and when the last slice has played out", () => {
    vi.useFakeTimers();
    const time = { now: 0 };
    const { ctx } = fakeContext("running", time);
    const speaking = vi.fn();
    const player = createLivePlayer(speaking, () => ctx);
    player.start("s1");
    expect(speaking).toHaveBeenLastCalledWith(true);
    player.chunk("s1", b64(new Array(16000).fill(1))); // 1 s, plays from 0.18 to 1.18
    player.end("s1");
    vi.advanceTimersByTime(1000);
    expect(speaking).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1000);
    expect(speaking).toHaveBeenLastCalledWith(false);
  });

  it("asks a suspended browser for sound, says it is blocked, and clears that at the next touch", async () => {
    const { ctx, raw } = fakeContext("suspended");
    const player = createLivePlayer(() => undefined, () => ctx);
    player.start("s1");
    expect(raw.resume).toHaveBeenCalled();
    expect(soundBlocked()).toBe(true);
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    expect(soundBlocked()).toBe(false);
  });
});
