/**
 * Link the pi packages this extension runs against, so tests and type checks
 * use exactly the version the local `pi` binary loads.
 *
 * We deliberately do not npm-install `@earendil-works/*`: a second copy of
 * pi-tui would be a different module instance than the one pi hands us.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const PACKAGES = ["pi-tui", "pi-coding-agent"];

/** Candidate `@earendil-works` directories, most authoritative first. */
function candidateRoots() {
  const roots = [];
  const installRoot = process.env.PI_MANAGED_INSTALL_ROOT;
  const home = process.env.HOME ?? "";

  const managedRoots = [installRoot, home ? join(home, ".pi/agent/install") : undefined].filter(Boolean);
  for (const root of managedRoots) {
    const versionFile = join(root, "current-version");
    if (!existsSync(versionFile)) continue;
    const version = readFileSync(versionFile, "utf-8").trim();
    if (version) roots.push(join(root, "releases", version, "node_modules", "@earendil-works"));

    // Unmanaged or leftover installs: newest release that actually has pi-tui.
    const releases = join(root, "releases");
    if (existsSync(releases)) {
      for (const entry of readdirSync(releases).sort().reverse()) {
        roots.push(join(releases, entry, "node_modules", "@earendil-works"));
      }
    }
  }

  try {
    const which = execFileSync("which", ["pi"], { encoding: "utf-8" }).trim();
    if (which) {
      const binDir = dirname(realpathSync(which));
      roots.push(join(binDir, "..", "node_modules", "@earendil-works"));
    }
  } catch {
    // pi not on PATH; the managed-install roots above are the normal path.
  }

  return roots;
}

function findPiInstall() {
  for (const root of candidateRoots()) {
    if (existsSync(join(root, "pi-tui"))) return root;
  }
  throw new Error("Could not find a pi installation. Is `pi` on PATH?");
}

const source = findPiInstall();
const target = join(import.meta.dirname, "..", "node_modules", "@earendil-works");
mkdirSync(target, { recursive: true });

for (const name of PACKAGES) {
  const link = join(target, name);
  rmSync(link, { recursive: true, force: true });
  symlinkSync(join(source, name), link, "dir");
  console.log(`linked @earendil-works/${name} -> ${join(source, name)}`);
}
