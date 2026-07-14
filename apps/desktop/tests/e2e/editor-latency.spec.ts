import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";
import { latencySummary } from "../terminalQuality";

const P50_BUDGET_MS = 99;
const P90_BUDGET_MS = 150;
const P99_BUDGET_MS = 300;
const SAMPLE_COUNT = 100;
const FOLDER_SAMPLE_COUNT = 20;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test.setTimeout(120_000);

test("keeps direct Explorer note navigation within the editor latency budget", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    const samples = await measureAlternatingNavigation(page, async (target) => {
      await page.getByRole("button", { name: target }).first().click();
    });
    expectLatencyBudget("Explorer", samples);
  } finally {
    await cleanup();
  }
});

test("keeps CLI note navigation within the editor latency budget", async () => {
  const { page, cleanup, runtimeRoot, workspaceRoot } = await launchExoWorkspaceFixture();

  try {
    const paths = {
      "focus-note": `${workspaceRoot}/notes/test-notes/focus-note.md`,
      "related-note": `${workspaceRoot}/notes/test-notes/related-note.md`,
    };
    const samples = await measureAlternatingNavigation(page, async (target) => {
      const result = runExoCli(["open", paths[target]], {
        ...stringEnv(process.env),
        COREPACK_ENABLE_PROJECT_SPEC: "0",
        EXO_RUNTIME_ROOT: runtimeRoot,
        EXO_WORKSPACE_ROOT: workspaceRoot,
        EXO_NOTE_ROOTS: path.join(workspaceRoot, "notes/test-notes"),
      });
      expect(result.status, result.stderr || result.error?.message).toBe(0);
    });
    expectLatencyBudget("CLI open", samples);
  } finally {
    await cleanup();
  }
});

test("keeps filename-search note navigation within the editor latency budget", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    const samples: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const target = index % 2 === 0 ? "related-note" : "focus-note";
      const search = page.getByTestId("workspace-search-input");
      await search.fill(target);
      const result = page.locator(`.sidebar-search-result[title$="${target}.md"]`).first();
      await expect(result).toBeVisible();
      const startedAt = performance.now();
      await result.click();
      await waitForEditorTitle(page, target);
      samples.push(performance.now() - startedAt);
    }
    expectLatencyBudget("filename search", samples);
  } finally {
    await cleanup();
  }
});

test("keeps live filename results responsive in a large workspace", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: (root) => createCorpus(root, 400),
  });

  try {
    const samples: number[] = [];
    const search = page.getByTestId("workspace-search-input");
    for (let index = 0; index < FOLDER_SAMPLE_COUNT; index += 1) {
      const query = `note-${String(index).padStart(3, "0")}`;
      const startedAt = performance.now();
      await search.fill(query);
      await expect(page.locator(`.sidebar-search-result[title$="${query}.md"]`).first()).toBeVisible();
      samples.push(performance.now() - startedAt);
    }
    expectLatencyBudget("large-workspace filename results", samples);
  } finally {
    await cleanup();
  }
});

test("keeps breadcrumb folder navigation within the editor latency budget", async () => {
  const { electronApp, page, cleanup, workspaceRoot } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (root) => {
      const folder = path.join(root, "notes/test-notes/nested");
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "child.md"), "# Child\n\nA nested fixture note.\n", "utf8");
      await writeFile(path.join(folder, "index.md"), "# Nested\n\nFolder context.\n", "utf8");
      await createCorpus(root, 400);
    },
  });
  const childPath = path.join(workspaceRoot, "notes/test-notes/nested/child.md");

  try {
    await openFromCommand(electronApp, childPath);
    await waitForEditorTitle(page, "child");
    await page.getByRole("button", { name: "nested", exact: true }).click();
    await waitForFolderOverview(page, "Nested");
    await expect(page.getByTestId("folder-overview")).not.toContainText("Create an index");

    const samples: number[] = [];
    const loadedSamples: number[] = [];
    for (let index = 0; index < FOLDER_SAMPLE_COUNT; index += 1) {
      await page.getByTestId("folder-overview").getByRole("button", { name: "child", exact: true }).click();
      await waitForEditorTitle(page, "child");
      const startedAt = performance.now();
      await page.getByRole("button", { name: "nested", exact: true }).click();
      await waitForFolderOverview(page, "Nested");
      samples.push(performance.now() - startedAt);
      await expect(page.getByTestId("folder-overview")).toHaveAttribute("data-folder-loaded", "true");
      loadedSamples.push(performance.now() - startedAt);
    }
    expectLatencyBudget("breadcrumb folder shell", samples);
    expectLatencyBudget("breadcrumb folder contents", loadedSamples);
  } finally {
    await cleanup();
  }
});

test("keeps backlink note navigation within the editor latency budget", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByRole("button", { name: "focus-note" }).first().click();
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-connections").click();
    const backlinks = page.getByTestId("connections-panel-outline");
    await expect(backlinks.getByRole("button", { name: "Related Note" }).first()).toBeVisible();

    const samples: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      await backlinks.getByRole("button", { name: "Related Note" }).first().click();
      await waitForEditorTitle(page, "related-note");
      samples.push(performance.now() - startedAt);
      await page.getByRole("button", { name: "focus-note" }).first().click();
      await waitForEditorTitle(page, "focus-note");
    }
    expectLatencyBudget("backlink", samples);
  } finally {
    await cleanup();
  }
});

async function measureAlternatingNavigation(
  page: Page,
  navigate: (target: "focus-note" | "related-note") => Promise<void>,
): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const target = index % 2 === 0 ? "related-note" : "focus-note";
    const startedAt = performance.now();
    await navigate(target);
    await waitForEditorTitle(page, target);
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

async function waitForFolderOverview(page: Page, expectedTitle: string): Promise<void> {
  await expect(page.getByTestId("folder-overview").getByRole("heading", { name: new RegExp(`^${escapeRegExp(expectedTitle)}$`, "i") })).toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createCorpus(root: string, count: number): Promise<void> {
  const corpus = path.join(root, "notes/test-notes/corpus");
  await mkdir(corpus, { recursive: true });
  await Promise.all(Array.from({ length: count }, (_, index) =>
    writeFile(
      path.join(corpus, `note-${String(index).padStart(3, "0")}.md`),
      `# Note ${index}\n\n[[focus-note]] corpus content ${index}.\n`,
      "utf8",
    ),
  ));
}

function expectLatencyBudget(route: string, samples: number[]): void {
  const summary = latencySummary(samples);
  const detail = `${route} editor navigation latency: ${JSON.stringify(summary)}`;
  console.info(`${route} editor navigation latency: ${JSON.stringify({
    samples: summary.samples.length,
    p50: summary.p50,
    p90: summary.p90,
    p99: summary.p99,
    max: summary.max,
  })}`);
  expect(summary.p50, detail).toBeLessThanOrEqual(P50_BUDGET_MS);
  expect(summary.p90, detail).toBeLessThanOrEqual(P90_BUDGET_MS);
  expect(summary.p99, detail).toBeLessThanOrEqual(P99_BUDGET_MS);
}

async function waitForEditorTitle(page: Page, expectedTitle: string): Promise<void> {
  await page.waitForFunction(
    (expected) => document.querySelector("[data-testid='editor-title']")?.textContent === expected,
    expectedTitle,
    { polling: 5 },
  );
}

async function openFromCommand(
  electronApp: Awaited<ReturnType<typeof launchExoWorkspaceFixture>>["electronApp"],
  filePath: string,
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, targetPath) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("command:open-file", targetPath);
  }, filePath);
}

function runExoCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(path.join(repoRoot, "bin/exo"), args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
