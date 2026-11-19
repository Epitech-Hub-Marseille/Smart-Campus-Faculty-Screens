import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fingerprint, generateIdentity, publicKeyOf, type Identity } from "@smartcampus/handshake";
import { readJson, writeFileAtomic } from "./files.js";

export interface DeviceRecord {
  /** Assigned by the server when the connection request was made. */
  deviceId: string | null;
  /** True once an admin approved the request. */
  enrolled: boolean;
}

/**
 * The device key and its enrollment record, on disk. The private key is generated here on first start and is
 * never sent anywhere or logged; the file is readable by its owner only. It lives outside the image (a volume).
 */
export class IdentityStore {
  private readonly keyFile: string;
  private readonly deviceFile: string;

  /** Shown to the admin in the connection request. */
  name = "Faculty screen";

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.keyFile = join(dataDir, "identity.json");
    this.deviceFile = join(dataDir, "device.json");
  }

  /** The existing key pair, or a new one. A key that no longer parses is replaced, not trusted. */
  loadOrCreate(): Identity {
    const stored = readJson<Identity>(this.keyFile);
    if (stored?.privateKey && stored.publicKey) {
      try {
        if (publicKeyOf(stored.privateKey) === stored.publicKey) {
          chmodSync(this.keyFile, 0o600);
          return stored;
        }
      } catch {
        // fall through: regenerate
      }
    }
    const created = generateIdentity();
    writeFileAtomic(this.keyFile, JSON.stringify(created), 0o600);
    // A new key is a new device as far as the server is concerned.
    this.saveDevice({ deviceId: null, enrolled: false });
    return created;
  }

  fingerprintOf(identity: Identity): string {
    return fingerprint(identity.publicKey);
  }

  device(): DeviceRecord {
    return readJson<DeviceRecord>(this.deviceFile) ?? { deviceId: null, enrolled: false };
  }

  saveDevice(record: DeviceRecord): void {
    writeFileAtomic(this.deviceFile, JSON.stringify(record));
  }

  /** Forgets the key and the enrollment: used when the server revoked this device or no longer knows the key. */
  reset(): void {
    for (const file of [this.keyFile, this.deviceFile]) if (existsSync(file)) rmSync(file, { force: true });
  }
}
