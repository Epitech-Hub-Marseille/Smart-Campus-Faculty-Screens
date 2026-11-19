import { log, errorMessage } from "./log.js";
import { HttpError, requestJson, type HttpOptions } from "./net/http.js";
import type { IdentityStore } from "./storage/identity.js";
import type { Identity } from "@smartcampus/handshake";
import type { EnrollmentStatus } from "@smartcampus/faculty-local";

interface EnrollTicket {
  deviceId: string;
  fingerprint: string;
  expiresAt: string;
}

type ServerStatus = "pending" | "active" | "denied" | "revoked" | "expired" | "unknown";

export interface EnrollmentDeps {
  serverUrl: string;
  http: HttpOptions;
  store: IdentityStore;
  identity: () => Identity;
  /** Reports progress to the page, which shows the fingerprint to the admin approving the request. */
  onStatus: (status: EnrollmentStatus, fingerprint: string, message?: string) => void;
  /** Replaces the key pair (a key the server already knows cannot ask again). */
  regenerate: () => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollMs?: number;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Gets this device approved. It sends only its PUBLIC key and waits; an admin or operator sees the request in the
 * console with the key fingerprint and approves it. The fingerprint the server computed is compared with the one
 * worked out here, so a request that was altered on the way is noticed. Resolves with the device id once approved.
 */
export async function enroll(deps: EnrollmentDeps, signal: AbortSignal): Promise<string> {
  const sleep = deps.sleep ?? wait;
  const pollMs = deps.pollMs ?? 3_000;
  let failures = 0;

  while (!signal.aborted) {
    const identity = deps.identity();
    const fingerprint = deps.store.fingerprintOf(identity);
    const record = deps.store.device();
    if (record.enrolled && record.deviceId) return record.deviceId;

    try {
      deps.onStatus("requesting", fingerprint);
      let deviceId = record.deviceId;
      if (!deviceId) {
        const ticket = await requestJson<EnrollTicket>(`${deps.serverUrl}/api/enroll`, "POST", { publicKey: identity.publicKey, type: "display", name: deps.store.name }, deps.http);
        if (ticket.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) throw new Error("the server computed another fingerprint for this key");
        deviceId = ticket.deviceId;
        deps.store.saveDevice({ deviceId, enrolled: false });
        log("info", "connection request sent", { deviceId });
      }

      const outcome = await waitForDecision(deps, deviceId, fingerprint, pollMs, sleep, signal);
      if (outcome === "active") {
        deps.store.saveDevice({ deviceId, enrolled: true });
        log("info", "enrolled", { deviceId });
        return deviceId;
      }
      // Denied, expired, revoked or forgotten: the request is over, ask again from a clean record.
      deps.store.saveDevice({ deviceId: null, enrolled: false });
      failures = 0;
      if (outcome === "denied") {
        // A denied key cannot ask again for a while: say so and wait instead of hammering the server.
        deps.onStatus("denied", fingerprint, "The request was denied. It will be sent again shortly.");
        await sleep(60_000, signal);
      }
    } catch (err) {
      failures++;
      if (err instanceof HttpError && err.status === 409) {
        // "This key is already enrolled": the key is known but the id was lost. Only a new key pair can enroll again.
        log("warn", "the server already knows this key, generating a new one");
        deps.regenerate();
        continue;
      }
      const message = err instanceof HttpError && err.status === 403 ? "The request was denied." : errorMessage(err);
      deps.onStatus(err instanceof HttpError && err.status === 403 ? "denied" : "error", fingerprint, message);
      log("warn", "enrollment failed", { error: message });
      await sleep(Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5)), signal);
    }
  }
  throw new Error("enrollment cancelled");
}

async function waitForDecision(
  deps: EnrollmentDeps,
  deviceId: string,
  fingerprint: string,
  pollMs: number,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<ServerStatus> {
  while (!signal.aborted) {
    let status: ServerStatus;
    try {
      status = (await requestJson<{ status: ServerStatus }>(`${deps.serverUrl}/api/enroll/${deviceId}`, "GET", undefined, deps.http)).status;
    } catch (err) {
      deps.onStatus("error", fingerprint, `Cannot reach the server: ${errorMessage(err)}`);
      await sleep(pollMs, signal);
      continue;
    }
    if (status === "pending") {
      deps.onStatus("waiting", fingerprint);
      await sleep(pollMs, signal);
      continue;
    }
    if (status === "expired") deps.onStatus("expired", fingerprint, "The request expired without an answer. A new one is sent.");
    return status;
  }
  return "unknown";
}
