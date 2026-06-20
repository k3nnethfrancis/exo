import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const binPath = path.join(repoRoot, "bin/exo");
const distDir = path.join(repoRoot, "packages/cli/dist");
const distPath = path.join(distDir, "index.cjs");
let previousDist: Buffer | null = null;
const tempPaths: string[] = [];

beforeEach(async () => {
  try {
    previousDist = await readFile(distPath);
  } catch {
    previousDist = null;
  }
});

afterEach(async () => {
  if (previousDist) {
    await mkdir(distDir, { recursive: true });
    await writeFile(distPath, previousDist);
  } else {
    await rm(distDir, { recursive: true, force: true });
  }
  await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { recursive: true, force: true })));
});

describe("bin/exo launcher", () => {
  it("prefers compiled CLI JavaScript when present", async () => {
    const marker = path.join(await tempDir(), "launcher-marker.txt");
    await writeCompiledMarker();

    const result = spawnSync(binPath, ["--launcher-test"], {
      env: { ...process.env, EXO_LAUNCHER_MARKER: marker },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    await expect(readFile(marker, "utf8")).resolves.toBe("compiled");
  });

  it("uses the explicit tsx fallback when requested", async () => {
    const tempRoot = await tempDir();
    const marker = path.join(tempRoot, "launcher-marker.txt");
    const fakePnpm = path.join(tempRoot, "pnpm");
    await writeCompiledMarker();
    await writeFile(fakePnpm, "#!/usr/bin/env bash\nprintf tsx > \"$EXO_LAUNCHER_MARKER\"\n", "utf8");
    await chmod(fakePnpm, 0o755);

    const result = spawnSync(binPath, ["--launcher-test"], {
      env: {
        ...process.env,
        EXO_CLI_USE_TSX: "1",
        EXO_LAUNCHER_MARKER: marker,
        PATH: `${tempRoot}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    await expect(readFile(marker, "utf8")).resolves.toBe("tsx");
  });
});

async function writeCompiledMarker(): Promise<void> {
  await mkdir(distDir, { recursive: true });
  await writeFile(
    distPath,
    [
      "#!/usr/bin/env node",
      "const { writeFileSync } = require('node:fs');",
      "writeFileSync(process.env.EXO_LAUNCHER_MARKER, 'compiled');",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(distPath, 0o755);
}

async function tempDir(): Promise<string> {
  const target = await mkdir(path.join(os.tmpdir(), `exo-launcher-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
  const value = target ?? os.tmpdir();
  tempPaths.push(value);
  return value;
}
