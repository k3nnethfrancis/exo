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

  await page.getByTestId("knowledge-toggle").click();
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
  await page.getByRole("button", { name: /scratch\.ts/i }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("scratch.ts");
  await expect(page.getByTestId("properties-panel")).toContainText("Project file");

  await page.getByTestId("workspace-search").fill("");
  await page.getByRole("button", { name: "focus-note.md" }).click();
  await page.getByTestId("create-branch").click();
  await expect(page.getByTestId("branch-meta")).toContainText("Branch 1");
  await page.getByTestId("knowledge-toggle").click();
  await expect(page.getByTestId("branches-panel")).toContainText("1 · Focus Note");
  await expect(page.getByTestId("branch-tree")).toContainText("1.md");

  await cleanup();
});

test("expands and collapses the project roots drawer", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/sidebar__drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/sidebar__drawer--expanded/);
  await expect(page.getByTestId("project-roots-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "exo-demo" })).toBeVisible();
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/sidebar__drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);

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

test("surfaces terminal sessions as agents and can steer them", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  await page.getByTestId("knowledge-toggle").click();
  await expect(page.getByTestId("agents-panel")).toBeVisible();
  await expect(page.getByTestId("agents-panel")).toContainText("Terminal");
  await page.getByTestId("agent-message-input").fill("Check in with the parent before editing.");
  await page.getByTestId("agent-message-send").click();
  await expect(page.getByTestId("agent-message-log")).toContainText("Check in with the parent before editing.");
  await expect(page.getByTestId("terminal-surface")).toContainText("Check in with the parent before editing.");

  await cleanup();
});

test("can manually kick off a run and spawn a child agent", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("knowledge-toggle").click();
  await page.getByTestId("kickoff-run").click();
  await expect(page.getByTestId("agent-run-term-1")).toHaveValue("run-1");
  await page.getByTestId("spawn-claude-agent").click();
  await expect(page.getByTestId("agents-panel")).toContainText("Claude");
  await expect(page.getByTestId("agent-run-term-2")).toHaveValue("run-1");

  await cleanup();
});
