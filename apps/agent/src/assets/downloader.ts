import { signRequest } from "@smartcampus/handshake";
import { download } from "../net/http.js";
import type { Fetcher } from "./cache.js";

export interface DownloaderOptions {
  serverUrl: string;
  deviceId: string;
  devicePrivateKey: string;
  timeoutMs: number;
  pin?: string | null;
  /** Milliseconds to add to the device clock to get the server's. A signed request is refused beyond 60 s of skew. */
  clockOffsetMs: () => number;
}

/**
 * Downloads over HTTPS with a request signed by the device key (method, path, timestamp), as `audio.play` and the
 * playlist require. The timestamp uses the server's clock, learned from `session.ready`: a Raspberry Pi without a
 * battery-backed clock would otherwise sign with the wrong time and be refused.
 */
export function signedFetcher(opts: DownloaderOptions): Fetcher {
  return async (assetId, destination, maxBytes, signal) => {
    const path = `/api/assets/${encodeURIComponent(assetId)}/download`;
    const signed = signRequest(opts.devicePrivateKey, "GET", path, Date.now() + opts.clockOffsetMs());
    return download(`${opts.serverUrl}${path}`, destination, {
      timeoutMs: opts.timeoutMs,
      pin: opts.pin,
      maxBytes,
      signal,
      headers: { "x-device-id": opts.deviceId, "x-timestamp": signed.timestamp, "x-signature": signed.signature },
    }).then((r) => ({ contentType: r.contentType }));
  };
}
