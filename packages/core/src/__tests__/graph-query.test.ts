import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getGraphBacklinks, getGraphNeighborhood, getNoteGraphContext } from "../graph-query";
import { buildGraphSnapshot } from "../graph-snapshot";
import type { WorkspaceModel } from "../types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("graph query", () => {
  it("returns deterministic note context from a snapshot", async () => {
    const root = await createFixtureVault();
    const notesRoot = path.join(root, "notes");
    const snapshot = await buildGraphSnapshot(workspaceModel(root, notesRoot), {
      generatedAt: "2026-07-08T00:00:00.000Z",
    });
    const alphaPath = path.join(notesRoot, "alpha.md");
    const betaPath = path.join(notesRoot, "folder", "beta.md");

    const context = getNoteGraphContext(snapshot, alphaPath);

    expect(context?.note.id).toBe(`note:${alphaPath}`);
    expect(context?.tags).toEqual(["body-tag", "frontmatter-tag"]);
    expect(context?.frontmatter).toEqual({
      title: "Alpha Note",
      tags: ["frontmatter-tag"],
      status: "active",
    });
    expect(context?.properties).toBe(context?.frontmatter);
    expect(context?.outgoingLinks.map((link) => link.edge.id)).toEqual(
      [...(context?.outgoingLinks.map((link) => link.edge.id) ?? [])].sort(),
    );
    expect(context?.outgoingLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edge: expect.objectContaining({
            kind: "wikilink",
            target: `note:${betaPath}`,
            resolution: "resolved",
            metadata: expect.objectContaining({ targetText: "folder/beta#intro|Beta Alias" }),
          }),
        }),
        expect.objectContaining({
          edge: expect.objectContaining({
            kind: "markdownLink",
            target: `note:${betaPath}`,
            resolution: "resolved",
            metadata: expect.objectContaining({ targetText: "folder/beta.md#intro" }),
          }),
        }),
      ]),
    );
    expect(context?.externalLinks.map((link) => link.node.id)).toEqual(["external:https://example.com/page"]);
    expect(context?.unresolvedLinks.map((link) => link.node.label)).toEqual(["missing.md", "duplicate", "missing-wiki"]);
  });

  it("derives backlinks and neighborhoods from canonical outgoing edges", async () => {
    const root = await createFixtureVault();
    const notesRoot = path.join(root, "notes");
    const snapshot = await buildGraphSnapshot(workspaceModel(root, notesRoot), {
      generatedAt: "2026-07-08T00:00:00.000Z",
    });
    const alphaPath = path.join(notesRoot, "alpha.md");
    const betaPath = path.join(notesRoot, "folder", "beta.md");

    const backlinks = getGraphBacklinks(snapshot, { id: `note:${betaPath}` });
    expect(backlinks.map((backlink) => backlink.sourceNode.id)).toEqual([`note:${alphaPath}`, `note:${alphaPath}`]);
    expect(backlinks.map((backlink) => backlink.edge.kind)).toEqual(["markdownLink", "wikilink"]);

    const betaNeighborhood = getGraphNeighborhood(snapshot, betaPath);
    expect(betaNeighborhood?.center.id).toBe(`note:${betaPath}`);
    expect(betaNeighborhood?.nodes.map((node) => node.id)).toEqual([
      `note:${alphaPath}`,
      `note:${betaPath}`,
      "tag:beta-tag",
    ]);
    expect(betaNeighborhood?.edges.map((edge) => edge.kind)).toEqual(["markdownLink", "wikilink", "hasTag"]);

    const alphaNeighborhood = getGraphNeighborhood(snapshot, alphaPath, {
      includeTags: false,
      includeExternal: true,
      includeUnresolved: true,
    });
    expect(alphaNeighborhood?.nodes.map((node) => node.id)).toEqual(
      [...(alphaNeighborhood?.nodes.map((node) => node.id) ?? [])].sort(),
    );
    expect(alphaNeighborhood?.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["note", "external", "unresolved"]),
    );
    expect(alphaNeighborhood?.nodes.some((node) => node.kind === "tag")).toBe(false);
  });
});

async function createFixtureVault(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-graph-query-"));
  tempRoots.push(root);
  const notesRoot = path.join(root, "notes");
  await mkdir(path.join(notesRoot, "folder"), { recursive: true });
  await mkdir(path.join(notesRoot, "other"), { recursive: true });
  await writeFile(
    path.join(notesRoot, "alpha.md"),
    [
      "---",
      "title: Alpha Note",
      "tags: [frontmatter-tag]",
      "status: active",
      "---",
      "",
      "Links to [[folder/beta#intro|Beta Alias]], [[missing-wiki]], and ambiguous [[duplicate]].",
      "Also [Beta](folder/beta.md#intro), [External](https://example.com/page), and [Missing](missing.md).",
      "A body #body-tag appears here.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(notesRoot, "folder", "beta.md"),
    ["---", "title: Beta Note", "tags: [beta-tag]", "---", "", "## Intro", ""].join("\n"),
    "utf8",
  );
  await writeFile(path.join(notesRoot, "duplicate.md"), "# Duplicate one\n", "utf8");
  await writeFile(path.join(notesRoot, "other", "duplicate.md"), "# Duplicate two\n", "utf8");
  return root;
}

function workspaceModel(root: string, notesRoot: string): WorkspaceModel {
  return {
    workspaceRoot: root,
    defaultTerminalCwd: root,
    noteRoots: [{ id: "notes", label: "notes", path: notesRoot }],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  };
}
