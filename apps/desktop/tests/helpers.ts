import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "fixtures/workspace/lab");

export async function launchExoFixture(options?: {
  mutable?: boolean;
  env?: Record<string, string>;
}): Promise<{ electronApp: ElectronApplication; page: Page; workspaceRoot: string; cleanup: () => Promise<void> }> {
  let workspaceRoot = fixtureRoot;
  let tempRoot: string | null = null;
  if (options?.mutable) {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-fixture-"));
    workspaceRoot = path.join(tempRoot, "lab");
    await cp(fixtureRoot, workspaceRoot, { recursive: true });
  }

  const electronApp = await electron.launch({
    args: [path.join(repoRoot, "apps/desktop/dist/main/index.js")],
    cwd: repoRoot,
    env: {
      ...process.env,
      EXO_WORKSPACE_ROOT: workspaceRoot,
      EXO_NOTE_ROOTS: path.join(workspaceRoot, "notes/shoshin-codex"),
      EXO_PROJECT_ROOTS: path.join(workspaceRoot, "projects"),
      EXO_DEFAULT_TERMINAL_CWD: workspaceRoot,
      EXO_SHELL: "/bin/echo",
      EXO_SHELL_ARGS: "shell ready",
      EXO_CLAUDE_COMMAND: "/bin/echo",
      EXO_CLAUDE_ARGS: "claude ready",
      EXO_CODEX_COMMAND: "/bin/echo",
      EXO_CODEX_ARGS: "codex ready",
      ...options?.env,
    },
  });
  const page = await electronApp.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-dock")).toBeVisible();
  await page.getByRole("button", { name: "focus-note.md" }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("Focus Note");

  return {
    electronApp,
    page,
    workspaceRoot,
    cleanup: async () => {
      await electronApp.close();
      if (tempRoot) {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  };
}
