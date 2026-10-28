/**
 * The one operation the command performs: plan, persist, apply.
 *
 * Dependencies are injected so the whole flow can run against a temp directory
 * and a real keybindings manager, with no terminal and no pi process.
 */

import {
  MANAGED_ACTIONS,
  describeChange,
  planCancelKey,
  planReset,
  recordApplied,
  residualConflicts,
  type BindingsConfig,
  type Change,
  type Key,
} from "./plan.ts";
import { keybindingsPath, loadKeybindingsFile, writeKeybindingsFile } from "./keybindings-file.ts";
import { clearApplied, readApplied, writeApplied } from "./state.ts";

export interface CancelKeyDeps {
  /** Directory holding keybindings.json (pi's agent dir). */
  agentDir: string;
  /** pi's effective keymap: defaults merged with user overrides. */
  readResolved: () => BindingsConfig;
  /** Apply overrides to the live keybindings manager. */
  applyUserBindings: (config: BindingsConfig) => void;
  /** Built-in default keys for one action, for reporting a reset. */
  readDefaults: (action: string) => Key[];
}

export type ApplyOutcome =
  | {
      ok: true;
      path: string;
      changes: Change[];
      messages: string[];
    }
  | {
      ok: false;
      path: string;
      reason: string;
    };

function defaultKeys(deps: CancelKeyDeps, actions: readonly string[]): BindingsConfig {
  const defaults: BindingsConfig = {};
  for (const action of actions) defaults[action] = deps.readDefaults(action);
  return defaults;
}

function persistAndApply(
  deps: CancelKeyDeps,
  planned: ReturnType<typeof planCancelKey>,
  resolved: BindingsConfig,
): ApplyOutcome {
  const path = keybindingsPath(deps.agentDir);

  const conflicts = residualConflicts(planned, resolved, planned.key ?? "");
  if (conflicts.length > 0) {
    const detail = conflicts.map((c) => `${c.key}: ${c.actions.join(", ")}`).join("; ");
    return { ok: false, path, reason: `Aborted: key conflicts remain (${detail})` };
  }

  const loaded = loadKeybindingsFile(path);
  writeKeybindingsFile(path, planned.nextUserBindings, loaded.raw);
  deps.applyUserBindings(planned.nextUserBindings);
  writeApplied(deps.agentDir, recordApplied(planned));

  return {
    ok: true,
    path,
    changes: planned.changes,
    messages: planned.changes.map(describeChange),
  };
}

export function applyCancelKey(deps: CancelKeyDeps, key: Key): ApplyOutcome {
  const resolved = deps.readResolved();
  const loaded = loadKeybindingsFile(keybindingsPath(deps.agentDir));

  const planned = planCancelKey({ user: loaded.config, resolved, key });
  return persistAndApply(deps, planned, resolved);
}

export function applyCancelKeyReset(deps: CancelKeyDeps): ApplyOutcome {
  const resolved = deps.readResolved();
  const path = keybindingsPath(deps.agentDir);
  const loaded = loadKeybindingsFile(path);
  const applied = readApplied(deps.agentDir);

  const targets = Object.keys(applied).length > 0 ? Object.keys(applied) : MANAGED_ACTIONS;
  const planned = planReset({
    user: loaded.config,
    defaults: defaultKeys(deps, targets),
    applied,
  });

  const outcome = persistAndApply(deps, planned, resolved);
  if (outcome.ok) clearApplied(deps.agentDir);
  return outcome;
}

/** Read the key pi currently uses to cancel, for display in the picker. */
export function currentCancelKeys(deps: Pick<CancelKeyDeps, "readResolved">): Key[] {
  const resolved = deps.readResolved();
  const value = resolved["app.interrupt"];
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value];
}
