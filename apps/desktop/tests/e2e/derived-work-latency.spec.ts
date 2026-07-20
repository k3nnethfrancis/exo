import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { launchExoTerminalFixture } from "../helpers";
import { latencySummary } from "../terminalQuality";

const CORPUS_SIZE = 1_200;
const NAVIGATION_SAMPLES = 20;
const SEARCH_SAMPLES = 10;
const TYPING_CHARACTERS = 400;

interface ConcurrentSurfaceResults {
  graph: { elapsed: number; available: boolean };
  search: { samples: number[]; sources: string[]; warnings: string[][] };
  status: { elapsed: number; warnings: string[] };
  terminal: { elapsed: number; available: boolean };
}

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

    const latencyPath = path.join(fixture.workspaceRoot, "notes/test-notes/latency.md");
    await fixture.page.evaluate(({ filePath, searchSamples }) => {
      const scoped = window as typeof window & {
        __exoConcurrentSurfaces?: Promise<ConcurrentSurfaceResults>;
      };
      const measure = async <Value>(run: () => Promise<Value>): Promise<{ elapsed: number; value: Value }> => {
        const startedAt = performance.now();
        const value = await run();
        return { elapsed: performance.now() - startedAt, value };
      };
      scoped.__exoConcurrentSurfaces = (async () => {
        // Start cold graph work before Search. These surfaces must remain
        // independently usable even when both need derived state.
        const graphPromise = measure(() => window.exo.notes.getGraphContext(filePath));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const searchPromise = (async () => {
          const samples: number[] = [];
          const sources: string[] = [];
          const warnings: string[][] = [];
          for (let index = 0; index < searchSamples; index += 1) {
            const sample = await measure(() => window.exo.workspace.searchIndex("latency", { limit: 5 }));
            samples.push(sample.elapsed);
            sources.push(sample.value.source);
            warnings.push(sample.value.warnings);
          }
          return { samples, sources, warnings };
        })();
        const statusPromise = measure(() => window.exo.workspace.getIndexStatus());
        const terminalPromise = measure(async () => {
          const terminal = (await window.exo.terminals.list())[0];
          if (!terminal) return false;
          await window.exo.terminals.write(terminal.id, "derived-work-terminal-alive\n");
          return true;
        });
        const [graph, search, status, terminal] = await Promise.all([
          graphPromise,
          searchPromise,
          statusPromise,
          terminalPromise,
        ]);
        return {
          graph: { elapsed: graph.elapsed, available: graph.value !== null },
          search,
          status: { elapsed: status.elapsed, warnings: status.value.warnings },
          terminal: { elapsed: terminal.elapsed, available: terminal.value },
        };
      })();
    }, { filePath: latencyPath, searchSamples: SEARCH_SAMPLES });

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
    const concurrentSurfaces = await fixture.page.evaluate(async () => {
      const scoped = window as typeof window & {
        __exoConcurrentSurfaces?: Promise<ConcurrentSurfaceResults>;
      };
      return scoped.__exoConcurrentSurfaces;
    });
    const finalProbe = await readLatencyProbe(fixture.page, true);
    const warmedSearch = latencySummary(concurrentSurfaces?.search.samples.slice(1) ?? []);

    console.info(`Concurrent derived-work latency: ${JSON.stringify({
      corpus: CORPUS_SIZE,
      typing: { elapsed: typingElapsed, p50: typing.p50, p90: typing.p90, p99: typing.p99, max: typing.max },
      navigation: { p50: navigation.p50, p90: navigation.p90, p99: navigation.p99, max: navigation.max },
      surfaces: {
        ...concurrentSurfaces,
        search: {
          cold: concurrentSurfaces?.search.samples[0],
          warmed: warmedSearch,
          sources: concurrentSurfaces?.search.sources,
        },
      },
      longTasks: finalProbe.longTasks,
    })}`);

    expect(indexStatus).toMatchObject({ mode: "hybrid" });
    expect(concurrentSurfaces).toMatchObject({
      graph: { available: true },
      terminal: { available: true },
    });
    expect(concurrentSurfaces?.search.sources).toEqual(Array(SEARCH_SAMPLES).fill("filesystem"));
    for (const warnings of concurrentSurfaces?.search.warnings ?? []) {
      expect(warnings).toContain("Index maintenance is running; showing Simple search results until it completes.");
    }
    expect(concurrentSurfaces?.status.warnings).toContain("Index maintenance is running; showing the last available index status until it finishes.");
    expect(concurrentSurfaces?.search.samples[0]).toBeLessThanOrEqual(300);
    expect(warmedSearch.p50).toBeLessThanOrEqual(99);
    expect(warmedSearch.p90).toBeLessThanOrEqual(150);
    expect(warmedSearch.p99).toBeLessThanOrEqual(300);
    expect(concurrentSurfaces?.terminal.elapsed).toBeLessThanOrEqual(300);
    expect(typing.p90).toBeLessThanOrEqual(34);
    expect(typing.p99).toBeLessThanOrEqual(50);
    expect(typingElapsed / typingText.length).toBeLessThanOrEqual(12);
    expect(typingResult.longTasks.filter((duration) => duration >= 50)).toEqual([]);
    expect(navigation.p50).toBeLessThanOrEqual(99);
    expect(navigation.p90).toBeLessThanOrEqual(150);
    expect(navigation.p99).toBeLessThanOrEqual(300);
    expect(
      finalProbe.longTasks.filter((duration) => duration >= 50),
      `renderer long tasks across concurrent typing/navigation/Search/graph/Terminal work: ${JSON.stringify({
        graphMs: concurrentSurfaces?.graph.elapsed,
        searchMs: concurrentSurfaces?.search.samples,
        terminalMs: concurrentSurfaces?.terminal.elapsed,
        longTasks: finalProbe.longTasks,
      })}`,
    ).toEqual([]);
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
