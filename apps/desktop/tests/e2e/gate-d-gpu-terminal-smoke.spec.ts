import { expect, test } from "@playwright/test";

import { launchExoTerminalFixture } from "../helpers";

test("keeps the direct PTY and xterm stable with Electron hardware acceleration", async () => {
  const { page, cleanup } = await launchExoTerminalFixture({
    env: { EXO_SHELL: "/bin/sh", EXO_SHELL_ARGS: "" },
  });
  try {
    const surface = page.getByTestId("terminal-surface");
    await surface.click();
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();

    await page.keyboard.type("echo rapid words", { delay: 0 });
    await page.keyboard.press("Enter");
    await expect(surface).toContainText("rapid words");

    await page.keyboard.insertText("echo paste-one\necho paste-two\n");
    await expect(surface).toContainText("paste-one");
    await expect(surface).toContainText("paste-two");

    await page.keyboard.type("echo backspace-okX", { delay: 0 });
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await expect(surface).toContainText("backspace-ok");

    await page.keyboard.type("echo arrow-history", { delay: 0 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await surface.innerText()).split("arrow-history").length - 1).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+C");
    await page.keyboard.type("echo after-control-c", { delay: 0 });
    await page.keyboard.press("Enter");
    await expect(surface).toContainText("after-control-c");

    const beforeGeometry = await page.evaluate(async () => (await window.exo.terminals.list())[0]?.geometry?.cols ?? 0);
    const resizer = page.getByTestId("utility-pane-resizer");
    const handle = await resizer.boundingBox();
    expect(handle).not.toBeNull();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 180);
    await page.mouse.down();
    await page.mouse.move(handle!.x - 160, handle!.y + 180, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await page.evaluate(async () => (await window.exo.terminals.list())[0]?.geometry?.cols ?? 0))).toBeGreaterThan(beforeGeometry);

    await surface.click();
    await page.keyboard.type("i=1; while [ $i -le 300 ]; do echo gpu-scroll-$i; i=$((i+1)); done", { delay: 0 });
    await page.keyboard.press("Enter");
    await expect.poll(async () => page.evaluate(async () => {
      const session = (await window.exo.terminals.list())[0];
      return session ? window.exo.terminals.read(session.id) : "";
    })).toContain("gpu-scroll-300");
    await surface.hover();
    await page.mouse.wheel(0, -50_000);
    await expect.poll(async () => page.locator(".xterm-viewport").evaluate((element) => element.scrollTop)).toBeLessThan(1_000);

    await page.getByTestId("utility-pane-preview").click();
    await expect(page.getByTestId("preview-empty-state")).toBeVisible();
    await page.getByTestId("utility-pane-terminal").click();
    await expect.poll(async () => page.evaluate(async () => {
      const session = (await window.exo.terminals.list())[0];
      return session ? window.exo.terminals.read(session.id) : "";
    })).toContain("gpu-scroll-300");
    await expect(surface).toBeVisible();
    await expect(page.locator(".pane-leaf--editor")).toBeVisible();
  } finally {
    await cleanup();
  }
});
