import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { inspectWorkspaceContent } from "../workspace-content-inspection";

describe("inspectWorkspaceContent", () => {
  it("keeps an ordinary Markdown folder fully in scope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exograph-content-"));
    await writeFile(path.join(root, "note.md"), "# Note\n");

    await expect(inspectWorkspaceContent(root)).resolves.toEqual({
      kind: "markdown",
      signals: [],
      recommendedPolicy: { excludedPaths: [], sourceVisibility: false },
    });
  });

  it("recommends a repository content policy from visible repository markers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exograph-content-"));
    await Promise.all([mkdir(path.join(root, ".git")), writeFile(path.join(root, "package.json"), "{}")]);

    const inspection = await inspectWorkspaceContent(root);

    expect(inspection.kind).toBe("repository");
    expect(inspection.signals).toEqual(["Git", "Node"]);
    expect(inspection.recommendedPolicy.excludedPaths).toContain("node_modules/**");
  });
});
