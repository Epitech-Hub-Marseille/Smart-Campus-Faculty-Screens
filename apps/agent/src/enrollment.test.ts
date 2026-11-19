import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint } from "@smartcampus/handshake";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enroll } from "./enrollment.js";
import { IdentityStore } from "./storage/identity.js";

let server: Server;
let url = "";
let status: string[] = [];
let posts: { publicKey: string; type: string; name?: string }[] = [];
let postAnswer: (body: { publicKey: string }) => { status: number; body: object } = () => ({ status: 500, body: {} });
const noSleep = () => Promise.resolve();

beforeEach(async () => {
  status = [];
  posts = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const reply = (code: number, body: object) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.method === "POST" && req.url === "/api/enroll") {
        const body = JSON.parse(raw);
        posts.push(body);
        const answer = postAnswer(body);
        return reply(answer.status, answer.body);
      }
      const id = req.url?.split("/").pop() ?? "";
      return reply(200, { status: status.shift() ?? "pending", id });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  postAnswer = (b) => ({ status: 201, body: { deviceId: "01DEVICE", fingerprint: fingerprint(b.publicKey), expiresAt: new Date().toISOString() } });
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

function deps(store: IdentityStore, reports: string[] = []) {
  return {
    serverUrl: url,
    http: { timeoutMs: 2_000 },
    store,
    identity: () => store.loadOrCreate(),
    onStatus: (s: string) => reports.push(s),
    regenerate: () => (store.reset(), store.loadOrCreate()),
    sleep: noSleep,
  };
}
const fresh = () => {
  const store = new IdentityStore(mkdtempSync(join(tmpdir(), "id-")));
  store.name = "Lobby screen";
  return store;
};

describe("enroll", () => {
  it("sends the PUBLIC key only, as a display, with the name, and waits for approval", async () => {
    const store = fresh();
    const reports: string[] = [];
    status = ["pending", "pending", "active"];
    expect(await enroll(deps(store, reports), new AbortController().signal)).toBe("01DEVICE");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ type: "display", name: "Lobby screen" });
    expect(JSON.stringify(posts[0])).not.toContain(store.loadOrCreate().privateKey);
    expect(reports).toEqual(expect.arrayContaining(["requesting", "waiting"]));
    expect(store.device()).toEqual({ deviceId: "01DEVICE", enrolled: true });
  });

  it("does nothing when the device is already enrolled", async () => {
    const store = fresh();
    store.loadOrCreate();
    store.saveDevice({ deviceId: "01ALREADY", enrolled: true });
    expect(await enroll(deps(store), new AbortController().signal)).toBe("01ALREADY");
    expect(posts).toHaveLength(0);
  });

  it("does not ask twice for a request it already made: it resumes waiting for it", async () => {
    const store = fresh();
    store.loadOrCreate();
    store.saveDevice({ deviceId: "01PENDING", enrolled: false });
    status = ["pending", "active"];
    expect(await enroll(deps(store), new AbortController().signal)).toBe("01PENDING");
    expect(posts).toHaveLength(0);
  });

  it("refuses to go on when the server computed another fingerprint for the key", async () => {
    const store = fresh();
    postAnswer = () => ({ status: 201, body: { deviceId: "01DEVICE", fingerprint: "00".repeat(32), expiresAt: "" } });
    const abort = new AbortController();
    const reports: string[] = [];
    const attempt = enroll({ ...deps(store, reports), sleep: async () => abort.abort() }, abort.signal);
    await expect(attempt).rejects.toThrow(/cancelled/);
    expect(reports).toContain("error");
    expect(store.device().enrolled).toBe(false);
  });

  it("asks again from a clean record when the request expired or was denied", async () => {
    const store = fresh();
    status = ["expired", "pending", "active"];
    const reports: string[] = [];
    expect(await enroll(deps(store, reports), new AbortController().signal)).toBe("01DEVICE");
    expect(posts).toHaveLength(2);
    expect(reports).toContain("expired");

    const denied = fresh();
    status = ["denied", "active"];
    const deniedReports: string[] = [];
    await enroll(deps(denied, deniedReports), new AbortController().signal);
    expect(deniedReports).toContain("denied");
  });

  it("generates a new key pair when the server already knows this key but the id was lost", async () => {
    const store = fresh();
    const first = store.loadOrCreate();
    let calls = 0;
    postAnswer = (b) => (++calls === 1 ? { status: 409, body: { error: "This key is already enrolled" } } : { status: 201, body: { deviceId: "01NEW", fingerprint: fingerprint(b.publicKey), expiresAt: "" } });
    status = ["active"];
    expect(await enroll(deps(store), new AbortController().signal)).toBe("01NEW");
    expect(store.loadOrCreate().publicKey).not.toBe(first.publicKey);
    expect(posts[1]!.publicKey).not.toBe(posts[0]!.publicKey);
  });

  it("keeps trying when the server is unreachable or busy, and stops when told to", async () => {
    const store = fresh();
    postAnswer = () => ({ status: 429, body: { error: "Too many pending requests" } });
    const abort = new AbortController();
    let sleeps = 0;
    const attempt = enroll({ ...deps(store), sleep: async () => void (++sleeps >= 3 && abort.abort()) }, abort.signal);
    await expect(attempt).rejects.toThrow(/cancelled/);
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("IdentityStore", () => {
  it("keeps the same key across runs, readable by its owner only, and replaces a damaged one", async () => {
    const { statSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "id-"));
    const a = new IdentityStore(dir).loadOrCreate();
    expect(new IdentityStore(dir).loadOrCreate()).toEqual(a);
    expect(statSync(join(dir, "identity.json")).mode & 0o777).toBe(0o600);

    writeFileSync(join(dir, "identity.json"), "{ not json");
    const b = new IdentityStore(dir).loadOrCreate();
    expect(b.publicKey).not.toBe(a.publicKey);
  });

  it("a new key is a new device: the old enrollment is forgotten", () => {
    const dir = mkdtempSync(join(tmpdir(), "id-"));
    const store = new IdentityStore(dir);
    store.loadOrCreate();
    store.saveDevice({ deviceId: "01OLD", enrolled: true });
    store.reset();
    store.loadOrCreate();
    expect(store.device()).toEqual({ deviceId: null, enrolled: false });
  });
});
