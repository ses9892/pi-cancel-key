/**
 * Publishability gate: exactly what `npm publish` would upload, installed the
 * way `pi install npm:pi-cancel-key` will install it, then loaded by a real pi.
 *
 * This is the only test that can catch the mistakes that matter for a published
 * package: a file missing from `files`, a runtime import pi cannot resolve from
 * the npm root, or a manifest pi will not discover.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BASE_FLAGS, PROJECT_ROOT, makeTempDir, startPi, waitForBoot } from "./support/pi-session.ts";

interface PackResult {
  filename: string;
  files: Array<{ path: string }>;
}

function packIntoTempDir(): { tarball: string; files: string[] } {
  const destination = makeTempDir("pi-cancel-key-pack-");
  const raw = execFileSync("npm", ["pack", "--json", "--pack-destination", destination], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  const [result] = JSON.parse(raw) as PackResult[];
  return {
    tarball: join(destination, result!.filename),
    files: result!.files.map((file) => file.path).sort(),
  };
}

test("publish: the tarball contains exactly the runtime files", { timeout: 60_000 }, () => {
  const { tarball, files } = packIntoTempDir();
  assert.ok(existsSync(tarball));

  assert.deepEqual(files, [
    "LICENSE",
    "README.md",
    "extensions/cancel-key.ts",
    "package.json",
    "src/cancel-key.ts",
    "src/keybindings-file.ts",
    "src/plan.ts",
    "src/state.ts",
  ]);

  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
  assert.equal(manifest.private, undefined, "a private package cannot be published");
  assert.deepEqual(manifest.pi.extensions, ["./extensions/cancel-key.ts"]);
  assert.equal(manifest.license, "MIT");
});

test("publish: the packed package installs into an npm root and loads in pi", { timeout: 120_000 }, async () => {
  const { tarball } = packIntoTempDir();
  const agentDir = makeTempDir("pi-cancel-key-npm-");
  const npmRoot = join(agentDir, "npm");

  // Mirror how pi installs packages: one shared npm root, peers omitted
  // because pi supplies them through its own module aliases.
  mkdirSync(npmRoot, { recursive: true });
  writeFileSync(join(npmRoot, "package.json"), JSON.stringify({ name: "pi-extensions", private: true }, null, 2));
  execFileSync("npm", ["install", "--prefix", npmRoot, "--omit=peer", "--no-audit", "--no-fund", tarball], {
    cwd: npmRoot,
    encoding: "utf-8",
  });
  assert.ok(existsSync(join(npmRoot, "node_modules", "pi-cancel-key", "extensions", "cancel-key.ts")));

  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-cancel-key"] }, null, 2),
  );

  const pi = await startPi({ agentDir, flags: BASE_FLAGS });
  try {
    await waitForBoot(pi);
    assert.match(pi.output(), /cancel-key/, "pi did not discover the installed package");

    pi.type("/cancel-key ctrl+c\r");
    await pi.waitFor(() => existsSync(join(agentDir, "keybindings.json")), 30_000, "installed package did not run");

    const bindings = JSON.parse(readFileSync(join(agentDir, "keybindings.json"), "utf-8"));
    assert.equal(bindings["app.interrupt"], "ctrl+c");
  } finally {
    pi.close();
  }
});
