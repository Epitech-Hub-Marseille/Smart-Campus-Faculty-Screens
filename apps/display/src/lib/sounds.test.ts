// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playSound, silenceSounds } from "./sounds";

const created: { src: string; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; volume: number }[] = [];

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal(
    "Audio",
    class {
      src: string;
      volume = 1;
      pause = vi.fn();
      play = vi.fn(() => Promise.resolve());
      addEventListener = vi.fn();
      constructor(src: string) {
        this.src = src;
        created.push(this as never);
      }
    },
  );
});
afterEach(() => silenceSounds(false));

describe("sounds", () => {
  it("plays at the volume asked, kept between 0 and 1", () => {
    playSound("/a.mp3", 50);
    playSound("/b.mp3", 500);
    expect(created.map((a) => a.volume)).toEqual([0.5, 1]);
    expect(created.every((a) => a.play.mock.calls.length === 1)).toBe(true);
  });

  it("stops what is playing when an alarm starts, and plays nothing until it ends", () => {
    playSound("/a.mp3", 80);
    silenceSounds(true);
    expect(created[0]!.pause).toHaveBeenCalled();
    playSound("/b.mp3", 80);
    expect(created).toHaveLength(1);
    silenceSounds(false);
    playSound("/c.mp3", 80);
    expect(created).toHaveLength(2);
  });
});
