import { join } from "node:path";
import { signedFetcher } from "./assets/downloader.js";
import { AssetCache } from "./assets/cache.js";
import { loadConfig } from "./config.js";
import { Controller } from "./controller.js";
import { enroll } from "./enrollment.js";
import { DeviceLink } from "./link/deviceLink.js";
import { startLocalServer } from "./local/server.js";
import { errorMessage, log, setLogLevel } from "./log.js";
import { IdentityStore } from "./storage/identity.js";
import { StateStore } from "./storage/stateStore.js";
import { WeatherPoller } from "./weather.js";

const VERSION = "0.1.0";

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const store = new IdentityStore(config.dataDir);
  store.name = config.deviceName;
  let identity = store.loadOrCreate();
  const states = new StateStore(config.dataDir);
  const http = { timeoutMs: config.requestTimeoutMs, pin: config.tlsPin };

  // The downloader signs with the key and the server's clock, both read when a download starts.
  let deviceId = "";
  const controllerRef: { current: Controller | null } = { current: null };
  const fetcher = signedFetcher({
    serverUrl: config.serverUrl,
    get deviceId() {
      return deviceId;
    },
    get devicePrivateKey() {
      return identity.privateKey;
    },
    timeoutMs: config.assetTimeoutMs,
    pin: config.tlsPin,
    clockOffsetMs: () => controllerRef.current?.clockOffsetMs() ?? 0,
  });
  const assets = new AssetCache(join(config.dataDir, "assets"), fetcher);
  const sounds = new AssetCache(join(config.dataDir, "audio"), fetcher);

  let local: Awaited<ReturnType<typeof startLocalServer>>;
  const controller = new Controller({
    initial: states.load(),
    seen: states.loadSeen(),
    assets,
    sounds,
    saveState: (s) => states.save(s),
    saveSeen: (ids) => states.saveSeen(ids),
    publish: (m) => local?.broadcast(m),
    version: VERSION,
  });
  controllerRef.current = controller;

  // The page first: even before the device is approved, the screen shows its fingerprint to whoever has to approve it.
  local = await startLocalServer({
    port: config.displayPort,
    bind: config.displayBind,
    distDir: config.displayDist,
    assetsDir: join(config.dataDir, "assets"),
    soundsDir: join(config.dataDir, "audio"),
    view: () => controller.view(),
    allowedOrigins: config.displayAllowedOrigins,
  });

  const stop = new AbortController();
  const shutdown = async () => {
    stop.abort();
    await local.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  const weather = new WeatherPoller((w) => controller.setWeather(w));
  let lastWeatherKey = "";
  const housekeeping = setInterval(() => {
    controller.housekeeping();
    const cfg = controller.snapshot.config;
    const key = JSON.stringify(cfg.widgets.weather ? cfg.weather : null);
    if (key !== lastWeatherKey) {
      lastWeatherKey = key;
      weather.configure(cfg.widgets.weather ? cfg.weather : null);
    }
  }, 5_000);
  housekeeping.unref();

  for (;;) {
    deviceId = await enroll(
      {
        serverUrl: config.serverUrl,
        http,
        store,
        identity: () => identity,
        onStatus: (status, fingerprint, message) => controller.setEnrollment(status, fingerprint, message),
        regenerate: () => {
          store.reset();
          identity = store.loadOrCreate();
        },
      },
      stop.signal,
    );

    log("info", "connecting", { deviceId });
    let revoked = false;
    await new DeviceLink({
      url: config.wsUrl,
      deviceId,
      devicePrivateKey: identity.privateKey,
      serverPublicKey: config.serverPublicKey,
      tlsPin: config.tlsPin,
    }).run(async (event) => {
      await controller.onEvent(event);
      if (event.type === "disconnected" && event.revoked) revoked = true;
    }, stop.signal);

    if (!revoked) break;
    // Revoked: forget the key and the enrollment, and ask to be approved again from scratch.
    log("warn", "this device was revoked, starting over");
    store.reset();
    identity = store.loadOrCreate();
  }
}

main().catch((err) => {
  log("error", "the agent stopped", { error: errorMessage(err) });
  process.exit(1);
});
