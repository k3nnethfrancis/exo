import { access, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@exo/core";
import { WorkspaceNotesService } from "./workspace-notes-service";

describe("WorkspaceNotesService", () => {
  it("searches body and frontmatter tags across note roots", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    await writeFile(path.join(noteRoot, "focus.md"), "---\ntags: [research]\n---\n# Focus\n\n#daily\n", "utf8");
    await writeFile(path.join(noteRoot, "other.md"), "# Other\n\nNo match.\n", "utf8");

    await expect(service.searchTag("#research")).resolves.toEqual([
      expect.objectContaining({ title: "Focus", snippet: "#research", kind: "tag" }),
    ]);
    await expect(service.searchTag("daily")).resolves.toEqual([
      expect.objectContaining({ title: "Focus", snippet: "#daily", kind: "tag" }),
    ]);
  });

  it("resolves relative targets before falling back to note basename search", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const relativeTarget = path.join(noteRoot, "folder", "target.md");
    const basenameTarget = path.join(noteRoot, "elsewhere.md");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(relativeTarget, "# Target\n", "utf8");
    await writeFile(basenameTarget, "# Elsewhere\n", "utf8");

    await expect(service.resolveTarget(sourcePath, "target")).resolves.toBe(relativeTarget);
    await expect(service.resolveTarget(sourcePath, "elsewhere")).resolves.toBe(basenameTarget);
    await expect(service.resolveTarget(sourcePath, "https://example.com")).resolves.toBeNull();
  });

  it("creates missing wiki targets next to the source note by default", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    await writeFile(sourcePath, "# Source\n", "utf8");

    const createdPath = await service.ensureTarget(sourcePath, "new target");

    expect(createdPath).toBe(path.join(noteRoot, "folder", "new target.md"));
    await expect(readFile(createdPath, "utf8")).resolves.toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\ntags: \[\]\n---\n\n# new target\n$/);
  });

  it("rejects wiki targets that traverse outside the source note root", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const outsidePath = path.join(path.dirname(noteRoot), "outside.md");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(outsidePath, "# Outside\n", "utf8");

    await expect(service.resolveTarget(sourcePath, "../../outside")).rejects.toThrow(
      "outside configured note roots",
    );
  });

  it("resolves contained relative Markdown images without granting renderer path access", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const imagePath = path.join(noteRoot, "folder", "attachments", "chart one.png");
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(imagePath, "not a real png", "utf8");

    const imageUrl = pathToFileURL(await realpath(imagePath)).toString();
    await expect(service.resolveMarkdownImage(sourcePath, "attachments/chart%20one.png")).resolves.toEqual({
      url: imageUrl,
    });
    await expect(service.resolveMarkdownImage(sourcePath, "/folder/attachments/chart one.png")).resolves.toEqual({
      url: imageUrl,
    });
  });

  it("resolves a site-root image from the nearest matching content ancestor", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const siteRoot = path.join(noteRoot, "kenneth-dot-computer", "garden");
    const sourcePath = path.join(siteRoot, "blog", "self-improving-business-systems.md");
    const imagePath = path.join(siteRoot, "images", "posts", "self-improving-business-systems", "loop-stack.png");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(sourcePath, "# Self-Improving Business Systems\n", "utf8");
    await writeFile(imagePath, "not a real png", "utf8");

    await expect(
      service.resolveMarkdownImage(
        sourcePath,
        "/images/posts/self-improving-business-systems/loop-stack.png",
      ),
    ).resolves.toEqual({ url: pathToFileURL(await realpath(imagePath)).toString() });
  });

  it("prefers the nearest regular root-relative image and decodes its filename", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const siteRoot = path.join(noteRoot, "site");
    const sourcePath = path.join(siteRoot, "blog", "source.md");
    const siteImagePath = path.join(siteRoot, "images", "chart one.png");
    const noteRootImagePath = path.join(noteRoot, "images", "chart one.png");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.dirname(siteImagePath), { recursive: true });
    await mkdir(path.dirname(noteRootImagePath), { recursive: true });
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(siteImagePath, "nearest", "utf8");
    await writeFile(noteRootImagePath, "fallback", "utf8");

    await expect(service.resolveMarkdownImage(sourcePath, "/images/chart%20one.png")).resolves.toEqual({
      url: pathToFileURL(await realpath(siteImagePath)).toString(),
    });
  });

  it("skips a matching directory while searching for a root-relative regular file", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const siteRoot = path.join(noteRoot, "site");
    const sourcePath = path.join(siteRoot, "blog", "source.md");
    const directoryCandidate = path.join(siteRoot, "images", "diagram.png");
    const fileCandidate = path.join(noteRoot, "images", "diagram.png");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(directoryCandidate, { recursive: true });
    await mkdir(path.dirname(fileCandidate), { recursive: true });
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(fileCandidate, "fallback", "utf8");

    await expect(service.resolveMarkdownImage(sourcePath, "/images/diagram.png")).resolves.toEqual({
      url: pathToFileURL(await realpath(fileCandidate)).toString(),
    });
  });

  it("rejects escaped, remote, and missing Markdown image targets", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    await writeFile(sourcePath, "# Source\n", "utf8");

    await expect(service.resolveMarkdownImage(sourcePath, "../../outside.png")).rejects.toThrow("outside configured note roots");
    await expect(service.resolveMarkdownImage(sourcePath, "/../../outside.png")).rejects.toThrow("outside configured note roots");
    await expect(service.resolveMarkdownImage(sourcePath, "file:///outside.png")).rejects.toThrow("not enabled");
    await expect(service.resolveMarkdownImage(sourcePath, "https://example.com/image.png")).rejects.toThrow("not enabled");
    await expect(service.resolveMarkdownImage(sourcePath, "missing.png")).rejects.toThrow();
  });

  it("rejects a Markdown image that escapes through an in-root symlink", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const outsideDirectory = path.join(path.dirname(noteRoot), "outside-images");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "secret.png"), "outside", "utf8");
    await symlink(outsideDirectory, path.join(noteRoot, "folder", "attachments"));

    await expect(service.resolveMarkdownImage(sourcePath, "attachments/secret.png")).rejects.toThrow("outside configured note roots");
    await expect(service.resolveMarkdownImage(sourcePath, "/folder/attachments/secret.png")).rejects.toThrow("outside configured note roots");
  });

  it("creates a missing absolute wiki target at its requested in-root path", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const targetPath = path.join(noteRoot, "elsewhere", "absolute.md");
    await writeFile(sourcePath, "# Source\n", "utf8");

    const createdPath = await service.ensureTarget(sourcePath, targetPath);

    expect(createdPath).toBe(targetPath);
    await expect(readFile(targetPath, "utf8")).resolves.toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\ntags: \[\]\n---\n\n# absolute\n$/);
  });

  it("suggests exact target matches before partial matches", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "source.md");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(path.join(noteRoot, "agent.md"), "# Agent\n", "utf8");
    await writeFile(path.join(noteRoot, "agent-notes.md"), "# Agent Notes\n", "utf8");

    const suggestions = await service.suggestTargets(sourcePath, "agent");

    expect(suggestions.map((suggestion) => suggestion.target)).toEqual(["agent", "agent-notes"]);
  });

  it("reads folder overviews without creating an index and hides index.md from children", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const folderPath = path.join(noteRoot, "projects");
    await mkdir(path.join(folderPath, "nested"), { recursive: true });
    await writeFile(path.join(folderPath, "index.md"), "---\ntags: [active]\n---\n# Projects\n", "utf8");
    await writeFile(path.join(folderPath, "alpha.md"), "# Alpha\n", "utf8");

    const indexed = await service.getFolderOverview(folderPath);

    expect(indexed).toMatchObject({
      directoryPath: folderPath,
      indexPath: path.join(folderPath, "index.md"),
      title: "Projects",
      frontmatter: { tags: ["active"] },
      indexExists: true,
      children: [
        { name: "nested", kind: "directory" },
        { name: "alpha.md", kind: "file" },
      ],
    });
    expect(indexed.children.map((entry) => entry.name)).not.toContain("index.md");

    const emptyFolder = path.join(noteRoot, "empty");
    await mkdir(emptyFolder);
    const unindexed = await service.getFolderOverview(emptyFolder);
    expect(unindexed).toMatchObject({ indexExists: false, title: "empty", children: [] });
    await expect(access(path.join(emptyFolder, "index.md"))).rejects.toThrow();

    await expect(service.ensureFolderIndex(emptyFolder)).resolves.toMatchObject({ created: true });
    await expect(service.getFolderOverview(emptyFolder)).resolves.toMatchObject({
      indexExists: true,
      title: "empty",
      children: [],
    });
  });

  it("invalidates cached folder and graph data after workspace changes", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const folderPath = path.join(noteRoot, "projects");
    const indexPath = path.join(folderPath, "index.md");
    await mkdir(folderPath, { recursive: true });
    await writeFile(indexPath, "# Projects\n", "utf8");

    const initialOverview = await service.getFolderOverview(folderPath);
    const initialGraph = await service.getGraphContext(indexPath);
    expect(initialOverview.children).toEqual([]);
    expect(initialGraph?.backlinks).toEqual([]);

    const backlinkPath = path.join(folderPath, "backlink.md");
    await writeFile(backlinkPath, "# Backlink\n\n[[index]]\n", "utf8");
    await service.handleWorkspaceChange({ rootPath: noteRoot, eventType: "rename", filePath: backlinkPath });

    const refreshedOverview = await service.getFolderOverview(folderPath);
    const refreshedGraph = await service.getGraphContext(indexPath);
    expect(refreshedOverview.children).toEqual([
      { path: backlinkPath, name: "backlink.md", kind: "file" },
    ]);
    expect(refreshedGraph?.backlinks.map((link) => link.target)).toEqual([backlinkPath]);
  });

  it("applies create, change, delete, and rename watcher events to a ready graph", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const focusPath = path.join(noteRoot, "focus.md");
    const oldPath = path.join(noteRoot, "old.md");
    const renamedPath = path.join(noteRoot, "renamed.md");
    await writeFile(focusPath, "# Focus\n", "utf8");
    await writeFile(oldPath, "# Old\n\n[[focus]]\n", "utf8");
    expect((await service.getGraphContext(focusPath))?.backlinks.map((link) => link.target)).toEqual([oldPath]);

    await writeFile(oldPath, "# Old\n", "utf8");
    await service.handleWorkspaceChange({ rootPath: noteRoot, eventType: "change", filePath: oldPath });
    expect((await service.getGraphContext(focusPath))?.backlinks).toEqual([]);

    await writeFile(oldPath, "# Old\n\n[[focus]]\n", "utf8");
    await rename(oldPath, renamedPath);
    await service.handleWorkspaceChange({ rootPath: noteRoot, eventType: "rename", filePath: oldPath });
    await service.handleWorkspaceChange({ rootPath: noteRoot, eventType: "rename", filePath: renamedPath });
    expect((await service.getGraphContext(focusPath))?.backlinks.map((link) => link.target)).toEqual([renamedPath]);

    await rm(renamedPath);
    await service.handleWorkspaceChange({ rootPath: noteRoot, eventType: "rename", filePath: renamedPath });
    expect((await service.getGraphContext(focusPath))?.backlinks).toEqual([]);
  });
});

async function workspaceNotesService() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-notes-service-"));
  const noteRoot = path.join(workspaceRoot, "notes");
  await mkdir(path.join(noteRoot, "folder"), { recursive: true });
  const model: WorkspaceModel = {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [{ id: "note-root-1", label: "notes", path: noteRoot }],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  };
  return {
    noteRoot,
    service: new WorkspaceNotesService({ getWorkspaceModel: () => model }),
  };
}
