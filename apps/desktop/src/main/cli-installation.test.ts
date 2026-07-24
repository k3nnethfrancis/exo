import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findSourceProjectRoot, inspectCliInstallation } from "./cli-installation";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-status-"));
  roots.push(root);
  const bin = path.join(root, "path");
  const project = path.join(root, "project");
  await mkdir(path.join(project, "bin"), { recursive: true });
  await mkdir(bin, { recursive: true });
  const source = path.join(project, "bin", "exo");
  await writeFile(source, "#!/usr/bin/env node\n", "utf8");
  await chmod(source, 0o755);
  return { bin, project, root, source, command: path.join(bin, "exo") };
}

describe("CLI installation diagnosis", () => {
  it("does not mistake packaged resources for a source checkout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-source-root-"));
    roots.push(root);
    const resources = path.join(root, "Exo.app", "Contents", "Resources");
    const project = path.join(root, "project");
    await mkdir(path.join(resources, "assets"), { recursive: true });
    await mkdir(path.join(project, "bin"), { recursive: true });
    await mkdir(path.join(project, "scripts"), { recursive: true });
    await writeFile(path.join(project, "package.json"), "{}\n", "utf8");
    await writeFile(path.join(project, "bin", "exo"), "#!/bin/sh\n", "utf8");
    await writeFile(path.join(project, "scripts", "install-local"), "#!/bin/sh\n", "utf8");

    expect(findSourceProjectRoot([resources])).toBeUndefined();
    expect(findSourceProjectRoot([resources, project])).toBe(project);
  });

  it("recognizes the current checkout shim", async () => {
    const { bin, project, root, source, command } = await fixture();
    await symlink(source, command);
    await expect(inspectCliInstallation({ env: { PATH: bin, HOME: root }, sourceProjectRoot: project }))
      .resolves.toMatchObject({ state: "current", commandPath: command, sourcePath: source });
  });

  it("recognizes a legacy Exo shim", async () => {
    const { bin, project, root, command } = await fixture();
    const legacy = path.join(project, "legacy-exo");
    await writeFile(legacy, "require('packages/cli/dist/index.cjs');\n", "utf8");
    await chmod(legacy, 0o755);
    await symlink(legacy, command);
    await expect(inspectCliInstallation({ env: { PATH: bin, HOME: root }, sourceProjectRoot: project }))
      .resolves.toMatchObject({ state: "legacy-exo" });
  });

  it("recognizes a missing command", async () => {
    const { bin, project, root } = await fixture();
    await expect(inspectCliInstallation({ env: { PATH: bin, HOME: root }, sourceProjectRoot: project }))
      .resolves.toMatchObject({ state: "missing" });
  });

  it("recognizes a dangling legacy checkout shim", async () => {
    const { bin, project, root, command } = await fixture();
    await symlink(path.join(project, "old", "bin", "exo"), command);
    await expect(inspectCliInstallation({ env: { PATH: bin, HOME: root }, sourceProjectRoot: project }))
      .resolves.toMatchObject({ state: "legacy-exo" });
  });

  it("does not claim a regular executable belongs to Exo", async () => {
    const { bin, project, root, command } = await fixture();
    await writeFile(command, "#!/bin/sh\n", "utf8");
    await chmod(command, 0o755);
    await expect(inspectCliInstallation({ env: { PATH: bin, HOME: root }, sourceProjectRoot: project }))
      .resolves.toMatchObject({ state: "non-exo" });
  });
});
