import { useEffect, useMemo, useState } from "react";
import { rotation, type ConfigView, type Page, type SceneView } from "@smartcampus/faculty-local";

/**
 * What the screen shows now: the scenes of the carousel, each for its time, round and round. The scene on screen is
 * remembered by its id, not its position, so when the set of scenes changes (one began or ended, the playlist was
 * replaced) the scene on screen stays if it still exists and the screen never jumps back to the start for no reason.
 * If it no longer exists, the first one is shown. With the carousel switched off the first scene stays.
 */
export function useRotation(config: ConfigView, scenes: readonly SceneView[], now: number): Page {
  // Rebuilt every few seconds so a scene that begins or ends is noticed, not on every clock tick.
  const pages = useMemo(() => rotation(scenes, now), [scenes, Math.floor(now / 5_000)]);
  const [currentId, setCurrentId] = useState("");

  const found = pages.findIndex((p) => p.scene.id === currentId);
  const index = found >= 0 ? found : 0;
  const page = pages[index]!;

  useEffect(() => {
    if (pages.length <= 1 || !config.carousel.enabled) return;
    const next = pages[(index + 1) % pages.length]!;
    const timer = setTimeout(() => setCurrentId(next.scene.id), Math.max(3, page.seconds) * 1000);
    return () => clearTimeout(timer);
  }, [page.scene.id, pages.map((p) => p.scene.id).join("|"), config.carousel.enabled]);

  return page;
}
