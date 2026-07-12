import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { qmdSearchProvider, type WorkspaceModel } from "@exo/core";
import {
  commandServerDocumentReadContext,
  CommandServerDocumentReader,
} from "./command-server-document-reader";

describe("CommandServerDocumentReader", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rejects a readable document outside configured Note Roots", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const attachedRoot = path.join(workspaceRoot, "attached");
    const attachedPath = path.join(attachedRoot, "private.md");
    await mkdir(noteRoot);
    await mkdir(attachedRoot);
    await writeFile(attachedPath, "# Private\n", "utf8");
    const model = workspaceModel(workspaceRoot, [noteRoot]);
    const reader = commandServerDocumentReader(model);

    await expect(reader.read(attachedPath)).rejects.toThrow("outside configured note roots");
  });

  it("reads documents from every configured Note Root", async () => {
    const workspaceRoot = await temporaryRoot();
    const firstNoteRoot = path.join(workspaceRoot, "notes");
    const secondNoteRoot = path.join(workspaceRoot, "journal");
    const firstNotePath = path.join(firstNoteRoot, "first.md");
    const secondNotePath = path.join(secondNoteRoot, "second.md");
    await mkdir(firstNoteRoot);
    await mkdir(secondNoteRoot);
    await writeFile(firstNotePath, "# First\n\nAlpha\n", "utf8");
    await writeFile(secondNotePath, "# Second\n\nBeta\n", "utf8");
    const reader = commandServerDocumentReader(workspaceModel(workspaceRoot, [firstNoteRoot, secondNoteRoot]));

    await expect(reader.read(firstNotePath)).resolves.toMatchObject({ filePath: firstNotePath, body: "# First\n\nAlpha\n" });
    await expect(reader.read(secondNotePath)).resolves.toMatchObject({ filePath: secondNotePath, body: "# Second\n\nBeta\n" });
  });

  it("rejects an absolute outside path before asking the document provider to read it", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    await mkdir(noteRoot);
    const model = workspaceModel(workspaceRoot, [noteRoot]);
    const reader = new CommandServerDocumentReader({
      getContext: () => ({ model, runtimeRoot: path.join(workspaceRoot, ".exo") }),
      readDocument: async () => {
        throw new Error("document provider should not run");
      },
    });

    await expect(reader.read(path.join(workspaceRoot, "outside.md"))).rejects.toThrow(
      "outside configured note roots",
    );
  });

  it("rejects a document ID when the provider resolves it outside configured Note Roots", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const attachedPath = path.join(workspaceRoot, "attached", "indexed.md");
    await mkdir(noteRoot);
    await mkdir(path.dirname(attachedPath));
    await writeFile(attachedPath, "# Indexed\n", "utf8");
    const model = workspaceModel(workspaceRoot, [noteRoot]);
    const reader = new CommandServerDocumentReader({
      getContext: () => ({ model, runtimeRoot: path.join(workspaceRoot, ".exo") }),
      readDocument: async (_context, target) => ({
        target,
        filePath: attachedPath,
        title: "Indexed",
        body: "# Indexed\n",
        source: "qmd",
      }),
    });

    await expect(reader.read("#outside123")).rejects.toThrow("outside configured note roots");
  });

  it("passes containment to the provider before a document ID body is read", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const attachedPath = path.join(workspaceRoot, "attached", "indexed.md");
    await mkdir(noteRoot);
    await mkdir(path.dirname(attachedPath));
    const model = workspaceModel(workspaceRoot, [noteRoot]);
    let bodyRead = false;
    const reader = new CommandServerDocumentReader({
      getContext: () => ({ model, runtimeRoot: path.join(workspaceRoot, ".exo") }),
      readDocument: async (_context, target, _options, authorizeResolvedPath) => {
        await authorizeResolvedPath(attachedPath);
        bodyRead = true;
        return {
          target,
          filePath: attachedPath,
          title: "Indexed",
          body: "# Indexed\n",
          source: "qmd",
        };
      },
    });

    await expect(reader.read("#outside123")).rejects.toThrow("outside configured note roots");
    expect(bodyRead).toBe(false);
  });

  it("captures the workspace model and runtime root as one request context", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const notePath = path.join(noteRoot, "context.md");
    await mkdir(noteRoot);
    await writeFile(notePath, "# Context\n", "utf8");
    const model = workspaceModel(workspaceRoot, [noteRoot]);
    const runtimeRoot = path.join(workspaceRoot, ".exo-current");
    let contextReads = 0;
    let observedRuntimeRoot: string | null = null;
    const reader = new CommandServerDocumentReader({
      getContext: () => {
        contextReads += 1;
        return { model, runtimeRoot };
      },
      readDocument: async (context, target, _options, authorizeResolvedPath) => {
        observedRuntimeRoot = context.runtimeRoot;
        await authorizeResolvedPath(notePath);
        return {
          target,
          filePath: notePath,
          title: "Context",
          body: "# Context\n",
          source: "filesystem",
        };
      },
    });

    await expect(reader.read("#context123")).resolves.toMatchObject({ filePath: notePath });
    expect(contextReads).toBe(1);
    expect(observedRuntimeRoot).toBe(runtimeRoot);
  });

  it("does not invent a Note Root while the authoritative onboarding model has none", async () => {
    const workspaceRoot = await temporaryRoot();
    const implicitWorkspaceRoot = path.join(workspaceRoot, "implicit-workspace");
    const implicitNotePath = path.join(implicitWorkspaceRoot, "notes", "not-authorized.md");
    await mkdir(path.dirname(implicitNotePath), { recursive: true });
    await writeFile(implicitNotePath, "# Not authorized\n", "utf8");
    const model = workspaceModel(workspaceRoot, []);
    const reader = new CommandServerDocumentReader({
      getContext: () => commandServerDocumentReadContext(model, {
        EXO_RUNTIME_ROOT: path.join(workspaceRoot, "onboarding-runtime"),
        EXO_WORKSPACE_ROOT: implicitWorkspaceRoot,
      }),
      readDocument: async () => {
        throw new Error("document provider should not run");
      },
    });

    await expect(reader.read(implicitNotePath)).rejects.toThrow("outside configured note roots");
  });

  function commandServerDocumentReader(model: WorkspaceModel): CommandServerDocumentReader {
    return new CommandServerDocumentReader({
      getContext: () => ({ model, runtimeRoot: path.join(model.workspaceRoot, ".exo") }),
      readDocument: (context, target, options, authorizeResolvedPath) =>
        qmdSearchProvider.readAuthorized(
          context.model,
          context.runtimeRoot,
          target,
          options,
          authorizeResolvedPath,
        ),
    });
  }

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-command-read-"));
    temporaryRoots.push(root);
    return root;
  }
});

function workspaceModel(workspaceRoot: string, noteRoots: string[]): WorkspaceModel {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: noteRoots.map((rootPath, index) => ({
      id: `note-root-${index + 1}`,
      label: path.basename(rootPath),
      path: rootPath,
    })),
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  };
}
