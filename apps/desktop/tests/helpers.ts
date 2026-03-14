import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "fixtures/workspace/lab");

export async function launchExoFixture(): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const electronApp = await electron.launch({
    args: [path.join(repoRoot, "apps/desktop/dist/main/index.js")],
    cwd: repoRoot,
    env: {
      ...process.env,
      EXO_WORKSPACE_ROOT: fixtureRoot,
      EXO_NOTE_ROOTS: path.join(fixtureRoot, "notes/shoshin-codex"),
      EXO_PROJECT_ROOTS: path.join(fixtureRoot, "projects"),
      EXO_DEFAULT_TERMINAL_CWD: fixtureRoot,
      EXO_SHELL: "/bin/echo",
      EXO_SHELL_ARGS: "shell ready",
      EXO_CLAUDE_COMMAND: "/bin/echo",
      EXO_CLAUDE_ARGS: "claude ready",
      EXO_CODEX_COMMAND: "/bin/echo",
      EXO_CODEX_ARGS: "codex ready",
    },
  });
  const page = await electronApp.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-dock")).toBeVisible();
  await page.getByRole("button", { name: "focus-note.md" }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("Focus Note");

  return { electronApp, page };
}
