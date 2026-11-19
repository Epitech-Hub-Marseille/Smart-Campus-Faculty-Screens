import { readFileSync } from "node:fs";
import { loadPublicKey } from "@smartcampus/handshake";
import { z } from "zod";

const schema = z.object({
  // Where the central server is. http(s) for the REST calls and the asset download; the WSS address is derived from it.
  SERVER_URL: z.string().url(),
  // The server's public key, provisioned on the device (base64 SPKI or PEM): the QR code or `GET /api/server-key` of the
  // console. It is never learned from the network by the agent, so a relay cannot hand over its own.
  SERVER_PUBLIC_KEY: z.string().optional(),
  SERVER_PUBLIC_KEY_FILE: z.string().optional(),
  // Pins a self-signed certificate of the server (SHA-256, hex, colons allowed). Without it, normal verification applies.
  SERVER_TLS_FINGERPRINT: z.string().optional(),
  DEVICE_NAME: z.string().trim().min(1).max(100).default("Faculty screen"),
  // Everything the agent keeps: the identity key (0600), its state and the verified files.
  DATA_DIR: z.string().default("./data"),
  // The local page. It listens on this machine only unless told otherwise (remote debugging).
  DISPLAY_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DISPLAY_BIND: z.string().default("127.0.0.1"),
  DISPLAY_DIST: z.string().optional(),
  // Other origins allowed to open the local socket, comma separated. For the Vite dev server only: the page of this machine
  // on DISPLAY_PORT is always allowed, a web page from anywhere else never is.
  DISPLAY_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  ASSET_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface Config {
  serverUrl: string;
  /** `ws://` or `wss://` address of the device channel. */
  wsUrl: string;
  serverPublicKey: string;
  tlsPin: string | null;
  deviceName: string;
  dataDir: string;
  displayPort: number;
  displayBind: string;
  displayDist: string | null;
  displayAllowedOrigins: string[];
  requestTimeoutMs: number;
  assetTimeoutMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

/** Reads and checks the environment. Throws a readable error: a screen that cannot start must say why. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Compose passes unset variables as empty strings; treat those as missing.
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(clean);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid configuration: ${issue?.path.join(".")}: ${issue?.message}`);
  }
  const c = parsed.data;

  const raw = c.SERVER_PUBLIC_KEY ?? (c.SERVER_PUBLIC_KEY_FILE ? readFileSync(c.SERVER_PUBLIC_KEY_FILE, "utf8") : undefined);
  if (!raw) throw new Error("Invalid configuration: the server public key is required (SERVER_PUBLIC_KEY or SERVER_PUBLIC_KEY_FILE)");
  const serverPublicKey = raw.trim();
  try {
    loadPublicKey(serverPublicKey);
  } catch {
    throw new Error("Invalid configuration: the server public key is not an ECDSA P-256 public key (base64 SPKI or PEM)");
  }

  const url = new URL(c.SERVER_URL);
  const wsUrl = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/ws/device`;
  const pin = c.SERVER_TLS_FINGERPRINT?.replace(/[:\s]/g, "").toLowerCase() ?? null;
  if (pin && !/^[0-9a-f]{64}$/.test(pin)) throw new Error("Invalid configuration: SERVER_TLS_FINGERPRINT must be a SHA-256 (64 hex digits)");

  return {
    serverUrl: c.SERVER_URL.replace(/\/+$/, ""),
    wsUrl,
    serverPublicKey,
    tlsPin: pin,
    deviceName: c.DEVICE_NAME,
    dataDir: c.DATA_DIR,
    displayPort: c.DISPLAY_PORT,
    displayBind: c.DISPLAY_BIND,
    displayDist: c.DISPLAY_DIST ?? null,
    displayAllowedOrigins: c.DISPLAY_ALLOWED_ORIGINS,
    requestTimeoutMs: c.REQUEST_TIMEOUT_MS,
    assetTimeoutMs: c.ASSET_TIMEOUT_MS,
    logLevel: c.LOG_LEVEL,
  };
}
