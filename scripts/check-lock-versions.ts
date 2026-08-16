/**
 * Verify that bun.lock's workspaces section agrees with every workspace's
 * package.json.
 *
 * `bun install` does not refresh a workspace's recorded self-version, and
 * `--frozen-lockfile` does not validate it either, yet `bun pm pack` resolves
 * `workspace:*` ranges from bun.lock. A stale entry therefore publishes
 * tarballs whose dependency ranges point at the old version (this shipped
 * markdown-it-blurest@0.4.0 depending on @fuuck/blurest-core@0.3.1).
 *
 * After a version bump, mirror the new versions into bun.lock's workspaces
 * section; bun will not do it for you.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface WorkspaceRecord {
  name?: string;
  version?: string;
}

const root = join(import.meta.dir, "..");
// bun.lock is JSONC-flavored (trailing commas); JSON.parse is not.
const raw = readFileSync(join(root, "bun.lock"), "utf8");
const lock = JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as {
  workspaces?: Record<string, WorkspaceRecord>;
};

const failures: string[] = [];
let checked = 0;

for (const [dir, recorded] of Object.entries(lock.workspaces ?? {})) {
  if (dir === "") continue; // The repo root workspace has no version.
  const pkg = JSON.parse(
    readFileSync(join(root, dir, "package.json"), "utf8"),
  ) as WorkspaceRecord;

  if (recorded.name && recorded.name !== pkg.name) {
    failures.push(
      `${dir}: name is ${pkg.name} in package.json but ${recorded.name} in bun.lock`,
    );
  }
  if (recorded.version && recorded.version !== pkg.version) {
    failures.push(
      `${dir}: version is ${pkg.version} in package.json but ${recorded.version} in bun.lock`,
    );
  }
  checked++;
}

if (failures.length > 0) {
  console.error(
    "bun.lock workspace records are stale; bun pm pack would resolve workspace:* to the old versions:",
  );
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "Mirror the package.json versions into bun.lock's workspaces section and retry.",
  );
  process.exit(1);
}

console.log(
  `bun.lock workspace records match all ${checked} workspace package.json files.`,
);
