import { describe, expect, it } from "vitest";
import { FONT_STACKS, emergencyFontFaces, emergencyVariables, themeFontFaces, themeVariables, activeScenes, boardEvents, effectiveStaff, emergencyPresentation, FALLBACK_SCENES, rotation, roomRows, showsBoard, visibleAnnouncements, visibleEndNotice } from "./logic.js";
import { KNOWN_TILE_KINDS, SCENE_LAYOUTS, type ReservationView, type SceneView, type StaffView, type ThemeView } from "./view.js";

const noon = new Date(2026, 10, 6, 12, 0, 0).getTime();
const H = 3_600_000;
const scene = (id: string, extra: Partial<SceneView> = {}): SceneView => ({ id, name: id, layout: "full", durationSeconds: 20, tiles: [{ id: `${id}-t`, kind: "text", settings: { text: id } }], ...extra });
const booking = (id: string, startH: number, endH: number, room = id): ReservationView => ({ id, room, title: id, start: noon + startH * H, end: noon + endH * H, organizer: "Ada" });

describe("activeScenes", () => {
  it("keeps the scenes whose window has begun and not ended, and those with no window", () => {
    const scenes = [scene("always"), scene("later", { startsAt: noon + H }), scene("over", { endsAt: noon - 1 }), scene("now", { startsAt: noon - H, endsAt: noon + H })];
    expect(activeScenes(scenes, noon).map((s) => s.id)).toEqual(["always", "now"]);
    expect(activeScenes(scenes, noon + 2 * H).map((s) => s.id)).toEqual(["always", "later"]);
  });

  it("treats the start as inclusive and the end as exclusive", () => {
    const s = scene("a", { startsAt: noon, endsAt: noon + H });
    expect(activeScenes([s], noon)).toHaveLength(1);
    expect(activeScenes([s], noon + H)).toHaveLength(0);
  });

  it("leaves out a scene made only of tiles of a kind this screen does not know, but keeps one with something to draw", () => {
    const unknown = scene("hologram", { tiles: [{ id: "t", kind: "hologram", settings: {} }] });
    const mixed = scene("mixed", { layout: "columns", tiles: [{ id: "a", kind: "hologram", settings: {} }, { id: "b", kind: "text", settings: { text: "hi" } }] });
    expect(activeScenes([unknown, mixed], noon).map((s) => s.id)).toEqual(["mixed"]);
  });
});

describe("rotation", () => {
  it("is the active scenes, each for its own time", () => {
    const pages = rotation([scene("a", { durationSeconds: 10 }), scene("b", { durationSeconds: 25 })], noon);
    expect(pages.map((p) => `${p.scene.id}:${p.seconds}`)).toEqual(["a:10", "b:25"]);
  });

  it("shows the information board when nothing is left to show, never a blank screen", () => {
    expect(rotation([], noon)).toHaveLength(FALLBACK_SCENES.length);
    expect(rotation([scene("over", { endsAt: noon - 1 })], noon).every((p) => showsBoard(p.scene))).toBe(true);
    expect(FALLBACK_SCENES.map((s) => s.tiles[0]?.kind)).toEqual(["reservations", "news", "staff"]);
  });
});

describe("showsBoard", () => {
  it("is true when a tile is part of the board, so the header goes with it, and false for pure media", () => {
    expect(showsBoard(scene("media"))).toBe(false);
    expect(showsBoard(scene("board", { layout: "columns", tiles: [{ id: "a", kind: "news", settings: {} }, { id: "b", kind: "image", settings: {} }] }))).toBe(true);
  });
});

describe("layouts", () => {
  it("every layout has at least one tile and a known kind list is not empty", () => {
    for (const layout of Object.values(SCENE_LAYOUTS)) expect(layout.tiles.length).toBeGreaterThan(0);
    expect(KNOWN_TILE_KINDS).toContain("youtube");
  });
});

describe("boardEvents", () => {
  it("shows what is on now, the next one, then the later ones, and drops what ended", () => {
    const events = boardEvents([booking("past", -3, -2), booking("later", 4, 5), booking("now", -1, 1), booking("soon", 2, 3)], noon);
    expect(events.map((e) => `${e.id}:${e.phase}`)).toEqual(["now:now", "soon:next", "later:later"]);
  });

  it("only keeps today and caps the list", () => {
    const tomorrow = booking("tomorrow", 24, 25);
    const many = Array.from({ length: 8 }, (_, i) => booking(`e${i}`, i * 0.1 + 0.1, i * 0.1 + 0.2));
    expect(boardEvents([tomorrow], noon)).toEqual([]);
    expect(boardEvents(many, noon)).toHaveLength(5);
  });

  it("orders simultaneous events by their end", () => {
    expect(boardEvents([booking("long", -1, 3), booking("short", -1, 1)], noon).map((e) => e.id)).toEqual(["short", "long"]);
  });
});

describe("roomRows", () => {
  it("gives each room its current or next booking, in use before reserved", () => {
    const rows = roomRows([booking("a1", 1, 2, "A101"), booking("a0", -1, 0.5, "A101"), booking("b", 3, 4, "B204"), booking("c", -2, -1, "C012")], noon);
    expect(rows.map((r) => `${r.room}:${r.status}`)).toEqual(["A101:in-use", "B204:reserved"]);
  });
});

describe("effectiveStaff", () => {
  const person = (extra: Partial<StaffView>): StaffView => ({ id: "1", name: "Ada", service: "pedagogical", availability: "away", note: "Lunch", until: noon + H, ...extra });
  it("shows a person as available again once the end time of their status has passed", () => {
    expect(effectiveStaff([person({ until: noon - 1 })], noon)[0]).toMatchObject({ availability: "available", note: undefined });
    expect(effectiveStaff([person({})], noon)[0]).toMatchObject({ availability: "away", note: "Lunch" });
    expect(effectiveStaff([person({ until: undefined })], noon + 99 * H)[0]).toMatchObject({ availability: "away" });
  });
});

describe("announcements and the end notice", () => {
  it("hides expired announcements and shows the most urgent first", () => {
    const list = visibleAnnouncements(
      [
        { id: "a", text: "info", priority: "info" },
        { id: "b", text: "urgent", priority: "urgent" },
        { id: "c", text: "gone", priority: "urgent", expiresAt: noon - 1 },
        { id: "d", text: "important", priority: "important", expiresAt: noon + 1 },
      ],
      noon,
    );
    expect(list.map((a) => a.id)).toEqual(["b", "d", "a"]);
  });

  it("shows the end notice for exactly its duration", () => {
    const notice = { message: "Over.", shownAt: noon, durationMs: 30_000 };
    expect(visibleEndNotice(notice, noon + 29_999)).toBe(notice);
    expect(visibleEndNotice(notice, noon + 30_000)).toBeNull();
    expect(visibleEndNotice(null, noon)).toBeNull();
  });
});


describe("emergencyPresentation", () => {
  const kinds = ["fire", "biohazard", "nuclear", "bomb", "seismic", "power"];

  it("has a headline and three actions for every kind, and one for an unknown kind from a newer server", () => {
    for (const kind of [...kinds, "zombies"]) {
      const p = emergencyPresentation(kind, "");
      expect(p.headline.length, kind).toBeGreaterThan(0);
      expect(p.actions, kind).toHaveLength(3);
    }
    expect(emergencyPresentation("zombies", "").headline).toBe("EVACUATE NOW");
  });

  it("names the assembly point when the site has one, and says what to do without it", () => {
    expect(emergencyPresentation("fire", "Car park A").actions[2].detail).toBe("Meet at Car park A.");
    expect(emergencyPresentation("fire", "").actions[2].detail).toBe("Go to the assembly point.");
  });
});

describe("themeVariables", () => {
  const theme = (tokens: Partial<ThemeView["tokens"]>): ThemeView => ({ id: "t", name: "T", version: 1, tokens: { colors: {}, typography: {}, shape: {}, ...tokens } });

  it("maps the tokens to the page's variables and sets nothing for what a theme leaves out", () => {
    const vars = themeVariables(theme({ colors: { primary: "#4f8cff", text: "#111111", border: "#cccccc" }, typography: { scale: 1.2, fontFamily: "serif" }, shape: { radius: 8 } }));
    expect(vars).toEqual({ "--ink": "#111111", "--line": "#cccccc", "--accent": "#4f8cff", "--radius": "0.5rem", "--scale": "1.2", "--font": FONT_STACKS.serif });
    expect(themeVariables(theme({}))).toEqual({});
  });

  it("a font file sets the family of its slot, and a slot without one sets nothing", () => {
    const withFonts = theme({ typography: { fontFamily: "serif" } });
    withFonts.fonts = { body: "/media/B.woff2", heading: "/media/H.woff2" };
    const vars = themeVariables(withFonts);
    expect(vars["--font"]).toBe(`"sc-body", ${FONT_STACKS.serif}`);
    expect(vars["--font-heading"]).toBe(`"sc-heading", ${FONT_STACKS.serif}`);
    expect(vars["--font-mono"]).toBeUndefined();
    expect(themeFontFaces(withFonts)).toBe('@font-face{font-family:"sc-body";src:url("/media/B.woff2");font-display:swap}\n@font-face{font-family:"sc-heading";src:url("/media/H.woff2");font-display:swap}');
    expect(themeFontFaces(theme({}))).toBe("");
  });

  it("a dark theme starts from dark colours, and the colours it gives win over them", () => {
    const dark = themeVariables(theme({ mode: "dark", colors: { background: "#000000", primary: "#00ff88" } }));
    expect(dark["--page"]).toBe("#000000");
    expect(dark["--card"]).toBe("#1a1d1f");
    expect(dark["--ink"]).toBe("#e8f1ec");
    expect(dark["--accent"]).toBe("#00ff88");
    // Light is the page's own, so a light theme sets only what it names.
    expect(themeVariables(theme({ mode: "light" }))).toEqual({});
  });

  it("knows every font family a theme may name", () => {
    expect(Object.keys(FONT_STACKS).sort()).toEqual(["condensed", "mono", "sans", "serif", "system"]);
  });
});

describe("emergencyVariables", () => {
  const base: ThemeView = { id: "t", name: "T", version: 1, tokens: { colors: {}, typography: {}, shape: {} }, fonts: { body: "/media/B.ttf", heading: "/media/H.ttf" } };

  it("is empty without a theme or without alert settings, so the alert keeps its default look", () => {
    expect(emergencyVariables(null)).toEqual({});
    expect(emergencyVariables(base)).toEqual({});
    expect(emergencyFontFaces(base)).toBe("");
  });

  it("maps only the closed set: corners, card and page colours, and the font families when the theme allows them", () => {
    const vars = emergencyVariables({ ...base, emergency: { fonts: true, frame: "bar", radius: 8, colors: { background: "#001070", card: "#0a1a8a" } } });
    expect(vars["--em-radius"]).toBe("0.5rem");
    expect(vars["--em-card"]).toBe("#0a1a8a");
    expect(vars["--em-solid"]).toBe("#001070");
    expect(vars["--em-font-body"]).toContain('"sc-body"');
    expect(vars["--em-font-heading"]).toContain('"sc-heading"');
    expect(Object.keys(vars).sort()).toEqual(["--em-card", "--em-font-body", "--em-font-heading", "--em-radius", "--em-solid"]);
    expect(emergencyFontFaces({ ...base, emergency: { fonts: true, frame: "stripes", colors: {} } })).toContain("sc-heading");
  });

  it("uses no font when the theme does not say so, or the slot has no file", () => {
    expect(emergencyVariables({ ...base, emergency: { fonts: false, frame: "stripes", colors: {}, radius: 4 } })["--em-font-body"]).toBeUndefined();
    expect(emergencyVariables({ ...base, fonts: {}, emergency: { fonts: true, frame: "stripes", colors: {}, radius: 4 } })["--em-font-heading"]).toBeUndefined();
  });
});
