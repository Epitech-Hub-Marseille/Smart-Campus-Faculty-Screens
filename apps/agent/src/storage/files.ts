import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** Writes through a temporary file and renames it, so a power cut leaves the old file or the new one, never half of one. */
export function writeFileAtomic(path: string, data: string | Buffer, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, path);
}

/** The parsed JSON, or null when the file is missing or unreadable (a corrupt file is the same as no file). */
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}
