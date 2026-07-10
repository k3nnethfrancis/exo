import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceFiles } from "../workspace";

describe("WorkspaceFiles", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rejects traversal outside configured note roots", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const outsidePath = path.join(workspaceRoot, "outside.md");
    await mkdir(noteRoot);
    await writeFile(outsidePath, "# Outside\n", "utf8");

    const files = new WorkspaceFiles([noteRoot]);

    await expect(files.existing(path.join(noteRoot, "..", "outside.md"))).rejects.toThrow(
      "outside configured note roots",
    );
  });

  it("allows absolute existing paths inside a configured note root", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const notePath = path.join(noteRoot, "inside.md");
    await mkdir(noteRoot);
    await writeFile(notePath, "# Inside\n", "utf8");

    const files = new WorkspaceFiles([noteRoot]);

    await expect(files.existing(notePath)).resolves.toBe(notePath);
  });

  it("rejects existing paths that escape through a symlink", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const outsideRoot = path.join(workspaceRoot, "outside");
    await mkdir(noteRoot);
    await mkdir(outsideRoot);
    await writeFile(path.join(outsideRoot, "secret.md"), "# Secret\n", "utf8");
    await symlink(outsideRoot, path.join(noteRoot, "linked-outside"));

    const files = new WorkspaceFiles([noteRoot]);

    await expect(files.existing(path.join(noteRoot, "linked-outside", "secret.md"))).rejects.toThrow(
      "outside configured note roots",
    );
  });

  it("allows a missing destination when its nearest existing ancestor is inside a note root", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const destinationPath = path.join(noteRoot, "new", "nested", "note.md");
    await mkdir(noteRoot);

    const files = new WorkspaceFiles([noteRoot]);

    await expect(files.writable(destinationPath)).resolves.toBe(destinationPath);
  });

  it("rejects an absolute missing destination outside configured note roots", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    await mkdir(noteRoot);

    const files = new WorkspaceFiles([noteRoot]);

    await expect(files.writable(path.join(workspaceRoot, "outside", "note.md"))).rejects.toThrow(
      "outside configured note roots",
    );
  });

  it("rejects a missing destination whose nearest existing ancestor escapes through a symlink", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    const outsideRoot = path.join(workspaceRoot, "outside");
    await mkdir(noteRoot);
    await mkdir(outsideRoot);
    await symlink(outsideRoot, path.join(noteRoot, "linked-outside"));

    const files = new WorkspaceFiles([noteRoot]);

    await expect(
      files.writable(path.join(noteRoot, "linked-outside", "missing", "note.md")),
    ).rejects.toThrow("outside configured note roots");
  });

  it("does not authorize a configured note root itself for mutation", async () => {
    const workspaceRoot = await temporaryRoot();
    const noteRoot = path.join(workspaceRoot, "notes");
    await mkdir(noteRoot);

    const files = new WorkspaceFiles([noteRoot]);

    await expect(files.writable(noteRoot)).rejects.toThrow("configured note root itself");
  });

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-files-"));
    temporaryRoots.push(root);
    return root;
  }
});
