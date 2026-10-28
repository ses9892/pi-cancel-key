# pi-cancel-key

**English** | [한국어](README.ko.md)

Cancel a running pi agent with the key you choose.

pi cancels with `escape` and resolves that binding before anything else, so
rebinding it to `ctrl+c` silently strands every other action on `ctrl+c`. This
extension makes the trade explicit: pick a key, and it moves the displaced keys
somewhere sensible, persists the change, and applies it without a restart.

```
/cancel-key
```

## Install

```bash
# from git (works today)
pi install git:github.com/ses9892/pi-cancel-key

# pinned to a release
pi install git:github.com/ses9892/pi-cancel-key@v0.1.0

# project-scoped
pi install -l git:github.com/ses9892/pi-cancel-key

# try it once, persist nothing
pi -e git:github.com/ses9892/pi-cancel-key
```

Extensions run with your OS permissions. Read the source before installing.

## Usage

| Command | Effect |
|---|---|
| `/cancel-key` | picker: current key, candidates, free-form input, reset |
| `/cancel-key ctrl+x` | apply a key directly |
| `/cancel-key` → `Reset to pi defaults` | drop this tool's overrides |

Choosing `ctrl+c` on a stock pi:

| action | before | after |
|---|---|---|
| `app.interrupt` | `escape` | `ctrl+c` ← assigned |
| `app.clear` | `ctrl+c` | `ctrl+shift+c` ← displaced |
| `tui.select.cancel` | `escape`, `ctrl+c` | `escape` ← displaced |
| `tui.input.copy` | `ctrl+c` | *(unmapped)* ← nothing left to move to |

`escape` keeps closing dialogs and transcript search; it just stops cancelling
the agent.

Choosing `ctrl+x` instead displaces the two actions pi keeps there:

| action | before | after |
|---|---|---|
| `app.interrupt` | `escape` | `ctrl+x` |
| `app.message.copy` | `ctrl+x` | `ctrl+shift+x` |
| `app.models.clearAll` | `ctrl+x` | `alt+x` |

Verify inside pi with `/hotkeys`: `Ctrl+C` should read *Cancel autocomplete /
abort streaming*.

## How displacement works

A displaced action keeps its letter and gains a modifier:
`ctrl+x` → `ctrl+shift+x` → `alt+x` → `ctrl+alt+x`. It is unmapped only when
every candidate is already taken, and the notification always says which
happened:

```
· app.interrupt: escape → ctrl+c
· app.clear: ctrl+c → ctrl+shift+c (displaced)
· tui.select.cancel: escape / ctrl+c → escape (displaced)
· tui.input.copy: ctrl+c → (unmapped, no free key)
Saved: ~/.pi/agent/keybindings.json
```

`keybindings.json` is rewritten in place: `$schema` and any action this tool does
not own survive untouched.

## Reset is exact

What was written is recorded in `~/.pi/agent/cancel-key-state.json`, so reset
removes **only those entries**, and only while they still hold the value this
tool wrote. An edit you made by hand is never reverted.

## Development

| file | role |
|---|---|
| `src/plan.ts` | pure arbitration: `planCancelKey`, `planReset`, `deriveFallbacks`, `residualConflicts` |
| `src/keybindings-file.ts` | tolerant read, atomic write, keeps entries it does not own |
| `src/state.ts` | record of what we wrote, so reset is exact |
| `src/cancel-key.ts` | plan → persist → apply, with injected dependencies |
| `extensions/cancel-key.ts` | the `/cancel-key` command and its picker |

Arbitration is pure, so the rules are provable without a terminal; the extension
only formats labels and calls `ctx.ui`.

```bash
npm test           # everything
npm run test:unit  # arbitration + integration, milliseconds
npm run test:e2e   # real pi on a real pty
```

| test | what it proves |
|---|---|
| `test/plan.test.ts` | the arbitration rules, no I/O |
| `test/cancel-key.test.ts` | real `pi-tui` keybindings manager, real files in a temp dir, live keymap |
| `test/e2e.test.ts` | a real `pi` process driven by keystrokes; asserts the written file **and** pi's own `/hotkeys` overlay |
| `test/publish.test.ts` | packs the tarball, installs it into an npm root, boots pi from it |

`scripts/pty-driver.py` gives the e2e tests a pty using only the Python standard
library. `scripts/link-pi.mjs` symlinks `@earendil-works/*` from your local pi
install instead of downloading a second copy — a second copy would be a
different module instance than the one pi hands the extension.

## License

MIT
