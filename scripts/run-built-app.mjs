import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const repoRoot = "/Users/kenneth/Desktop/lab/projects/exo";
const appEntry = path.join(repoRoot, "apps/desktop");
const electronBinary = path.join(appEntry, "node_modules/.bin/electron");

function killStaleExoProcesses() {
  try {
    const output = execFileSync("pgrep", ["-af", appEntry], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const [pidText] = trimmed.split(/\s+/, 1);
      const pid = Number(pidText);
      if (!Number.isFinite(pid) || pid === process.pid) {
        continue;
      }

      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore stale processes that exit between pgrep and kill.
      }
    }
  } catch {
    // No stale Exo processes found.
  }
}

killStaleExoProcesses();

const child = spawn(electronBinary, ["."], {
  cwd: appEntry,
  stdio: "inherit",
  detached: true,
  env: process.env,
});

child.unref();
