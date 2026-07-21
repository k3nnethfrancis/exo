import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type ElectronApplication, type Locator, type Page } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";
import {
  copyPrivateVaultForGraphGate,
  fingerprintPrivateVault,
  privateVaultFingerprintsMatch,
  requirePrivateGraphGateSource,
  type PrivateVaultCopyAggregate,
} from "../privateVaultGate";

const RUN_PRIVATE_GATE = process.env.EXO_PRIVATE_GRAPH_GATE === "copy-only"
  && Boolean(process.env.EXO_PRIVATE_GRAPH_VAULT_ROOT);
const PROFILE_ID = "generic-markdown";

interface GraphDebugSnapshot {
  pendingWork: number;
  pendingFrame: boolean;
  moving: boolean;
  sourceSnapshotId: string | null;
  selected: number;
  pathTarget: number;
  pathNodeCount: number;
  activeEditorPath: string | null;
  inspectedFilePath: string | null;
  renderedFrames: number;
  rendererKind?: "canvas2d" | "webgpu" | null;
}

interface InteractionTarget {
  source: { index: number; x: number; y: number };
  target: { index: number; x: number; y: number; filePath: string };
}

interface GateReport {
  schemaVersion: 1;
  result: "pass";
  runtime: "source" | "packaged";
  corpus: PrivateVaultCopyAggregate;
  graph: { nodes: number; edges: number; renderers: string[] };
  timingsMs: Record<string, number>;
  repetitions: { graphOpenClose: number };
  sourceUnchanged: true;
}

test.skip(!RUN_PRIVATE_GATE, "Opt-in copy-only private graph gate.");
test.setTimeout(360_000);

test("verifies graph behavior on a guarded private-vault copy", async () => {
  const sourceRoot = await requirePrivateGraphGateSource(process.env);
  const before = await fingerprintPrivateVault(sourceRoot);
  let fixture: Awaited<ReturnType<typeof launchExoWorkspaceFixture>> | null = null;
  let copiedRoot = "";
  let corpus: PrivateVaultCopyAggregate | null = null;
  let phase = "copy";
  let journeyFailure = false;
  let report: GateReport | null = null;

  try {
    fixture = await launchExoWorkspaceFixture({
      mutable: true,
      initialNoteLabel: null,
      workspaceRootEnv: false,
      stripEnvironment: [
        "EXO_PRIVATE_GRAPH_GATE",
        "EXO_PRIVATE_GRAPH_REPORT_PATH",
        "EXO_PRIVATE_GRAPH_VAULT_ROOT",
      ],
      prepareWorkspace: async (workspaceRoot) => {
        copiedRoot = path.join(workspaceRoot, "notes", "private-graph-copy");
        await mkdir(path.dirname(copiedRoot), { recursive: true });
        corpus = await copyPrivateVaultForGraphGate(sourceRoot, copiedRoot);
      },
      prepareSettings: async ({ settingsPath, workspaceRoot }) => {
        ensure(Boolean(copiedRoot), "COPY_NOT_READY");
        const settings = {
          workspaceRoot,
          defaultTerminalCwd: workspaceRoot,
          noteRoots: [copiedRoot],
          indexedRoots: [],
          indexing: { enabled: false, mode: "off", backend: "qmd" },
          searchEngine: "filesystem",
        };
        await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
        await writeFile(path.join(path.dirname(settingsPath), "workspace-registry.json"), JSON.stringify({
          activeWorkspaceId: "private-graph-copy",
          workspaces: [{
            id: "private-graph-copy",
            label: "private-graph-copy",
            notesFolder: copiedRoot,
            settings,
            updatedAt: "2026-07-20T00:00:00.000Z",
          }],
        }, null, 2), "utf8");
      },
    });

    phase = "topology";
    const graphSeed = await connectedGraphSeed(fixture.page);
    ensure(graphSeed.nodeCount > 0 && graphSeed.edgeCount > 0 && Boolean(graphSeed.filePath), "GRAPH_HAS_NO_CONNECTED_NOTE");

    phase = "open-note";
    await openNote(fixture.electronApp, graphSeed.filePath!);
    await waitForEditor(fixture.page);

    const timings: Record<string, number> = {};
    phase = "open-graph";
    timings.graphOpen = await measured(async () => openGraphFromEditor(fixture!.page));
    let canvas = graphCanvas(fixture.page);
    await waitForGraphIdle(canvas);
    if (await hasCanvasFallbackHook(canvas)) await waitForRendererReady(canvas);
    await assertGraphIdentity(canvas, graphSeed.filePath!);

    const initialSnapshot = await graphSnapshot(canvas);
    if (await hasCanvasFallbackHook(canvas)) ensure(initialSnapshot.rendererKind === "webgpu", "WEBGPU_NOT_ACTIVE");
    const renderers = new Set<string>([initialSnapshot.rendererKind ?? "canvas2d"]);

    phase = "connections-identity";
    timings.connectionsIdentity = await measured(async () => {
      await openConnectionsGraph(fixture!.page);
      await assertGraphIdentity(canvas, graphSeed.filePath!);
    });

    phase = "pan-zoom";
    timings.panZoom = await measured(async () => panAndZoom(fixture!.page, canvas));
    phase = "interaction-target";
    const interaction = await interactionTarget(canvas);
    phase = "select-path";
    timings.selectPath = await measured(async () => selectAndRoute(canvas, interaction, (next) => { phase = next; }));
    phase = "note-open";
    timings.noteOpen = await measured(async () => {
      await canvas.dblclick({ position: { x: interaction.target.x, y: interaction.target.y } });
      await waitForGraphIdentity(canvas, interaction.target.filePath);
    });

    phase = "canvas-fallback";
    if (await hasCanvasFallbackHook(canvas)) {
      await forceCanvasFallback(canvas);
      await waitForRenderer(canvas, "canvas2d");
      renderers.add("canvas2d");
      await waitForGraphIdentity(canvas, interaction.target.filePath);
      timings.canvasFallbackPanZoom = await measured(async () => panAndZoom(fixture!.page, canvas));
      phase = "canvas-interaction-target";
      const canvasInteraction = await interactionTarget(canvas);
      phase = "canvas-select-path";
      timings.canvasFallbackSelectPath = await measured(async () => selectAndRoute(
        canvas,
        canvasInteraction,
        (next) => { phase = `canvas-${next}`; },
      ));
    }

    phase = "repeat-open-close";
    timings.repeatedOpenClose = await measured(async () => {
      for (let repetition = 0; repetition < 3; repetition += 1) {
        await closeGraph(fixture!.page);
        await openGraphFromEditor(fixture!.page);
        canvas = graphCanvas(fixture!.page);
        await waitForGraphIdle(canvas);
      }
    });

    phase = "live-rebuild";
    const beforeMutation = await graphSnapshot(canvas);
    const targetRelative = path.relative(copiedRoot, interaction.target.filePath).replaceAll(path.sep, "/").replace(/\.md$/iu, "");
    const mutationRoot = path.join(copiedRoot, "exo-private-graph-gate-fixture");
    await mkdir(mutationRoot, { recursive: true });
    await writeFile(
      path.join(mutationRoot, "live-rebuild.md"),
      `# Private graph gate mutation\n\n[[${targetRelative}]]\n`,
      "utf8",
    );
    timings.liveRebuild = await measured(async () => {
      await waitForGraphRebuild(canvas, beforeMutation.sourceSnapshotId, graphSeed.nodeCount);
    });

    phase = "report";
    ensure(corpus !== null, "COPY_AGGREGATE_MISSING");
    const finalSnapshot = await graphSnapshot(canvas);
    if (finalSnapshot.rendererKind) renderers.add(finalSnapshot.rendererKind);
    report = {
      schemaVersion: 1,
      result: "pass",
      runtime: process.env.EXO_PACKAGED_APP_PATH ? "packaged" : "source",
      corpus,
      graph: { nodes: graphSeed.nodeCount, edges: graphSeed.edgeCount, renderers: [...renderers].sort() },
      timingsMs: roundedTimings(timings),
      repetitions: { graphOpenClose: 3 },
      sourceUnchanged: true,
    };
  } catch (error) {
    if (error instanceof Error && /^[A-Z][A-Z_]+$/u.test(error.message)) {
      phase = error.message.toLowerCase().replaceAll("_", "-");
    }
    journeyFailure = true;
  } finally {
    await fixture?.cleanup().catch(() => {
      journeyFailure = true;
    });
    const after = await fingerprintPrivateVault(sourceRoot).catch(() => null);
    if (!after || !privateVaultFingerprintsMatch(before, after)) {
      throw new Error("Private graph gate failed closed: configured source changed.");
    }
  }

  if (journeyFailure) throw new Error(`Private graph gate failed during ${phase}.`);
  ensure(report !== null, "REPORT_MISSING");
  const reportPath = process.env.EXO_PRIVATE_GRAPH_REPORT_PATH;
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.info(`Private graph gate aggregate: ${JSON.stringify(report)}`);
});

async function connectedGraphSeed(page: Page): Promise<{
  nodeCount: number;
  edgeCount: number;
  filePath: string | null;
}> {
  return page.evaluate(async (profileId) => {
    const topology = await window.exo.notes.getGraphTopology(profileId);
    const ordered = Array.from({ length: topology.nodeCount }, (_, index) => index)
      .filter((index) => (topology.nodes.degrees[index] ?? 0) > 0)
      .sort((left, right) => (topology.nodes.degrees[right] ?? 0) - (topology.nodes.degrees[left] ?? 0));
    for (let offset = 0; offset < ordered.length; offset += 64) {
      const result = await window.exo.notes.getGraphConceptSummaries(
        ordered.slice(offset, offset + 64),
        topology.sourceSnapshotId,
        profileId,
      );
      const resolved = result.summaries.find((summary) => Boolean(summary.filePath));
      if (resolved?.filePath) {
        return { nodeCount: topology.nodeCount, edgeCount: topology.edgeCount, filePath: resolved.filePath };
      }
    }
    return { nodeCount: topology.nodeCount, edgeCount: topology.edgeCount, filePath: null };
  }, PROFILE_ID);
}

async function openNote(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, targetPath) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("command:open-file", targetPath);
  }, filePath);
}

async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(document.querySelector("[data-testid='editor-title']")), null, { timeout: 30_000 });
}

async function openGraphFromEditor(page: Page): Promise<void> {
  const editor = page.getByTestId("editor-panel");
  await editor.hover();
  await page.getByTestId("open-note-graph").click();
  await page.waitForFunction(() => Boolean(document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']")), null, { timeout: 60_000 });
}

function graphCanvas(page: Page): Locator {
  return page.getByTestId("graph-pane").locator('canvas[aria-label="Interactive knowledge graph"]');
}

async function graphSnapshot(canvas: Locator): Promise<GraphDebugSnapshot> {
  const snapshot = await canvas.evaluate((element) => {
    return (element as HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }).__exoGraphSnapshot?.() ?? null;
  });
  ensure(Boolean(snapshot), "GRAPH_DEBUG_SNAPSHOT_MISSING");
  return snapshot!;
}

async function waitForGraphIdle(canvas: Locator): Promise<void> {
  await canvas.page().waitForFunction(() => {
    const element = document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    const snapshot = element?.__exoGraphSnapshot?.();
    return Boolean(snapshot && snapshot.pendingWork === 0 && !snapshot.pendingFrame && !snapshot.moving);
  }, null, { timeout: 120_000 });
}

async function assertGraphIdentity(canvas: Locator, filePath: string): Promise<void> {
  const snapshot = await graphSnapshot(canvas);
  ensure(snapshot.activeEditorPath === filePath && snapshot.inspectedFilePath === filePath, "GRAPH_IDENTITY_MISMATCH");
}

async function waitForGraphIdentity(canvas: Locator, filePath: string): Promise<void> {
  await canvas.page().waitForFunction((expected) => {
    const element = document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    const snapshot = element?.__exoGraphSnapshot?.();
    return snapshot?.activeEditorPath === expected && snapshot.inspectedFilePath === expected;
  }, filePath, { timeout: 30_000 });
}

async function openConnectionsGraph(page: Page): Promise<void> {
  const utility = page.getByTestId("utility-pane");
  if (await utility.count() === 0 || !await utility.isVisible()) await page.getByTestId("utility-pane-toggle").click();
  await page.getByTestId("utility-pane-connections").click();
  await page.getByTestId("connections-tab-graph").click();
  await page.waitForFunction(() => Boolean(document.querySelector("[data-testid='graph-neighborhood-panel']")), null, { timeout: 30_000 });
  const openFull = page.getByTestId("connections-panel-graph").getByRole("button", { name: "Open full graph" });
  if (await openFull.count()) await openFull.click();
}

async function interactionTarget(canvas: Locator): Promise<InteractionTarget> {
  const target = await canvas.evaluate(async (element, profileId) => {
    const graphCanvasElement = element as HTMLCanvasElement & {
      __exoGraphPointForIndex?: (index: number) => { x: number; y: number; visible: boolean } | null;
      __exoGraphPickAt?: (x: number, y: number) => number;
      __exoGraphSnapshot?: () => GraphDebugSnapshot | null;
    };
    const sourceSnapshotId = graphCanvasElement.__exoGraphSnapshot?.()?.sourceSnapshotId;
    if (!sourceSnapshotId) return null;
    const bounds = graphCanvasElement.getBoundingClientRect();
    const inViewport = (point: { x: number; y: number; visible: boolean }) => point.visible
      && point.x >= 2 && point.y >= 2 && point.x <= bounds.width - 2 && point.y <= bounds.height - 2;
    const topology = await window.exo.notes.getGraphTopology(profileId);
    const maximum = Math.min(topology.edgeCount, 25_000);
    for (let edge = 0; edge < maximum; edge += 1) {
      const sourceIndex = topology.edges.endpoints[edge * 2] ?? -1;
      const targetIndex = topology.edges.endpoints[edge * 2 + 1] ?? -1;
      if (sourceIndex < 0 || targetIndex < 0) continue;
      const source = graphCanvasElement.__exoGraphPointForIndex?.(sourceIndex);
      const targetPoint = graphCanvasElement.__exoGraphPointForIndex?.(targetIndex);
      if (!source || !targetPoint || !inViewport(source) || !inViewport(targetPoint)) continue;
      if (graphCanvasElement.__exoGraphPickAt?.(source.x, source.y) !== sourceIndex) continue;
      if (graphCanvasElement.__exoGraphPickAt?.(targetPoint.x, targetPoint.y) !== targetIndex) continue;
      const summary = await window.exo.notes.getGraphConceptSummaries([targetIndex], sourceSnapshotId, profileId);
      const filePath = summary.summaries[0]?.filePath;
      if (!filePath) continue;
      return {
        source: { index: sourceIndex, x: source.x, y: source.y },
        target: { index: targetIndex, x: targetPoint.x, y: targetPoint.y, filePath },
      };
    }
    return null;
  }, PROFILE_ID);
  ensure(Boolean(target), "NO_PICKABLE_CONNECTED_PAIR");
  return target!;
}

async function panAndZoom(page: Page, canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  ensure(Boolean(box), "GRAPH_VIEWPORT_MISSING");
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const before = await graphSnapshot(canvas);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 28, center.y + 14, { steps: 4 });
  await page.mouse.up();
  await canvas.evaluate((element, point) => {
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      ctrlKey: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: -24,
    }));
  }, { x: box!.width / 2, y: box!.height / 2 });
  await waitForGraphIdle(canvas);
  const after = await graphSnapshot(canvas);
  ensure(after.renderedFrames > before.renderedFrames, "GESTURE_DID_NOT_RENDER");
}

async function selectAndRoute(
  canvas: Locator,
  target: InteractionTarget,
  onPhase: (phase: string) => void,
): Promise<void> {
  onPhase("select-source");
  await canvas.click({ position: target.source });
  onPhase("wait-source-selection");
  await canvas.page().waitForFunction((selectedIndex) => {
    const element = document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    const snapshot = element?.__exoGraphSnapshot?.();
    return Boolean(snapshot && snapshot.selected === selectedIndex && !snapshot.moving && !snapshot.pendingFrame);
  }, target.source.index, { timeout: 30_000 });
  onPhase("resolve-route-target");
  const currentTarget = await canvas.evaluate((element, index) => {
    const graphCanvasElement = element as HTMLCanvasElement & {
      __exoGraphPointForIndex?: (value: number) => { x: number; y: number; visible: boolean } | null;
      __exoGraphPickAt?: (x: number, y: number) => number;
    };
    const point = graphCanvasElement.__exoGraphPointForIndex?.(index) ?? null;
    if (!point?.visible || graphCanvasElement.__exoGraphPickAt?.(point.x, point.y) !== index) return null;
    return { x: point.x, y: point.y };
  }, target.target.index);
  ensure(Boolean(currentTarget), "ROUTE_TARGET_NOT_PICKABLE_AFTER_SELECTION");
  target.target.x = currentTarget!.x;
  target.target.y = currentTarget!.y;
  onPhase("select-route-target");
  await canvas.click({ position: currentTarget!, modifiers: ["Shift"] });
  onPhase("wait-route");
  await canvas.page().waitForFunction(() => {
    const element = document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    const snapshot = element?.__exoGraphSnapshot?.();
    return Boolean(snapshot && snapshot.pathNodeCount >= 2 && snapshot.pathTarget >= 0);
  }, null, { timeout: 30_000 });
}

async function hasCanvasFallbackHook(canvas: Locator): Promise<boolean> {
  return canvas.evaluate((element) => typeof (element as HTMLCanvasElement & {
    __exoGraphForceCanvasFallback?: () => Promise<void>;
  }).__exoGraphForceCanvasFallback === "function");
}

async function forceCanvasFallback(canvas: Locator): Promise<void> {
  await canvas.evaluate(async (element) => {
    await (element as HTMLCanvasElement & { __exoGraphForceCanvasFallback?: () => Promise<void> })
      .__exoGraphForceCanvasFallback?.();
  });
}

async function waitForRenderer(canvas: Locator, expected: "canvas2d" | "webgpu"): Promise<void> {
  await canvas.page().waitForFunction((kind) => {
    const element = document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    return element?.__exoGraphSnapshot?.()?.rendererKind === kind;
  }, expected, { timeout: 30_000 });
}

async function waitForRendererReady(canvas: Locator): Promise<void> {
  await canvas.page().waitForFunction(() => {
    const element = document.querySelector("[data-testid='graph-pane'] canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    return Boolean(element?.__exoGraphSnapshot?.()?.rendererKind);
  }, null, { timeout: 30_000 });
}

async function closeGraph(page: Page): Promise<void> {
  await page.getByTestId("graph-pane").getByRole("button", { name: "Close graph" }).click();
  await page.waitForFunction(() => !document.querySelector("[data-testid='graph-pane']"), null, { timeout: 30_000 });
}

async function waitForGraphRebuild(canvas: Locator, previousSnapshotId: string | null, previousNodeCount: number): Promise<void> {
  await canvas.page().waitForFunction(({ snapshotId, nodeCount }) => {
    const graph = document.querySelector("[data-testid='graph-pane']");
    const count = Number.parseInt(graph?.querySelector(".spatial-graph__count")?.textContent ?? "0", 10);
    const element = graph?.querySelector("canvas[aria-label='Interactive knowledge graph']") as
      (HTMLCanvasElement & { __exoGraphSnapshot?: () => GraphDebugSnapshot | null }) | null;
    const snapshot = element?.__exoGraphSnapshot?.();
    return Boolean(snapshot && snapshot.sourceSnapshotId !== snapshotId && count > nodeCount
      && snapshot.pendingWork === 0 && !snapshot.pendingFrame && !snapshot.moving);
  }, { snapshotId: previousSnapshotId, nodeCount: previousNodeCount }, { timeout: 120_000 });
}

async function measured(run: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await run();
  return performance.now() - startedAt;
}

function roundedTimings(timings: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Math.round(value * 100) / 100]));
}

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
