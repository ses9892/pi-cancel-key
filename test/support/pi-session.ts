/**
 * Shared harness for tests that drive a real `pi` process on a real pty.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
export const EXTENSION = join(PROJECT_ROOT, "extensions", "cancel-key.ts");
export const PTY_DRIVER = join(PROJECT_ROOT, "scripts", "pty-driver.py");

/** Flags that keep a test pi away from the network and the user's session. */
export const BASE_FLAGS = [
  "--offline",
  "--no-session",
  "--no-mcp",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-context-files",
  "--approve",
  "--tui-mode",
  "regular",
];

/** Extra flags for runs that load exactly one explicit extension. */
export const ISOLATED_EXTENSION_FLAGS = ["--no-extensions"];

const children = new Set<ChildProcess>();
const dirs: string[] = [];

after(() => {
  for (const child of children) killTree(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    // Negative pid targets the whole process group: driver plus its child pi.
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export interface PiSession {
  output: () => string;
  waitFor: (predicate: (text: string) => boolean, timeoutMs: number, label: string) => Promise<void>;
  type: (text: string) => void;
  agentDir: string;
  close: () => void;
}

export interface StartPiOptions {
  /** Explicitly load this extension path (`-e`). */
  extension?: string;
  /** Agent dir to use; a temp one is created when omitted. */
  agentDir?: string;
  /** Extra CLI flags appended after the base flags. */
  flags?: string[];
  env?: Record<string, string>;
}

export async function startPi(options: StartPiOptions = {}): Promise<PiSession> {
  const agentDir = options.agentDir ?? makeTempDir("pi-e2e-");
  const args = [PTY_DRIVER, "pi", ...BASE_FLAGS, ...(options.flags ?? [])];
  if (options.extension) args.push("-e", options.extension);

  const child = spawn("python3", args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      TERM: "xterm-256color",
      ...options.env,
    },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);

  let buffer = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
    });
  }

  return {
    output: () => buffer,
    agentDir,
    type: (text: string) => {
      child.stdin.write(text);
    },
    waitFor: async (predicate, timeoutMs, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(buffer)) return;
        if (child.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`${label} (${timeoutMs}ms). Last output:\n${buffer.slice(-2000)}`);
    },
    close: () => killTree(child),
  };
}

/** Resolves once pi has drawn its startup panel. */
export async function waitForBoot(pi: PiSession): Promise<void> {
  await pi.waitFor(
    (text) => text.includes("Press ctrl+o") || text.includes("[Extensions]"),
    45_000,
    "pi did not boot",
  );
}
