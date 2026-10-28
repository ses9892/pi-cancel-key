/**
 * Reading and writing `keybindings.json` without losing what we do not own.
 *
 * A user may hand-edit this file: comments are not supported by JSON, but
 * `$schema`, unknown actions, and unrelated overrides must survive our write.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BindingsConfig } from "./plan.ts";

const SCHEMA_URL = "https://pi.dev/schemas/keybindings.schema.json";

export function keybindingsPath(agentDir: string): string {
  return join(agentDir, "keybindings.json");
}

export interface LoadedKeybindings {
  /** Everything in the file, including `$schema` and unknown actions. */
  raw: Record<string, unknown>;
  /** Just the binding entries, which is what the planner works on. */
  config: BindingsConfig;
  /** True when the file did not exist yet. */
  missing: boolean;
}

function isBindingValue(value: unknown): value is string | string[] {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function loadKeybindingsFile(path: string): LoadedKeybindings {
  if (!existsSync(path)) {
    return { raw: {}, config: {}, missing: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
  } catch {
    return { raw: {}, config: {}, missing: false };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { raw: {}, config: {}, missing: false };
  }

  const raw = parsed as Record<string, unknown>;
  const config: BindingsConfig = {};
  for (const [action, value] of Object.entries(raw)) {
    if (action === "$schema") continue;
    if (!isBindingValue(value)) continue;
    config[action] = value;
  }

  return { raw, config, missing: false };
}

export function serializeKeybindings(config: BindingsConfig, previousRaw: Record<string, unknown> = {}): string {
  const ordered: Record<string, unknown> = {};
  ordered["$schema"] = typeof previousRaw["$schema"] === "string" ? previousRaw["$schema"] : SCHEMA_URL;

  for (const [action, value] of Object.entries(config)) {
    if (action === "$schema") continue;
    if (value === undefined) continue;
    ordered[action] = value;
  }

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Write via a sibling temp file so a crash cannot truncate the config. */
export function writeKeybindingsFile(
  path: string,
  config: BindingsConfig,
  previousRaw: Record<string, unknown> = {},
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, serializeKeybindings(config, previousRaw), "utf-8");
  renameSync(temp, path);
}
