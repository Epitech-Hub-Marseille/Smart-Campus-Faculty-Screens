import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssetCache, type Fetcher } from "./cache.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 1)]);
const ref = (data = png, extra = {}) => ({ assetId: "01ASSET", sha256: sha(data), size: data.length, mime: "image/png", ...extra });
const signal = new AbortController().signal;

function setup(serve: (id: string) => { data: Buffer; contentType?: string } | Error = () => ({ data: png })) {
  const dir = mkdtempSync(join(tmpdir(), "cache-"));
  const calls: { id: string; maxBytes: number }[] = [];
  const fetcher: Fetcher = async (id, dest, maxBytes) => {
    calls.push({ id, maxBytes });
    const served = serve(id);
    if (served instanceof Error) throw served;
    writeFileSync(dest, served.data);
    return { contentType: served.contentType ?? "image/png" };
  };
  return { dir, calls, cache: new AssetCache(dir, fetcher) };
}

describe("AssetCache", () => {
  it("downloads a file, checks its hash and keeps it under its final name only", async () => {
    const { cache, dir } = setup();
    expect(await cache.ensure(ref(), signal)).toBe("01ASSET.png");
    expect(readdirSync(dir)).toEqual(["01ASSET.png"]);
    expect(cache.has(ref())).toBe(true);
  });

  it("does not download again what it already holds", async () => {
    const { cache, calls } = setup();
    await cache.ensure(ref(), signal);
    await cache.ensure(ref(), signal);
    expect(calls).toHaveLength(1);
  });

  it("asks the downloader for no more than the announced size", async () => {
    const { cache, calls } = setup();
    await cache.ensure(ref(), signal);
    expect(calls[0]!.maxBytes).toBe(png.length);
  });

  it("refuses a file whose hash is not the announced one and leaves nothing behind", async () => {
    const { cache, dir } = setup(() => ({ data: Buffer.alloc(png.length, 9) }));
    await expect(cache.ensure(ref(), signal)).rejects.toThrow(/SHA-256/);
    expect(readdirSync(dir)).toEqual([]);
    expect(cache.has(ref())).toBe(false);
  });

  it("refuses a file that is not the announced size, even with the right start", async () => {
    const { cache, dir } = setup(() => ({ data: Buffer.concat([png, Buffer.alloc(5)]) }));
    await expect(cache.ensure(ref(), signal)).rejects.toThrow(/announced size/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("leaves nothing behind when the download fails", async () => {
    const { cache, dir } = setup(() => new Error("connection reset"));
    await expect(cache.ensure(ref(), signal)).rejects.toThrow(/connection reset/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses ids that could point outside the directory and types it cannot show", async () => {
    const { cache, calls } = setup();
    await expect(cache.ensure(ref(png, { assetId: "../../etc/passwd" }), signal)).rejects.toThrow(/unsupported/);
    await expect(cache.ensure(ref(png, { assetId: "a/b" }), signal)).rejects.toThrow(/unsupported/);
    await expect(cache.ensure(ref(png, { mime: "text/html" }), signal)).rejects.toThrow(/unsupported/);
    await expect(cache.ensure(ref(png, { mime: "image/svg+xml" }), signal)).rejects.toThrow(/unsupported/);
    expect(calls).toHaveLength(0);
  });

  it("removes what is no longer needed and the leftovers of interrupted downloads, and keeps what is", async () => {
    const { cache, dir } = setup((id) => ({ data: id === "B" ? Buffer.from("bb".repeat(40)) : png }));
    const a = ref();
    const b = ref(Buffer.from("bb".repeat(40)), { assetId: "B" });
    await cache.ensure(a, signal);
    await cache.ensure(b, signal);
    writeFileSync(join(dir, "C.png.1234.part"), "partial");
    expect(cache.collect([a])).toBe(2);
    expect(readdirSync(dir)).toEqual(["01ASSET.png"]);
  });

  it("does not pull a download of its own out from under it while cleaning up (the logo and a carousel arrive together)", async () => {
    const { cache, dir } = setup();
    const a = ref();
    await cache.ensure(a, signal);
    writeFileSync(join(dir, `LOGO.png.${process.pid}.part`), "in flight");
    writeFileSync(join(dir, "OLD.png.1.part"), "left by a crashed run");
    expect(cache.collect([a])).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(["01ASSET.png", `LOGO.png.${process.pid}.part`]);
  });

  it("a sound is typed by the answer of the download, verified, and only audio is accepted", async () => {
    const wav = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt "), Buffer.alloc(40)]);
    const ok = setup(() => ({ data: wav, contentType: "audio/wav" }));
    expect(await ok.cache.ensureAudio("SOUND1", sha(wav), wav.length, signal)).toBe("SOUND1.wav");
    expect(await ok.cache.ensureAudio("SOUND1", sha(wav), wav.length, signal)).toBe("SOUND1.wav");
    expect(ok.calls).toHaveLength(1);

    const html = setup(() => ({ data: wav, contentType: "text/html" }));
    await expect(html.cache.ensureAudio("SOUND1", sha(wav), wav.length, signal)).rejects.toThrow(/not a supported sound/);
    expect(readdirSync(html.dir)).toEqual([]);

    const bad = setup(() => ({ data: wav, contentType: "audio/wav" }));
    await expect(bad.cache.ensureAudio("SOUND1", "0".repeat(64), wav.length, signal)).rejects.toThrow(/SHA-256/);
  });

  it("forgets files older than a given age", async () => {
    const { cache, dir } = setup();
    await cache.ensure(ref(), signal);
    const old = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(dir, "01ASSET.png"), old, old);
    expect(cache.collectOlderThan(3_600_000)).toBe(1);
    expect(existsSync(join(dir, "01ASSET.png"))).toBe(false);
  });
});
