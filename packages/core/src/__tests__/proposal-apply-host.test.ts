import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyProposalToWorkspace, contentSha256, currentHashesForProposal } from "../proposal-apply-host";
import { ProposalReviewStore } from "../proposal-review-store";
import type { ProposalBatch } from "../proposal-review";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("proposal apply host", () => {
  it("stores and lists proposal batches without mutating workspace files", async () => {
    const root = await tempRoot();
    const store = new ProposalReviewStore(path.join(root, ".exo"));
    const proposal = createProposal({
      id: "proposal-store",
      items: [
        {
          id: "create-1",
          kind: "fileCreate",
          path: "notes/new.md",
          contents: "# New\n",
          itemStatus: "pending",
        },
      ],
    });

    await store.writeProposal(proposal);

    await expect(store.readProposal("proposal-store")).resolves.toEqual(proposal);
    await expect(store.listProposals()).resolves.toEqual([proposal]);
    await expect(readFile(path.join(root, "notes/new.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies file creates, unified diffs, and frontmatter operations after base hashes match", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "note.md"), "---\ntitle: Old\ntags:\n  - draft\n---\nBody\n", "utf8");
    await writeFile(path.join(root, "patch.md"), "old\nkeep\n", "utf8");
    const proposal = createProposal({
      items: [
        {
          id: "create-1",
          kind: "fileCreate",
          path: "created.md",
          contents: "# Created\n",
          itemStatus: "pending",
        },
        {
          id: "patch-1",
          kind: "filePatch",
          path: "patch.md",
          baseHash: contentSha256("old\nkeep\n"),
          unifiedDiff: [
            "--- a/patch.md",
            "+++ b/patch.md",
            "@@ -1,2 +1,2 @@",
            "-old",
            "+new",
            " keep",
          ].join("\n"),
          itemStatus: "pending",
        },
        {
          id: "frontmatter-1",
          kind: "frontmatterPatch",
          path: "note.md",
          baseHash: contentSha256("---\ntitle: Old\ntags:\n  - draft\n---\nBody\n"),
          operations: [
            { kind: "set", keyPath: ["title"], value: "New title" },
            { kind: "appendToList", keyPath: ["tags"], value: "reviewed" },
          ],
          itemStatus: "pending",
        },
      ],
    });

    const result = await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "cli",
      decidedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(result.proposal.status).toBe("accepted");
    expect(result.appliedItems.map((item) => [item.id, item.action])).toEqual([
      ["create-1", "created"],
      ["patch-1", "patched"],
      ["frontmatter-1", "frontmatterPatched"],
    ]);
    await expect(readFile(path.join(root, "created.md"), "utf8")).resolves.toBe("# Created\n");
    await expect(readFile(path.join(root, "patch.md"), "utf8")).resolves.toBe("new\nkeep\n");
    await expect(readFile(path.join(root, "note.md"), "utf8")).resolves.toContain("title: New title");
    await expect(readFile(path.join(root, "note.md"), "utf8")).resolves.toContain("- reviewed");
  });

  it("marks stale proposals without writing when the current file hash differs", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "patch.md"), "changed\n", "utf8");
    const proposal = createProposal({
      items: [
        {
          id: "patch-1",
          kind: "filePatch",
          path: "patch.md",
          baseHash: contentSha256("old\n"),
          unifiedDiff: ["--- a/patch.md", "+++ b/patch.md", "@@ -1 +1 @@", "-old", "+new"].join("\n"),
          itemStatus: "pending",
        },
      ],
    });

    const result = await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "ui",
    });

    expect(result.proposal.status).toBe("stale");
    expect(result.appliedItems).toEqual([]);
    await expect(readFile(path.join(root, "patch.md"), "utf8")).resolves.toBe("changed\n");
  });

  it("rejects MCP decisions and paths that escape the workspace", async () => {
    const root = await tempRoot();
    const proposal = createProposal({
      items: [
        {
          id: "create-1",
          kind: "fileCreate",
          path: "created.md",
          contents: "# Created\n",
          itemStatus: "pending",
        },
      ],
    });

    await expect(applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "mcp" as unknown as "cli",
    })).rejects.toThrow("Agent surfaces may create and list proposals only");

    await expect(currentHashesForProposal(root, [
      {
        id: "escape",
        kind: "fileCreate",
        path: "../escape.md",
        contents: "",
        itemStatus: "pending",
      },
    ])).rejects.toThrow("escapes workspace root");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-proposal-"));
  tempPaths.push(root);
  return root;
}

function createProposal(overrides: Partial<ProposalBatch> = {}): ProposalBatch {
  return {
    id: "proposal-1",
    status: "pending",
    provenance: { activityId: "activity-1" },
    items: [],
    ...overrides,
  };
}
