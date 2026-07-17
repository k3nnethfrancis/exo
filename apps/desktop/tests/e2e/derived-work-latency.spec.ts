import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { launchExoTerminalFixture } from "../helpers";
import { latencySummary } from "../terminalQuality";

const CORPUS_SIZE = 1_200;
const NAVIGATION_SAMPLES = 20;
const TYPING_CHARACTERS = 400;

test.setTimeout(120_000);

test("keeps editor work responsive while hybrid QMD refresh runs out of process", async () => {
  const fixture = await launchExoTerminalFixture({
    mutable: true,
    initialNoteLabel: "latency",
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(path.join(noteRoot, "latency.md"), "# Latency\n\nTyping target.\n", "utf8");
      await createIndexedCorpus(path.join(noteRoot, "corpus"));
    },
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [noteRoot],
        indexedRoots: [{
          id: "index-notes",
          label: "test-notes",
          path: noteRoot,
          kind: "notes",
          pattern: "**/*.md",
          ignore: [],
          backend: "qmd",
        }],
        indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: true,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });

  try {
    await expect(fixture.page.getByTestId("terminal-dock").first()).toBeVisible();
    const content = fixture.page.locator(".editor-surface .cm-content");
    await content.click();
    await fixture.page.keyboard.press("Control+End");
    await installLatencyProbe(fixture.page);

    await fixture.page.evaluate(() => {
      const scoped = window as typeof window & {
        __exoConcurrentIndexUpdate?: Promise<unknown>;
        __exoConcurrentIndexPending?: boolean;
      };
      scoped.__exoConcurrentIndexPending = true;
      scoped.__exoConcurrentIndexUpdate = window.exo.workspace.updateIndex().finally(() => {
        scoped.__exoConcurrentIndexPending = false;
      });
    });
    expect(await fixture.page.evaluate(() => (window as typeof window & { __exoConcurrentIndexPending?: boolean }).__exoConcurrentIndexPending)).toBe(true);

    const typingText = "0123456789".repeat(TYPING_CHARACTERS / 10);
    const typingStartedAt = performance.now();
    await content.pressSequentially(typingText, { delay: 0 });
    await nextPaint(fixture.page);
    const typingElapsed = performance.now() - typingStartedAt;
    const typingResult = await readLatencyProbe(fixture.page, false);
    const typing = latencySummary(typingResult.samples);

    const navigationSamples: number[] = [];
    for (let index = 0; index < NAVIGATION_SAMPLES; index += 1) {
      const target = index % 2 === 0 ? "focus-note" : "latency";
      const startedAt = performance.now();
      await fixture.page.getByRole("button", { name: target }).first().click();
      await waitForEditorTitle(fixture.page, target);
      navigationSamples.push(performance.now() - startedAt);
    }
    const navigation = latencySummary(navigationSamples);

    const indexStatus = await fixture.page.evaluate(async () => {
      const scoped = window as typeof window & { __exoConcurrentIndexUpdate?: Promise<unknown> };
      return scoped.__exoConcurrentIndexUpdate;
    });
    const finalProbe = await readLatencyProbe(fixture.page, true);

    console.info(`Concurrent derived-work latency: ${JSON.stringify({
      corpus: CORPUS_SIZE,
      typing: { elapsed: typingElapsed, p50: typing.p50, p90: typing.p90, p99: typing.p99, max: typing.max },
      navigation: { p50: navigation.p50, p90: navigation.p90, p99: navigation.p99, max: navigation.max },
      longTasks: finalProbe.longTasks,
    })}`);

    expect(indexStatus).toMatchObject({ mode: "hybrid" });
    expect(typing.p90).toBeLessThanOrEqual(34);
    expect(typing.p99).toBeLessThanOrEqual(50);
    expect(typingElapsed / typingText.length).toBeLessThanOrEqual(12);
    expect(typingResult.longTasks.filter((duration) => duration >= 50)).toEqual([]);
    expect(navigation.p50).toBeLessThanOrEqual(99);
    expect(navigation.p90).toBeLessThanOrEqual(150);
    expect(navigation.p99).toBeLessThanOrEqual(300);
  } finally {
    await fixture.cleanup();
  }
});

async function createIndexedCorpus(corpusRoot: string): Promise<void> {
  await mkdir(corpusRoot, { recursive: true });
  const paragraph = "A realistic indexed paragraph with [[focus-note]], #latency, metadata, and enough prose to exercise QMD document refresh. ".repeat(32);
  await Promise.all(Array.from({ length: CORPUS_SIZE }, (_, index) =>
    writeFile(
      path.join(corpusRoot, `note-${String(index).padStart(4, "0")}.md`),
      `# Indexed note ${index}\n\n${paragraph}\n`,
      "utf8",
    ),
  ));
}

async function installLatencyProbe(page: Page): Promise<void> {
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
    Object.assign(window, {
      __exoConcurrentTypingSamples: samples,
      __exoConcurrentLongTasks: longTasks,
      __exoConcurrentObserver: observer,
    });
  });
}

async function readLatencyProbe(page: Page, disconnect: boolean): Promise<{ samples: number[]; longTasks: number[] }> {
  return page.evaluate((shouldDisconnect) => {
    const scoped = window as typeof window & {
      __exoConcurrentTypingSamples?: number[];
      __exoConcurrentLongTasks?: number[];
      __exoConcurrentObserver?: PerformanceObserver;
    };
    if (shouldDisconnect) scoped.__exoConcurrentObserver?.disconnect();
    return {
      samples: scoped.__exoConcurrentTypingSamples ?? [],
      longTasks: scoped.__exoConcurrentLongTasks ?? [],
    };
  }, disconnect);
}

async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function waitForEditorTitle(page: Page, expectedTitle: string): Promise<void> {
  await page.waitForFunction(
    (expected) => document.querySelector("[data-testid='editor-title']")?.textContent === expected,
    expectedTitle,
    { polling: 5 },
  );
}
