import { describe, expect, it } from "vitest";

import {
  PROPOSAL_DECISION_FORBIDDEN_ERROR,
  PROPOSAL_UNSUPPORTED_MOVE_DELETE_REASON,
  decideProposalBatch,
  decideProposalItem,
  isProposalDecisionForbiddenError,
  parseProposalBatch,
  proposalPermissionRequirement,
  proposalStatusForItems,
  serializeProposalBatch,
  validateProposalBatch,
  type ProposalBatch,
} from "../proposal-review";

const proposal: ProposalBatch = {
  id: "proposal-1",
  title: "Reviewable file changes",
  status: "pending",
  provenance: {
    activityId: "activity-1",
    sessionId: "term-1",
    traceRef: "traces/term-1.ndjson#1-12",
  },
  items: [
    {
      id: "patch-1",
      kind: "filePatch",
      path: "notes/project.md",
      baseHash: "sha256:base",
      unifiedDiff: [
        "--- a/notes/project.md",
        "+++ b/notes/project.md",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
      itemStatus: "pending",
    },
    {
      id: "frontmatter-1",
      kind: "frontmatterPatch",
      path: "notes/project.md",
      baseHash: "sha256:base",
      operations: [
        { kind: "set", keyPath: ["title"], value: "Project" },
        { kind: "appendToList", keyPath: ["tags"], value: "reviewed" },
      ],
      itemStatus: "pending",
    },
    {
      id: "create-1",
      kind: "fileCreate",
      path: "notes/new.md",
      contents: "# New\n",
      itemStatus: "pending",
    },
  ],
};

describe("proposal review contract", () => {
  it("validates ordered independently decidable proposal batches with provenance", () => {
    expect(validateProposalBatch(proposal)).toMatchObject({
      id: "proposal-1",
      status: "pending",
      provenance: {
        activityId: "activity-1",
        sessionId: "term-1",
        traceRef: "traces/term-1.ndjson#1-12",
      },
      items: [
        { id: "patch-1", kind: "filePatch" },
        { id: "frontmatter-1", kind: "frontmatterPatch" },
        { id: "create-1", kind: "fileCreate" },
      ],
    });
    expect(() => validateProposalBatch({ ...proposal, provenance: {} })).toThrow("activityId");
    expect(() => validateProposalBatch({ ...proposal, items: [] })).toThrow("at least one item");
    expect(() =>
      validateProposalBatch({
        ...proposal,
        items: [{ ...proposal.items[0], path: "/absolute.md" }],
      }),
    ).toThrow("workspace-relative");
    expect(() =>
      validateProposalBatch({
        ...proposal,
        items: [{ ...proposal.items[0], path: "../escape.md" }],
      }),
    ).toThrow("workspace-relative");
  });

  it("marks an accepted item stale when baseHash mismatches current content", () => {
    const decided = decideProposalItem(proposal, "patch-1", "accept", {
      surface: "ui",
      decidedAt: "2026-07-03T00:00:00.000Z",
      currentHashes: {
        "notes/project.md": "sha256:changed",
      },
    });

    expect(decided.status).toBe("partial");
    expect(decided.items[0]).toMatchObject({
      id: "patch-1",
      itemStatus: "stale",
      statusReason: "baseHash mismatch: file changed since proposal (notes/project.md)",
      decidedAt: "2026-07-03T00:00:00.000Z",
    });
    expect(decided.items[1]?.itemStatus).toBe("pending");
  });

  it("allows partial acceptance for non-atomic batches without performing writes", () => {
    const decided = decideProposalItem(proposal, "patch-1", "accept", {
      surface: "cli",
      currentHashes: {
        "notes/project.md": "sha256:base",
      },
    });

    expect(decided.status).toBe("partial");
    expect(decided.items.map((item) => [item.id, item.itemStatus])).toEqual([
      ["patch-1", "accepted"],
      ["frontmatter-1", "pending"],
      ["create-1", "pending"],
    ]);
  });

  it("rejects per-item decisions for atomic batches", () => {
    expect(() => decideProposalItem({ ...proposal, atomic: true }, "patch-1", "reject", { surface: "ui" })).toThrow(
      "decide the full batch",
    );

    const decided = decideProposalBatch({ ...proposal, atomic: true }, "reject", { surface: "ui" });
    expect(decided.status).toBe("rejected");
    expect(decided.items.every((item) => item.itemStatus === "rejected")).toBe(true);
  });

  it("forbids decision helpers on the MCP plane", () => {
    expect(() => decideProposalItem(proposal, "patch-1", "accept", { surface: "mcp" })).toThrow(
      PROPOSAL_DECISION_FORBIDDEN_ERROR.message,
    );
    try {
      decideProposalBatch(proposal, "reject", { surface: "mcp" });
      throw new Error("expected MCP decision to fail");
    } catch (error) {
      expect(isProposalDecisionForbiddenError(error)).toBe(true);
      expect(error).toMatchObject(PROPOSAL_DECISION_FORBIDDEN_ERROR);
    }
  });

  it("describes proposal permission boundaries without granting execution", () => {
    expect(proposalPermissionRequirement("create")).toMatchObject({
      action: "propose",
      reviewCopy: expect.stringContaining("draft"),
    });
    expect(proposalPermissionRequirement("decide")).toMatchObject({
      action: "write",
      reviewCopy: expect.stringContaining("human UI/CLI"),
    });
  });

  it("marks fileMove and fileDelete accept attempts unsupported in v1", () => {
    const moveDelete: ProposalBatch = {
      id: "proposal-move-delete",
      status: "pending",
      provenance: { activityId: "activity-1" },
      items: [
        {
          id: "move-1",
          kind: "fileMove",
          path: "notes/old.md",
          toPath: "notes/new.md",
          baseHash: "sha256:move",
          itemStatus: "pending",
        },
        {
          id: "delete-1",
          kind: "fileDelete",
          path: "notes/delete.md",
          baseHash: "sha256:delete",
          itemStatus: "pending",
        },
      ],
    };

    const decided = decideProposalBatch(moveDelete, "accept", {
      surface: "ui",
      currentHashes: {
        "notes/old.md": "sha256:move",
        "notes/delete.md": "sha256:delete",
      },
    });

    expect(decided.status).toBe("stale");
    expect(decided.items.map((item) => item.statusReason)).toEqual([
      PROPOSAL_UNSUPPORTED_MOVE_DELETE_REASON,
      PROPOSAL_UNSUPPORTED_MOVE_DELETE_REASON,
    ]);
  });

  it("serializes and parses proposal metadata without changing order", () => {
    const decided = decideProposalItem(proposal, "patch-1", "reject", {
      surface: "cli",
      decidedAt: "2026-07-03T01:00:00.000Z",
    });
    const parsed = parseProposalBatch(serializeProposalBatch(decided));

    expect(parsed).toEqual(decided);
    expect(parsed.items.map((item) => item.id)).toEqual(["patch-1", "frontmatter-1", "create-1"]);
    expect(proposalStatusForItems(parsed.items)).toBe("partial");
  });
});
