import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { contentSha256 } from "../proposal-apply-host";
import {
  inspectProfileApplyRecoveryManifest,
  listProfileApplyRecoveryManifests,
  restoreProfileApplyRecoveryManifest,
} from "../profile-apply-recovery";
import type { ProfileApplyRecoveryManifest } from "../proposal-apply-host";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("profile apply recovery", () => {
  it("lists and inspects profile apply recovery manifests", async () => {
    const workspaceRoot = await workspace();
    const manifest = manifestFor([
      { id: "context-agents", kind: "fileCreate", path: "AGENTS.md", before: { exists: false }, afterHash: contentSha256("# Agents\n") },
    ]);
    await writeManifest(workspaceRoot, "profile-apply-one.json", manifest);

    await expect(listProfileApplyRecoveryManifests(workspaceRoot)).resolves.toEqual([
      expect.objectContaining({
        path: ".exo/proposal-recovery/profile-apply/profile-apply-one.json",
        fileName: "profile-apply-one.json",
        proposalId: "proposal-1",
        profileId: "test.profile",
        itemCount: 1,
      }),
    ]);
    await expect(inspectProfileApplyRecoveryManifest(workspaceRoot, "profile-apply-one.json")).resolves.toMatchObject({
      summary: { proposalId: "proposal-1", itemCount: 1 },
      manifest: { format: "exo.profileApplyRecovery.v1", items: [{ id: "context-agents" }] },
    });
  });

  it("restores existing files only when current content matches the recorded post-apply hash", async () => {
    const workspaceRoot = await workspace();
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# Claude\n", "utf8");
    await writeManifest(workspaceRoot, "restore-existing.json", manifestFor([
      {
        id: "instruction-claude",
        kind: "filePatch",
        path: "CLAUDE.md",
        before: { exists: true, hash: contentSha256("# Old\n"), contents: "# Old\n" },
        afterHash: contentSha256("# Claude\n"),
      },
    ]));

    await expect(restoreProfileApplyRecoveryManifest(workspaceRoot, "restore-existing.json")).resolves.toMatchObject({
      restoredItems: [{ id: "instruction-claude", path: "CLAUDE.md", action: "restored" }],
    });
    await expect(readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe("# Old\n");
  });

  it("deletes files that were absent before only when current content matches the recorded post-apply hash", async () => {
    const workspaceRoot = await workspace();
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "# Agents\n", "utf8");
    await writeManifest(workspaceRoot, "restore-created.json", manifestFor([
      {
        id: "context-agents",
        kind: "fileCreate",
        path: "AGENTS.md",
        before: { exists: false },
        afterHash: contentSha256("# Agents\n"),
      },
    ]));

    await expect(restoreProfileApplyRecoveryManifest(workspaceRoot, "restore-created.json", { itemId: "context-agents" })).resolves.toMatchObject({
      restoredItems: [{ id: "context-agents", path: "AGENTS.md", action: "deleted" }],
    });
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks restore when current content no longer matches the expected post-apply hash", async () => {
    const workspaceRoot = await workspace();
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# Edited later\n", "utf8");
    await writeManifest(workspaceRoot, "stale.json", manifestFor([
      {
        id: "instruction-claude",
        kind: "filePatch",
        path: "CLAUDE.md",
        before: { exists: true, hash: contentSha256("# Old\n"), contents: "# Old\n" },
        afterHash: contentSha256("# Claude\n"),
      },
    ]));

    await expect(restoreProfileApplyRecoveryManifest(workspaceRoot, "stale.json")).rejects.toThrow("does not match expected post-apply hash");
    await expect(readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe("# Edited later\n");
  });

  it("preflights all selected items before mutating any file", async () => {
    const workspaceRoot = await workspace();
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "# Agents\n", "utf8");
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# Edited later\n", "utf8");
    await writeManifest(workspaceRoot, "partial-block.json", manifestFor([
      {
        id: "context-agents",
        kind: "fileCreate",
        path: "AGENTS.md",
        before: { exists: false },
        afterHash: contentSha256("# Agents\n"),
      },
      {
        id: "instruction-claude",
        kind: "filePatch",
        path: "CLAUDE.md",
        before: { exists: true, hash: contentSha256("# Old\n"), contents: "# Old\n" },
        afterHash: contentSha256("# Claude\n"),
      },
    ]));

    await expect(restoreProfileApplyRecoveryManifest(workspaceRoot, "partial-block.json")).rejects.toThrow("does not match expected post-apply hash");
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe("# Agents\n");
    await expect(readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe("# Edited later\n");
  });

  it("rejects manifest item paths that escape the workspace root", async () => {
    const workspaceRoot = await workspace();
    await writeManifest(workspaceRoot, "escape.json", manifestFor([
      {
        id: "bad",
        kind: "fileCreate",
        path: "../outside.md",
        before: { exists: false },
        afterHash: contentSha256("# Outside\n"),
      },
    ]));

    await expect(restoreProfileApplyRecoveryManifest(workspaceRoot, "escape.json")).rejects.toThrow("escapes workspace root");
  });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-apply-recovery-"));
  tempPaths.push(root);
  return root;
}

async function writeManifest(workspaceRoot: string, fileName: string, manifest: ProfileApplyRecoveryManifest): Promise<void> {
  const target = path.join(workspaceRoot, ".exo/proposal-recovery/profile-apply", fileName);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function manifestFor(items: ProfileApplyRecoveryManifest["items"]): ProfileApplyRecoveryManifest {
  return {
    format: "exo.profileApplyRecovery.v1",
    proposalId: "proposal-1",
    createdAt: "2026-07-05T12:00:00.000Z",
    source: "profileApply",
    profileId: "test.profile",
    profileLabel: "Test Profile",
    profileApplyTarget: "realVault",
    items,
  };
}
