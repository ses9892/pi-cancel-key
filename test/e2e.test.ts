/**
 * End-to-end: a real `pi` process in a real pty, driven by keystrokes.
 *
 * No mocks: `scripts/pty-driver.py` allocates the pty, pi loads the extension
 * from disk, the command writes keybindings.json, and we assert on the file pi
 * would read on its next start plus pi's own /hotkeys overlay.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  EXTENSION,
  ISOLATED_EXTENSION_FLAGS,
  startPi,
  waitForBoot,
} from "./support/pi-session.ts";

const FLAGS = ISOLATED_EXTENSION_FLAGS;

function readBindings(agentDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(agentDir, "keybindings.json"), "utf-8"));
}

test("e2e: /cancel-key ctrl+c rewrites keybindings.json and reports the displaced keys", { timeout: 90_000 }, async () => {
  const pi = await startPi({ extension: EXTENSION, flags: FLAGS });
  try {
    await waitForBoot(pi);

    pi.type("/cancel-key ctrl+c\r");
    await pi.waitFor(() => existsSync(join(pi.agentDir, "keybindings.json")), 20_000, "keybindings.json was not written");
    await pi.waitFor((text) => text.includes("Saved:"), 10_000, "no apply notification");

    const bindings = readBindings(pi.agentDir);
    assert.equal(bindings["app.interrupt"], "ctrl+c");
    assert.equal(bindings["app.clear"], "ctrl+shift+c");
    assert.equal(bindings["tui.select.cancel"], "escape");
    assert.deepEqual(bindings["tui.input.copy"], []);
    assert.equal(bindings["$schema"], "https://pi.dev/schemas/keybindings.schema.json");

    const log = pi.output();
    assert.match(log, /app\.clear: ctrl\+c → ctrl\+shift\+c/);
    assert.match(log, /tui\.select\.cancel: .*→ escape/);

    // pi's own shortcut overlay must agree -- this is the binding in effect,
    // not just a file we wrote.
    pi.type("/hotkeys\r");
    await pi.waitFor((text) => /Ctrl\+C[^\n]*abort streaming/.test(text), 15_000, "/hotkeys does not show Ctrl+C as cancel");
    assert.match(pi.output(), /Ctrl\+Shift\+C[^\n]*Clear editor/);
  } finally {
    pi.close();
  }
});

test("e2e: choosing Ctrl+C from the picker applies it in the running session", { timeout: 90_000 }, async () => {
  const pi = await startPi({ extension: EXTENSION, flags: FLAGS });
  try {
    await waitForBoot(pi);

    pi.type("/cancel-key\r");
    await pi.waitFor((text) => text.includes("Cancel key"), 10_000, "picker did not open");

    pi.type("\r"); // first option: Ctrl+C
    await pi.waitFor(() => existsSync(join(pi.agentDir, "keybindings.json")), 20_000, "no file after choosing");

    assert.equal(readBindings(pi.agentDir)["app.interrupt"], "ctrl+c");
  } finally {
    pi.close();
  }
});

test("e2e: the reset entry restores pi defaults", { timeout: 90_000 }, async () => {
  const pi = await startPi({ extension: EXTENSION, flags: FLAGS });
  try {
    await waitForBoot(pi);

    pi.type("/cancel-key ctrl+c\r");
    await pi.waitFor(() => existsSync(join(pi.agentDir, "keybindings.json")), 20_000, "first apply failed");
    await pi.waitFor((text) => text.includes("Saved:"), 10_000, "no first notification");

    pi.type("/cancel-key\r");
    await pi.waitFor((text) => text.includes("Cancel key"), 10_000, "picker did not open");

    // 5 candidate keys, then "Custom key…", then "Reset to pi defaults".
    for (let i = 0; i < 6; i++) pi.type("\u001b[B");
    pi.type("\r");

    await pi.waitFor(
      (text) => /app\.interrupt: .*→ escape \(default\)/.test(text),
      20_000,
      "no reset notification",
    );

    const bindings = readBindings(pi.agentDir);
    assert.equal(bindings["app.interrupt"], undefined);
    assert.equal(bindings["app.clear"], undefined);
  } finally {
    pi.close();
  }
});
