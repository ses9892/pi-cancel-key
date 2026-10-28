import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MANAGED_ACTIONS,
  deriveFallbacks,
  normalizeKeys,
  planCancelKey,
  planReset,
  residualConflicts,
  type BindingsConfig,
} from "../src/plan.ts";

/** A cut-down copy of pi's defaults, enough to exercise arbitration. */
function piDefaults(): BindingsConfig {
  return {
    "app.interrupt": "escape",
    "app.clear": "ctrl+c",
    "app.exit": "ctrl+d",
    "app.message.copy": "ctrl+x",
    "app.session.togglePath": "ctrl+p",
    "app.model.cycleForward": "ctrl+p",
    "tui.input.newLine": ["shift+enter", "ctrl+j"],
    "tui.input.copy": "ctrl+c",
    "tui.select.cancel": ["escape", "ctrl+c"],
    "tui.altScreen.searchClose": "escape",
  };
}

test("moving cancel to ctrl+c takes the key away from its old owners", () => {
  const resolved = piDefaults();
  const plan = planCancelKey({ user: {}, resolved, key: "ctrl+c" });

  assert.equal(plan.nextUserBindings["app.interrupt"], "ctrl+c");
  assert.deepEqual(normalizeKeys(plan.nextUserBindings["tui.select.cancel"]), ["escape"]);
  assert.equal(plan.nextUserBindings["app.clear"], "ctrl+shift+c");

  const changes = Object.fromEntries(plan.changes.map((c) => [c.action, c]));
  assert.equal(changes["app.interrupt"]!.kind, "assigned");
  assert.equal(changes["tui.select.cancel"]!.kind, "displaced");
  assert.equal(changes["app.clear"]!.kind, "displaced");
});

test("the plan leaves no two actions on the same key", () => {
  const resolved = piDefaults();
  const plan = planCancelKey({ user: {}, resolved, key: "ctrl+c" });
  assert.deepEqual(residualConflicts(plan, resolved, "ctrl+c"), []);
});

test("a key nobody uses only changes the interrupt binding", () => {
  const resolved = piDefaults();
  const plan = planCancelKey({ user: {}, resolved, key: "alt+x" });

  assert.equal(plan.nextUserBindings["app.interrupt"], "alt+x");
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]!.action, "app.interrupt");
  assert.equal(plan.nextUserBindings["app.clear"], undefined);
});

test("choosing the key that already cancels is a no-op", () => {
  const resolved = piDefaults();
  const plan = planCancelKey({ user: { "app.interrupt": "escape" }, resolved, key: "escape" });

  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.nextUserBindings, { "app.interrupt": "escape" });
});

test("an unknown displaced action keeps its letter and gains a modifier", () => {
  const resolved = piDefaults();
  const plan = planCancelKey({ user: {}, resolved, key: "ctrl+x" });

  assert.equal(plan.nextUserBindings["app.message.copy"], "ctrl+shift+x");
  const change = plan.changes.find((c) => c.action === "app.message.copy");
  assert.equal(change?.kind, "displaced");
  assert.deepEqual(residualConflicts(plan, resolved, "ctrl+x"), []);
});

test("a displaced action is unmapped only when every derived candidate is taken", () => {
  const resolved = {
    ...piDefaults(),
    "fake.one": "ctrl+shift+x",
    "fake.two": "alt+x",
    "fake.three": "ctrl+alt+x",
  };
  const plan = planCancelKey({ user: {}, resolved, key: "ctrl+x" });

  assert.deepEqual(plan.nextUserBindings["app.message.copy"], []);
  assert.equal(plan.changes.find((c) => c.action === "app.message.copy")?.kind, "disabled");
  assert.deepEqual(residualConflicts(plan, resolved, "ctrl+x"), []);
});

test("derived fallbacks keep the letter and only add modifiers", () => {
  assert.deepEqual(deriveFallbacks("ctrl+x"), ["ctrl+shift+x", "alt+x", "ctrl+alt+x"]);
  assert.deepEqual(deriveFallbacks("escape"), ["alt+escape", "ctrl+shift+escape"]);
});

test("fallback candidates skip keys that are already taken", () => {
  const resolved = { ...piDefaults(), "app.thinking.cycle": "ctrl+shift+c" };
  const plan = planCancelKey({ user: {}, resolved, key: "ctrl+c" });

  assert.equal(plan.nextUserBindings["app.clear"], "alt+c");
});

test("existing user overrides on unrelated actions survive", () => {
  const resolved = { ...piDefaults(), "app.exit": "ctrl+q", "tui.editor.undo": ["alt+z", "ctrl+-"] };
  const user: BindingsConfig = { "app.exit": "ctrl+q", "tui.editor.undo": ["alt+z", "ctrl+-"] };
  const plan = planCancelKey({ user, resolved, key: "ctrl+c" });

  assert.equal(plan.nextUserBindings["app.exit"], "ctrl+q");
  assert.deepEqual(plan.nextUserBindings["tui.editor.undo"], ["alt+z", "ctrl+-"]);
});

test("an action that already avoids the chosen key is untouched", () => {
  const resolved = piDefaults();
  const plan = planCancelKey({ user: {}, resolved, key: "ctrl+x" });

  assert.equal(plan.nextUserBindings["app.clear"], undefined);
  assert.equal(plan.nextUserBindings["tui.select.cancel"], undefined);
});

test("reset drops exactly the managed actions and reports what returns", () => {
  const defaults = piDefaults();
  const user: BindingsConfig = {
    "app.interrupt": "ctrl+c",
    "app.clear": "ctrl+shift+c",
    "tui.select.cancel": "escape",
    "app.exit": "ctrl+q",
  };

  const plan = planReset({ user, defaults });

  assert.equal(plan.nextUserBindings["app.interrupt"], undefined);
  assert.equal(plan.nextUserBindings["app.clear"], undefined);
  assert.equal(plan.nextUserBindings["tui.select.cancel"], undefined);
  assert.equal(plan.nextUserBindings["app.exit"], "ctrl+q", "unmanaged override is kept");

  const actions = plan.changes.map((c) => c.action).sort();
  assert.deepEqual(actions, [...MANAGED_ACTIONS].filter((a) => Object.hasOwn(user, a)).sort());
  assert.deepEqual(plan.changes.find((c) => c.action === "app.interrupt")?.to, ["escape"]);
});

test("reset on a file with no managed entries changes nothing", () => {
  const plan = planReset({ user: { "app.exit": "ctrl+q" }, defaults: piDefaults() });
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.nextUserBindings, { "app.exit": "ctrl+q" });
});
