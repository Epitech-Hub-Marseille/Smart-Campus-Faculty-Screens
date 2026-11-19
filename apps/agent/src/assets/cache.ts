import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AssetRef } from "@smartcampus/protocol";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/mp4": "m4a",
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Fetches an asset to a path. Implemented with a signed HTTPS request; a seam so the cache can be tested alone. */
export type Fetcher = (assetId: string, destination: string, maxBytes: number, signal: AbortSignal) => Promise<{ contentType: string | null }>;

export class AssetError extends Error {}

const sha256Of = (path: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

/**
 * Verified files on disk. A file is renamed to its final name only after its SHA-256 matched the one the server
 * announced, so a file at its final name is a verified file and the cache needs no index. The name comes from the
 * asset id and the declared type, never from anything a server could use to point outside the directory.
 */
export class AssetCache {
  constructor(
    private readonly dir: string,
    private readonly fetcher: Fetcher,
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** File name for a reference, e.g. `01J9ZQ.png`. Throws for anything that is not a plain id and a known type. */
  fileName(ref: Pick<AssetRef, "assetId" | "mime">): string {
    const ext = EXTENSIONS[ref.mime];
    if (!ID.test(ref.assetId) || !ext) throw new AssetError(`unsupported asset ${ref.assetId} (${ref.mime})`);
    return `${ref.assetId}.${ext}`;
  }

  pathOf(ref: Pick<AssetRef, "assetId" | "mime">): string {
    return join(this.dir, this.fileName(ref));
  }

  has(ref: AssetRef): boolean {
    try {
      const path = this.pathOf(ref);
      return existsSync(path) && statSync(path).size === ref.size;
    } catch {
      return false;
    }
  }

  /** Makes sure the verified file is on disk, downloading and checking it if it is not. Returns its file name. */
  async ensure(ref: AssetRef, signal: AbortSignal): Promise<string> {
    const name = this.fileName(ref);
    if (this.has(ref)) return name;
    await this.fetchVerified(ref.assetId, ref.sha256, ref.size, join(this.dir, name), signal);
    return name;
  }

  /**
   * For a sound: `audio.play` names the asset, its hash and its size but not its type, so the type is read from the
   * response of the signed download. Only audio is accepted, and the file is verified like any other.
   */
  async ensureAudio(assetId: string, sha256: string, size: number, signal: AbortSignal): Promise<string> {
    if (!ID.test(assetId)) throw new AssetError(`invalid asset id ${assetId}`);
    const cached = readdirSync(this.dir).find((f) => f.startsWith(`${assetId}.`) && !f.endsWith(".part"));
    if (cached && statSync(join(this.dir, cached)).size === size) return cached;

    const partial = join(this.dir, `${assetId}.${process.pid}.part`);
    try {
      const { contentType } = await this.fetcher(assetId, partial, size, signal);
      const ext = contentType?.startsWith("audio/") ? EXTENSIONS[contentType] : undefined;
      if (!ext) throw new AssetError(`${assetId} is not a supported sound (${contentType ?? "unknown type"})`);
      await this.verify(partial, sha256, size, assetId);
      const name = `${assetId}.${ext}`;
      renameSync(partial, join(this.dir, name));
      return name;
    } finally {
      rmSync(partial, { force: true });
    }
  }

  private async fetchVerified(assetId: string, sha256: string, size: number, final: string, signal: AbortSignal): Promise<void> {
    const partial = `${final}.${process.pid}.part`;
    try {
      // Never accept more than the announced size: a larger file is hostile or broken.
      await this.fetcher(assetId, partial, size, signal);
      await this.verify(partial, sha256, size, assetId);
      renameSync(partial, final);
    } finally {
      rmSync(partial, { force: true });
    }
  }

  private async verify(path: string, sha256: string, size: number, assetId: string): Promise<void> {
    if (statSync(path).size !== size) throw new AssetError(`${assetId} is not the announced size`);
    if ((await sha256Of(path)) !== sha256.toLowerCase()) throw new AssetError(`${assetId} failed SHA-256 verification`);
  }

  /** Removes files not touched for `ageMs`: sounds are played once and then only waste the disk. */
  collectOlderThan(ageMs: number, now = Date.now()): number {
    let removed = 0;
    for (const entry of readdirSync(this.dir)) {
      const path = join(this.dir, entry);
      if (now - statSync(path).mtimeMs > ageMs) {
        rmSync(path, { force: true, recursive: true });
        removed++;
      }
    }
    return removed;
  }

  /**
   * Removes every file that is not in `keep`, and leftovers of interrupted downloads. A download this process is still
   * making (`*.<pid>.part`) is left alone: the logo and a carousel arrive together on connection, and cleaning up
   * after one must not pull the file out from under the other.
   */
  collect(keep: Iterable<AssetRef>): number {
    const keepNames = new Set<string>();
    for (const ref of keep) {
      try {
        keepNames.add(this.fileName(ref));
      } catch {
        // an unusable reference keeps nothing
      }
    }
    let removed = 0;
    const ownPartial = `.${process.pid}.part`;
    for (const entry of readdirSync(this.dir)) {
      if (!keepNames.has(entry) && !entry.endsWith(ownPartial)) {
        rmSync(join(this.dir, entry), { force: true, recursive: true });
        removed++;
      }
    }
    return removed;
  }
}
