import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  copyPrivateVaultForGraphGate,
  fingerprintPrivateVault,
  privateVaultFingerprintsMatch,
  requirePrivateGraphGateSource,
} from "./privateVaultGate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("private graph gate", () => {
  it("requires an explicit copy-only confirmation and absolute source", async () => {
    await expect(requirePrivateGraphGateSource({})).rejects.toThrow("explicit copy-only");
    await expect(requirePrivateGraphGateSource({
      EXO_PRIVATE_GRAPH_GATE: "copy-only",
      EXO_PRIVATE_GRAPH_VAULT_ROOT: "relative",
    })).rejects.toThrow("absolute configured vault root");
  });

  it("copies canonical files without carrying derived state or symlinks", async () => {
    const source = await temporaryRoot("exo-private-source-");
    const targetParent = await temporaryRoot("exo-private-target-");
    const target = path.join(targetParent, "copy");
    await mkdir(path.join(source, "nested"));
    await mkdir(path.join(source, ".exo"));
    await writeFile(path.join(source, "nested", "note.md"), "# Note\n", "utf8");
    await writeFile(path.join(source, ".exo", "derived"), "derived", "utf8");
    await symlink(path.join(source, "nested", "note.md"), path.join(source, "linked.md"));

    const aggregate = await copyPrivateVaultForGraphGate(source, target);

    expect(aggregate).toEqual({
      directories: 2,
      files: 1,
      markdownFiles: 1,
      bytes: 7,
      skippedSymlinks: 1,
      skippedSpecialFiles: 0,
    });
    await expect(readFile(path.join(target, "nested", "note.md"), "utf8")).resolves.toBe("# Note\n");
    await expect(readFile(path.join(target, ".exo", "derived"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(target, "linked.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects any canonical source mutation without exposing identities", async () => {
    const source = await temporaryRoot("exo-private-fingerprint-");
    await writeFile(path.join(source, "note.md"), "before", "utf8");
    const before = await fingerprintPrivateVault(source);
    const unchanged = await fingerprintPrivateVault(source);
    expect(privateVaultFingerprintsMatch(before, unchanged)).toBe(true);
    await writeFile(path.join(source, "note.md"), "after", "utf8");
    const changed = await fingerprintPrivateVault(source);
    expect(privateVaultFingerprintsMatch(before, changed)).toBe(false);
  });
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
