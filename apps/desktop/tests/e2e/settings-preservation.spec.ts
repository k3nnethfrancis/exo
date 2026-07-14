import { expect, test, type Dialog, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoWorkspaceFixture } from "../helpers";

test("every non-structural Settings round trip preserves commands, layout, opaque metadata, and command invocation", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        projectRoots: [],
        agentCommands: [{
          id: "preserved-command",
          label: "Preserved command",
          handle: "preserved",
          command: "/bin/cat",
          cwdPolicy: "workspace_root",
          promptDelivery: "terminalInputAfterLaunch",
          version: 1,
          enabled: true,
        }],
        futureSetting: { keep: "me" },
        migrationMetadata: { sourceVersion: 2, completedSteps: ["roots", "commands"] },
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
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
    await invokeConfiguredCommand(fixture.page, "preserved");

    await editSettingsAndClose(fixture.page, "index", async (page) => {
      await page.getByTestId("workspace-settings-index-update-strategy").selectOption("manual");
    });
    await expectPreservedSettings(fixture.settingsPath, seeded, { appearanceMode: "dark", indexUpdateStrategy: "manual" });
    await invokeConfiguredCommand(fixture.page, "preserved");

    await editSettingsAndClose(fixture.page, "terminal", async (page) => {
      await page.getByTestId("workspace-settings-terminal-font-size").fill("14");
    });
    await expectPreservedSettings(fixture.settingsPath, seeded, {
      appearanceMode: "dark",
      indexUpdateStrategy: "manual",
      terminalFontSize: 14,
    });
    await invokeConfiguredCommand(fixture.page, "preserved");
  } finally {
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

async function expectPreservedSettings(settingsPath: string, seeded: Record<string, unknown>, expectedOwnedValues: Record<string, unknown>): Promise<void> {
  await expect.poll(() => persistedSettings(settingsPath)).toMatchObject(expectedOwnedValues);
  const persisted = await persistedSettings(settingsPath);
  expect(persisted.agentCommands).toEqual(seeded.agentCommands);
  expect(persisted.layout).toEqual(seeded.layout);
  expect(persisted.futureSetting).toEqual(seeded.futureSetting);
  expect(persisted.migrationMetadata).toEqual(seeded.migrationMetadata);
}

async function persistedSettings(settingsPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
}

async function invokeConfiguredCommand(page: Page, handle: string): Promise<void> {
  const onDialog = (dialog: Dialog) => void dialog.accept();
  page.on("dialog", onDialog);
  try {
    await appendEditorText(page, `\n@${handle}`);
    await expect(page.getByTestId(`agent-suggestion-${handle}`)).toBeVisible();
    await page.keyboard.press("Enter");
    const composer = page.getByTestId("inline-agent-composer");
    await expect(composer).toHaveCount(1);
    await page.keyboard.type("Confirm this command still launches.");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(page.getByTestId("invocation-review-banner")).toContainText(`Running @${handle}`);
  } finally {
    page.off("dialog", onDialog);
  }
}

async function appendEditorText(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.evaluate((insert) => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) throw new Error("Unable to resolve CodeMirror view");
    const position = view.state.doc.length + insert.length;
    view.dispatch({ changes: { from: view.state.doc.length, insert }, selection: { anchor: position } });
  }, text);
}

function preservedLayout(focusNotePath: string) {
  return {
    version: 2,
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
