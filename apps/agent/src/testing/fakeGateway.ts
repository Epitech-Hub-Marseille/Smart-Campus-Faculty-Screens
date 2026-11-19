import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ServerHandshake, generateIdentity, publicKeyOf, type SecureChannel, type Identity } from "@smartcampus/handshake";
import { buildMessage, handshakeMessages, parseDeviceMessage, ulid, type DeviceMessage, type ServerMessage } from "@smartcampus/protocol";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * A device gateway that speaks the real protocol (the same handshake and framing as the central server, built from
 * the same packages), so the agent can be tested end to end without the server. It accepts one known device.
 */
export class FakeGateway {
  readonly serverKey: Identity = generateIdentity();
  readonly serverPublicKey = publicKeyOf(this.serverKey.privateKey);
  readonly received: DeviceMessage[] = [];
  readonly connections: { deviceId: string | null }[] = [];
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private channel: SecureChannel | null = null;
  private sendSeq = 0;
  private waiters: Array<() => void> = [];
  /** Public key the device must prove. Set to null to refuse everybody. */
  devicePublicKey: string | null = null;
  url = "";
  /** Messages sent right after `session.ready` on every connection. */
  onReady: () => void = () => undefined;
  desired: Record<string, unknown> = {};
  serverTime = () => Date.now();

  async start(): Promise<void> {
    this.http = createServer();
    this.wss = new WebSocketServer({ server: this.http, path: "/ws/device", maxPayload: 70_000 });
    this.wss.on("connection", (ws) => this.accept(ws));
    await new Promise<void>((resolve) => this.http!.listen(0, "127.0.0.1", resolve));
    this.url = `ws://127.0.0.1:${(this.http.address() as AddressInfo).port}/ws/device`;
  }

  async stop(): Promise<void> {
    this.socket?.terminate();
    this.wss?.close();
    await new Promise<void>((resolve) => this.http?.close(() => resolve()) ?? resolve());
  }

  private accept(ws: WebSocket) {
    const hs = new ServerHandshake(this.serverKey.privateKey);
    const connection = { deviceId: null as string | null };
    this.connections.push(connection);
    let stage: "hello" | "auth" | "live" = "hello";
    let channel: SecureChannel | null = null;
    let recvSeq = 0;

    ws.on("message", (data, isBinary) => {
      try {
        const raw = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
        if (stage === "hello") {
          const hello = handshakeMessages.hello.parse(JSON.parse(raw.toString()));
          connection.deviceId = hello.deviceId;
          ws.send(JSON.stringify(hs.onHello(hello)));
          stage = "auth";
        } else if (stage === "auth") {
          if (!this.devicePublicKey) return ws.close(4401, "authentication failed");
          channel = hs.onAuth(handshakeMessages.auth.parse(JSON.parse(raw.toString())), this.devicePublicKey);
          this.socket = ws;
          this.channel = channel;
          this.sendSeq = 0;
          stage = "live";
          this.send("session.ready", { desired: this.desired, serverTime: this.serverTime(), pendingCommands: 0 });
          this.onReady();
        } else {
          if (!isBinary) return ws.close(4400, "protocol error");
          const parsed = parseDeviceMessage(channel!.decrypt(raw));
          if (!parsed.ok || parsed.message.seq !== recvSeq + 1) return ws.close(4400, "protocol error");
          recvSeq = parsed.message.seq;
          this.received.push(parsed.message);
          for (const w of this.waiters.splice(0)) w();
        }
      } catch {
        ws.close(4401, "authentication failed");
      }
    });
  }

  /** Sends an encrypted, numbered server message to the connected device. */
  send<T extends ServerMessage["type"]>(type: T, payload: Extract<ServerMessage, { type: T }>["payload"], id: string = ulid(), seq?: number): string {
    if (!this.socket || !this.channel) throw new Error("no device connected");
    const msg = buildMessage<ServerMessage>({ type, payload, id } as never, seq ?? ++this.sendSeq);
    this.socket.send(this.channel.encrypt(JSON.stringify(msg)), { binary: true });
    return id;
  }

  /** Sends bytes as they are, bypassing the channel (an attacker or a bug). */
  sendRaw(data: Buffer | string, binary = true) {
    this.socket?.send(data, { binary });
  }

  close(code: number, reason = "") {
    this.socket?.close(code, reason);
  }

  async waitFor<T extends DeviceMessage["type"]>(type: T, match: (m: Extract<DeviceMessage, { type: T }>) => boolean = () => true, timeoutMs = 5_000): Promise<Extract<DeviceMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find((m) => m.type === type && match(m as never));
      if (found) return found as never;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${type}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, Math.min(left, 100));
      });
    }
  }

  acksFor(id: string) {
    return this.received.filter((m) => m.type === "ack" && m.payload.ref === id).length;
  }
}
