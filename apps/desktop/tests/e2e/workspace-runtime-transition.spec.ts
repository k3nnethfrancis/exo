import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceSettings } from "@exograph/core";

import { launchExographWorkspaceFixture } from "../helpers";

test("keeps command discovery, status, and search scoped across A → B → A", async () => {
  const fixture = await launchExographWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    runtimeRootEnv: false,
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes", "test-notes");
      await writeFile(path.join(noteRoot, "runtime-a.md"), "# Runtime A\n", "utf8");
      const alternateRoot = path.join(workspaceRoot, "alternate-wiki");
      await mkdir(alternateRoot, { recursive: true });
      await writeFile(path.join(alternateRoot, "runtime-b.md"), "# Runtime B\n", "utf8");
    },
  });
  const rootA = fixture.workspaceRoot;
  const noteRootA = path.join(rootA, "notes", "test-notes");
  const rootB = path.join(rootA, "alternate-wiki");

  try {
    await expect.poll(() => commandServerStatus(path.join(rootA, ".exograph"))).toMatchObject({
      workspace: { workspaceRoot: rootA, noteRoots: [{ path: noteRootA }] },
    });

    await saveActiveWorkspace(fixture.page, rootB, rootB);
    await expect.poll(() => commandServerStatus(path.join(rootB, ".exograph"))).toMatchObject({
      workspace: { workspaceRoot: rootB, noteRoots: [{ path: rootB }] },
    });
    await expect.poll(() => fixture.page.evaluate(() => window.exograph.workspace.searchWorkspace("runtime-b")))
      .toMatchObject({ notes: [expect.objectContaining({ title: "runtime-b" })] });

    await saveActiveWorkspace(fixture.page, rootA, noteRootA);
    await expect.poll(() => commandServerStatus(path.join(rootA, ".exograph"))).toMatchObject({
      workspace: { workspaceRoot: rootA, noteRoots: [{ path: noteRootA }] },
    });
    await expect.poll(() => fixture.page.evaluate(() => window.exograph.workspace.searchWorkspace("runtime-a")))
      .toMatchObject({ notes: [expect.objectContaining({ title: "runtime-a" })] });
  } finally {
    await fixture.cleanup();
  }
});

async function saveActiveWorkspace(page: Page, workspaceRoot: string, noteRoot: string): Promise<void> {
  const outcome = await page.evaluate(async ({ workspaceRoot, noteRoot }) => {
    const snapshot = await window.exograph.workspace.getSettings();
    return window.exograph.workspace.saveSettings({
      settings: {
        ...snapshot.settings,
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [noteRoot],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        searchEngine: "filesystem",
      } satisfies WorkspaceSettings,
      expectedRevision: snapshot.revision,
    });
  }, { workspaceRoot, noteRoot });
  expect(outcome.runtimeApply).toEqual({ status: "applied" });
}

async function commandServerStatus(runtimeRoot: string): Promise<unknown> {
  const discovery = JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as {
    port: number;
    token: string;
  };
  const response = await fetch(`http://127.0.0.1:${discovery.port}/status`, {
    headers: { "x-exograph-command-token": discovery.token },
  });
  expect(response.ok).toBe(true);
  return response.json();
}
