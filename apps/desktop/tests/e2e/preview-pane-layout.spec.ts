import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { test, expect } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("uses one full-width preview surface in the utility pane", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-preview").click();
    await page.getByRole("button", { name: "New preview" }).click();
    await page.getByTestId("browser-url-input").fill("localhost:4321");
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", "http://localhost:4321/");

    const utilityPane = page.getByTestId("utility-pane");
    await expect(utilityPane.getByTestId("browser-pane")).toHaveCount(1);
    await expect(utilityPane.getByTestId("terminal-dock")).toHaveCount(0);
    const browserPane = utilityPane.getByTestId("browser-pane");
    await expect(browserPane).toBeVisible();
    const [utilityBox, browserBox] = await Promise.all([utilityPane.boundingBox(), browserPane.boundingBox()]);
    expect(utilityBox).not.toBeNull();
    expect(browserBox).not.toBeNull();
    expect(browserBox!.width).toBeGreaterThan(utilityBox!.width - 56);
  } finally {
    await cleanup();
  }
});

test("opens absolute local HTML paths through the command server in the preview pane", async () => {
  const { page, runtimeRoot, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
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
    const serverInfo = JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number; token: string };
    const commandHeaders = {
      "Content-Type": "application/json",
      "x-exo-command-token": serverInfo.token,
    };
    const firstPath = path.join(workspaceRoot, "projects", "sample-project", "docs", "artifacts", "overall-exo-architecture.html");
    const secondPath = path.join(workspaceRoot, "projects", "sample-project", "docs", "artifacts", "core-plugin-boundary.html");
    const secondUrl = pathToFileURL(secondPath).toString();

    const firstResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/preview/open`, {
      method: "POST",
      headers: commandHeaders,
      body: JSON.stringify({ target: firstPath }),
    });
    expect(firstResponse.ok).toBe(true);
    await expect(firstResponse.json()).resolves.toMatchObject({
      url: pathToFileURL(firstPath).toString(),
      source: "file",
    });
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", pathToFileURL(firstPath).toString());
    await expect.poll(async () => getPreviewLayoutMetrics(page)).toMatchObject({
      title: "Overall",
      bottomMarkerVisibleAtViewportBottom: true,
      frameFillsPane: true,
      guestViewportMatchesElement: true,
    });

    const secondResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/preview/open`, {
      method: "POST",
      headers: commandHeaders,
      body: JSON.stringify({ target: secondPath }),
    });
    expect(secondResponse.ok).toBe(true);
    await expect(secondResponse.json()).resolves.toMatchObject({ url: secondUrl, source: "file" });
    await expect(page.getByTestId("utility-pane").getByTestId("browser-pane")).toHaveCount(1);
    await expect(page.getByTestId("browser-url-input")).toHaveValue(secondUrl);
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", secondUrl);

    await page.getByTestId("browser-url-input").fill(firstPath);
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", pathToFileURL(firstPath).toString());
    await expect.poll(async () => getPreviewLayoutMetrics(page)).toMatchObject({
      title: "Overall",
      bottomMarkerVisibleAtViewportBottom: true,
      frameFillsPane: true,
      guestViewportMatchesElement: true,
    });
  } finally {
    await cleanup();
  }
});

async function getPreviewLayoutMetrics(page: Page): Promise<{
  title: string;
  bottomMarkerVisibleAtViewportBottom: boolean;
  frameFillsPane: boolean;
  guestViewportMatchesElement: boolean;
  paneHeight: number;
  frameHeight: number;
  guestInnerHeight: number;
  bottomMarkerBottom: number;
}> {
  const shellMetrics = await page.evaluate(async () => {
    const pane = document.querySelector<HTMLElement>("[data-testid='browser-pane']");
    const frame = document.querySelector<HTMLIFrameElement>("[data-testid='browser-preview-frame']");
    if (!pane || !frame) {
      return {
        frameFillsPane: false,
        paneHeight: 0,
        frameHeight: 0,
      };
    }

    const paneRect = pane.getBoundingClientRect();
    const headerRect = pane.querySelector<HTMLElement>(".browser-pane__header")?.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const expectedFrameHeight = paneRect.height - (headerRect?.height ?? 0);

    return {
      frameFillsPane: frameRect.height >= expectedFrameHeight - 2,
      paneHeight: paneRect.height,
      frameHeight: frameRect.height,
    };
  });

  const frameHandle = await page.getByTestId("browser-preview-frame").elementHandle();
  const frame = await frameHandle?.contentFrame();
  if (!frame) {
    return {
      title: "",
      bottomMarkerVisibleAtViewportBottom: false,
      frameFillsPane: shellMetrics.frameFillsPane,
      guestViewportMatchesElement: false,
      paneHeight: shellMetrics.paneHeight,
      frameHeight: shellMetrics.frameHeight,
      guestInnerHeight: 0,
      bottomMarkerBottom: 0,
    };
  }

  const guest = await frame.evaluate(() => {
    const marker = document.getElementById("viewport-bottom");
    const markerRect = marker ? marker.getBoundingClientRect() : { bottom: 0 };
    return {
      title: document.title,
      innerHeight: window.innerHeight,
      bottomMarkerBottom: markerRect.bottom,
    };
  });

  return {
    title: guest.title,
    bottomMarkerVisibleAtViewportBottom: Math.abs(guest.bottomMarkerBottom - guest.innerHeight) <= 2,
    frameFillsPane: shellMetrics.frameFillsPane,
    guestViewportMatchesElement: Math.abs(guest.innerHeight - shellMetrics.frameHeight) <= 2,
    paneHeight: shellMetrics.paneHeight,
    frameHeight: shellMetrics.frameHeight,
    guestInnerHeight: guest.innerHeight,
    bottomMarkerBottom: guest.bottomMarkerBottom,
  };
}

test("keeps an empty preview destination isolated from the editor and terminal", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-preview").click();
    await expect(page.getByTestId("preview-empty-state")).toBeVisible();
    await expect(page.getByTestId("utility-pane").getByTestId("browser-pane")).toHaveCount(0);
    await expect(page.getByTestId("utility-pane").getByTestId("terminal-dock")).toHaveCount(0);
    await expect(page.locator(".workspace-shell__canvas .pane-leaf--editor")).toHaveCount(1);
    await expect(page.locator(".workspace-shell__canvas .pane-leaf--browser")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("returns to the Preview empty state after its final tab closes", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-preview").click();
    await page.getByRole("button", { name: "New preview" }).click();
    await page.getByTestId("browser-tab-preview").getByRole("button", { name: "Close preview pane" }).click();

    await expect(page.getByTestId("preview-empty-state")).toBeVisible();
    await expect(page.getByTestId("utility-pane-terminal")).toHaveAttribute("aria-pressed", "false");
  } finally {
    await cleanup();
  }
});
