import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { test, expect } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("renders visible content from a localhost preview", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><h1>Preview content loaded</h1></body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Preview fixture server did not expose a TCP port");
  }
  const url = `http://127.0.0.1:${address.port}/preview`;
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-preview").click();
    await page.getByRole("button", { name: "New preview" }).click();
    await page.getByTestId("browser-url-input").fill(url);
    const frameNavigation = page.waitForEvent("framenavigated", (frame) => frame.url() === url);
    await page.getByTestId("browser-url-input").press("Enter");

    const previewFrame = await frameNavigation;
    await expect(previewFrame.getByRole("heading", { name: "Preview content loaded" })).toBeVisible();
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

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

test("resizes the utility pane from its left edge", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByTestId("utility-pane-toggle").click();
    const utilityPane = page.getByTestId("utility-pane");
    const resizer = page.getByTestId("utility-pane-resizer");
    const before = await utilityPane.boundingBox();
    const handle = await resizer.boundingBox();
    expect(before).not.toBeNull();
    expect(handle).not.toBeNull();

    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 120);
    await page.mouse.down();
    await page.mouse.move(handle!.x - 140, handle!.y + 120, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await utilityPane.boundingBox())?.width ?? 0).toBeGreaterThan(before!.width + 100);
  } finally {
    await cleanup();
  }
});

test("opens absolute local HTML paths in the preview pane", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (root) => {
      const artifactRoot = path.join(root, "notes", "test-notes", "artifacts");
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
    const firstPath = path.join(workspaceRoot, "notes", "test-notes", "artifacts", "overall-exo-architecture.html");
    const secondPath = path.join(workspaceRoot, "notes", "test-notes", "artifacts", "core-plugin-boundary.html");
    const secondUrl = pathToFileURL(secondPath).toString();

    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-preview").click();
    await page.getByRole("button", { name: "New preview" }).click();
    await page.getByTestId("browser-url-input").fill(firstPath);
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", pathToFileURL(firstPath).toString());
    await expect.poll(async () => getPreviewLayoutMetrics(page)).toMatchObject({
      title: "Overall",
      bottomMarkerVisibleAtViewportBottom: true,
      frameFillsPane: true,
      guestViewportMatchesElement: true,
    });

    await page.getByTestId("browser-url-input").fill(secondPath);
    await page.getByTestId("browser-load-url").click();
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

test("switches one utility pane between independent Preview, Terminal, and Connections destinations", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await expect.poll(async () => page.evaluate(() => window.exo.terminals.list())).toEqual([]);

    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-preview").click();
    await page.getByRole("button", { name: "New preview" }).click();
    await page.getByTestId("browser-url-input").fill("http://localhost:8765/blog/self-improving-business-systems");
    await page.getByTestId("browser-url-input").press("Enter");
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute(
      "src",
      "http://localhost:8765/blog/self-improving-business-systems",
    );

    await page.getByTestId("utility-pane-terminal").click();
    await expect(page.getByTestId("utility-pane-terminal")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("terminal-dock")).toBeVisible();
    await expect(page.getByTestId("browser-pane")).toHaveCount(0);
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.exo.terminals.list())).toEqual([]);

    await page.getByTestId("new-terminal").click();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(1);
    await expect.poll(async () => page.evaluate(async () => (await window.exo.terminals.list()).length)).toBe(1);

    await page.getByTestId("utility-pane-connections").click();
    await expect(page.getByTestId("utility-pane-connections")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("inspector-panel")).toBeVisible();
    await expect(page.getByTestId("browser-pane")).toHaveCount(0);
    await expect(page.getByTestId("terminal-dock")).toHaveCount(0);

    await page.getByTestId("utility-pane-preview").click();
    await expect(page.getByTestId("utility-pane-preview")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("browser-url-input")).toHaveValue(
      "http://localhost:8765/blog/self-improving-business-systems",
    );
    await expect(page.getByTestId("terminal-dock")).toHaveCount(0);
    await expect(page.getByTestId("inspector-panel")).toHaveCount(0);

    await page.getByTestId("utility-pane-terminal").click();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(1);
    await expect(page.getByTestId("browser-pane")).toHaveCount(0);
    await expect(page.getByTestId("inspector-panel")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(async () => (await window.exo.terminals.list()).length)).toBe(1);
  } finally {
    await cleanup();
  }
});
