import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

test("boots the shell, opens notes, and manages terminal tabs", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("editor-title")).toHaveText("Focus Note");
  await expect(page.getByTestId("terminal-tab-shell")).toBeVisible();

  await page.getByTestId("launch-claude").click();
  await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();

  await page.getByTestId("launch-codex").click();
  await expect(page.getByTestId("terminal-tab-codex")).toBeVisible();

  await page.getByTestId("terminal-tab-shell").dblclick();
  await expect(page.getByTestId("terminal-dock")).toBeVisible();

  await page.getByTestId("inspector-toggle").click();
  await expect(page.locator('[data-testid="tags-panel"] .tag-pill').first()).toBeVisible();
  await page.locator('[data-testid="tags-panel"] .tag-pill').first().click();
  await expect(page.getByTestId("tag-results")).toBeVisible();

  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Related Note");

  await cleanup();
});

test("opens project files and creates note branches", async () => {
  const { page, cleanup } = await launchExoFixture({ mutable: true });

  await page.getByTestId("project-roots-toggle").click();
  await page.getByRole("button", { name: "exo-demo" }).click();
  await page.getByRole("button", { name: "src" }).click({ button: "right" });
  await expect(page.getByText("New File")).toBeVisible();
  await page.getByText("New File").click();
  await page.getByTestId("workspace-dialog-input").fill("scratch.ts");
  await page.getByTestId("workspace-dialog-confirm").click();

  await page.getByTestId("workspace-search").fill("scratch.ts");
  await page.getByTestId("search-results").getByRole("button", { name: /scratch\.ts/i }).first().click();
  await expect(page.getByTestId("editor-title")).toHaveText("scratch.ts");
  await expect(page.getByTestId("properties-panel")).toContainText("Project file");

  await page.getByTestId("workspace-search").fill("");
  await page.getByRole("button", { name: "focus-note.md" }).click();
  await page.getByTestId("create-branch").click();
  await expect(page.getByTestId("branch-selector")).toHaveValue(/-looms\/1\.md$/);
  await expect(page.getByTestId("branch-selector").locator("option")).toHaveCount(2);

  await cleanup();
});

test("expands and collapses the project roots drawer", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--expanded/);
  await expect(page.getByTestId("project-roots-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "exo-demo" })).toBeVisible();
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);

  await cleanup();
});

test("matches system appearance by default and supports light mode override", async () => {
  const { page, cleanup } = await launchExoFixture();
  const systemTheme = await page.evaluate(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  await expect(page.locator("html")).toHaveAttribute("data-theme", systemTheme);
  await page.getByTestId("appearance-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTestId("appearance-system").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", systemTheme);

  await cleanup();
});

test("accepts terminal keyboard input", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  await page.getByTestId("terminal-surface").click();
  await page.keyboard.type("hello exo");
  await expect(page.getByTestId("terminal-surface")).toContainText("hello exo");

  await cleanup();
});

test("collapses the dock when the last terminal closes", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("close-terminal-shell").click();
  await expect(page.getByTestId("terminal-dock")).toHaveClass(/terminal-dock--collapsed/);
  await expect(page.getByText("No terminals yet.")).toHaveCount(0);
  await expect(page.getByTestId("launch-claude")).toBeVisible();

  await cleanup();
});

test("lets you close editor tabs", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Related Note");
  await page.getByLabel("Close Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Focus Note");

  await cleanup();
});

test("surfaces subagent terminals for the selected main terminal", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("subagents-toggle").click();
  await expect(page.getByTestId("subagents-panel")).toContainText("No observed subagent terminals yet");
  await page.getByTestId("kickoff-run").click();
  await page.getByTestId("spawn-claude-agent").click();
  await expect(page.getByTestId("subagents-panel")).toContainText("Claude");
  await expect(page.getByTestId("subagent-card-term-2")).toBeVisible();

  await cleanup();
});
