import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { copyMutableFixtureWorkspace } from "../helpers";

test("copies mutable fixtures without ignored runtime debris", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-fixture-hygiene-"));
  const sourceRoot = path.join(tempRoot, "source");
  const targetRoot = path.join(tempRoot, "target");

  try {
    await mkdir(path.join(sourceRoot, "notes/test-notes"), { recursive: true });
    await mkdir(path.join(sourceRoot, ".exo/instructions"), { recursive: true });
    await mkdir(path.join(sourceRoot, ".git/objects"), { recursive: true });
    await mkdir(path.join(sourceRoot, "projects/sample-project/node_modules/pkg"), { recursive: true });
    await mkdir(path.join(sourceRoot, "projects/sample-project/dist"), { recursive: true });
    await mkdir(path.join(sourceRoot, "release/mac-arm64/Exo.app"), { recursive: true });
    await writeFile(path.join(sourceRoot, "notes/test-notes/focus-note.md"), "# Keep me\n", "utf8");
    await writeFile(path.join(sourceRoot, ".exo/server.json"), "{}", "utf8");
    await writeFile(path.join(sourceRoot, ".git/HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(path.join(sourceRoot, "projects/sample-project/node_modules/pkg/index.js"), "", "utf8");
    await writeFile(path.join(sourceRoot, "projects/sample-project/dist/app.js"), "", "utf8");
    await writeFile(path.join(sourceRoot, "release/mac-arm64/Exo.app/Contents"), "", "utf8");

    await copyMutableFixtureWorkspace(sourceRoot, targetRoot);

    await expect(readFile(path.join(targetRoot, "notes/test-notes/focus-note.md"), "utf8")).resolves.toBe("# Keep me\n");
    await expect(access(path.join(targetRoot, ".exo"))).rejects.toThrow();
    await expect(access(path.join(targetRoot, ".git"))).rejects.toThrow();
    await expect(access(path.join(targetRoot, "projects/sample-project/node_modules"))).rejects.toThrow();
    await expect(access(path.join(targetRoot, "projects/sample-project/dist"))).rejects.toThrow();
    await expect(access(path.join(targetRoot, "release"))).rejects.toThrow();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
