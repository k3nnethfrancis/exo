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
const TYPING_SAMPLE_COUNT = 2_000;
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

test("keeps sustained Markdown typing within the input-to-paint budget", async () => {
  const { electronApp, page, cleanup, workspaceRoot } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (root) => {
      const note = path.join(root, "notes/test-notes/typing.md");
      const paragraphs = Array.from({ length: 5_000 }, (_, index) =>
        `## Section ${index}\n\nParagraph ${index} with **formatting**, [[focus-note]], #latency, and ordinary prose.`,
      );
      const priorInvocation = `<exo-invocation id="123e4567-e89b-42d3-a456-426614174000" agent="claude" status="sent">\n@claude Prior request\n</exo-invocation>`;
      await writeFile(note, `# Typing latency\n\n${priorInvocation}\n\n${paragraphs.join("\n\n")}\n\n`, "utf8");
    },
  });
  const notePath = path.join(workspaceRoot, "notes/test-notes/typing.md");

  try {
    await openFromCommand(electronApp, notePath);
    await waitForEditorTitle(page, "typing");
    const content = page.locator(".editor-surface .cm-content");
    await content.click();
    await page.keyboard.press("Control+End");

    await page.evaluate(() => {
      const samples: number[] = [];
      const longTasks: number[] = [];
      document.addEventListener("beforeinput", () => {
        const startedAt = performance.now();
        requestAnimationFrame(() => samples.push(performance.now() - startedAt));
      }, { capture: true });
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
      Object.assign(window, { __exoTypingSamples: samples, __exoTypingLongTasks: longTasks, __exoTypingObserver: observer });
    });

    const text = Array.from({ length: TYPING_SAMPLE_COUNT }, (_, index) => String(index % 10)).join("");
    const startedAt = performance.now();
    await content.pressSequentially(text, { delay: 0 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const elapsed = performance.now() - startedAt;
    const result = await page.evaluate(() => {
      const scoped = window as typeof window & {
        __exoTypingSamples?: number[];
        __exoTypingLongTasks?: number[];
        __exoTypingObserver?: PerformanceObserver;
      };
      return { samples: scoped.__exoTypingSamples ?? [], longTasks: scoped.__exoTypingLongTasks ?? [] };
    });
    const summary = latencySummary(result.samples);
    console.info(`Markdown typing latency: ${JSON.stringify({
      characters: text.length,
      elapsed,
      p50: summary.p50,
      p90: summary.p90,
      p99: summary.p99,
      max: summary.max,
      longTasks: result.longTasks,
    })}`);
    expect(summary.p50).toBeLessThanOrEqual(17);
    expect(summary.p90).toBeLessThanOrEqual(34);
    expect(summary.p99).toBeLessThanOrEqual(50);
    expect(result.longTasks.filter((duration) => duration >= 50)).toEqual([]);
    expect(elapsed / text.length).toBeLessThanOrEqual(12);

    const deletionResult = await page.evaluate(async () => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) throw new Error("CodeMirror view is unavailable.");
      const deletionFixture = Array.from({ length: 24 }, (_, index) => `- rapid deletion line ${index}\n`).join("");
      view.dispatch({
        changes: { from: view.state.doc.length, insert: deletionFixture },
        selection: { anchor: view.state.doc.length + deletionFixture.length },
      });
      const samples: number[] = [];
      const startedAt = performance.now();
      for (let index = 0; index < deletionFixture.length; index += 1) {
        const operationStartedAt = performance.now();
        const head = view.state.doc.length;
        view.dispatch({
          changes: { from: head - 1, to: head },
          selection: { anchor: head - 1 },
          userEvent: "delete.backward",
        });
        samples.push(performance.now() - operationStartedAt);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { samples, elapsed: performance.now() - startedAt };
    });
    const deletionSummary = latencySummary(deletionResult.samples);
    console.info(`Markdown backspace latency: ${JSON.stringify({
      characters: deletionResult.samples.length,
      elapsed: deletionResult.elapsed,
      p50: deletionSummary.p50,
      p90: deletionSummary.p90,
      p99: deletionSummary.p99,
      max: deletionSummary.max,
    })}`);
    expect(deletionSummary.p50).toBeLessThanOrEqual(17);
    expect(deletionSummary.p90).toBeLessThanOrEqual(17);
    expect(deletionSummary.p99).toBeLessThanOrEqual(17);
    expect(deletionResult.elapsed / deletionResult.samples.length).toBeLessThanOrEqual(12);

    await content.pressSequentially("\n@claude", { delay: 0 });
    await expect(page.getByTestId("agent-suggestions")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inline-agent-composer")).toHaveCount(1);
    await page.evaluate(() => {
      const scoped = window as typeof window & { __exoTypingSamples?: number[]; __exoTypingLongTasks?: number[] };
      scoped.__exoTypingSamples?.splice(0);
      scoped.__exoTypingLongTasks?.splice(0);
    });
    const invocationText = "agent latency ".repeat(30);
    const invocationStartedAt = performance.now();
    await content.pressSequentially(invocationText, { delay: 0 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const invocationElapsed = performance.now() - invocationStartedAt;
    const invocationResult = await page.evaluate(() => {
      const scoped = window as typeof window & {
        __exoTypingSamples?: number[];
        __exoTypingLongTasks?: number[];
        __exoTypingObserver?: PerformanceObserver;
      };
      scoped.__exoTypingObserver?.disconnect();
      return { samples: scoped.__exoTypingSamples ?? [], longTasks: scoped.__exoTypingLongTasks ?? [] };
    });
    const invocationSummary = latencySummary(invocationResult.samples);
    console.info(`Invocation typing latency: ${JSON.stringify({
      characters: invocationText.length,
      elapsed: invocationElapsed,
      p50: invocationSummary.p50,
      p90: invocationSummary.p90,
      p99: invocationSummary.p99,
      max: invocationSummary.max,
      longTasks: invocationResult.longTasks,
    })}`);
    expect(invocationSummary.p90).toBeLessThanOrEqual(34);
    expect(invocationSummary.p99).toBeLessThanOrEqual(50);
    expect(invocationResult.longTasks.filter((duration) => duration >= 50)).toEqual([]);
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
