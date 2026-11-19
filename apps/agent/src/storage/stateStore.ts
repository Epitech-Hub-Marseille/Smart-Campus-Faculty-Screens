import { join } from "node:path";
import { reviveState, type AgentState } from "../state.js";
import { readJson, writeFileAtomic } from "./files.js";

/** The state and the recently handled command ids, on disk: a restart or a long outage shows the last known screen. */
export class StateStore {
  private readonly stateFile: string;
  private readonly seenFile: string;

  constructor(dataDir: string) {
    this.stateFile = join(dataDir, "state.json");
    this.seenFile = join(dataDir, "seen-ids.json");
  }

  load(): AgentState {
    return reviveState(readJson<unknown>(this.stateFile));
  }

  save(state: AgentState): void {
    writeFileAtomic(this.stateFile, JSON.stringify(state));
  }

  loadSeen(): string[] {
    const ids = readJson<unknown>(this.seenFile);
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string").slice(-200) : [];
  }

  saveSeen(ids: string[]): void {
    writeFileAtomic(this.seenFile, JSON.stringify(ids));
  }
}
