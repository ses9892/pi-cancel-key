# pi-cancel-key

Cancel a running pi agent with the key **you** choose — and let the command
move whatever else was sitting on that key out of the way.

```
/cancel-key
```

## Why this exists

pi treats `escape` as "cancel / abort" (`app.interrupt`) and checks it **before**
every other app action. So simply rebinding `app.interrupt` to `ctrl+c` would
silently make `ctrl+c`'s previous jobs unreachable: clearing the editor
(`app.clear`) and the editor's selection copy (`tui.input.copy`).

This extension makes the trade explicit. When you pick a key it:

1. assigns it to `app.interrupt`,
2. takes it away from every action that had it,
3. moves those actions to their next free key — the same letter with an extra
   modifier (`ctrl+x` → `ctrl+shift+x` → `alt+x`), or unmaps them only when
   every derived candidate is taken,
4. writes `~/.pi/agent/keybindings.json` (preserving `$schema` and your other
   entries),
5. applies the change to the **running** session — no restart.

What it wrote is recorded in `~/.pi/agent/cancel-key-state.json`, so reset undoes
**exactly** those entries and leaves anything you edited by hand alone.

## Usage

| Command | Effect |
|---|---|
| `/cancel-key` | picker with the current key, candidates, free-form input, and reset |
| `/cancel-key ctrl+x` | apply a key directly |
| `/cancel-key` → `Reset to pi defaults` | drop this tool's overrides, back to pi defaults |

Choosing `ctrl+c` on a stock pi produces:

| action | before | after |
|---|---|---|
| `app.interrupt` | `escape` | `ctrl+c` ← assigned |
| `app.clear` | `ctrl+c` | `ctrl+shift+c` ← displaced |
| `tui.select.cancel` | `escape`, `ctrl+c` | `escape` ← displaced |
| `tui.input.copy` | `ctrl+c` | *(unmapped)* ← nothing left to move to |

`escape` keeps closing dialogs and the transcript search; it just stops
cancelling the agent.

Choosing `ctrl+x` instead displaces the two actions pi also keeps there:

| action | before | after |
|---|---|---|
| `app.interrupt` | `escape` | `ctrl+x` |
| `app.message.copy` | `ctrl+x` | `ctrl+shift+x` |
| `app.models.clearAll` | `ctrl+x` | `alt+x` |

Verify inside pi with `/hotkeys`: `Ctrl+C` should read *Cancel autocomplete /
abort streaming*.

## Install

```bash
# project-scoped (writes .pi/settings.json)
pi install -l ./pi-cancel-cut

# or try it once, without persisting anything
pi -e ./pi-cancel-cut
```

Extensions run with your OS permissions; read the source before installing.

## Design

| file | role |
|---|---|
| `src/plan.ts` | pure arbitration: `planCancelKey`, `planReset`, `deriveFallbacks`, `residualConflicts` |
| `src/keybindings-file.ts` | tolerant read, atomic write, keeps entries it does not own |
| `src/state.ts` | record of what we wrote, so reset is exact |
| `src/cancel-key.ts` | plan → persist → apply, with injected dependencies |
| `extensions/cancel-key.ts` | the `/cancel-key` command and its picker |

Arbitration is deliberately pure so the rules can be proven without a terminal.
The extension only formats labels and calls `ctx.ui`.

## Tests

```bash
npm install --no-save   # no deps; kept for habit
npm test                # unit + integration + e2e
```

- `test/plan.test.ts` — arbitration rules, no I/O.
- `test/cancel-key.test.ts` — real `pi-tui` `KeybindingsManager`, real files in
  a temp dir, live keymap assertions.
- `test/e2e.test.ts` — a real `pi` process on a real pty (via
  `scripts/pty-driver.py`), booted with an isolated `PI_CODING_AGENT_DIR`,
  driven by keystrokes. It asserts the written file **and** that pi's own
  `/hotkeys` overlay changed.

`scripts/link-pi.mjs` symlinks the `@earendil-works/*` packages from your local
pi install instead of downloading a second copy — a second copy would be a
different module instance than the one pi hands the extension.
