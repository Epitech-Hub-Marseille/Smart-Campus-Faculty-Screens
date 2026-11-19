// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThemeView } from "@smartcampus/faculty-local";
import { useTheme } from "./useTheme";

const theme = (extra: Partial<ThemeView> = {}): ThemeView => ({ id: "t", name: "T", version: 1, tokens: { colors: { primary: "#4f8cff" }, typography: { scale: 1.1 }, shape: { radius: 16 } }, css: ".card { gap: 1rem }", ...extra });
const root = () => document.documentElement.style;
const style = () => document.getElementById("theme-css");

afterEach(() => {
  cleanup();
  root().cssText = "";
});

describe("useTheme", () => {
  it("sets the variables and adds the CSS", () => {
    renderHook(() => useTheme(theme(), false));
    expect(root().getPropertyValue("--accent")).toBe("#4f8cff");
    expect(root().getPropertyValue("--scale")).toBe("1.1");
    expect(root().getPropertyValue("--radius")).toBe("1rem");
    expect(style()?.textContent).toBe(".card { gap: 1rem }");
  });

  it("changes nothing without a theme, and without CSS adds no style element", () => {
    renderHook(() => useTheme(null, false));
    expect(root().getPropertyValue("--accent")).toBe("");
    expect(style()).toBeNull();
    renderHook(() => useTheme(theme({ css: undefined }), false));
    expect(style()).toBeNull();
  });

  it("takes everything away while an emergency is showing, and puts it back after", () => {
    const { rerender } = renderHook(({ off }) => useTheme(theme(), off), { initialProps: { off: false } });
    expect(root().getPropertyValue("--accent")).toBe("#4f8cff");
    rerender({ off: true });
    expect(root().getPropertyValue("--accent")).toBe("");
    expect(root().getPropertyValue("--scale")).toBe("");
    expect(style()).toBeNull();
    rerender({ off: false });
    expect(root().getPropertyValue("--accent")).toBe("#4f8cff");
    expect(style()).not.toBeNull();
  });

  it("during an emergency, keeps only the font files the theme lets an alert use, never its colours or CSS", () => {
    const dressed = theme({ fonts: { heading: "/media/H.ttf" }, emergency: { fonts: true, frame: "bar", colors: {} } });
    renderHook(() => useTheme(dressed, true));
    expect(root().getPropertyValue("--accent")).toBe("");
    expect(style()?.textContent).toContain('font-family:"sc-heading"');
    expect(style()?.textContent).not.toContain(".card");
    cleanup();
    renderHook(() => useTheme(theme({ fonts: { heading: "/media/H.ttf" }, emergency: { fonts: false, frame: "stripes", colors: {} } }), true));
    expect(style()).toBeNull();
  });

  it("replaces a theme by the next one without leaving the old one behind, and cleans up when it ends", () => {
    const { rerender, unmount } = renderHook(({ t }) => useTheme(t, false), { initialProps: { t: theme() } });
    rerender({ t: theme({ tokens: { colors: { danger: "#aa0000" }, typography: {}, shape: {} }, css: ".x { color: red }" }) });
    expect(root().getPropertyValue("--accent")).toBe("");
    expect(root().getPropertyValue("--danger")).toBe("#aa0000");
    expect(document.querySelectorAll("#theme-css")).toHaveLength(1);
    expect(style()?.textContent).toBe(".x { color: red }");
    unmount();
    expect(root().getPropertyValue("--danger")).toBe("");
    expect(style()).toBeNull();
  });
});
