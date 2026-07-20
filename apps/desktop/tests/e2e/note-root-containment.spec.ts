import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  CONTAINMENT_FIXTURE_SHAPE,
  createContainmentFixture,
  measureContainmentFixture,
  type ContainmentFixturePaths,
} from "../containmentFixture";
import { launchExoWorkspaceFixture } from "../helpers";

test("keeps an aggregate-scale synthetic vault inside its authorized Note Root", async () => {
  let paths: ContainmentFixturePaths | null = null;
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    workspaceRootEnv: false,
    prepareWorkspace: async (workspaceRoot) => {
      paths = await createContainmentFixture(workspaceRoot);
    },
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      const fixturePaths = requireFixturePaths(paths);
      const settings = {
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [fixturePaths.authorizedRoot],
        projectRoots: [fixturePaths.retiredRoot],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        searchEngine: "filesystem",
      };
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
      await writeFile(path.join(path.dirname(settingsPath), "workspace-registry.json"), JSON.stringify({
        activeWorkspaceId: "synthetic-workspace",
        workspaces: [{
          id: "synthetic-workspace",
          label: "synthetic-workspace",
          notesFolder: fixturePaths.authorizedRoot,
          settings,
          updatedAt: "2026-07-19T00:00:00.000Z",
        }],
      }, null, 2), "utf8");
    },
  });
  const fixturePaths = requireFixturePaths(paths);

  try {
    expect(await measureContainmentFixture(fixturePaths.authorizedRoot)).toEqual({
      ...CONTAINMENT_FIXTURE_SHAPE,
      symlinkCount: 2,
    });

    const model = await fixture.page.evaluate(() => window.exo.workspace.getModel());
    expect(model.noteRoots.map((root) => root.path)).toEqual([fixturePaths.authorizedRoot]);
    expect(model).not.toHaveProperty("projectRoots");
    await expect(fixture.page.getByText("retired-note", { exact: false })).toHaveCount(0);

    const authorizedTree = await fixture.page.evaluate(
      ({ authorizedRoot }) => window.exo.workspace.listTree(authorizedRoot, { markdownOnly: true, maxDepth: 1 }),
      fixturePaths,
    );
    expect(authorizedTree.length).toBeGreaterThan(0);

    const pathShapeTree = await fixture.page.evaluate(
      ({ pathShapeDirectory }) => window.exo.workspace.listTree(pathShapeDirectory, { markdownOnly: true, maxDepth: 0 }),
      fixturePaths,
    );
    expect(pathShapeTree.map((entry) => entry.name)).toContain("Résumé + 研究 (draft).md");
    await openNote(fixture.page, fixture.electronApp, fixturePaths.pathShapeNote, "Résumé + 研究 (draft)");
    const renamedPathShapeNote = path.join(fixturePaths.pathShapeDirectory, "Renamed – résumé [final].md");
    await fixture.page.evaluate(
      ({ sourcePath, targetPath }) => window.exo.workspace.renamePath(sourcePath, targetPath),
      { sourcePath: fixturePaths.pathShapeNote, targetPath: renamedPathShapeNote },
    );
    await expect(access(fixturePaths.pathShapeNote)).rejects.toMatchObject({ code: "ENOENT" });
    await openNote(fixture.page, fixture.electronApp, renamedPathShapeNote, "Renamed – résumé [final]");

    const createdPath = path.join(fixturePaths.authorizedRoot, "journey-note.md");
    const renamedPath = path.join(fixturePaths.authorizedRoot, "journey-note-renamed.md");
    await fixture.page.evaluate(
      ({ targetPath }) => window.exo.workspace.createFile(targetPath, "# Journey Note\n"),
      { targetPath: createdPath },
    );
    await expect(access(createdPath)).resolves.toBeUndefined();

    await openNote(fixture.page, fixture.electronApp, createdPath, "journey-note");
    const linkedPath = await fixture.page.evaluate(
      ({ sourcePath }) => window.exo.notes.ensureTarget(sourcePath, "journey-linked"),
      { sourcePath: createdPath },
    );
    expect(linkedPath).toBe(path.join(fixturePaths.authorizedRoot, "journey-linked.md"));
    await expect(access(linkedPath)).resolves.toBeUndefined();

    await fixture.page.evaluate(
      ({ sourcePath, targetPath }) => window.exo.workspace.renamePath(sourcePath, targetPath),
      { sourcePath: createdPath, targetPath: renamedPath },
    );
    await expect(access(createdPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(renamedPath)).resolves.toBeUndefined();
    await openNote(fixture.page, fixture.electronApp, renamedPath, "journey-note-renamed");

    await fixture.page.evaluate(
      ({ targetPath }) => window.exo.workspace.deletePath(targetPath),
      { targetPath: renamedPath },
    );
    await expect(access(renamedPath)).rejects.toMatchObject({ code: "ENOENT" });

    const refusals = await containmentRefusals(fixture.page, fixturePaths);
    expect(
      Object.entries(refusals).filter(([, result]) => result === "ALLOWED").map(([operation]) => operation),
    ).toEqual([]);
    for (const [operation, result] of Object.entries(refusals)) {
      expect(result, operation).toContain("outside configured note roots");
    }

    const normalizedSettings = JSON.parse(await readFile(fixture.settingsPath, "utf8")) as Record<string, unknown>;
    const normalizedRegistry = JSON.parse(
      await readFile(path.join(path.dirname(fixture.settingsPath), "workspace-registry.json"), "utf8"),
    ) as { workspaces: Array<{ settings: Record<string, unknown> }> };
    expect(normalizedSettings).not.toHaveProperty("projectRoots");
    expect(normalizedRegistry.workspaces[0]?.settings).not.toHaveProperty("projectRoots");
  } finally {
    await fixture.cleanup();
  }
});

async function openNote(
  page: Page,
  electronApp: Awaited<ReturnType<typeof launchExoWorkspaceFixture>>["electronApp"],
  filePath: string,
  expectedTitle: string,
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, targetPath) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("command:open-file", targetPath);
  }, filePath);
  await expect(page.getByTestId("editor-title")).toHaveText(expectedTitle);
}

async function containmentRefusals(page: Page, paths: ContainmentFixturePaths): Promise<Record<string, string>> {
  return page.evaluate(async (fixturePaths) => {
    async function errorFrom(operation: () => Promise<unknown>): Promise<string> {
      try {
        await operation();
        return "ALLOWED";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    const traversalPath = `${fixturePaths.authorizedRoot}/../outside-root/outside-note.md`;
    return {
      outsideRead: await errorFrom(() => window.exo.notes.read(fixturePaths.outsideNote)),
      traversalRead: await errorFrom(() => window.exo.notes.read(traversalPath)),
      symlinkFileRead: await errorFrom(() => window.exo.notes.read(fixturePaths.symlinkFile)),
      symlinkDirectoryRead: await errorFrom(() => window.exo.notes.read(`${fixturePaths.symlinkDirectory}/outside-note.md`)),
      symlinkDirectoryWrite: await errorFrom(() => window.exo.workspace.createFile(`${fixturePaths.symlinkDirectory}/created.md`)),
      outsideWrite: await errorFrom(() => window.exo.workspace.createFile(`${fixturePaths.outsideRoot}/created.md`)),
      retiredRead: await errorFrom(() => window.exo.notes.read(fixturePaths.retiredNote)),
      retiredWrite: await errorFrom(() => window.exo.workspace.createFile(`${fixturePaths.retiredRoot}/created.md`)),
      retiredDelete: await errorFrom(() => window.exo.workspace.deletePath(fixturePaths.retiredNote)),
      retiredTree: await errorFrom(() => window.exo.workspace.listTree(fixturePaths.retiredRoot, { markdownOnly: true })),
      outsideTree: await errorFrom(() => window.exo.workspace.listTree(fixturePaths.outsideRoot, { markdownOnly: true })),
      symlinkTree: await errorFrom(() => window.exo.workspace.listTree(fixturePaths.symlinkDirectory, { markdownOnly: true })),
      escapedWikilink: await errorFrom(() => window.exo.notes.ensureTarget(fixturePaths.sourceNote, "../../outside-root/wikilink")),
    };
  }, paths);
}

function requireFixturePaths(paths: ContainmentFixturePaths | null): ContainmentFixturePaths {
  if (!paths) {
    throw new Error("Containment fixture was not prepared.");
  }
  return paths;
}
