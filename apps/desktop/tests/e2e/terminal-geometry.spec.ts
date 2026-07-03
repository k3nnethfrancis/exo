import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Locator, type Page } from "@playwright/test";

import { launchExoFixture } from "../helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fakeInkAgentPath = path.join(repoRoot, "apps/desktop/tests/fixtures/fake-ink-agent.sh");

test.describe.configure({ mode: "serial" });

test("Terminal V4.1 baseline fake Ink fixture reports one unwrapped wide frame", async () => {
  const { page, electronApp, cleanup } = await launchWideTerminal();

  try {
    const shell = await pageShellSession(page);
    await startFakeInkAgent(page, shell.id);
    const baseline = await expectGeometryFrame(page, { minCols: 180 });

    expect(baseline.frameCount).toBe(1);
    expect(baseline.rulerLength).toBe(baseline.cols);
    expect(baseline.boxLength).toBe(baseline.cols);
  } finally {
    await cleanup();
    await electronApp.close().catch(() => {});
  }
});

test("Terminal V4.1 reconnect-at-wrong-size keeps fixture width aligned after reconnect", async () => {
  const { page, electronApp, cleanup } = await launchWideTerminal();

  try {
    const shell = await pageShellSession(page);
    await startFakeInkAgent(page, shell.id);
    const baseline = await expectGeometryFrame(page, { minCols: 180 });

    await page.evaluate(async (id) => {
      await window.exo.terminals.reconnect(id);
    }, shell.id);
    await waitForTerminalHealth(page, shell.id, { bridgeStatus: "attached", paneStatus: "alive" }, 5_000);

    await expect.poll(async () => currentGeometryFrame(page, baseline.cols), { timeout: 5_000 }).toMatchObject({
      frameCount: 1,
      cols: baseline.cols,
      rulerLength: baseline.cols,
      boxLength: baseline.cols,
    });
    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type("hello-after-reconnect\n");
    await expect.poll(async () => currentGeometryFrame(page, baseline.cols), { timeout: 5_000 }).toMatchObject({
      frameCount: 1,
      echo: "input: hello-after-reconnect",
      cols: baseline.cols,
      rulerLength: baseline.cols,
      boxLength: baseline.cols,
    });
  } finally {
    await cleanup();
    await electronApp.close().catch(() => {});
  }
});

test("Terminal V4.1 reconnect-recoverable route restores a detached fake Ink bridge", async () => {
  const { page, electronApp, runtimeRoot, cleanup } = await launchWideTerminal();

  try {
    const shell = await pageShellSession(page);
    await startFakeInkAgent(page, shell.id);
    const baseline = await expectGeometryFrame(page, { minCols: 180 });

    await killAttachBridgeForTerminal(page, shell.id);
    await waitForTerminalHealth(page, shell.id, { bridgeStatus: "detached", health: "unhealthy" }, 5_000);
    await postReconnectRecoverable(runtimeRoot);
    await waitForTerminalHealth(page, shell.id, { bridgeStatus: "attached", paneStatus: "alive" }, 10_000);

    await assertRecoveredFakeInk(page, baseline.cols, "recoverable-after-route");
  } finally {
    await cleanup();
    await electronApp.close().catch(() => {});
  }
});

test("Terminal V4.1 @quarantine-preview reconnect-recoverable route restores fake Ink with preview pane open", async () => {
  const { page, electronApp, runtimeRoot, workspaceRoot, cleanup } = await launchWideTerminal({
    prepareWorkspace: async (root) => {
      await writeFile(
        path.join(root, "fake-ink-preview.html"),
        "<!doctype html><html><body><button autofocus>preview loaded</button><p>fake ink preview reconnect</p></body></html>",
      );
    },
  });

  try {
    await page.getByTestId("launch-browser").click();
    await page.getByTestId("browser-url-input").fill(`file://${path.join(workspaceRoot, "fake-ink-preview.html")}`);
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", /^file:\/\/.*fake-ink-preview\.html$/);

    const shell = await pageShellSession(page);
    await page.getByTestId("terminal-surface").click();
    await startFakeInkAgent(page, shell.id);
    const baseline = await expectGeometryFrame(page, { minCols: 180 });

    await page.getByTestId("browser-pane").click();
    await killAttachBridgeForTerminal(page, shell.id);
    await waitForTerminalHealth(page, shell.id, { bridgeStatus: "detached", health: "unhealthy" }, 5_000);
    await postReconnectRecoverable(runtimeRoot);
    await waitForTerminalHealth(page, shell.id, { bridgeStatus: "attached", paneStatus: "alive" }, 10_000);

    await page.getByTestId("terminal-surface").click();
    await assertRecoveredFakeInk(page, baseline.cols, "preview-recoverable-after-route");
  } finally {
    await cleanup();
    await electronApp.close().catch(() => {});
  }
});

async function launchWideTerminal(options?: { prepareWorkspace?: (workspaceRoot: string) => Promise<void> }) {
  const fixture = await launchExoFixture({
    mutable: Boolean(options?.prepareWorkspace),
    prepareWorkspace: options?.prepareWorkspace,
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "",
    },
    initialNoteLabel: null,
  });
  await fixture.electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setZoomFactor(0.5);
    window.setBounds({ x: 0, y: 0, width: 2600, height: 1300 });
  });
  await fixture.page.evaluate(async () => {
    const settings = await window.exo.workspace.getSettings();
    await window.exo.workspace.saveSettings({ ...settings, terminalFontSize: 10 });
  });
  await fixture.page.reload();
  await expect(fixture.page.getByTestId("terminal-rail")).toBeVisible();
  if (await fixture.page.getByTestId("sidebar-collapse").isVisible()) {
    await fixture.page.getByTestId("sidebar-collapse").click();
    await expect(fixture.page.getByTestId("sidebar-expand")).toBeVisible();
  }
  await dragBy(fixture.page, fixture.page.locator(".workspace__body > .pane-split-resizer--vertical").first(), { x: -700, y: 0 });
  await fixture.page.getByTestId("terminal-surface").click();
  return fixture;
}

async function dragBy(page: Page, locator: Locator, delta: { x: number; y: number }) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(start.x + (delta.x * step) / 10, start.y + (delta.y * step) / 10);
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function pageShellSession(page: Page) {
  const shell = await page.evaluate(async () => {
    const sessions = await window.exo.terminals.list();
    return sessions.find((session) => session.kind === "shell") ?? null;
  });
  if (!shell) {
    throw new Error("Expected shell terminal session.");
  }
  return shell;
}

async function startFakeInkAgent(page: Page, terminalId: string): Promise<void> {
  await waitForSettledTerminalGeometry(page, terminalId, { minCols: 180 });
  await page.evaluate(async ({ id, command }) => {
    await window.exo.terminals.write(id, `${command}\n`);
  }, {
    id: terminalId,
    command: `/usr/bin/env bash ${shellQuote(fakeInkAgentPath)}`,
  });
  await expect.poll(async () => currentGeometryFrame(page), { timeout: 5_000 }).toMatchObject({
    frameCount: 1,
  });
}

async function waitForSettledTerminalGeometry(page: Page, terminalId: string, options: { minCols: number }): Promise<void> {
  const deadline = Date.now() + 5_000;
  let stableKey = "";
  let stableSince = 0;
  let lastSample: { rendererCols: number; rendererRows: number; tmuxCols: number } | null = null;

  while (Date.now() < deadline) {
    const session = await page.evaluate(async (id) => {
      const sessions = await window.exo.terminals.list();
      return sessions.find((candidate) => candidate.id === id) ?? null;
    }, terminalId);
    const tmuxCols = session ? await tmuxPaneWidthForTerminal(page, terminalId) : 0;
    const rendererCols = session?.geometry?.source === "renderer-fit" ? session.geometry.cols : 0;
    const rendererRows = session?.geometry?.source === "renderer-fit" ? session.geometry.rows : 0;
    lastSample = { rendererCols, rendererRows, tmuxCols };

    if (rendererCols >= options.minCols && rendererCols === tmuxCols && rendererRows > 0) {
      const key = `${rendererCols}x${rendererRows}`;
      if (key !== stableKey) {
        stableKey = key;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 250) {
        return;
      }
    } else {
      stableKey = "";
      stableSince = 0;
    }
    await page.waitForTimeout(50);
  }

  throw new Error(`Timed out waiting for settled terminal geometry: ${JSON.stringify(lastSample)}`);
}

async function tmuxPaneWidthForTerminal(page: Page, terminalId: string): Promise<number> {
  const diagnostic = await page.evaluate(async (id) => {
    const diagnostics = await window.exo.terminals.diagnostics();
    return diagnostics.find((candidate) => candidate.id === id) ?? null;
  }, terminalId);
  if (!diagnostic?.tmuxSessionName) {
    return 0;
  }
  return tmuxPaneWidth(diagnostic.tmuxSessionName) ?? 0;
}

async function expectGeometryFrame(page: Page, options: { minCols: number }) {
  await expect.poll(async () => currentGeometryFrame(page), { timeout: 5_000 }).toMatchObject({
    frameCount: 1,
  });
  const current = await currentGeometryFrame(page);
  expect(current.cols, `Expected wide terminal cols from visible fake Ink frame:\n${current.visibleText}`).toBeGreaterThanOrEqual(options.minCols);
  expect(current.rulerLength, `Expected ruler to match cols:\n${current.visibleText}`).toBe(current.cols);
  expect(current.boxLength, `Expected box line to match cols:\n${current.visibleText}`).toBe(current.cols);
  expect(current.boxWrappedFragment, `Expected no wrapped box fragment:\n${current.visibleText}`).toBe(false);
  return current;
}

async function assertRecoveredFakeInk(page: Page, expectedCols: number, input: string): Promise<void> {
  await page.getByTestId("terminal-surface").click();
  await expect.poll(async () =>
    page.getByTestId("terminal-surface").evaluate((element) => element.className),
  { timeout: 5_000 }).not.toContain("terminal-surface--input-disabled");
  await page.keyboard.type(`${input}\n`);
  await expect.poll(async () => currentGeometryFrame(page, expectedCols), { timeout: 10_000 }).toMatchObject({
    frameCount: 1,
    echo: `input: ${input}`,
    cols: expectedCols,
    rulerLength: expectedCols,
    boxLength: expectedCols,
    boxWrappedFragment: false,
  });
}

async function currentGeometryFrame(page: Page, preferredCols?: number): Promise<GeometryFrame> {
  const lines = await visibleTerminalRows(page);
  const visibleText = lines.join("\n");
  const frameCount = countOccurrences(visibleText, "frame=");
  const header = lines.find((line) => line.includes("FAKE-INK v1 frame=")) ?? "";
  const cols = Number(header.match(/cols=(\d+)/)?.[1] ?? 0);
  const ruler = lines.find((line) => /^[-+\d]+$/.test(line) && line.includes("----+----1")) ?? "";
  const box = selectBoxLine(lines, preferredCols ?? cols);
  const echo = lines.find((line) => line.startsWith("input: "))?.trimEnd() ?? "";
  return {
    visibleText,
    frameCount,
    cols,
    rulerLength: ruler.length,
    boxLength: box.length,
    echo,
    boxWrappedFragment: lines.some((line) => line !== box && /^─*┐$/.test(line)),
  };
}

async function visibleTerminalRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".terminal-surface .xterm-rows > div"))
      .map((row) => row.textContent ?? "")
      .filter((line) => line.length > 0),
  );
}

function selectBoxLine(lines: string[], expectedCols: number): string {
  const candidates = lines.filter((line) => line.startsWith("┌"));
  return candidates.find((line) => line.length === expectedCols)
    ?? candidates.sort((left, right) => right.length - left.length)[0]
    ?? "";
}

async function waitForTerminalHealth(
  page: Page,
  terminalId: string,
  expected: { bridgeStatus?: string; paneStatus?: string; health?: string },
  timeout: number,
): Promise<void> {
  await expect.poll(async () => {
    const diagnostic = await page.evaluate(async (id) => {
      const diagnostics = await window.exo.terminals.diagnostics();
      return diagnostics.find((candidate) => candidate.id === id) ?? null;
    }, terminalId);
    return {
      bridgeStatus: diagnostic?.bridgeStatus ?? "",
      paneStatus: diagnostic?.paneStatus ?? "",
      health: diagnostic?.health ?? "",
    };
  }, { timeout }).toMatchObject(expected);
}

async function killAttachBridgeForTerminal(page: Page, terminalId: string): Promise<void> {
  const diagnostic = await page.evaluate(async (id) => {
    const diagnostics = await window.exo.terminals.diagnostics();
    return diagnostics.find((candidate) => candidate.id === id) ?? null;
  }, terminalId);
  if (!diagnostic?.tmuxSessionName) {
    throw new Error("Expected shell terminal to expose a tmux session name in diagnostics.");
  }
  const killed = killTmuxAttachClients(diagnostic.tmuxSessionName);
  expect(killed, `Expected to kill tmux attach client for ${diagnostic.tmuxSessionName}.`).toBeGreaterThan(0);
}

function killTmuxAttachClients(tmuxSessionName: string): number {
  const processList = spawnSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  if (processList.status !== 0) {
    throw new Error(processList.stderr || "Failed to list processes.");
  }
  const escapedSessionName = tmuxSessionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attachPattern = new RegExp(`\\btmux(?:\\s+-[A-Za-z]+)*\\s+attach-session\\s+-t\\s+${escapedSessionName}\\b`);
  const pids = processList.stdout
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match && attachPattern.test(match[2]) ? Number(match[1]) : null;
    })
    .filter((pid): pid is number => pid !== null && pid !== process.pid);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The attach client may have exited between process listing and termination.
    }
  }
  return pids.length;
}

function tmuxPaneWidth(tmuxSessionName: string): number | null {
  const result = spawnSync("tmux", ["display-message", "-p", "-t", tmuxSessionName, "#{pane_width}"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const width = Number(result.stdout.trim());
  return Number.isFinite(width) ? width : null;
}

async function postReconnectRecoverable(runtimeRoot: string): Promise<void> {
  const serverInfo = JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number };
  const response = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals/reconnect-recoverable`, {
    method: "POST",
  });
  expect(response.ok).toBe(true);
  await expect(response.json()).resolves.toEqual({ ok: true });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function countOccurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

interface GeometryFrame {
  visibleText: string;
  frameCount: number;
  cols: number;
  rulerLength: number;
  boxLength: number;
  echo: string;
  boxWrappedFragment: boolean;
}
