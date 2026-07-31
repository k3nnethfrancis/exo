import { describe, expect, it, vi } from "vitest";
import type { InvocationFileReviewPayload } from "../../shared/api";

import { refreshInvocationReviewAfterResolution } from "./invocationReviewResolution";

describe("invocation review resolution", () => {
  it("surfaces a rejected-change document reload failure to the review owner", async () => {
    const reloadDocument = vi.fn(async () => {
      throw new Error("reload failed");
    });

    await expect(refreshInvocationReviewAfterResolution(
      modifiedPayload("/notes/changed.md"),
      "reject",
      {
        isDocumentOpen: () => true,
        openDocument: vi.fn(),
        reloadDocument,
        removeOpenPath: vi.fn(),
      },
    )).rejects.toThrow("reload failed");

    expect(reloadDocument).toHaveBeenCalledWith("/notes/changed.md");
  });
});

function modifiedPayload(filePath: string): InvocationFileReviewPayload {
  return {
    invocation: { id: "invocation-1" },
    change: {
      id: "change-1",
      operation: "modified",
      before: { path: filePath, mediaType: "text" },
      after: { path: filePath, mediaType: "text" },
      decision: { status: "pending" },
    },
  } as InvocationFileReviewPayload;
}
