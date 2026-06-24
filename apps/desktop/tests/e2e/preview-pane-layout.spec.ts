import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { test, expect, type Locator, type Page } from "@playwright/test";

import { launchExoFixture } from "../helpers";

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

async function dragPoint(page: Page, source: { x: number; y: number }, target: { x: number; y: number }) {
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    const ratio = step / 10;
    await page.mouse.move(
      source.x + (target.x - source.x) * ratio,
      source.y + (target.y - source.y) * ratio,
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test("resizes preview/editor and preview/terminal splits while a webview is open", async () => {
  const { page, cleanup } = await launchExoFixture();

  try {
    await page.getByTestId("launch-browser").click();
    await page.getByTestId("browser-url-input").fill("localhost:4321");
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-webview")).toHaveAttribute("src", "http://localhost:4321");

    const browserPane = page.locator(".pane-leaf--browser").first();
    const terminalPane = page.locator(".workspace__body .pane-leaf--terminal").first();
    const previewSplitResizer = page.locator(".workspace__body > .pane-split > .pane-split-resizer--vertical").first();
    const zoneResizer = page.locator(".workspace__body > .pane-split-resizer--vertical").first();

    const browserBefore = await browserPane.boundingBox();
    expect(browserBefore).not.toBeNull();
    await dragBy(page, previewSplitResizer, { x: -150, y: 0 });
    const browserAfter = await browserPane.boundingBox();
    expect(browserAfter).not.toBeNull();
    expect(browserAfter!.width).toBeGreaterThan(browserBefore!.width + 80);

    const terminalBefore = await page.locator(".workspace__body .pane-leaf--terminal").first().boundingBox();
    expect(terminalBefore).not.toBeNull();
    await dragBy(page, zoneResizer, { x: -180, y: 0 });
    const terminalAfter = await page.locator(".workspace__body .pane-leaf--terminal").first().boundingBox();
    expect(terminalAfter).not.toBeNull();
    expect(terminalAfter!.width).toBeGreaterThan(terminalBefore!.width + 80);
    await expect(terminalPane).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("opens absolute local HTML paths through the command server in the preview pane", async () => {
  const { page, runtimeRoot, workspaceRoot, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (root) => {
      const artifactRoot = path.join(root, "projects", "sample-project", "docs", "artifacts");
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(
        path.join(artifactRoot, "overall-exo-architecture.html"),
        `<!doctype html>
<html>
  <head>
    <title>Overall</title>
    <style>
      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      .viewport-fit {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-rows: minmax(0, 1fr) 32px;
        background: #101820;
      }

      #viewport-bottom {
        background: #31d0aa;
      }
    </style>
  </head>
  <body>
    <main class="viewport-fit">
      <section>Preview body</section>
      <footer id="viewport-bottom">Viewport bottom marker</footer>
    </main>
  </body>
</html>`,
        "utf8",
      );
      await writeFile(
        path.join(artifactRoot, "core-plugin-boundary.html"),
        "<!doctype html><title>Core Boundary</title>",
        "utf8",
      );
    },
  });

  try {
    const serverInfo = JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number };
    const firstPath = path.join(workspaceRoot, "projects", "sample-project", "docs", "artifacts", "overall-exo-architecture.html");
    const secondPath = path.join(workspaceRoot, "projects", "sample-project", "docs", "artifacts", "core-plugin-boundary.html");
    const secondUrl = pathToFileURL(secondPath).toString();

    const firstResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/preview/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: firstPath }),
    });
    expect(firstResponse.ok).toBe(true);
    await expect(firstResponse.json()).resolves.toMatchObject({
      url: pathToFileURL(firstPath).toString(),
      source: "file",
    });
    await expect(page.getByTestId("browser-webview")).toHaveAttribute("src", pathToFileURL(firstPath).toString());
    await expect.poll(async () => getPreviewLayoutMetrics(page)).toMatchObject({
      title: "Overall",
      bottomMarkerVisibleAtViewportBottom: true,
      webviewFillsPane: true,
      guestViewportMatchesElement: true,
    });

    const secondResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/preview/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: secondPath }),
    });
    expect(secondResponse.ok).toBe(true);
    await expect(secondResponse.json()).resolves.toMatchObject({ url: secondUrl, source: "file" });
    await expect(page.locator(".pane-leaf--browser")).toHaveCount(1);
    await expect(page.getByTestId("browser-url-input")).toHaveValue(secondUrl);
    await expect(page.getByTestId("browser-webview")).toHaveAttribute("src", secondUrl);

    await page.getByTestId("browser-url-input").fill(firstPath);
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-webview")).toHaveAttribute("src", pathToFileURL(firstPath).toString());
    await expect.poll(async () => getPreviewLayoutMetrics(page)).toMatchObject({
      title: "Overall",
      bottomMarkerVisibleAtViewportBottom: true,
      webviewFillsPane: true,
      guestViewportMatchesElement: true,
    });
  } finally {
    await cleanup();
  }
});

async function getPreviewLayoutMetrics(page: Page): Promise<{
  title: string;
  bottomMarkerVisibleAtViewportBottom: boolean;
  webviewFillsPane: boolean;
  guestViewportMatchesElement: boolean;
  paneHeight: number;
  webviewHeight: number;
  guestInnerHeight: number;
  bottomMarkerBottom: number;
}> {
  return page.evaluate(async () => {
    const pane = document.querySelector<HTMLElement>("[data-testid='browser-pane']");
    const webview = document.querySelector<HTMLElement & {
      executeJavaScript<T>(code: string): Promise<T>;
    }>("[data-testid='browser-webview']");
    if (!pane || !webview || typeof webview.executeJavaScript !== "function") {
      throw new Error("Preview pane/webview is not ready");
    }

    const paneRect = pane.getBoundingClientRect();
    const headerRect = pane.querySelector<HTMLElement>(".browser-pane__header")?.getBoundingClientRect();
    const webviewRect = webview.getBoundingClientRect();
    const guest = await webview.executeJavaScript<{
      title: string;
      innerHeight: number;
      bottomMarkerBottom: number;
    }>(`
      (() => {
        const marker = document.getElementById("viewport-bottom");
        const markerRect = marker ? marker.getBoundingClientRect() : { bottom: 0 };
        return {
          title: document.title,
          innerHeight: window.innerHeight,
          bottomMarkerBottom: markerRect.bottom,
        };
      })()
    `);
    const expectedWebviewHeight = paneRect.height - (headerRect?.height ?? 0);

    return {
      title: guest.title,
      bottomMarkerVisibleAtViewportBottom: Math.abs(guest.bottomMarkerBottom - guest.innerHeight) <= 2,
      webviewFillsPane: webviewRect.height >= expectedWebviewHeight - 2,
      guestViewportMatchesElement: Math.abs(guest.innerHeight - webviewRect.height) <= 2,
      paneHeight: paneRect.height,
      webviewHeight: webviewRect.height,
      guestInnerHeight: guest.innerHeight,
      bottomMarkerBottom: guest.bottomMarkerBottom,
    };
  });
}

test("drags the browser preview tab into the shared pane graph", async () => {
  const { page, cleanup } = await launchExoFixture();

  try {
    await page.getByTestId("launch-browser").click();
    await expect(page.getByTestId("browser-tab-preview")).toBeVisible();

    const browserTab = await page.getByTestId("browser-tab-preview").boundingBox();
    const editorBefore = await page.locator(".pane-leaf--editor").first().boundingBox();
    expect(browserTab).not.toBeNull();
    expect(editorBefore).not.toBeNull();

    await dragPoint(
      page,
      { x: browserTab!.x + browserTab!.width / 2, y: browserTab!.y + browserTab!.height / 2 },
      { x: editorBefore!.x + editorBefore!.width / 2, y: editorBefore!.y + editorBefore!.height - 8 },
    );

    await expect(page.locator(".pane-leaf--browser")).toHaveCount(1);
    const editorAfter = await page.locator(".pane-leaf--editor").first().boundingBox();
    const browserAfter = await page.locator(".pane-leaf--browser").first().boundingBox();
    expect(editorAfter).not.toBeNull();
    expect(browserAfter).not.toBeNull();
    expect(browserAfter!.y).toBeGreaterThan(editorAfter!.y + editorAfter!.height - 4);
    expect(Math.abs(browserAfter!.x - editorAfter!.x)).toBeLessThan(12);
    expect(Math.abs(browserAfter!.width - editorAfter!.width)).toBeLessThan(24);
  } finally {
    await cleanup();
  }
});
