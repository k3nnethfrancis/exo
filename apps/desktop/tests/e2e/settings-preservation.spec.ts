import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoWorkspaceFixture, relaunchExoWorkspaceFixture } from "../helpers";

test("every non-structural Settings round trip preserves commands, layout, and opaque metadata", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        agentCommands: [{
          id: "preserved-command",
          label: "Preserved command",
          handle: "preserved",
          command: "/bin/cat",
          cwdPolicy: "workspace_root",
          promptDelivery: "stdin",
          version: 1,
          enabled: true,
        }],
        futureSetting: { keep: "me" },
        futureWorkspaceMetadata: { sourceVersion: 3, keep: true },
        indexedRoots: [path.join(workspaceRoot, "notes/test-notes")],
        indexing: { enabled: true, mode: "lexical", backend: "qmd" },
        searchEngine: "qmd",
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });

  try {
    // Let independent canvas persistence settle before proving Settings itself
    // is read-only while untouched.
    await fixture.page.waitForTimeout(1_100);
    const before = await readFile(fixture.settingsPath, "utf8");
    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).toBeVisible();
    await fixture.page.waitForTimeout(800);
    await fixture.page.getByTestId("workspace-settings-close").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).not.toBeVisible();
    expect(await readFile(fixture.settingsPath, "utf8")).toBe(before);

    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).toBeVisible();
    await fixture.page.waitForTimeout(800);
    await fixture.page.getByTestId("workspace-settings-close").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).not.toBeVisible();
    expect(await readFile(fixture.settingsPath, "utf8")).toBe(before);

    const layout = preservedLayout(path.join(fixture.workspaceRoot, "notes/test-notes/focus-note.md"));
    const savedLayout = await fixture.page.evaluate(async (nextLayout) => {
      const snapshot = await window.exo.workspace.getSettings();
      const saved = await window.exo.workspace.saveSettings({
        settings: { ...snapshot.settings, layout: nextLayout },
        expectedRevision: snapshot.revision,
      });
      return saved.settings.layout;
    }, layout);
    expect(savedLayout).toEqual(layout);

    // The renderer owns canvas persistence. Let that normal path settle, then
    // treat its saved canvas as the layout Settings must leave untouched.
    await fixture.page.waitForTimeout(1_100);
    const seeded = await persistedSettings(fixture.settingsPath);
    expect(seeded.layout).toBeDefined();
    await editSettingsAndClose(fixture.page, "appearance", async (page) => {
      await page.getByTestId("workspace-settings-appearance").selectOption("dark");
    });
    await expectPreservedSettings(fixture.settingsPath, seeded, { appearanceMode: "dark" });

    await editSettingsAndClose(fixture.page, "index", async (page) => {
      await page.getByTestId("workspace-settings-index-update-strategy").selectOption("manual");
    });
    await expectPreservedSettings(fixture.settingsPath, seeded, { appearanceMode: "dark", indexUpdateStrategy: "manual" });

    await editSettingsAndClose(fixture.page, "terminal", async (page) => {
      await page.getByTestId("workspace-settings-terminal-font-size").fill("14");
    });
    await expectPreservedSettings(fixture.settingsPath, seeded, {
      appearanceMode: "dark",
      indexUpdateStrategy: "manual",
      terminalFontSize: 14,
    });
  } finally {
    await fixture.cleanup();
  }
});

test("an explicit empty Commands list stays empty and does not offer @claude", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        projectRoots: [],
        agentCommands: [],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        searchEngine: "filesystem",
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });

  try {
    await editSettingsAndClose(fixture.page, "terminal", async (page) => {
      await page.getByTestId("workspace-settings-terminal-font-size").fill("14");
    });
    await expect.poll(() => persistedSettings(fixture.settingsPath)).toMatchObject({ agentCommands: [] });

    await fixture.page.locator(".editor-surface .cm-content").click();
    await fixture.page.keyboard.press("Meta+End");
    await fixture.page.keyboard.type("@claude");
    await expect(fixture.page.getByTestId("agent-suggestions")).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test("a disabled Claude command stays unavailable to inline completion", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        projectRoots: [],
        agentCommands: [{
          id: "claude",
          label: "Claude",
          handle: "claude",
          command: "/bin/echo",
          adapter: "claude-code",
          continuityPolicy: "continuous",
          cwdPolicy: "workspace_root",
          promptDelivery: "stdin",
          version: 1,
          enabled: false,
        }],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        searchEngine: "filesystem",
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });

  try {
    await fixture.page.locator(".editor-surface .cm-content").click();
    await fixture.page.keyboard.press("Meta+End");
    await fixture.page.keyboard.type("@claude");
    await expect(fixture.page.getByTestId("agent-suggestions")).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test("structural Settings Apply preserves retained Indexed Root policy", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      const notesPath = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [notesPath],
        indexedRoots: [{
          id: "research-docs",
          label: "Research documents",
          path: notesPath,
          kind: "docs",
          pattern: "**/*.{md,mdx}",
          ignore: ["private/**", "archive/**"],
          backend: "qmd",
        }],
        indexing: { enabled: true, mode: "lexical", backend: "qmd" },
        searchEngine: "qmd",
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });

  try {
    const expectedRoot = {
      id: "research-docs",
      label: "Research documents",
      path: path.join(fixture.workspaceRoot, "notes/test-notes"),
      kind: "docs",
      pattern: "**/*.{md,mdx}",
      ignore: ["private/**", "archive/**"],
      backend: "qmd",
    };
    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).toBeVisible();

    const workspaceRoot = fixture.page.getByTestId("workspace-settings-workspace-root");
    await workspaceRoot.fill(`${fixture.workspaceRoot} `);
    await fixture.page.getByTestId("workspace-settings-apply").click();
    await expect(fixture.page.getByTestId("workspace-settings-apply-status")).toHaveText("Changes applied.");
    await expect(fixture.page.getByTestId("workspace-settings-apply")).toHaveCount(0);
    await expect.poll(() => persistedSettings(fixture.settingsPath)).toMatchObject({ indexedRoots: [expectedRoot] });
    await fixture.page.getByTestId("workspace-settings-close").click();
    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await expect(fixture.page.getByTestId("workspace-settings-apply")).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test("structural Apply reports an external revision conflict without overwriting it", async () => {
  const fixture = await launchExoWorkspaceFixture({ mutable: true });

  try {
    await fixture.page.waitForTimeout(1_100);
    await openSettingsSection(fixture.page, "workspace");
    await fixture.page.getByTestId("workspace-settings-workspace-root").fill(`${fixture.workspaceRoot} `);

    await fixture.page.evaluate(async () => {
      const snapshot = await window.exo.workspace.getSettings();
      await window.exo.workspace.saveSettings({
        settings: { ...snapshot.settings, terminalFontSize: 17 },
        expectedRevision: snapshot.revision,
      });
    });

    await fixture.page.getByTestId("workspace-settings-apply").click();
    await expect(fixture.page.locator(".dialog-card__status--error")).toContainText(
      "Workspace settings changed since this edit began",
    );
    await expect(fixture.page.getByTestId("workspace-settings-apply")).toBeVisible();
    await expect.poll(() => persistedSettings(fixture.settingsPath)).toMatchObject({
      workspaceRoot: fixture.workspaceRoot,
      terminalFontSize: 17,
    });
  } finally {
    await fixture.cleanup();
  }
});

test("re-enabling QMD preserves retained Indexed Roots through restart", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      const notesPath = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [notesPath],
        indexedRoots: [
          {
            id: "research-docs",
            label: "Research documents",
            path: path.join(notesPath, "research"),
            kind: "docs",
            pattern: "**/*.mdx",
            ignore: ["private/**"],
            backend: "qmd",
          },
          {
            id: "source-code",
            label: "Source code",
            path: path.join(notesPath, "code"),
            kind: "code",
            pattern: "**/*.{ts,tsx}",
            ignore: ["generated/**"],
            backend: "qmd",
          },
        ],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        searchEngine: "filesystem",
      }, null, 2), "utf8");
    },
  });
  let relaunched: Awaited<ReturnType<typeof relaunchExoWorkspaceFixture>> | null = null;

  try {
    const before = await persistedSettings(fixture.settingsPath);
    await openSettingsSection(fixture.page, "index");
    await fixture.page.getByTestId("workspace-settings-search-engine-qmd").click();
    await fixture.page.getByTestId("workspace-settings-apply").click();
    await expect(fixture.page.getByTestId("workspace-settings-apply")).toHaveCount(0);
    await expect.poll(() => persistedSettings(fixture.settingsPath)).toMatchObject({
      indexedRoots: before.indexedRoots,
      indexing: { enabled: true, mode: "lexical", backend: "qmd" },
      searchEngine: "qmd",
    });

    await fixture.electronApp.close();
    relaunched = await relaunchExoWorkspaceFixture(fixture);
    await openSettingsSection(relaunched.page, "index");
    await expect(relaunched.page.getByTestId("workspace-settings-search-engine-qmd")).toBeChecked();
    await expect(relaunched.page.getByTestId("workspace-settings-apply")).toHaveCount(0);
    expect((await persistedSettings(fixture.settingsPath)).indexedRoots).toEqual(before.indexedRoots);
  } finally {
    await relaunched?.electronApp.close().catch(() => {});
    await fixture.cleanup();
  }
});

test("QMD setup defaults empty roots once and remains idempotent after restart", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      const notesPath = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [notesPath],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        searchEngine: "filesystem",
      }, null, 2), "utf8");
    },
  });
  let relaunched: Awaited<ReturnType<typeof relaunchExoWorkspaceFixture>> | null = null;

  try {
    const noteRoot = path.join(fixture.workspaceRoot, "notes/test-notes");
    const expectedRoot = {
      id: "index-root-1",
      label: "test-notes",
      path: noteRoot,
      kind: "mixed",
      pattern: "**/*.md",
      ignore: [],
      backend: "qmd",
    };
    await openSettingsSection(fixture.page, "index");
    await fixture.page.getByTestId("workspace-settings-search-engine-qmd").click();
    await fixture.page.getByTestId("workspace-settings-apply").click();
    await expect(fixture.page.getByTestId("workspace-settings-apply")).toHaveCount(0);
    await expect.poll(() => persistedSettings(fixture.settingsPath)).toMatchObject({ indexedRoots: [expectedRoot] });

    await fixture.electronApp.close();
    relaunched = await relaunchExoWorkspaceFixture(fixture);
    await openSettingsSection(relaunched.page, "index");
    await relaunched.page.getByTestId("workspace-settings-search-engine-qmd").click();
    await expect(relaunched.page.getByTestId("workspace-settings-apply")).toHaveCount(0);
    expect((await persistedSettings(fixture.settingsPath)).indexedRoots).toEqual([expectedRoot]);
  } finally {
    await relaunched?.electronApp.close().catch(() => {});
    await fixture.cleanup();
  }
});

async function editSettingsAndClose(page: Page, section: "appearance" | "index" | "terminal", edit: (page: Page) => Promise<void>): Promise<void> {
  await page.getByTestId("workspace-menu-toggle").click();
  await page.getByTestId("workspace-menu-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  await page.getByTestId(`workspace-settings-tab-${section}`).click();
  await edit(page);
  await expect(page.getByTestId("workspace-settings-status")).toContainText("Settings saved.");
  await page.getByTestId("workspace-settings-close").click();
  await expect(page.getByTestId("workspace-settings-dialog")).not.toBeVisible();
}

async function openSettingsSection(page: Page, section: "workspace" | "index"): Promise<void> {
  await page.getByTestId("workspace-menu-toggle").click();
  await page.getByTestId("workspace-menu-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  await page.getByTestId(`workspace-settings-tab-${section}`).click();
}

async function expectPreservedSettings(settingsPath: string, seeded: Record<string, unknown>, expectedOwnedValues: Record<string, unknown>): Promise<void> {
  await expect.poll(() => persistedSettings(settingsPath)).toMatchObject(expectedOwnedValues);
  const persisted = await persistedSettings(settingsPath);
  expect(persisted.agentCommands).toEqual(seeded.agentCommands);
  expect(persisted.layout).toEqual(seeded.layout);
  expect(persisted.futureSetting).toEqual(seeded.futureSetting);
  expect(persisted.futureWorkspaceMetadata).toEqual(seeded.futureWorkspaceMetadata);
}

async function persistedSettings(settingsPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
}

function preservedLayout(focusNotePath: string) {
  return {
    version: 3,
    canvas: {
      kind: "leaf",
      id: "preserved-editor",
      content: { kind: "editor", openPaths: [focusNotePath], activePath: focusNotePath },
    },
    sidebarCollapsed: false,
    sidebarWidth: 275,
    utilityWidth: 430,
  };
}
