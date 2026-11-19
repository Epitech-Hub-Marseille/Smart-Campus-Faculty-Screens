import { KNOWN_TILE_KINDS, SCENE_LAYOUTS as PAGE_LAYOUTS } from "@smartcampus/faculty-local";
import { SCENE_LAYOUTS as SERVER_LAYOUTS, TILE_KINDS } from "@smartcampus/protocol";
import { buildMessage, type ServerMessage } from "@smartcampus/protocol";
import { describe, expect, it } from "vitest";
import { activateCarousel, applyCommand, applyDesired, initialState, neededAssets, prune, reviveState, toViewState, END_NOTICE_DEFAULT_MS } from "./state.js";

const NOW = 1_800_000_000_000;
const sha = "a".repeat(64);
const msg = <T extends ServerMessage["type"]>(type: T, payload: Extract<ServerMessage, { type: T }>["payload"]) => buildMessage<ServerMessage>({ type, payload } as never, 1);
const emergency = (id = "E1", kind: "fire" | "power" = "fire") => ({ emergencyId: id, kind, title: "Fire alarm", instructions: "Leave.", testMode: false, testVolume: 20, startedAt: NOW });
const rt = { phase: "running" as const, enrollment: null, online: true, offlineSince: null, weather: null, urlOf: (r: { assetId: string }) => `/assets/${r.assetId}`, has: () => true };

describe("emergencies", () => {
  it("shows an alert until it is cleared, and a clear for another alert changes nothing", () => {
    let s = applyCommand(initialState(), msg("emergency.set", emergency("E1")), NOW);
    expect(s.emergency?.emergencyId).toBe("E1");
    s = applyCommand(s, msg("emergency.set", emergency("E2", "power")), NOW);
    expect(applyCommand(s, msg("emergency.clear", { emergencyId: "E1" }), NOW)).toBe(s);
    expect(applyCommand(s, msg("emergency.clear", { emergencyId: "E2" }), NOW).emergency).toBeNull();
  });

  it("an end message becomes a notice of the chosen length, clamped to the server's bounds, 2 minutes by default", () => {
    const base = applyCommand(initialState(), msg("emergency.set", emergency()), NOW);
    const clear = (extra: object) => applyCommand(base, msg("emergency.clear", { emergencyId: "E1", message: "All clear.", ...extra }), NOW).endNotice;
    expect(clear({})).toMatchObject({ message: "All clear.", durationMs: END_NOTICE_DEFAULT_MS, shownAt: NOW });
    expect(clear({ noticeSeconds: 45 })?.durationMs).toBe(45_000);
    expect(applyCommand(base, msg("emergency.clear", { emergencyId: "E1" }), NOW).endNotice).toBeNull();
  });

  it("a new alert replaces the notice, and the notice uses the server's clock", () => {
    let s = { ...applyCommand(initialState(), msg("emergency.set", emergency()), NOW), clockOffsetMs: 5_000 };
    s = applyCommand(s, msg("emergency.clear", { emergencyId: "E1", message: "Over." }), NOW);
    expect(s.endNotice?.shownAt).toBe(NOW + 5_000);
    expect(applyCommand(s, msg("emergency.set", emergency("E2")), NOW).endNotice).toBeNull();
  });

  it("the desired state decides: no alert in it means the alert is over, even if the clear was missed", () => {
    const sounding = applyCommand(initialState(), msg("emergency.set", emergency()), NOW);
    expect(applyDesired(sounding, {}, NOW, NOW).emergency).toBeNull();
    expect(applyDesired(initialState(), { emergency: emergency("E9") }, NOW, NOW).emergency?.emergencyId).toBe("E9");
    expect(applyDesired(initialState(), { emergency: { nonsense: true } }, NOW, NOW).emergency).toBeNull();
  });
});

describe("announcements", () => {
  it("shows and clears them, and the desired state replaces the set", () => {
    const show = (id: string, extra = {}) => msg("announce.show", { announcementId: id, text: id, priority: "info" as const, ...extra });
    let s = applyCommand(initialState(), show("a"), NOW);
    s = applyCommand(s, show("b"), NOW);
    expect(Object.keys(s.announcements)).toEqual(["a", "b"]);
    expect(Object.keys(applyCommand(s, msg("announce.clear", { announcementId: "a" }), NOW).announcements)).toEqual(["b"]);
    expect(Object.keys(applyDesired(s, { announcements: { c: { announcementId: "c", text: "c", priority: "info" }, bad: { text: 1 } } }, NOW, NOW).announcements)).toEqual(["c"]);
  });

  it("prunes the expired ones by the server's clock", () => {
    let s = applyCommand(initialState(), msg("announce.show", { announcementId: "old", text: "x", priority: "info", expiresAt: NOW - 1 }), NOW);
    s = applyCommand(s, msg("announce.show", { announcementId: "fresh", text: "x", priority: "info", expiresAt: NOW + 60_000 }), NOW);
    expect(Object.keys(prune(s, NOW).announcements)).toEqual(["fresh"]);
    expect(prune(s, NOW - 120_000)).toBe(s);
  });
});

describe("desired state and the clock", () => {
  it("learns the offset from the server time, and takes the configuration and volume from it", () => {
    const s = applyDesired(initialState(), { facultyConfig: { service: "pedagogical", site: { name: "Faculty of Engineering" } }, audioSettings: { volume: 40, quietHours: { enabled: true, from: "22:00", to: "06:00" } } }, NOW + 7_000, NOW);
    expect(s.clockOffsetMs).toBe(7_000);
    expect(s.config).toMatchObject({ service: "pedagogical", site: { name: "Faculty of Engineering" } });
    expect(s.audio.volume).toBe(40);
  });

  it("keeps what it had when a part of the desired state is invalid", () => {
    const before = applyDesired(initialState(), { facultyConfig: { service: "administrative" } }, NOW, NOW);
    expect(applyDesired(before, { facultyConfig: { service: "cleaning" } }, NOW, NOW).config.service).toBe("administrative");
  });
});

describe("carousel and files", () => {
  const asset = { assetId: "A1", sha256: sha, size: 10, mime: "image/png" };
  const image = { id: "s1", name: "", layout: "full" as const, durationSeconds: 15, tiles: [{ id: "i", kind: "image", settings: { asset, fit: "contain" } }] };
  const text = { id: "t", name: "", layout: "full" as const, durationSeconds: 15, tiles: [{ id: "x", kind: "text", settings: { text: "Hello", align: "center" } }] };

  it("only a verified carousel is activated, and the view leaves out a scene whose file is missing", () => {
    const s = activateCarousel(initialState(), [image, text], NOW);
    expect(toViewState(s, rt).scenes.map((p) => p.id)).toEqual(["s1", "t"]);
    expect(toViewState(s, rt).scenes[0]?.tiles[0]).toMatchObject({ src: "/assets/A1", kind: "image" });
    expect(toViewState(s, { ...rt, has: () => false }).scenes.map((p) => p.id)).toEqual(["t"]);
  });

  it("does not give the page the id or hash of a file", () => {
    const view = toViewState(activateCarousel(initialState(), [image], NOW), rt);
    expect(JSON.stringify(view.scenes)).not.toMatch(/sha256|assetId/);
  });

  it("knows which files it needs: the carousel's media (once) and the logo, nothing else", () => {
    let s = activateCarousel(initialState(), [image, { ...image, id: "again" }, text], NOW);
    s = applyCommand(s, msg("faculty.config.set", { config: { ...s.config, site: { ...s.config.site, logo: { assetId: "L1", sha256: sha, size: 5, mime: "image/png" } } } }), NOW);
    expect(neededAssets(s).map((a) => a.assetId)).toEqual(["A1", "L1"]);
    expect(toViewState(s, rt).logoUrl).toBe("/assets/L1");
  });
});

describe("the view handed to the page", () => {
  it("carries the accent and the kind of alarm of an emergency from the catalogue, and no logo or key material", () => {
    const s = applyCommand(initialState(), msg("emergency.set", emergency("E1", "power")), NOW);
    const view = toViewState(s, rt);
    expect(view.emergency).toMatchObject({ kind: "power", loud: false });
    expect(view.emergency?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(JSON.stringify(view)).not.toMatch(/privateKey|sha256|assetId/);
  });

  it("shows the weather only when the widget is on", () => {
    const weather = { temperature: 18, code: 1, label: "Marseille", updatedAt: NOW };
    expect(toViewState(initialState(), { ...rt, weather }).weather).toBeNull();
    const on = applyDesired(initialState(), { facultyConfig: { widgets: { weather: true }, weather: { label: "Marseille", latitude: 43.3, longitude: 5.4 } } }, NOW, NOW);
    expect(toViewState(on, { ...rt, weather }).weather).toEqual(weather);
  });
});

describe("reviveState", () => {
  it("survives garbage and keeps the good fields of a damaged file", () => {
    expect(reviveState(null)).toEqual(initialState());
    expect(reviveState("nope")).toEqual(initialState());
    const revived = reviveState({ config: { service: "pedagogical" }, audio: { volume: 999 }, emergency: { broken: true }, carousel: "x" });
    expect(revived.config.service).toBe("pedagogical");
    expect(revived.audio.volume).toBe(initialState().audio.volume);
    expect(revived.emergency).toBeNull();
    expect(revived.carousel.scenes).toEqual([]);
  });
});

describe("the page's copy of the server's scene definitions", () => {
  it("has the same layouts and the same tile kinds as the protocol, so a drift fails here instead of on a wall", () => {
    for (const [id, layout] of Object.entries(SERVER_LAYOUTS)) expect(PAGE_LAYOUTS[id], id).toEqual({ columns: layout.columns, rows: layout.rows, tiles: layout.tiles });
    expect(Object.keys(PAGE_LAYOUTS).sort()).toEqual(Object.keys(SERVER_LAYOUTS).sort());
    expect([...KNOWN_TILE_KINDS].sort()).toEqual(TILE_KINDS.map((k) => k.kind).sort());
  });
});

describe("themes", () => {
  const theme = { id: "t1", name: "Night", version: 2, tokens: { mode: "dark" as const, colors: { primary: "#4f8cff" }, typography: {}, shape: { radius: 12 } }, css: ".card { gap: 1rem }" };

  it("a command sets the theme, null clears it, and the page is given it", () => {
    const s = applyCommand(initialState(), msg("theme.set", { theme }), NOW);
    expect(s.theme?.id).toBe("t1");
    expect(toViewState(s, rt).theme).toMatchObject({ id: "t1", version: 2, css: ".card { gap: 1rem }", tokens: { colors: { primary: "#4f8cff" } } });
    expect(applyCommand(s, msg("theme.set", { theme: null }), NOW).theme).toBeNull();
    expect(toViewState(initialState(), rt).theme).toBeNull();
  });

  it("the desired state is complete: no theme in it means the theme was taken away, even if the command was missed", () => {
    const withTheme = applyCommand(initialState(), msg("theme.set", { theme }), NOW);
    expect(applyDesired(withTheme, { theme }, NOW, NOW).theme?.id).toBe("t1");
    expect(applyDesired(withTheme, {}, NOW, NOW).theme).toBeNull();
  });

  it("keeps what it had when a desired theme is invalid, and never puts unchecked CSS on a wall", () => {
    const withTheme = applyCommand(initialState(), msg("theme.set", { theme }), NOW);
    expect(applyDesired(withTheme, { theme: { ...theme, css: "a { background: url(https://evil.example/x) }" } }, NOW, NOW).theme?.id).toBe("t1");
    // A state file edited by hand is checked again on the way back from disk.
    expect(reviveState({ theme }).theme?.id).toBe("t1");
    expect(reviveState({ theme: { ...theme, css: "@import 'https://evil.example/x.css';" } }).theme).toBeNull();
    expect(reviveState({ theme: "nope" }).theme).toBeNull();
  });
});
