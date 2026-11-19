import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { Buffer } from "node:buffer";
import type { TLSSocket } from "node:tls";

export interface HttpOptions {
  timeoutMs: number;
  /** SHA-256 of the server certificate (hex). With a pin a self-signed certificate is accepted if, and only if, it matches. */
  pin?: string | null;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const agents = new Map<string, https.Agent>();

/** TLS agent that checks the pinned certificate fingerprint instead of the certificate chain. */
function agentFor(pin: string): https.Agent {
  let agent = agents.get(pin);
  if (!agent) {
    agent = new https.Agent({
      keepAlive: true,
      // The chain is not what is trusted here, the pin is. Without a pin the default verification stays on.
      rejectUnauthorized: false,
      checkServerIdentity: (_host, cert) => (cert.fingerprint256.replace(/:/g, "").toLowerCase() === pin ? undefined : new Error("The server certificate does not match the pinned fingerprint")),
    });
    agents.set(pin, agent);
  }
  return agent;
}

function open(url: string, method: string, opts: HttpOptions, body?: Buffer): Promise<http.IncomingMessage> {
  const target = new URL(url);
  const lib = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      target,
      {
        method,
        headers: { ...opts.headers, ...(body && { "content-type": "application/json", "content-length": String(body.length) }) },
        ...(target.protocol === "https:" && opts.pin ? { agent: agentFor(opts.pin) } : {}),
        timeout: opts.timeoutMs,
      },
      resolve,
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

/** JSON in, JSON out. Anything but a 2xx throws an HttpError carrying the status and the server's message. */
export async function requestJson<T>(url: string, method: "GET" | "POST", payload: unknown, opts: HttpOptions): Promise<T> {
  const res = await open(url, method, opts, payload === undefined ? undefined : Buffer.from(JSON.stringify(payload)));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    size += (chunk as Buffer).length;
    // Answers of the REST API are tiny. Anything large is not the server we know.
    if (size > 1_000_000) throw new HttpError(res.statusCode ?? 0, "the answer is too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  const status = res.statusCode ?? 0;
  if (status < 200 || status >= 300) throw new HttpError(status, (json as { error?: string } | null)?.error ?? `HTTP ${status}`);
  return json as T;
}

/**
 * Streams a download to `dest`, refusing it as soon as it is larger than `maxBytes`. The caller verifies the hash
 * and moves the file; on any failure the partial file is removed here.
 */
export async function download(url: string, dest: string, opts: HttpOptions & { maxBytes: number; signal?: AbortSignal }): Promise<{ bytes: number; contentType: string | null }> {
  const res = await open(url, "GET", opts);
  const status = res.statusCode ?? 0;
  if (status !== 200) {
    res.resume();
    throw new HttpError(status, `download refused (${status})`);
  }
  const announced = Number(res.headers["content-length"] ?? 0);
  if (announced > opts.maxBytes) {
    res.destroy();
    throw new HttpError(status, "the file is larger than announced");
  }

  let received = 0;
  const out = createWriteStream(dest, { mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error("download cancelled"));
      opts.signal?.addEventListener("abort", abort, { once: true });
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > opts.maxBytes) {
          res.destroy();
          reject(new HttpError(status, "the file is larger than announced"));
        }
      });
      res.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      res.pipe(out);
    });
    return { bytes: received, contentType: typeof res.headers["content-type"] === "string" ? res.headers["content-type"].split(";")[0]!.trim().toLowerCase() : null };
  } catch (err) {
    out.destroy();
    await rm(dest, { force: true });
    throw err;
  }
}

/** The certificate of a TLS socket, for tests that need to read what a pin is compared with. */
export const certificateFingerprint = (socket: TLSSocket) => socket.getPeerCertificate().fingerprint256.replace(/:/g, "").toLowerCase();
