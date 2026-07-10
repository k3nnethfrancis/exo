import { readFile } from "node:fs/promises";

import { test, expect, type Page } from "@playwright/test";

import { launchExoTerminalFixture, relaunchExoTerminalFixture } from "../helpers";

test.describe.configure({ mode: "serial" });

test("splits live terminals in monitor mode, reconciles geometry, and persists monitor preference across relaunch", async () => {
  const fixture = await launchExoTerminalFixture({ initialNoteLabel: null });
  let relaunched: Awaited<ReturnType<typeof relaunchExoTerminalFixture>> | null = null;

  try {
    const { page, settingsPath } = fixture;
    await expect(page.getByTestId("terminal-tab-shell")).toBeVisible();
    await page.getByTestId("side-panel-terminal-rail").click();
    await page.getByTestId("side-panel-terminal-rail").click();
    await page.getByTestId("side-panel-terminal-rail").click();

    await expect.poll(async () => terminalSessions(page), { timeout: 10_000 }).toHaveLength(4);
    const sessionsBeforeMonitor = await terminalSessions(page);
    await expect(page.getByTestId("terminal-surface")).toHaveCount(1);
    await writeBurst(page, sessionsBeforeMonitor, "before-monitor", 8);
    const geometryBeforeMonitor = await terminalGeometryById(page);

    await page.getByTestId("side-panel-monitor-mode-rail").click();
    await expect(page.getByTestId("side-panel-monitor-mode-rail").first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("terminal-surface")).toHaveCount(4);
    await writeBurst(page, sessionsBeforeMonitor, "during-monitor-toggle", 24);
    await waitForRendererGeometry(page, sessionsBeforeMonitor.map((session) => session.id));
    await expectNoGeometryDivergence(page, sessionsBeforeMonitor.map((session) => session.id));

    const geometryAfterMonitor = await terminalGeometryById(page);
    expect(
      sessionsBeforeMonitor.some((session) =>
        geometryChanged(geometryBeforeMonitor[session.id], geometryAfterMonitor[session.id]),
      ),
      `Expected monitor mode to resize at least one terminal.\nBefore: ${JSON.stringify(geometryBeforeMonitor)}\nAfter: ${JSON.stringify(geometryAfterMonitor)}`,
    ).toBe(true);

    await page.screenshot({ path: "/tmp/exo-monitor-mode-4-live-sessions.png", fullPage: false });

    await page.getByTestId("side-panel-terminal-rail").click();
    await expect.poll(async () => terminalSessions(page), { timeout: 10_000 }).toHaveLength(5);
    await expect(page.getByTestId("terminal-surface")).toHaveCount(5);
    const sessionsWithCreated = await terminalSessions(page);
    await waitForRendererGeometry(page, sessionsWithCreated.map((session) => session.id));

    await page.locator('[data-testid="close-terminal-shell"]').last().click();
    await expect.poll(async () => terminalSessions(page), { timeout: 10_000 }).toHaveLength(4);
    await expect(page.getByTestId("terminal-surface")).toHaveCount(4);

    await expect.poll(async () => {
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      return settings.layout?.terminalMonitorMode;
    }, { timeout: 5_000 }).toBe(true);

    await fixture.electronApp.close();
    relaunched = await relaunchExoTerminalFixture(fixture);
    await expect.poll(async () => terminalSessions(relaunched!.page), { timeout: 10_000 }).toHaveLength(1);
    await expect(relaunched.page.getByTestId("side-panel-monitor-mode-rail").first()).toHaveAttribute("aria-pressed", "true");
    await expect(relaunched.page.getByTestId("terminal-surface")).toHaveCount(1);

    const relaunchedSessions = await terminalSessions(relaunched.page);
    await waitForRendererGeometry(relaunched.page, relaunchedSessions.map((session) => session.id));
    await expectNoGeometryDivergence(relaunched.page, relaunchedSessions.map((session) => session.id));
    await writeBurst(relaunched.page, relaunchedSessions, "after-relaunch-monitor", 4);
    await expect.poll(async () => readAllTerminals(relaunched!.page, relaunchedSessions), { timeout: 10_000 }).toContain("after-relaunch-monitor-003");
    await relaunched.page.screenshot({ path: "/tmp/exo-monitor-mode-relaunch-persisted.png", fullPage: false });
  } finally {
    if (relaunched) {
      await relaunched.cleanup();
    } else {
      await fixture.cleanup();
    }
  }
});

async function terminalSessions(page: Page) {
  return page.evaluate(() => window.exo.terminals.list());
}

async function writeBurst(page: Page, sessions: Awaited<ReturnType<typeof terminalSessions>>, label: string, count: number) {
  await page.evaluate(
    async ({ terminalIds, label, count }) => {
      await Promise.all(terminalIds.map((id) => {
        const payload = Array.from({ length: count }, (_, index) => `${label}-${String(index).padStart(3, "0")}`).join("\n");
        return window.exo.terminals.write(id, `${payload}\n`);
      }));
    },
    {
      terminalIds: sessions.map((session) => session.id),
      label,
      count,
    },
  );
  await expect.poll(async () => readAllTerminals(page, sessions), { timeout: 10_000 }).toContain(
    `${label}-${String(count - 1).padStart(3, "0")}`,
  );
}

async function readAllTerminals(page: Page, sessions: Awaited<ReturnType<typeof terminalSessions>>): Promise<string> {
  return page.evaluate(async (terminalIds) => {
    const chunks = await Promise.all(terminalIds.map((id) => window.exo.terminals.read(id)));
    return chunks.join("\n");
  }, sessions.map((session) => session.id));
}

async function terminalGeometryById(page: Page) {
  const sessions = await terminalSessions(page);
  return Object.fromEntries(sessions.map((session) => [session.id, session.geometry ?? null]));
}

async function waitForRendererGeometry(page: Page, terminalIds: string[]) {
  await expect.poll(async () => {
    const sessions = await terminalSessions(page);
    return terminalIds.map((id) => {
      const geometry = sessions.find((session) => session.id === id)?.geometry;
      return geometry?.source === "renderer-fit" && geometry.cols > 0 && geometry.rows > 0;
    });
  }, { timeout: 10_000 }).toEqual(terminalIds.map(() => true));
}

async function expectNoGeometryDivergence(page: Page, terminalIds: string[]) {
  await expect.poll(async () => {
    const diagnostics = await page.evaluate(() => window.exo.terminals.diagnostics());
    return terminalIds.map((id) => {
      const diagnostic = diagnostics.find((candidate) => candidate.id === id);
      return {
        id,
        divergent: diagnostic?.geometry.divergent ?? true,
        bridgeStatus: diagnostic?.bridgeStatus ?? "",
        paneStatus: diagnostic?.paneStatus ?? "",
      };
    });
  }, { timeout: 10_000 }).toEqual(
    terminalIds.map((id) => ({
      id,
      divergent: false,
      bridgeStatus: "attached",
      paneStatus: "alive",
    })),
  );
}

function geometryChanged(
  before: { cols: number; rows: number } | null | undefined,
  after: { cols: number; rows: number } | null | undefined,
): boolean {
  return Boolean(before && after && (before.cols !== after.cols || before.rows !== after.rows));
}
