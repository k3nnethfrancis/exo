import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyProposalToWorkspace,
  contentSha256,
  currentHashesForProposal,
  enrichProposalFrontmatterPreviews,
  getFrontmatterPatchPreviewEvidence,
  previewFrontmatterPatch,
} from "../proposal-apply-host";
import { ProposalReviewStore } from "../proposal-review-store";
import type { FrontmatterPatchOperation, ProposalBatch } from "../proposal-review";

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

  it("patches hand-formatted frontmatter without touching untouched key bytes or body bytes", async () => {
    const root = await tempRoot();
    const original = [
      "---\n",
      "# comment above untouched key\n",
      "zeta: \"kept string\" # beside untouched key\n",
      "published: 2026-07-03\n",
      "title: Old title\n",
      "tags: [draft]\n",
      "---\n",
      "Body line 1\n",
      "\n",
      "Body line 2 with [draft] bytes.\n",
    ].join("");
    const expected = [
      "---\n",
      "# comment above untouched key\n",
      "zeta: \"kept string\" # beside untouched key\n",
      "published: 2026-07-03\n",
      "title: New title\n",
      "tags: [draft]\n",
      "---\n",
      "Body line 1\n",
      "\n",
      "Body line 2 with [draft] bytes.\n",
    ].join("");
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const operations = [{ kind: "set" as const, keyPath: ["title"], value: "New title" }];
    const preview = previewFrontmatterPatch(original, operations);
    const proposal = createProposal({
      items: [
        {
          id: "frontmatter-1",
          kind: "frontmatterPatch",
          path: "note.md",
          baseHash: contentSha256(original),
          operations,
          itemStatus: "pending",
        },
      ],
    });

    const result = await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "cli",
    });

    const applied = await readFile(path.join(root, "note.md"), "utf8");
    expect(result.proposal.status).toBe("accepted");
    expect(preview).toBe(expected);
    expect(applied).toBe(preview);
    expect(applied.slice(applied.indexOf("---\n", 4) + 4)).toBe(original.slice(original.indexOf("---\n", 4) + 4));
  });

  it("creates a minimal frontmatter block when none exists while preserving body bytes", async () => {
    const root = await tempRoot();
    const original = "Body starts immediately.\n---\nThis is body, not frontmatter.\n";
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const operations = [{ kind: "set" as const, keyPath: ["title"], value: "Inserted" }];
    const proposal = frontmatterProposal("note.md", original, operations);

    const result = await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "ui",
    });

    const applied = await readFile(path.join(root, "note.md"), "utf8");
    expect(result.proposal.status).toBe("accepted");
    expect(applied).toBe(`---\ntitle: Inserted\n---\n${original}`);
    expect(applied.endsWith(original)).toBe(true);
  });

  it("patches an empty frontmatter block", async () => {
    const root = await tempRoot();
    const original = "---\n---\nBody\n";
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const proposal = frontmatterProposal("note.md", original, [
      { kind: "set", keyPath: ["title"], value: "From empty" },
    ]);

    await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "cli",
    });

    await expect(readFile(path.join(root, "note.md"), "utf8")).resolves.toBe("---\ntitle: From empty\n---\nBody\n");
  });

  it("appends to block lists without reformatting neighboring frontmatter", async () => {
    const root = await tempRoot();
    const original = [
      "---\n",
      "title: \"Quoted\"\n",
      "tags:\n",
      "  - draft\n",
      "  # keep this comment\n",
      "  - reviewed\n",
      "date: 2026-07-03\n",
      "---\n",
      "Body\n",
    ].join("");
    const expected = [
      "---\n",
      "title: \"Quoted\"\n",
      "tags:\n",
      "  - draft\n",
      "  # keep this comment\n",
      "  - reviewed\n",
      "  - final\n",
      "date: 2026-07-03\n",
      "---\n",
      "Body\n",
    ].join("");
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const operations = [{ kind: "appendToList" as const, keyPath: ["tags"], value: "final" }];
    const preview = previewFrontmatterPatch(original, operations);

    await applyProposalToWorkspace(frontmatterProposal("note.md", original, operations), {
      workspaceRoot: root,
      decision: "accept",
      surface: "cli",
    });

    const applied = await readFile(path.join(root, "note.md"), "utf8");
    expect(preview).toBe(expected);
    expect(applied).toBe(preview);
  });

  it("round-trips CRLF frontmatter and leaves CRLF body bytes untouched", async () => {
    const root = await tempRoot();
    const original = "---\r\ntitle: Old\r\nkept: \"quoted\"\r\n---\r\nLine 1\r\nLine 2\r\n";
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const operations = [{ kind: "set" as const, keyPath: ["title"], value: "New" }];

    await applyProposalToWorkspace(frontmatterProposal("note.md", original, operations), {
      workspaceRoot: root,
      decision: "accept",
      surface: "ui",
    });

    const applied = await readFile(path.join(root, "note.md"), "utf8");
    expect(applied).toBe("---\r\ntitle: New\r\nkept: \"quoted\"\r\n---\r\nLine 1\r\nLine 2\r\n");
    expect(applied.slice(applied.indexOf("---\r\n", 5) + 5)).toBe("Line 1\r\nLine 2\r\n");
  });

  it("adds reviewer byte evidence matching the exact bytes apply writes", async () => {
    const root = await tempRoot();
    const original = [
      "---\r\n",
      "# keep comment\r\n",
      "zeta: \"kept\"\r\n",
      "published: 2026-07-04\r\n",
      "title: Old\r\n",
      "---\r\n",
      "Body line 1\r\n",
      "Body line 2\r\n",
    ].join("");
    const operations = [
      { kind: "set" as const, keyPath: ["title"], value: "New" },
      { kind: "set" as const, keyPath: ["reviewed"], value: "2026-07-04" },
    ];
    await writeFile(path.join(root, "note.md"), original, "utf8");

    const proposal = await enrichProposalFrontmatterPreviews(root, frontmatterProposal("note.md", original, operations));
    const evidence = getFrontmatterPatchPreviewEvidence(proposal.items[0]);

    expect(evidence).not.toBeNull();
    expect(evidence?.before).toBe(original);
    expect(evidence?.after).toContain("# keep comment\r\n");
    expect(evidence?.after).toContain("zeta: \"kept\"\r\n");
    expect(evidence?.after).toContain("published: 2026-07-04\r\n");
    expect(evidence?.after.endsWith("Body line 1\r\nBody line 2\r\n")).toBe(true);

    await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "cli",
    });

    const applied = await readFile(path.join(root, "note.md"), "utf8");
    expect(applied).toBe(evidence?.after);
    expect(applied.slice(applied.indexOf("---\r\n", 5) + 5)).toBe("Body line 1\r\nBody line 2\r\n");
  });

  it("marks duplicate frontmatter keys stale instead of guessing which key to patch", async () => {
    const root = await tempRoot();
    const original = "---\ntitle: One\ntitle: Two\n---\nBody\n";
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const proposal = frontmatterProposal("note.md", original, [
      { kind: "set", keyPath: ["title"], value: "New" },
    ]);

    const result = await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "cli",
    });

    expect(result.proposal.status).toBe("stale");
    expect(result.proposal.items[0]).toMatchObject({
      itemStatus: "stale",
      statusReason: expect.stringContaining("Map keys must be unique"),
    });
    expect(result.appliedItems).toEqual([]);
    await expect(readFile(path.join(root, "note.md"), "utf8")).resolves.toBe(original);
  });

  it("marks exotic non-mapping frontmatter stale clearly", async () => {
    const root = await tempRoot();
    const original = "---\n- not\n- a map\n---\nBody\n";
    await writeFile(path.join(root, "note.md"), original, "utf8");
    const proposal = frontmatterProposal("note.md", original, [
      { kind: "set", keyPath: ["title"], value: "New" },
    ]);

    const result = await applyProposalToWorkspace(proposal, {
      workspaceRoot: root,
      decision: "accept",
      surface: "ui",
    });

    expect(result.proposal.items[0]).toMatchObject({
      itemStatus: "stale",
      statusReason: expect.stringContaining("requires a YAML mapping"),
    });
    await expect(readFile(path.join(root, "note.md"), "utf8")).resolves.toBe(original);
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

  it("does not partially apply atomic batches when frontmatter preparation fails", async () => {
    const root = await tempRoot();
    const duplicate = "---\ntitle: One\ntitle: Two\n---\nBody\n";
    const patchable = "old\n";
    await writeFile(path.join(root, "dupe.md"), duplicate, "utf8");
    await writeFile(path.join(root, "patch.md"), patchable, "utf8");
    const proposal = createProposal({
      atomic: true,
      items: [
        {
          id: "frontmatter-1",
          kind: "frontmatterPatch",
          path: "dupe.md",
          baseHash: contentSha256(duplicate),
          operations: [{ kind: "set", keyPath: ["title"], value: "New" }],
          itemStatus: "pending",
        },
        {
          id: "patch-1",
          kind: "filePatch",
          path: "patch.md",
          baseHash: contentSha256(patchable),
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
    expect(result.proposal.items.map((item) => item.itemStatus)).toEqual(["stale", "stale"]);
    expect(result.appliedItems).toEqual([]);
    await expect(readFile(path.join(root, "dupe.md"), "utf8")).resolves.toBe(duplicate);
    await expect(readFile(path.join(root, "patch.md"), "utf8")).resolves.toBe(patchable);
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

function frontmatterProposal(
  filePath: string,
  contents: string,
  operations: FrontmatterPatchOperation[],
): ProposalBatch {
  return createProposal({
    items: [
      {
        id: "frontmatter-1",
        kind: "frontmatterPatch",
        path: filePath,
        baseHash: contentSha256(contents),
        operations,
        itemStatus: "pending",
      },
    ],
  });
}
