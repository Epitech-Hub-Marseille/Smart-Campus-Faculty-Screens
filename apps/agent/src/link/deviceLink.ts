import {
  CloseCode,
  HANDSHAKE_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_MISSED_PONGS,
  PING_INTERVAL_MS,
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  buildMessage,
  handshakeMessages,
  parseServerMessage,
  ulid,
  type DeviceMessage,
  type ServerMessage,
} from "@smartcampus/protocol";
import { DeviceHandshake, type SecureChannel } from "@smartcampus/handshake";
import { WebSocket, type RawData } from "ws";
import https from "node:https";
import { errorMessage, log } from "../log.js";

/** What the agent can say to the server on an open connection. */
export interface MessageSink {
  send<T extends DeviceMessage["type"]>(type: T, payload: Extract<DeviceMessage, { type: T }>["payload"], id?: string): void;
}

export type LinkEvent =
  | { type: "connected"; sink: MessageSink }
  | { type: "message"; message: ServerMessage }
  | { type: "disconnected"; code: number | null; revoked: boolean };

export interface LinkOptions {
  url: string;
  deviceId: string;
  /** The device key (PKCS#8). Used to sign the handshake and never leaves this module. */
  devicePrivateKey: string;
  /** Provisioned server key (SPKI). */
  serverPublicKey: string;
  tlsPin?: string | null;
  /** For tests. */
  pingIntervalMs?: number;
  handshakeTimeoutMs?: number;
  backoff?: { minMs: number; maxMs: number };
  random?: () => number;
}

/** Delay before reconnecting: exponential from the minimum, with full jitter so a campus does not reconnect in one burst. */
export function backoffDelay(attempt: number, minMs = BACKOFF_MIN_MS, maxMs = BACKOFF_MAX_MS, random = Math.random): number {
  const ceiling = Math.min(maxMs, minMs * 2 ** Math.min(attempt, 16));
  return Math.max(minMs, Math.floor(random() * ceiling));
}

const toBuffer = (data: RawData): Buffer => (Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data));

/**
 * The persistent, outbound WSS link of the device (the device always dials out). It performs the mutual handshake
 * (hello, challenge, auth, then an encrypted session), numbers and checks every frame, and reconnects with jitter.
 * Events are delivered one at a time and in order. A revoked device is reported, never retried.
 */
export class DeviceLink {
  constructor(private readonly opts: LinkOptions) {}

  async run(onEvent: (event: LinkEvent) => Promise<void> | void, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      const outcome = await this.connectOnce(onEvent, signal);
      if (outcome.revoked) return;
      // A connection that reached session.ready was healthy: start the backoff over.
      attempt = outcome.ready ? 0 : attempt + 1;
      const rateLimited = outcome.code === CloseCode.RateLimited;
      const delay = rateLimited ? (this.opts.backoff?.maxMs ?? BACKOFF_MAX_MS) : backoffDelay(attempt, this.opts.backoff?.minMs, this.opts.backoff?.maxMs, this.opts.random);
      log("info", "reconnecting", { inMs: delay, code: outcome.code });
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    }
  }

  private connectOnce(
    onEvent: (event: LinkEvent) => Promise<void> | void,
    signal: AbortSignal,
  ): Promise<{ code: number | null; revoked: boolean; ready: boolean }> {
    const { url, deviceId, devicePrivateKey, serverPublicKey } = this.opts;
    return new Promise((resolve) => {
      const handshake = new DeviceHandshake({ deviceId, devicePrivateKey, serverPublicKey });
      const pin = this.opts.tlsPin;
      const ws = new WebSocket(url, {
        // A frame larger than the protocol allows is never legitimate, before or after encryption.
        maxPayload: MAX_FRAME_BYTES,
        ...(url.startsWith("wss:") && pin
          ? {
              agent: new https.Agent({
                rejectUnauthorized: false,
                checkServerIdentity: (_h, cert) => (cert.fingerprint256.replace(/:/g, "").toLowerCase() === pin ? undefined : new Error("certificate does not match the pin")),
              }),
            }
          : {}),
      });

      let channel: SecureChannel | null = null;
      let ready = false;
      let sendSeq = 0;
      let recvSeq = 0;
      let lastHeard = Date.now();
      let finished = false;
      // Events are handled strictly in order, even though a handler may be asynchronous.
      let queue: Promise<void> = Promise.resolve();

      const sink: MessageSink = {
        send: (type, payload, id) => {
          if (!channel || ws.readyState !== WebSocket.OPEN) return;
          const msg = buildMessage<DeviceMessage>({ type, payload, id: id ?? ulid() } as never, ++sendSeq);
          ws.send(channel.encrypt(JSON.stringify(msg)), { binary: true });
        },
      };

      const deliver = (event: LinkEvent) => {
        queue = queue.then(() => onEvent(event)).catch((err) => log("error", "event handler failed", { error: errorMessage(err) }));
        return queue;
      };

      const handshakeTimer = setTimeout(() => ws.terminate(), this.opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS);
      // The server pings every 25 s. If nothing is heard for as long as it takes it to give up on us, the link is dead.
      const watchdog = setInterval(() => {
        if (ready && Date.now() - lastHeard > (this.opts.pingIntervalMs ?? PING_INTERVAL_MS) * MAX_MISSED_PONGS + 5_000) {
          log("warn", "the server went quiet, dropping the connection");
          ws.terminate();
        }
      }, 5_000);

      const abort = () => ws.close(1000, "shutting down");
      signal.addEventListener("abort", abort, { once: true });

      const protocolError = (why: string) => {
        log("warn", "protocol error", { why });
        ws.close(CloseCode.ProtocolError, "protocol error");
      };

      ws.on("open", () => ws.send(JSON.stringify(handshake.hello())));
      ws.on("ping", () => (lastHeard = Date.now()));
      ws.on("error", (err) => log("warn", "socket error", { error: errorMessage(err) }));

      ws.on("message", (data, isBinary) => {
        lastHeard = Date.now();
        try {
          if (!channel) {
            // The first answer is the (plain JSON) challenge. Anything else is not our server.
            if (isBinary) return protocolError("binary frame before the handshake");
            const parsed = handshakeMessages.challenge.safeParse(JSON.parse(toBuffer(data).toString("utf8")));
            if (!parsed.success) return protocolError("bad challenge");
            const answered = handshake.onChallenge(parsed.data);
            channel = answered.channel;
            ws.send(JSON.stringify(answered.auth));
            return;
          }
          if (!isBinary) return protocolError("text frame in an encrypted session");
          const parsed = parseServerMessage(channel.decrypt(toBuffer(data)));
          if (!parsed.ok) return protocolError(parsed.error);
          // seq starts at 1 and rises by exactly 1: anything else is a replay or a loss.
          if (parsed.message.seq !== recvSeq + 1) return protocolError("bad seq");
          recvSeq = parsed.message.seq;

          if (!ready) {
            if (parsed.message.type !== "session.ready") return protocolError("expected session.ready first");
            ready = true;
            clearTimeout(handshakeTimer);
            void deliver({ type: "connected", sink });
          }
          void deliver({ type: "message", message: parsed.message });
        } catch (err) {
          // A failed server signature lands here too: a device never talks to a server that cannot prove its identity.
          log("warn", "handshake or frame refused", { error: errorMessage(err) });
          ws.terminate();
        }
      });

      ws.on("close", (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(handshakeTimer);
        clearInterval(watchdog);
        signal.removeEventListener("abort", abort);
        const revoked = code === CloseCode.Revoked;
        void deliver({ type: "disconnected", code, revoked }).then(() => resolve({ code, revoked, ready }));
      });
    });
  }
}
