type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let threshold: Level = "info";

export function setLogLevel(level: Level): void {
  threshold = level;
}

/**
 * JSON lines on stdout. Callers pass ids, counts and error messages, never keys, tokens or file contents: there
 * is deliberately no helper here that would make it easy to dump an object.
 */
export function log(level: Level, msg: string, extra: Record<string, string | number | boolean | null | undefined> = {}): void {
  if (ORDER[level] < ORDER[threshold]) return;
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
