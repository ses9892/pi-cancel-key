/**
 * What this tool last wrote, so reset can undo exactly that.
 *
 * Without this, reset would have to guess: a displaced action can be any of
 * pi's ~60 actions, and silently restoring an action the user had overridden
 * themselves would be worse than leaving our own damage behind.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BindingsConfig, Key } from "./plan.ts";

const STATE_FILE = "cancel-key-state.json";
const STATE_VERSION = 1;

export function statePath(agentDir: string): string {
  return join(agentDir, STATE_FILE);
}

interface StateFile {
  version: number;
  /** action -> value this tool wrote */
  applied: Record<string, Key | Key[]>;
}

function isBindingValue(value: unknown): value is Key | Key[] {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function readApplied(agentDir: string): BindingsConfig {
  const path = statePath(agentDir);
  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<StateFile>;
    if (parsed.version !== STATE_VERSION || typeof parsed.applied !== "object" || parsed.applied === null) {
      return {};
    }
    const applied: BindingsConfig = {};
    for (const [action, value] of Object.entries(parsed.applied)) {
      if (isBindingValue(value)) applied[action] = value;
    }
    return applied;
  } catch {
    return {};
  }
}

export function writeApplied(agentDir: string, applied: BindingsConfig): void {
  const path = statePath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  const state: StateFile = { version: STATE_VERSION, applied: applied as Record<string, Key | Key[]> };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  renameSync(temp, path);
}

export function clearApplied(agentDir: string): void {
  rmSync(statePath(agentDir), { force: true });
}
