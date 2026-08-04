import { expect, test } from "@playwright/test";

import { launchExographTerminalFixture, launchExographWorkspaceFixture, relaunchExographWorkspaceFixture } from "../helpers";
import { waitForTerminalInputEnabled, waitForTerminalText } from "../terminalQuality";

test("primary plus, minus, and zero zoom the whole app", async () => {
  const fixture = await launchExographWorkspaceFixture();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  try {
    const zoomFactor = () => fixture.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
    );

    await expect.poll(zoomFactor).toBe(1);
    await fixture.page.keyboard.press(`${modifier}+Shift+=`);
    await expect.poll(zoomFactor).toBeGreaterThan(1);
    await fixture.page.keyboard.press(`${modifier}+-`);
    await expect.poll(zoomFactor).toBe(1);
    await fixture.page.keyboard.press(`${modifier}+Shift+=`);
    await fixture.page.keyboard.press(`${modifier}+0`);
    await expect.poll(zoomFactor).toBe(1);

    for (let step = 0; step < 12; step += 1) {
      await fixture.page.keyboard.press(`${modifier}+Shift+=`);
    }
    await expect.poll(zoomFactor).toBe(2);
    await fixture.page.keyboard.press(`${modifier}+Shift+=`);
    await expect.poll(zoomFactor).toBe(2);

    for (let step = 0; step < 16; step += 1) {
      await fixture.page.keyboard.press(`${modifier}+-`);
    }
    await expect.poll(zoomFactor).toBe(0.5);
    await fixture.page.keyboard.press(`${modifier}+-`);
    await expect.poll(zoomFactor).toBe(0.5);
  } finally {
    await fixture.cleanup();
  }
});

test("whole-app zoom scales a live terminal without disrupting geometry or input", async () => {
  const fixture = await launchExographTerminalFixture();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  try {
    await waitForTerminalInputEnabled(fixture.page);
    const terminalSurface = fixture.page.getByTestId("terminal-surface").first();
    await terminalSurface.click();
    const geometry = async () => {
      const sessions = await fixture.page.evaluate(() => window.exograph.terminals.list());
      return sessions[0]?.geometry ?? null;
    };
    const initialGeometry = await geometry();
    expect(initialGeometry).not.toBeNull();

    await fixture.page.keyboard.press(`${modifier}+Shift+=`);
    await expect.poll(() => fixture.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
    )).toBeGreaterThan(1);
    await expect.poll(geometry).toEqual(initialGeometry);

    await fixture.page.keyboard.type("zoom keeps terminal input intact");
    await fixture.page.keyboard.press("Enter");
    await waitForTerminalText(fixture.page, "zoom keeps terminal input intact");
  } finally {
    await fixture.cleanup();
  }
});

test("whole-app zoom persists without changing configured editor or terminal sizes", async () => {
  const fixture = await launchExographWorkspaceFixture();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  let relaunched: Awaited<ReturnType<typeof relaunchExographWorkspaceFixture>> | null = null;

  try {
    await fixture.page.keyboard.press(`${modifier}+Shift+=`);
    await expect.poll(() => fixture.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
    )).toBeGreaterThan(1);

    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-settings").click();
    await fixture.page.getByTestId("workspace-settings-tab-appearance").click();
    await expect(fixture.page.getByTestId("workspace-settings-editor-font-size")).toHaveValue("15");
    await fixture.page.getByTestId("workspace-settings-tab-terminal").click();
    await expect(fixture.page.getByTestId("workspace-settings-terminal-font-size")).toHaveValue("13");
    await fixture.page.getByTestId("workspace-settings-close").click();

    await fixture.electronApp.close();
    relaunched = await relaunchExographWorkspaceFixture(fixture);
    const relaunchedZoomFactor = () => relaunched!.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
    );
    await expect.poll(relaunchedZoomFactor).toBeGreaterThan(1);
    const restoredZoom = await relaunchedZoomFactor();
    await relaunched.page.keyboard.press(`${modifier}+Shift+=`);
    await expect.poll(relaunchedZoomFactor).toBeGreaterThan(restoredZoom);
    await relaunched.page.keyboard.press(`${modifier}+0`);
    await expect.poll(relaunchedZoomFactor).toBe(1);
  } finally {
    if (relaunched) {
      await relaunched.cleanup();
    } else {
      await fixture.cleanup();
    }
  }
});
