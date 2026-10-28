/**
 * Integration: real pi-tui KeybindingsManager, real files, real arbitration.
 * Only the terminal rendering is absent.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { applyCancelKey, applyCancelKeyReset } from "../src/cancel-key.ts";
import { keybindingsPath } from "../src/keybindings-file.ts";

/** pi's app bindings on top of the TUI ones, as pi composes them. */
const DEFINITIONS = {
  ...TUI_KEYBINDINGS,
  "app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
  "app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
  "app.exit": { defaultKeys: "ctrl+d", description: "Exit when editor is empty" },
  "app.message.copy": { defaultKeys: "ctrl+x", description: "Copy" },
  "app.models.clearAll": { defaultKeys: "ctrl+x", description: "Clear all models" },
};

function makeDeps(agentDir: string, manager: KeybindingsManager) {
  return {
    agentDir,
    readResolved: () => manager.getResolvedBindings(),
    applyUserBindings: (config: Record<string, string | string[] | undefined>) => manager.setUserBindings(config),
    readDefaults: (action: string) => {
      const defaults = manager.getDefinition(action).defaultKeys;
      return Array.isArray(defaults) ? [...defaults] : [defaults];
    },
  };
}

const cleanups: string[] = [];
after(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function tempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cancel-key-"));
  cleanups.push(dir);
  return dir;
}

test("applying ctrl+c changes the live keymap and persists it", () => {
  const agentDir = tempAgentDir();
  const manager = new KeybindingsManager(DEFINITIONS);
  const deps = makeDeps(agentDir, manager);

  const outcome = applyCancelKey(deps, "ctrl+c");

  assert.equal(outcome.ok, true);
  assert.deepEqual(manager.getKeys("app.interrupt"), ["ctrl+c"]);
  assert.deepEqual(manager.getKeys("tui.select.cancel"), ["escape"]);
  assert.equal(
    manager.getConflicts().some((c) => c.key === "ctrl+c"),
    false,
    "no live conflict remains on ctrl+c",
  );

  const written = JSON.parse(readFileSync(keybindingsPath(agentDir), "utf-8"));
  assert.equal(written["app.interrupt"], "ctrl+c");
  assert.equal(written["$schema"], "https://pi.dev/schemas/keybindings.schema.json");
});

test("running the same choice twice is idempotent", () => {
  const agentDir = tempAgentDir();
  const manager = new KeybindingsManager(DEFINITIONS);
  const deps = makeDeps(agentDir, manager);

  applyCancelKey(deps, "ctrl+c");
  const first = readFileSync(keybindingsPath(agentDir), "utf-8");
  const second = applyCancelKey(deps, "ctrl+c");

  assert.equal(second.ok, true);
  assert.deepEqual(second.ok && second.changes, []);
  assert.equal(readFileSync(keybindingsPath(agentDir), "utf-8"), first);
});

test("reset returns to pi defaults and removes our entries", () => {
  const agentDir = tempAgentDir();
  const manager = new KeybindingsManager(DEFINITIONS);
  const deps = makeDeps(agentDir, manager);

  applyCancelKey(deps, "ctrl+c");
  const outcome = applyCancelKeyReset(deps);

  assert.equal(outcome.ok, true);
  assert.deepEqual(manager.getKeys("app.interrupt"), ["escape"]);
  assert.deepEqual(manager.getKeys("app.clear"), ["ctrl+c"]);

  const written = JSON.parse(readFileSync(keybindingsPath(agentDir), "utf-8"));
  assert.equal(written["app.interrupt"], undefined);
  assert.equal(written["app.clear"], undefined);
  assert.equal(written["app.message.copy"], undefined);
});

test("hand-written entries and $schema in keybindings.json survive", () => {
  const agentDir = tempAgentDir();
  writeFileSync(
    keybindingsPath(agentDir),
    JSON.stringify({ $schema: "custom", "tui.editor.undo": "alt+z", "app.exit": "ctrl+q" }),
  );

  const manager = new KeybindingsManager(DEFINITIONS, { "tui.editor.undo": "alt+z", "app.exit": "ctrl+q" });
  applyCancelKey(makeDeps(agentDir, manager), "ctrl+c");

  const written = JSON.parse(readFileSync(keybindingsPath(agentDir), "utf-8"));
  assert.equal(written["tui.editor.undo"], "alt+z");
  assert.equal(written["app.exit"], "ctrl+q");
  assert.equal(written["app.interrupt"], "ctrl+c");
});

test("reset also undoes displacements outside the curated action list", () => {
  const agentDir = tempAgentDir();
  const manager = new KeybindingsManager(DEFINITIONS);
  const deps = makeDeps(agentDir, manager);

  applyCancelKey(deps, "ctrl+x");
  assert.equal(manager.getKeys("app.message.copy").length, 1, "copy keeps a key, it is not unmapped");
  assert.equal(manager.getKeys("app.models.clearAll").length, 1);

  applyCancelKeyReset(deps);

  assert.deepEqual(manager.getKeys("app.message.copy"), ["ctrl+x"]);
  assert.deepEqual(manager.getKeys("app.models.clearAll"), ["ctrl+x"]);
  assert.deepEqual(manager.getKeys("app.interrupt"), ["escape"]);
});

test("reset leaves an entry the user re-edited by hand alone", () => {
  const agentDir = tempAgentDir();
  const manager = new KeybindingsManager(DEFINITIONS);
  const deps = makeDeps(agentDir, manager);

  applyCancelKey(deps, "ctrl+x");
  // The user decides they want a different cancel key, typed by hand.
  const current = JSON.parse(readFileSync(keybindingsPath(agentDir), "utf-8"));
  current["app.interrupt"] = "alt+x";
  writeFileSync(keybindingsPath(agentDir), JSON.stringify(current));
  manager.setUserBindings(current);

  applyCancelKeyReset(deps);

  const written = JSON.parse(readFileSync(keybindingsPath(agentDir), "utf-8"));
  assert.equal(written["app.interrupt"], "alt+x", "hand edit survives reset");
  assert.equal(written["app.message.copy"], undefined, "our displacement is still undone");
});

test("a corrupted config file does not stop the command", () => {
  const agentDir = tempAgentDir();
  writeFileSync(keybindingsPath(agentDir), "{ not json");
  const manager = new KeybindingsManager(DEFINITIONS);

  const outcome = applyCancelKey(makeDeps(agentDir, manager), "ctrl+c");

  assert.equal(outcome.ok, true);
  const written = JSON.parse(readFileSync(keybindingsPath(agentDir), "utf-8"));
  assert.equal(written["app.interrupt"], "ctrl+c");
});

test("unstored agent dir is created on demand", () => {
  const agentDir = join(tempAgentDir(), "nested", "agent");
  const manager = new KeybindingsManager(DEFINITIONS);

  const outcome = applyCancelKey(makeDeps(agentDir, manager), "alt+x");

  assert.equal(outcome.ok, true);
  assert.deepEqual(manager.getKeys("app.interrupt"), ["alt+x"]);
  assert.match(readFileSync(keybindingsPath(agentDir), "utf-8"), /alt\+x/);
});
