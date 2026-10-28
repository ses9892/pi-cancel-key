/**
 * /cancel-key -- pick the key that cancels a running agent.
 *
 * pi checks `app.interrupt` before every other app action, so whatever key is
 * chosen here has to be taken away from its previous owner. That arbitration
 * lives in src/plan.ts; this file is only the terminal-facing edge.
 */

import { getKeybindings } from "@earendil-works/pi-tui";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  applyCancelKey,
  applyCancelKeyReset,
  currentCancelKeys,
  type CancelKeyDeps,
} from "../src/cancel-key.ts";
import { CANDIDATE_KEYS, describeChange } from "../src/plan.ts";

const CUSTOM_LABEL = "Custom key…";
const RESET_LABEL = "Reset to pi defaults";

function deps(): CancelKeyDeps {
  const keybindings = getKeybindings();
  return {
    agentDir: getAgentDir(),
    readResolved: () => keybindings.getResolvedBindings(),
    applyUserBindings: (config) => keybindings.setUserBindings(config),
    readDefaults: (action) => {
      const keys = keybindings.getDefinition(action)?.defaultKeys;
      if (keys === undefined) return [];
      return Array.isArray(keys) ? [...keys] : [keys];
    },
  };
}

/** `ctrl+shift+c` -> `Ctrl+Shift+C`, `escape` -> `Esc`. */
export function formatKey(key: string): string {
  if (key === "escape" || key === "esc") return "Esc";
  return key
    .split("+")
    .map((part) => {
      if (part.length === 0) return part;
      if (part.length === 1) return part.toUpperCase();
      return part[0]!.toUpperCase() + part.slice(1);
    })
    .join("+");
}

function formatKeys(keys: string[]): string {
  return keys.length > 0 ? keys.map(formatKey).join(" / ") : "(none)";
}

function report(outcome: ReturnType<typeof applyCancelKey>, ctx: ExtensionCommandContext): void {
  if (!outcome.ok) {
    ctx.ui.notify(`Could not change the cancel key: ${outcome.reason}`, "error");
    return;
  }

  const lines = outcome.changes.length > 0 ? outcome.messages.map((m) => `· ${m}`) : ["· No changes"];
  ctx.ui.notify([...lines, `Saved: ${outcome.path}`].join("\n"), "info");
}

function applyOrReport(key: string, ctx: ExtensionCommandContext): void {
  report(applyCancelKey(deps(), key), ctx);
}

async function pickCancelKey(ctx: ExtensionCommandContext): Promise<void> {
  const current = currentCancelKeys(deps());
  const options = [
    ...CANDIDATE_KEYS.map((key) => {
      const isCurrent = current.length === 1 && current[0] === key;
      const suffix = isCurrent ? "(current)" : key === "escape" ? "(pi default)" : "";
      return `${formatKey(key)}${suffix ? ` ${suffix}` : ""}`.trim();
    }),
    CUSTOM_LABEL,
    RESET_LABEL,
  ];

  const title = `Cancel key — current: ${formatKeys(current)}`;
  const choice = await ctx.ui.select(title, options);
  if (choice === undefined) return;

  if (choice === RESET_LABEL) {
    report(applyCancelKeyReset(deps()), ctx);
    return;
  }

  if (choice === CUSTOM_LABEL) {
    const typed = await ctx.ui.input("Cancel key", "e.g. ctrl+x");
    const key = typed?.trim();
    if (!key) return;
    applyOrReport(key, ctx);
    return;
  }

  const index = options.indexOf(choice);
  const key = CANDIDATE_KEYS[index];
  if (!key) return;
  applyOrReport(key, ctx);
}

export default function cancelKeyExtension(pi: ExtensionAPI): void {
  pi.registerCommand("cancel-key", {
    description: "Change the cancel key and remap the keys it displaces",
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trim();
      const keys = [...CANDIDATE_KEYS];
      return keys
        .filter((key) => key.startsWith(trimmed))
        .map((key) => ({ value: key, label: formatKey(key), description: "Use as the cancel key" }));
    },
    handler: async (args, ctx) => {
      const key = args.trim();
      if (key.length > 0) {
        applyOrReport(key, ctx);
        return;
      }
      await pickCancelKey(ctx);
    },
  });

  // Surface the arbitration rule once, so a surprise remap is never silent.
  pi.on("session_start", async (_event, ctx) => {
    const current = currentCancelKeys(deps());
    if (current.length === 1 && current[0] === "escape") return;
    ctx.ui.notify(`Cancel key: ${formatKeys(current)} · change it with /cancel-key`, "info");
  });
}

export { describeChange };
