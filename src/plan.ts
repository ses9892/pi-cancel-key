/**
 * Pure planning for the "which key cancels the agent" decision.
 *
 * Nothing here touches the filesystem or the terminal: it takes the keymap pi
 * is currently using, plus the user's own overrides, and returns the overrides
 * to persist. That keeps the whole arbitration rule testable in milliseconds.
 */

export type Key = string;
export type BindingsConfig = Record<string, Key | Key[] | undefined>;

/** The action this tool owns. */
export const TARGET_ACTION = "app.interrupt";

/**
 * Actions this tool is allowed to rewrite when they collide with the chosen
 * key, or reset when the user asks for defaults.
 */
export const MANAGED_ACTIONS = [
  "app.interrupt",
  "app.clear",
  "tui.input.copy",
  "tui.select.cancel",
] as const;

export type ManagedAction = (typeof MANAGED_ACTIONS)[number];

/**
 * Movements for actions we know something about. An explicit entry is final:
 * an empty list means "never move this one", not "work it out later".
 */
export const ACTION_FALLBACKS: Record<string, Key[]> = {
  "app.clear": ["ctrl+shift+c", "alt+c", "ctrl+shift+x"],
  // Swallowed by the editor and never actually wired to a copy action.
  "tui.input.copy": [],
  // Keeps `escape`, so it never needs a replacement.
  "tui.select.cancel": [],
};

/**
 * Keys derived from the one being taken: same letter, more modifiers.
 * A displaced action keeps its mnemonic (`ctrl+x` -> `ctrl+shift+x`), which is
 * far less disruptive than being silently unmapped.
 */
export function deriveFallbacks(key: Key): Key[] {
  const parts = key.split("+");
  const base = parts.pop();
  if (!base) return [];
  const hasCtrl = parts.some((part) => part.toLowerCase() === "ctrl");

  const candidates = [
    ...(hasCtrl ? [`ctrl+shift+${base}`] : []),
    `alt+${base}`,
    ...(hasCtrl ? [`ctrl+alt+${base}`] : []),
    `ctrl+shift+${base}`,
  ];

  return [...new Set(candidates)].filter((candidate) => candidate !== key);
}

export type ChangeKind = "assigned" | "displaced" | "disabled" | "reset";

export interface Change {
  action: string;
  from: Key[];
  to: Key[];
  kind: ChangeKind;
}

export interface Plan {
  /** User overrides to persist in keybindings.json. */
  nextUserBindings: BindingsConfig;
  /** What changed, in display order. Empty means "already like that". */
  changes: Change[];
  /** Key that calling code should treat as the new cancel key, null on reset. */
  key: Key | null;
}

export interface PlanCancelKeyInput {
  /** The user's own overrides, as persisted today. */
  user: BindingsConfig;
  /** pi's effective keymap (defaults merged with user overrides). */
  resolved: BindingsConfig;
  key: Key;
  fallbacks?: Record<string, Key[]>;
}

/** Normalise any bindings value into a de-duplicated key list. */
export function normalizeKeys(value: Key | Key[] | undefined | null): Key[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set<Key>();
  const out: Key[] = [];
  for (const key of list) {
    if (typeof key !== "string" || key.length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Write a key list back in the compact form pi's config uses. */
function toBindingValue(keys: Key[]): Key | Key[] {
  return keys.length === 1 ? keys[0]! : [...keys];
}

function pickFallback(
  action: string,
  occupied: Set<Key>,
  chosen: Key,
  fallbacks: Record<string, Key[]>,
): Key | undefined {
  const candidates = Object.hasOwn(fallbacks, action) ? (fallbacks[action] ?? []) : deriveFallbacks(chosen);
  for (const candidate of candidates) {
    if (candidate === chosen) continue;
    if (occupied.has(candidate)) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Move the cancel action to `key`, and push whatever else lived on that key
 * out of the way.
 *
 * pi resolves `app.interrupt` before the other app actions, so leaving a
 * second action on the same key would silently make that action unreachable.
 * Remapping is therefore part of the contract, not a nicety.
 */
export function planCancelKey({
  user,
  resolved,
  key,
  fallbacks = ACTION_FALLBACKS,
}: PlanCancelKeyInput): Plan {
  const next: BindingsConfig = { ...user };
  const changes: Change[] = [];

  const current = normalizeKeys(resolved[TARGET_ACTION]);
  if (current.length === 1 && current[0] === key) {
    return { nextUserBindings: next, changes, key };
  }

  next[TARGET_ACTION] = key;
  changes.push({ action: TARGET_ACTION, from: current, to: [key], kind: "assigned" });

  // Everything the chosen key could collide with, minus the chosen key itself.
  const occupied = new Set<Key>();
  for (const [action, value] of Object.entries(resolved)) {
    if (action === TARGET_ACTION) continue;
    for (const other of normalizeKeys(value)) {
      if (other !== key) occupied.add(other);
    }
  }

  for (const [action, value] of Object.entries(resolved)) {
    if (action === TARGET_ACTION) continue;
    const keys = normalizeKeys(value);
    if (!keys.includes(key)) continue;

    const remaining = keys.filter((other) => other !== key);
    if (remaining.length > 0) {
      next[action] = toBindingValue(remaining);
      changes.push({ action, from: keys, to: remaining, kind: "displaced" });
      continue;
    }

    const fallback = pickFallback(action, occupied, key, fallbacks);
    if (fallback) {
      occupied.add(fallback);
      next[action] = fallback;
      changes.push({ action, from: keys, to: [fallback], kind: "displaced" });
      continue;
    }

    next[action] = [];
    changes.push({ action, from: keys, to: [], kind: "disabled" });
  }

  return { nextUserBindings: next, changes, key };
}

export interface PlanResetInput {
  /** The user's own overrides, as persisted today. */
  user: BindingsConfig;
  /** pi's built-in defaults, so the report can say what a reset restores. */
  defaults: BindingsConfig;
  /** What this tool wrote last time. Empty means "no record; reset our defaults". */
  applied?: BindingsConfig;
}

function sameBinding(left: Key | Key[] | undefined, right: Key | Key[] | undefined): boolean {
  return normalizeKeys(left).join("\u0000") === normalizeKeys(right).join("\u0000");
}

/**
 * Drop this tool's overrides so pi falls back to its built-in keys.
 *
 * With a record of what we wrote, only those actions are touched, and only
 * while they still hold our value -- a deliberate edit by the user survives.
 */
export function planReset({ user, defaults, applied }: PlanResetInput): Plan {
  const next: BindingsConfig = { ...user };
  const changes: Change[] = [];
  const recorded = applied && Object.keys(applied).length > 0 ? applied : undefined;
  const targets = recorded ? Object.keys(recorded) : [...MANAGED_ACTIONS];

  for (const action of targets) {
    if (!Object.hasOwn(next, action)) continue;
    if (recorded && !sameBinding(next[action], recorded[action])) continue;
    const from = normalizeKeys(next[action]);
    delete next[action];
    changes.push({ action, from, to: normalizeKeys(defaults[action]), kind: "reset" });
  }

  return { nextUserBindings: next, changes, key: null };
}

/** The actions and values this plan wrote, for the state file. */
export function recordApplied(plan: Plan): BindingsConfig {
  const applied: BindingsConfig = {};
  for (const change of plan.changes) {
    if (change.kind === "reset") continue;
    applied[change.action] = toBindingValue(change.to);
  }
  return applied;
}

/**
 * Actions that would still share `key` after `plan` is applied.
 *
 * Only the chosen key is inspected: pi's defaults deliberately reuse keys
 * across context-scoped actions (a list selector's `escape` and the editor's
 * `escape`), and those are not conflicts this tool introduced or can fix.
 */
export function residualConflicts(
  plan: Plan,
  resolved: BindingsConfig,
  key: Key,
): Array<{ key: Key; actions: string[] }> {
  const effective: BindingsConfig = { ...resolved, ...plan.nextUserBindings };
  const actions: string[] = [];

  for (const [action, value] of Object.entries(effective)) {
    if (normalizeKeys(value).includes(key)) actions.push(action);
  }

  return actions.length > 1 ? [{ key, actions }] : [];
}

/** Candidate keys offered in the picker, in display order. */
export const CANDIDATE_KEYS: Key[] = ["ctrl+c", "ctrl+x", "escape", "ctrl+shift+c", "alt+x"];

export function describeChange(change: Change): string {
  const from = change.from.length > 0 ? change.from.join(" / ") : "(none)";
  const to = change.to.length > 0 ? change.to.join(" / ") : "(unmapped)";
  switch (change.kind) {
    case "assigned":
      return `${change.action}: ${from} → ${to}`;
    case "displaced":
      return `${change.action}: ${from} → ${to} (displaced)`;
    case "disabled":
      return `${change.action}: ${from} → (unmapped, no free key)`;
    case "reset":
      return `${change.action}: ${from} → ${to} (default)`;
  }
}
