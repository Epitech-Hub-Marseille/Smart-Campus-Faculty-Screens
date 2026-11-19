import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveMessage, ViewState } from "@smartcampus/faculty-local";
import { log } from "../log.js";

export interface LocalServerOptions {
  port: number;
  bind: string;
  /** Built kiosk page. Without it only the socket and the files are served (development uses Vite). */
  distDir: string | null;
  assetsDir: string;
  soundsDir: string;
  /** Current view, sent to every page that connects. */
  view: () => ViewState;
  /** Extra origins allowed to open the socket (the Vite dev server). */
  allowedOrigins?: string[];
}

/** The page is the only legitimate client: its origin is this machine. A web page the browser happens to open is not. */
export function originAllowed(origin: string | undefined, port: number, extra: string[] = []): boolean {
  if (!origin) return true; // not a browser
  if (extra.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && (u.port || (u.protocol === "https:" ? "443" : "80")) === String(port);
  } catch {
    return false;
  }
}

export interface LocalServer {
  server: Server;
  /** Sends a message to every connected page. */
  broadcast(message: LiveMessage): void;
  close(): Promise<void>;
}

/**
 * Serves the kiosk page on this machine and pushes the state to it over `ws://localhost/live`. The page asks for
 * nothing and sends nothing: the browser never sees the device key, the session or the server address.
 */
export function startLocalServer(opts: LocalServerOptions): Promise<LocalServer> {
  const app = express();
  app.disable("x-powered-by");
  // The port that is really listened on: it is not the requested one with port 0, or behind a port mapping.
  let actualPort = opts.port;

  // The page plays files from this machine and, for what an administrator chose to put on a tile, loads that address:
  // a web page or YouTube in a frame, a live stream or radio as media (HLS is fetched by the player), an MJPEG camera as
  // an image. Scripts, styles and fonts stay local.
  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "img-src 'self' data: http: https:",
        "media-src 'self' blob: http: https:",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        `connect-src 'self' ws://localhost:${actualPort} ws://127.0.0.1:${actualPort} http: https:`,
        "frame-src http: https:",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Names are asset ids plus a type, so the cache can be served as it is. Immutable: a file never changes under its name.
  const files = { fallthrough: false, immutable: true, maxAge: "1y", dotfiles: "deny" as const, index: false };
  // Not `/assets`: that is where the built page keeps its own scripts and fonts.
  app.use("/media", express.static(opts.assetsDir, files));
  app.use("/audio", express.static(opts.soundsDir, files));

  // Deliberately small: no identity, no key, no server address.
  app.get("/health", (_req, res) => {
    const v = opts.view();
    res.setHeader("Cache-Control", "no-store");
    res.json({ service: "faculty-agent", phase: v.phase, online: v.online, scenes: v.scenes.length, emergency: Boolean(v.emergency) });
  });

  const dist = opts.distDir && existsSync(opts.distDir) ? resolve(opts.distDir) : null;
  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!media\/|audio\/|health|live).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
  } else {
    app.get("/", (_req, res) => res.type("text/plain").send("The Faculty screen agent is running. The kiosk page is not built (run it with `pnpm dev:display`).\n"));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const pages = new Set<WebSocket>();

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/live" || !originAllowed(req.headers.origin, actualPort, opts.allowedOrigins)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      pages.add(ws);
      ws.on("close", () => pages.delete(ws));
      ws.on("error", () => pages.delete(ws));
      // The page sends nothing: anything it does send is ignored.
      ws.on("message", () => undefined);
      ws.send(JSON.stringify({ type: "state", state: opts.view() } satisfies LiveMessage));
    });
  });

  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.bind, () => {
      actualPort = (server.address() as AddressInfo).port;
      log("info", "local display listening", { bind: opts.bind, port: opts.port });
      resolveStart({
        server,
        broadcast(message) {
          const text = JSON.stringify(message);
          for (const ws of pages) if (ws.readyState === ws.OPEN) ws.send(text);
        },
        close: () =>
          new Promise<void>((done) => {
            for (const ws of pages) ws.terminate();
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}
