import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoWorkspaceFixture } from "../helpers";

test("opening Settings is read-only and an appearance edit preserves opaque command and future settings", async () => {
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
          command: "printf preserved",
          cwdPolicy: "workspace_root",
          promptDelivery: "terminalInputAfterLaunch",
          version: 1,
          enabled: true,
        }],
        futureSetting: { keep: "me" },
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryLines: 100_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });

  try {
    const before = await readFile(fixture.settingsPath, "utf8");
    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).toBeVisible();
    await fixture.page.getByTestId("workspace-settings-close").click();
    await expect(fixture.page.getByTestId("workspace-settings-dialog")).not.toBeVisible();
    expect(await readFile(fixture.settingsPath, "utf8")).toBe(before);

    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await fixture.page.getByTestId("workspace-settings-tab-appearance").click();
    await fixture.page.getByTestId("workspace-settings-appearance").selectOption("dark");
    await expect(fixture.page.getByTestId("workspace-settings-status")).toContainText("Settings saved.");

    const persisted = JSON.parse(await readFile(fixture.settingsPath, "utf8"));
    expect(persisted.appearanceMode).toBe("dark");
    expect(persisted.agentCommands).toHaveLength(1);
    expect(persisted.agentCommands[0].handle).toBe("preserved");
    expect(persisted.futureSetting).toEqual({ keep: "me" });
  } finally {
    await fixture.cleanup();
  }
});
