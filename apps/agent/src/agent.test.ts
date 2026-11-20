import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, type Identity } from "@smartcampus/handshake";
import { ulid } from "@smartcampus/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssetCache, type Fetcher } from "./assets/cache.js";
import { Controller } from "./controller.js";
import { DeviceLink } from "./link/deviceLink.js";
import { StateStore } from "./storage/stateStore.js";
import { FakeGateway } from "./testing/fakeGateway.js";
import type { LiveMessage } from "@smartcampus/faculty-local";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 3)]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const imageRef = (id = "IMG1", data = png) => ({ assetId: id, sha256: sha(data), size: data.length, mime: "image/png" });
/** A scene with one image tile whose file is `A-<id>`. */
const slide = (id: string, data = png) => ({ id, name: "", layout: "full" as const, durationSeconds: 15, tiles: [{ id: `${id}-t`, kind: "image", settings: { asset: imageRef(`A-${id}`, data), fit: "contain" } }] });
const textScene = (id: string, text: string) => ({ id, name: "", layout: "full" as const, durationSeconds: 10, tiles: [{ id: `${id}-t`, kind: "text", settings: { text, align: "center" } }] });
const wavData = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt "), Buffer.alloc(60)]);

let gateway: FakeGateway;
let device: Identity;
let stop: AbortController;
let running: Promise<void> | null;

/** An agent wired like index.ts, against the fake gateway. `serve` decides what each download returns. */
function agent(opts: { serve?: (id: string) => Promise<{ data: Buffer; contentType?: string }> | { data: Buffer; contentType?: string }; serverKey?: string; dir?: string } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "agent-"));
  const fetches: string[] = [];
  const fetcher: Fetcher = async (id, dest) => {
    fetches.push(id);
    const served = await (opts.serve ?? (() => ({ data: png })))(id);
    writeFileSync(dest, served.data);
    return { contentType: served.contentType ?? "image/png" };
  };
  const states = new StateStore(dir);
  const published: LiveMessage[] = [];
  const controller = new Controller({
    initial: states.load(),
    seen: states.loadSeen(),
    assets: new AssetCache(join(dir, "assets"), fetcher),
    sounds: new AssetCache(join(dir, "audio"), fetcher),
    saveState: (s) => states.save(s),
    saveSeen: (ids) => states.saveSeen(ids),
    publish: (m) => published.push(m),
    version: "test",
  });
  const events: string[] = [];
  running = new DeviceLink({
    url: gateway.url,
    deviceId: ulid(),
    devicePrivateKey: device.privateKey,
    serverPublicKey: opts.serverKey ?? gateway.serverPublicKey,
    backoff: { minMs: 20, maxMs: 80 },
    handshakeTimeoutMs: 1_000,
  }).run(async (event) => {
    events.push(event.type === "message" ? event.message.type : event.type);
    await controller.onEvent(event);
  }, stop.signal);
  return { controller, events, published, fetches, dir };
}

const until = async (check: () => boolean, ms = 4_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 15));
  }
};

beforeEach(async () => {
  gateway = new FakeGateway();
  device = generateIdentity();
  gateway.devicePublicKey = device.publicKey;
  stop = new AbortController();
  running = null;
  await gateway.start();
});
afterEach(async () => {
  stop.abort();
  await running;
  await gateway.stop();
});

describe("the link", () => {
  it("performs the handshake, applies the desired state and reports back", async () => {
    gateway.desired = { facultyConfig: { service: "pedagogical", site: { name: "Faculty of Engineering" } }, audioSettings: { volume: 55, quietHours: {} } };
    const a = agent();
    await until(() => a.controller.view().online);
    expect(a.controller.view()).toMatchObject({ phase: "running", config: { service: "pedagogical", site: { name: "Faculty of Engineering" } }, audio: { volume: 55 } });
    const report = await gateway.waitFor("state.report");
    expect(report.payload.state).toMatchObject({ configApplied: true, screen: "on", scenes: [], carouselUpdatedAt: 0 });
  });

  it("learns the server's clock from session.ready", async () => {
    gateway.serverTime = () => Date.now() + 9_000;
    const a = agent();
    await until(() => a.controller.view().online);
    expect(Math.abs(a.controller.clockOffsetMs() - 9_000)).toBeLessThan(500);
  });

  it("never talks to a server that does not own the provisioned key (a relay with its own key)", async () => {
    const relay = generateIdentity();
    const a = agent({ serverKey: relay.publicKey });
    await new Promise((r) => setTimeout(r, 600));
    expect(a.events).not.toContain("connected");
    expect(gateway.connections.length).toBeGreaterThan(0);
  });

  it("is refused when the server does not know its key, and keeps trying without ever connecting", async () => {
    gateway.devicePublicKey = null;
    const a = agent();
    await new Promise((r) => setTimeout(r, 500));
    expect(a.events).not.toContain("connected");
  });

  it("reconnects by itself when the server drops it, and asks for nothing twice", async () => {
    gateway.desired = { facultyConfig: { service: "administrative" } };
    const a = agent();
    await until(() => a.controller.view().online);
    gateway.close(1011, "restart");
    await until(() => !a.controller.view().online);
    await until(() => a.controller.view().online);
    expect(gateway.connections.length).toBe(2);
    expect(a.controller.view().config.service).toBe("administrative");
  });

  it("stops for good when the device is revoked", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    gateway.close(4403, "revoked");
    await running;
    expect(a.events.at(-1)).toBe("disconnected");
    expect(gateway.connections).toHaveLength(1);
  });

  it("drops a connection whose frames are out of order", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    gateway.send("announce.show", { announcementId: "x", text: "skipped a number", priority: "info" }, ulid(), 99);
    await until(() => !a.controller.view().online);
    expect(a.controller.view().announcements).toEqual([]);
  });

  it("drops a connection that sends plaintext after the handshake", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    gateway.sendRaw(JSON.stringify({ v: 1, type: "emergency.set" }), false);
    await until(() => !a.controller.view().online);
    expect(a.controller.view().emergency).toBeNull();
  });
});

describe("commands", () => {
  it("applies a command once, acknowledges it, and acknowledges a replay without running it again", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const show = gateway.send("announce.show", { announcementId: "a1", title: "Exam", text: "Registration closes", priority: "important" }, ulid());
    await until(() => gateway.acksFor(show) === 1);
    expect(a.controller.view().announcements).toMatchObject([{ id: "a1", priority: "important" }]);

    gateway.send("announce.clear", { announcementId: "a1" });
    await until(() => a.controller.view().announcements.length === 0);
    // The server did not get our first ack and sends the show again with the same id.
    gateway.send("announce.show", { announcementId: "a1", text: "Registration closes", priority: "important" }, show);
    await until(() => gateway.acksFor(show) === 2);
    expect(a.controller.view().announcements).toEqual([]);
  });

  it("shows the faculty content and keeps it across a restart", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    gateway.send("faculty.content.set", { news: [{ id: "n1", title: "Open day", text: "Saturday", priority: "important", publishedAt: Date.now() }], staff: [], reservations: [{ id: "r1", room: "A101", title: "Lecture", start: Date.now(), end: Date.now() + 3_600_000 }], updatedAt: Date.now() });
    await until(() => a.controller.view().faculty?.news.length === 1);
    stop.abort();
    await running;

    stop = new AbortController();
    const restarted = agent({ dir: a.dir });
    expect(restarted.controller.view().faculty?.reservations[0]?.room).toBe("A101");
  });

  it("acknowledges commands that are meant for other devices without acting on them", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const ids = [
      gateway.send("room.status.set", { roomId: "r", status: "free", label: "Free", color: "#00a86b", icon: "check" }),
      gateway.send("reservations.set", { roomId: "r", items: [] }),
      gateway.send("registration.mode.set", { sessionId: "s", active: false }),
    ];
    await until(() => ids.every((id) => gateway.acksFor(id) === 1));
    expect(a.controller.view().emergency).toBeNull();
  });

  it("puts an emergency on the screen at once, even while a large download is in progress", async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    const a = agent({ serve: async () => (await slow, { data: png }) });
    await until(() => a.controller.view().online);
    const content = gateway.send("carousel.set", { scenes: [slide("1")], updatedAt: 1 });
    await until(() => a.fetches.length === 1);

    const alert = gateway.send("emergency.set", { emergencyId: "E1", kind: "fire", title: "Fire alarm", instructions: "Leave.", testMode: false, testVolume: 20, startedAt: Date.now() });
    await until(() => gateway.acksFor(alert) === 1);
    expect(a.controller.view().emergency?.emergencyId).toBe("E1");
    expect(gateway.acksFor(content)).toBe(0);

    release();
    await until(() => gateway.acksFor(content) === 1);
  });
});

describe("the carousel", () => {
  it("activates a carousel only when every file is downloaded and verified, and acknowledges then", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const id = gateway.send("carousel.set", { scenes: [slide("1"), textScene("t", "Hello")], updatedAt: 5 });
    await until(() => gateway.acksFor(id) === 1);
    const view = a.controller.view();
    expect(view.scenes.map((s) => s.id)).toEqual(["1", "t"]);
    expect(view.scenes[0]?.tiles[0]?.src).toBe("/media/A-1.png");
    // The page is given the local address of the file, not its id or its hash.
    expect(JSON.stringify(view.scenes)).not.toMatch(/sha256|assetId|A-1\b(?!\.)/);
    expect(readFileSync(join(a.dir, "assets", "A-1.png")).equals(png)).toBe(true);
  });

  it("keeps the previous carousel and says so when a file fails its check", async () => {
    const a = agent({ serve: (id) => ({ data: id === "A-bad" ? Buffer.alloc(png.length, 7) : png }) });
    await until(() => a.controller.view().online);
    const good = gateway.send("carousel.set", { scenes: [slide("ok")], updatedAt: 1 });
    await until(() => gateway.acksFor(good) === 1);

    const bad = gateway.send("carousel.set", { scenes: [slide("ok"), slide("bad")], updatedAt: 2 });
    const nack = await gateway.waitFor("nack", (m) => m.payload.ref === bad);
    expect(nack.payload.reason).toMatch(/SHA-256/);
    expect(a.controller.view().scenes.map((s) => s.id)).toEqual(["ok"]);
    expect(gateway.acksFor(bad)).toBe(0);
  });

  it("a newer carousel cancels the one still downloading", async () => {
    const releases: Array<() => void> = [];
    const a = agent({ serve: (id) => (id === "A-old" ? new Promise((r) => releases.push(() => r({ data: png }))) : { data: png }) });
    await until(() => a.controller.view().online);
    const old = gateway.send("carousel.set", { scenes: [slide("old")], updatedAt: 1 });
    await until(() => a.fetches.includes("A-old"));
    const fresh = gateway.send("carousel.set", { scenes: [slide("new")], updatedAt: 2 });
    await until(() => gateway.acksFor(fresh) === 1);
    releases.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 100));
    expect(a.controller.view().scenes.map((s) => s.id)).toEqual(["new"]);
    expect(gateway.acksFor(old)).toBe(0);
  });

  it("frees the files a replaced carousel no longer needs", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const first = gateway.send("carousel.set", { scenes: [slide("1")], updatedAt: 1 });
    await until(() => gateway.acksFor(first) === 1);
    const second = gateway.send("carousel.set", { scenes: [slide("2")], updatedAt: 2 });
    await until(() => gateway.acksFor(second) === 1);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(a.dir, "assets"))).toEqual(["A-2.png"]);
  });

  it("downloads the logo of the configuration but never refuses the configuration because of it", async () => {
    const a = agent({ serve: () => { throw new Error("logo server down"); } });
    await until(() => a.controller.view().online);
    const config = gateway.send("faculty.config.set", { config: { site: { name: "Faculty", subtitle: "", zone: "", assemblyPoint: "", emergencyNumber: "", logo: imageRef("LOGO") }, service: "all", carousel: { enabled: true }, widgets: { clock: true, date: true, weather: false }, weather: null } });
    await until(() => gateway.acksFor(config) === 1);
    expect(a.controller.view().config.site.name).toBe("Faculty");
    expect(a.controller.view().logoUrl).toBeNull();
  });
});

describe("live tiles", () => {
  it("activates a carousel of streams, radios and web pages without downloading anything, and passes the settings to the page", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const id = gateway.send("carousel.set", {
      scenes: [
        { id: "live", name: "Live", layout: "columns", durationSeconds: 20, tiles: [{ id: "y", kind: "youtube", settings: { video: "dQw4w9WgXcQ", muted: true } }, { id: "r", kind: "radio", settings: { url: "https://radio.example.org/live.mp3", label: "Campus radio", muted: false } }] },
        { id: "cam", name: "Cameras", layout: "full", durationSeconds: 15, tiles: [{ id: "s", kind: "stream", settings: { url: "https://cam.example.org/live.m3u8", format: "hls", label: "", muted: true } }] },
      ],
      updatedAt: 1,
    });
    await until(() => gateway.acksFor(id) === 1);
    expect(a.fetches).toHaveLength(0);
    const view = a.controller.view();
    expect(view.scenes.map((s) => s.layout)).toEqual(["columns", "full"]);
    expect(view.scenes[0]?.tiles.map((t) => [t.kind, t.settings.muted])).toEqual([["youtube", true], ["radio", false]]);
  });

  it("keeps a tile of a kind it does not know and hands it over, so a newer server does not break an older screen", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const id = gateway.send("carousel.set", { scenes: [{ id: "x", name: "", layout: "full", durationSeconds: 10, tiles: [{ id: "h", kind: "hologram", settings: { depth: 3 } }] }], updatedAt: 1 });
    await until(() => gateway.acksFor(id) === 1);
    expect(a.controller.view().scenes[0]?.tiles[0]).toMatchObject({ kind: "hologram", settings: { depth: 3 } });
  });

  it("reports the scenes it shows, for the console", async () => {
    const a = agent();
    await until(() => a.controller.view().online);
    const id = gateway.send("carousel.set", { scenes: [textScene("t", "Hello")], updatedAt: 9 });
    await until(() => gateway.acksFor(id) === 1);
    const report = await gateway.waitFor("state.report", (m) => (m.payload.state as { scenes?: string[] }).scenes?.[0] === "t");
    expect(report.payload.state).toMatchObject({ scenes: ["t"], carouselUpdatedAt: 9 });
  });
});

describe("audio", () => {
  const play = (extra: object = {}) => ({ announcementId: "n1", assetId: "SOUND1", sha256: sha(wavData), size: wavData.length, urgent: false, ...extra });
  const wav = { data: wavData, contentType: "audio/wav" };

  it("downloads, verifies and hands the page a sound to play at the configured volume", async () => {
    gateway.desired = { audioSettings: { volume: 30, quietHours: {} } };
    const a = agent({ serve: () => wav });
    await until(() => a.controller.view().online);
    const id = gateway.send("audio.play", play());
    await until(() => gateway.acksFor(id) === 1);
    expect(a.published.filter((m) => m.type === "audio")).toEqual([{ type: "audio", id: "n1", src: "/audio/SOUND1.wav", volume: 30 }]);
  });

  it("stays silent in quiet hours but acknowledges, unless the sound is urgent", async () => {
    gateway.desired = { audioSettings: { volume: 30, quietHours: { enabled: true, from: "00:00", to: "23:59" } } };
    const a = agent({ serve: () => wav });
    await until(() => a.controller.view().online);
    const quiet = gateway.send("audio.play", play());
    await until(() => gateway.acksFor(quiet) === 1);
    expect(a.fetches).toHaveLength(0);

    const urgent = gateway.send("audio.play", play({ announcementId: "n2", urgent: true }));
    await until(() => gateway.acksFor(urgent) === 1);
    expect(a.published.filter((m) => m.type === "audio")).toEqual([{ type: "audio", id: "n2", src: "/audio/SOUND1.wav", volume: 100, urgent: true }]);
  });

  it("refuses a sound that is not what was announced", async () => {
    const a = agent({ serve: () => ({ data: Buffer.concat([wavData, Buffer.from("x")]), contentType: "audio/wav" }) });
    await until(() => a.controller.view().online);
    const id = gateway.send("audio.play", play());
    await gateway.waitFor("nack", (m) => m.payload.ref === id);
    expect(a.published.some((m) => m.type === "audio")).toBe(false);
  });
});
