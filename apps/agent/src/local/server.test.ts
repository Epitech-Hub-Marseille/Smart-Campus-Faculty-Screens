import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyViewState, type LiveMessage } from "@smartcampus/faculty-local";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { originAllowed, startLocalServer, type LocalServer } from "./server.js";

let local: LocalServer | null = null;
afterEach(async () => {
  await local?.close();
  local = null;
});

async function start(extra: { dist?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "local-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "audio"));
  writeFileSync(join(dir, "assets", "A1.png"), "png-bytes");
  writeFileSync(join(dir, "audio", "S1.wav"), "wav-bytes");
  writeFileSync(join(dir, "secret.txt"), "not served");
  const state = { ...emptyViewState(), phase: "running" as const, online: true, config: { ...emptyViewState().config, service: "pedagogical" as const } };
  local = await startLocalServer({ port: 0, bind: "127.0.0.1", distDir: extra.dist ?? null, assetsDir: join(dir, "assets"), soundsDir: join(dir, "audio"), view: () => state });
  const port = (local.server.address() as import("node:net").AddressInfo).port;
  return { port, dir, base: `http://127.0.0.1:${port}` };
}

const messages = (ws: WebSocket) => {
  const got: LiveMessage[] = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  return got;
};
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
};

describe("local display server", () => {
  it("pushes the current state to a page as soon as it connects, then every message broadcast", async () => {
    const { port } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin: `http://localhost:${port}` });
    const got = messages(ws);
    await until(() => got.length === 1);
    expect(got[0]).toMatchObject({ type: "state", state: { phase: "running", config: { service: "pedagogical" } } });
    local!.broadcast({ type: "audio", id: "n1", src: "/audio/S1.wav", volume: 50 });
    await until(() => got.length === 2);
    expect(got[1]).toEqual({ type: "audio", id: "n1", src: "/audio/S1.wav", volume: 50 });
    ws.close();
  });

  it("refuses a socket opened by a web page from somewhere else", async () => {
    const { port } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin: "https://evil.example.org" });
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("refused"));
      ws.on("close", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
  });

  it("only allows the page of this machine on this port (and a dev origin when told)", () => {
    expect(originAllowed("http://localhost:3000", 3000)).toBe(true);
    expect(originAllowed("http://127.0.0.1:3000", 3000)).toBe(true);
    expect(originAllowed(undefined, 3000)).toBe(true);
    expect(originAllowed("http://localhost:3001", 3000)).toBe(false);
    expect(originAllowed("http://localhost.evil.org:3000", 3000)).toBe(false);
    expect(originAllowed("not a url", 3000)).toBe(false);
    expect(originAllowed("http://localhost:5173", 3000, ["http://localhost:5173"])).toBe(true);
  });

  it("serves the cached files immutably and never anything outside them", async () => {
    const { base } = await start();
    const asset = await fetch(`${base}/media/A1.png`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await (await fetch(`${base}/audio/S1.wav`)).text()).toBe("wav-bytes");
    expect((await fetch(`${base}/media/../secret.txt`)).status).not.toBe(200);
    expect((await fetch(`${base}/media/%2e%2e/secret.txt`)).status).not.toBe(200);
    expect((await fetch(`${base}/media/missing.png`)).status).toBe(404);
  });

  it("restricts what the page may load, but lets it frame web pages and load the streams a tile names", async () => {
    const { base } = await start();
    const csp = (await fetch(`${base}/health`)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-src http: https:");
    expect(csp).toContain("media-src 'self' blob: http: https:");
    expect(csp).toContain("img-src 'self' data: http: https:");
    expect(csp).toMatch(/script-src|default-src 'self'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'unsafe");
  });

  it("answers health with the phase only: no identity, key or server address", async () => {
    const { base } = await start();
    const body = await (await fetch(`${base}/health`)).text();
    expect(JSON.parse(body)).toEqual({ service: "faculty-agent", phase: "running", online: true, scenes: 0, emergency: false });
    expect(body).not.toMatch(/key|deviceId|http/i);
  });

  it("serves the built page and falls back to it for any other path", async () => {
    const dist = mkdtempSync(join(tmpdir(), "dist-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>kiosk</title>");
    const { base } = await start({ dist });
    expect(await (await fetch(`${base}/`)).text()).toContain("kiosk");
    expect(await (await fetch(`${base}/anything/else`)).text()).toContain("kiosk");
  });
});
