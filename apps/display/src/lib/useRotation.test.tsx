// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, FALLBACK_SCENES, type ConfigView, type SceneView } from "@smartcampus/faculty-local";
import { useRotation } from "./useRotation";

const scene = (id: string, seconds = 10): SceneView => ({ id, name: id, layout: "full", durationSeconds: seconds, tiles: [{ id: `${id}-t`, kind: "text", settings: { text: id } }] });
const config = (patch: Partial<ConfigView> = {}): ConfigView => ({ ...DEFAULT_CONFIG, ...patch });
const id = (p: { scene: SceneView }) => p.scene.id;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRotation", () => {
  it("takes turns through the scenes, each for its time, and starts over", () => {
    const scenes = [scene("a", 10), scene("b", 20), scene("c", 5)];
    const { result } = renderHook(() => useRotation(config(), scenes, 1_000));
    const seen = [id(result.current)];
    for (const wait of [10, 20, 5]) {
      act(() => void vi.advanceTimersByTime(wait * 1000));
      seen.push(id(result.current));
    }
    expect(seen).toEqual(["a", "b", "c", "a"]);
  });

  it("stays put when there is one scene", () => {
    const { result } = renderHook(() => useRotation(config(), [scene("a")], 1_000));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(id(result.current)).toBe("a");
  });

  it("does not rotate when the carousel is switched off", () => {
    const { result } = renderHook(() => useRotation(config({ carousel: { enabled: false } }), [scene("a"), scene("b")], 1_000));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(id(result.current)).toBe("a");
  });

  it("keeps the scene on screen when the playlist changes around it", () => {
    const { result, rerender } = renderHook(({ list }) => useRotation(config(), list, 1_000), { initialProps: { list: [scene("a"), scene("b")] } });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(id(result.current)).toBe("b");
    rerender({ list: [scene("c"), scene("a"), scene("b")] });
    expect(id(result.current)).toBe("b");
  });

  it("falls back to the first scene when the one on screen disappears", () => {
    const { result, rerender } = renderHook(({ list }) => useRotation(config(), list, 1_000), { initialProps: { list: [scene("a"), scene("b")] } });
    act(() => void vi.advanceTimersByTime(10_000));
    rerender({ list: [scene("a")] });
    expect(id(result.current)).toBe("a");
  });

  it("shows the information board when there is no scene, never a blank screen", () => {
    const { result } = renderHook(() => useRotation(config(), [], 1_000));
    expect(id(result.current)).toBe(FALLBACK_SCENES[0]!.id);
  });
});
