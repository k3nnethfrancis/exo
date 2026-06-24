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
      await writeFile(path.join(artifactRoot, "overall-exo-architecture.html"), "<!doctype html><title>Overall</title>", "utf8");
      await writeFile(path.join(artifactRoot, "core-plugin-boundary.html"), "<!doctype html><title>Core Boundary</title>", "utf8");
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
  } finally {
    await cleanup();
  }
});

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
