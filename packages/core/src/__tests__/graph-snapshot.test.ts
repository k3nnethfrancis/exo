import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildGraphSnapshot } from "../graph-snapshot";
import type { WorkspaceModel } from "../types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("graph snapshot", () => {
  it("builds deterministic outgoing graph facts from configured note roots", async () => {
    const root = await createFixtureVault();
    const notesRoot = path.join(root, "notes");
    const model = workspaceModel(root, notesRoot);

    const snapshot = await buildGraphSnapshot(model, { generatedAt: "2026-06-26T00:00:00.000Z" });
    const secondSnapshot = await buildGraphSnapshot(model, { generatedAt: "2026-06-26T00:00:00.000Z" });

    const alphaPath = path.join(notesRoot, "alpha.md");
    const betaPath = path.join(notesRoot, "folder", "beta.md");
    const duplicateOnePath = path.join(notesRoot, "duplicate.md");
    const duplicateTwoPath = path.join(notesRoot, "other", "duplicate.md");
    const alphaId = `note:${alphaPath}`;
    const betaId = `note:${betaPath}`;

    expect(snapshot).toEqual(secondSnapshot);
    expect(snapshot.nodes.map((node) => node.id)).toEqual([...snapshot.nodes.map((node) => node.id)].sort());
    expect(snapshot.edges.map((edge) => edge.id)).toEqual([...snapshot.edges.map((edge) => edge.id)].sort());

    expect(snapshot.scope).toEqual({
      workspaceRoot: root,
      noteRootIds: ["notes"],
      projectRootIds: [],
      paths: [alphaPath, duplicateOnePath, betaPath, duplicateTwoPath],
    });

    expect(snapshot.nodes.filter((node) => node.kind === "note").map((node) => node.id)).toEqual([
      alphaId,
      `note:${duplicateOnePath}`,
      betaId,
      `note:${duplicateTwoPath}`,
    ]);
    expect(snapshot.nodes.find((node) => node.id === alphaId)).toMatchObject({
      kind: "note",
      label: "Alpha Note",
      filePath: alphaPath,
      rootId: "notes",
      metadata: {
        title: "Alpha Note",
        tags: ["body-tag", "frontmatter-tag"],
        frontmatter: {
          title: "Alpha Note",
          tags: ["frontmatter-tag"],
          status: "active",
          nested: { keep: true },
        },
      },
    });

    expect(snapshot.nodes).toContainEqual({
      id: "tag:frontmatter-tag",
      kind: "tag",
      label: "#frontmatter-tag",
      metadata: { title: "frontmatter-tag" },
    });
    expect(snapshot.nodes).toContainEqual({
      id: "tag:body-tag",
      kind: "tag",
      label: "#body-tag",
      metadata: { title: "body-tag" },
    });

    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hasTag",
          source: alphaId,
          target: "tag:frontmatter-tag",
          resolution: "resolved",
        }),
        expect.objectContaining({
          kind: "hasTag",
          source: alphaId,
          target: "tag:body-tag",
          resolution: "resolved",
        }),
        expect.objectContaining({
          kind: "wikilink",
          source: alphaId,
          target: betaId,
          resolution: "resolved",
          metadata: expect.objectContaining({ targetText: "folder/beta" }),
        }),
        expect.objectContaining({
          kind: "markdownLink",
          source: alphaId,
          target: betaId,
          resolution: "resolved",
          metadata: expect.objectContaining({ targetText: "folder/beta.md" }),
        }),
      ]),
    );

    expect(snapshot.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external:https://example.com/page",
          kind: "external",
        }),
        expect.objectContaining({
          id: `unresolved:${encodeURIComponent(`markdown:${path.join(notesRoot, "missing.md")}`)}`,
          kind: "unresolved",
          label: "missing.md",
        }),
        expect.objectContaining({
          id: `unresolved:${encodeURIComponent("wikilink:missing-wiki")}`,
          kind: "unresolved",
          label: "missing-wiki",
        }),
        expect.objectContaining({
          id: `unresolved:${encodeURIComponent("wikilink:duplicate")}`,
          kind: "unresolved",
          label: "duplicate",
        }),
      ]),
    );
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "markdownLink",
          target: "external:https://example.com/page",
          resolution: "external",
        }),
        expect.objectContaining({
          kind: "markdownLink",
          target: `unresolved:${encodeURIComponent(`markdown:${path.join(notesRoot, "missing.md")}`)}`,
          resolution: "unresolved",
        }),
        expect.objectContaining({
          kind: "wikilink",
          target: `unresolved:${encodeURIComponent("wikilink:missing-wiki")}`,
          resolution: "unresolved",
        }),
      ]),
    );

    expect(snapshot.edges.some((edge) => edge.source === betaId && edge.target === alphaId)).toBe(false);
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.warnings[0]).toContain("Ambiguous wikilink \"duplicate\"");
  });
});

async function createFixtureVault(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-graph-snapshot-"));
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
      "nested:",
      "  keep: true",
      "---",
      "",
      "Links to [[folder/beta]], [[missing-wiki]], and ambiguous [[duplicate]].",
      "Also [Beta](folder/beta.md), [External](https://example.com/page), and [Missing](missing.md).",
      "A body #body-tag appears here.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(notesRoot, "folder", "beta.md"), "# Beta\n\nNo backlink should be emitted.\n", "utf8");
  await writeFile(path.join(notesRoot, "duplicate.md"), "# Duplicate one\n", "utf8");
  await writeFile(path.join(notesRoot, "other", "duplicate.md"), "# Duplicate two\n", "utf8");
  return root;
}

function workspaceModel(root: string, notesRoot: string): WorkspaceModel {
  return {
    workspaceRoot: root,
    defaultTerminalCwd: root,
    noteRoots: [{ id: "notes", label: "notes", path: notesRoot, kind: "notes" }],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    attachedWorkcells: [],
  };
}
