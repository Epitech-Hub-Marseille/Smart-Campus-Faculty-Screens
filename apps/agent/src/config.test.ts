import { generateIdentity } from "@smartcampus/handshake";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const key = generateIdentity().publicKey;
const env = (extra: Record<string, string> = {}) => ({ SERVER_URL: "http://localhost:3000", SERVER_PUBLIC_KEY: key, ...extra });

describe("loadConfig", () => {
  it("derives the device channel address from the server address", () => {
    expect(loadConfig(env()).wsUrl).toBe("ws://localhost:3000/ws/device");
    expect(loadConfig(env({ SERVER_URL: "https://campus.example.org/" })).wsUrl).toBe("wss://campus.example.org/ws/device");
    expect(loadConfig(env({ SERVER_URL: "https://campus.example.org/" })).serverUrl).toBe("https://campus.example.org");
  });

  it("has safe defaults: the page listens on this machine only", () => {
    expect(loadConfig(env())).toMatchObject({ displayBind: "127.0.0.1", displayPort: 3000, dataDir: "./data", tlsPin: null });
  });

  it("refuses to start without a valid server key: the agent never learns it from the network", () => {
    expect(() => loadConfig({ SERVER_URL: "http://localhost:3000" })).toThrow(/server public key is required/);
    expect(() => loadConfig(env({ SERVER_PUBLIC_KEY: "not-a-key" }))).toThrow(/not an ECDSA P-256/);
  });

  it("refuses a missing or malformed server address", () => {
    expect(() => loadConfig({ SERVER_PUBLIC_KEY: key })).toThrow(/SERVER_URL/);
    expect(() => loadConfig(env({ SERVER_URL: "campus" }))).toThrow(/SERVER_URL/);
  });

  it("treats empty variables as missing, as docker compose passes them", () => {
    expect(loadConfig(env({ DEVICE_NAME: "", DISPLAY_PORT: "" }))).toMatchObject({ deviceName: "Faculty screen", displayPort: 3000 });
  });

  it("lists the extra origins allowed to open the local socket", () => {
    expect(loadConfig(env()).displayAllowedOrigins).toEqual([]);
    expect(loadConfig(env({ DISPLAY_ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173" })).displayAllowedOrigins).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
  });

  it("reads a certificate pin in any notation and rejects a wrong one", () => {
    const pin = "AB".repeat(32);
    expect(loadConfig(env({ SERVER_TLS_FINGERPRINT: pin.match(/../g)!.join(":") })).tlsPin).toBe(pin.toLowerCase());
    expect(() => loadConfig(env({ SERVER_TLS_FINGERPRINT: "abc" }))).toThrow(/SHA-256/);
  });
});
