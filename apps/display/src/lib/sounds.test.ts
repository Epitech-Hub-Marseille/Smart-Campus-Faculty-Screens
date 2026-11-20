// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_SOUND_MAX_AGE_MS, onUrgentSound, playSound, setBlocked, silenceSounds, soundBlocked, subscribeBlocked } from "./sounds";

const created: { listeners: Record<string, () => void>; src: string; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; volume: number }[] = [];

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal(
    "Audio",
    class {
      src: string;
      volume = 1;
      pause = vi.fn();
      play = vi.fn(() => Promise.resolve());
      listeners: Record<string, () => void> = {};
      addEventListener = (type: string, fn: () => void) => void (this.listeners[type] = fn);
      constructor(src: string) {
        this.src = src;
        created.push(this as never);
      }
    },
  );
});
afterEach(() => {
  silenceSounds(false);
  onUrgentSound(() => undefined);
});

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

  it("lets an urgent read-out through an alarm, and does not stop it when the alarm starts", () => {
    silenceSounds(true);
    playSound("/voice.wav", 100, true);
    playSound("/radio.mp3", 80);
    expect(created.map((a) => a.src)).toEqual(["/voice.wav"]);
    silenceSounds(true);
    expect(created[0]!.pause).not.toHaveBeenCalled();
    created[0]!.listeners.ended!();
  });

  it("tells the alarm to step back for as long as a read-out plays, once for overlapping ones", () => {
    const calls: boolean[] = [];
    onUrgentSound((speaking) => calls.push(speaking));
    playSound("/one.wav", 100, true);
    playSound("/two.wav", 100, true);
    expect(calls).toEqual([true]);
    created[0]!.listeners.ended!();
    expect(calls).toEqual([true]);
    created[1]!.listeners.ended!();
    created[1]!.listeners.error!();
    expect(calls).toEqual([true, false]);
  });

  it("brings the alarm back when a read-out cannot play", async () => {
    const calls: boolean[] = [];
    onUrgentSound((speaking) => calls.push(speaking));
    const Original = globalThis.Audio;
    vi.stubGlobal("Audio", class extends (Original as never as new (s: string) => object) {
      play = () => Promise.reject(new Error("blocked"));
    });
    playSound("/blocked.wav", 100, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([true, false]);
  });

  describe("a browser that has not been touched", () => {
    const refuse = () =>
      vi.stubGlobal(
        "Audio",
        class {
          src: string;
          volume = 1;
          pause = vi.fn();
          listeners: Record<string, () => void> = {};
          addEventListener = (t: string, f: () => void) => void (this.listeners[t] = f);
          play = vi.fn(() => (created.length > 1 ? Promise.resolve() : Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }))));
          constructor(src: string) {
            this.src = src;
            created.push(this as never);
          }
        },
      );

    afterEach(() => {
      window.dispatchEvent(new Event("pointerdown"));
      setBlocked("alarm", false);
      vi.useRealTimers();
    });

    it("says so, and plays the read-out it refused at the first touch", async () => {
      refuse();
      const seen: boolean[] = [];
      const off = subscribeBlocked(() => seen.push(soundBlocked()));
      playSound("/voice.wav", 100, true);
      await Promise.resolve();
      await Promise.resolve();
      expect(soundBlocked()).toBe(true);
      expect(created).toHaveLength(1);
      window.dispatchEvent(new Event("pointerdown"));
      expect(soundBlocked()).toBe(false);
      expect(created.map((a) => a.src)).toEqual(["/voice.wav", "/voice.wav"]);
      expect(seen).toEqual([true, false]);
      off();
    });

    it("drops a sound that waited too long for a touch, and says so while the alarm is blocked too", async () => {
      vi.useFakeTimers();
      refuse();
      playSound("/old.wav", 100, true);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(BLOCKED_SOUND_MAX_AGE_MS + 1);
      setBlocked("alarm", true);
      window.dispatchEvent(new Event("pointerdown"));
      expect(created).toHaveLength(1);
      expect(soundBlocked()).toBe(true); // the alarm is still waiting for its own touch
    });
  });
});
