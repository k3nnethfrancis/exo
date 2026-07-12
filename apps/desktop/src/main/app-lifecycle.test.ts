import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  appQuit: vi.fn(),
  commandServerStatus: { listening: true, port: 4317 as number | null },
  dialogResponse: 1,
  openSettings: vi.fn(),
  restartCommandServer: vi.fn(),
  showMessageBox: vi.fn(),
  trayImageCreateFromDataURL: vi.fn(),
  trayImageCreateFromPath: vi.fn(),
  trayImageSetTemplateImage: vi.fn(),
  trayInstances: [] as Array<any>,
  windows: [] as Array<any>,
  menuTemplate: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  app: {
    quit: electronMock.appQuit,
  },
  dialog: {
    showMessageBox: electronMock.showMessageBox,
  },
  BrowserWindow: class MockBrowserWindow extends EventEmitter {
    static getAllWindows() {
      return electronMock.windows.filter((window) => !window.destroyed);
    }

    readonly webContents = new EventEmitter();
    destroyed = false;
    visible = false;
    hidden = false;
    minimized = false;
    focused = false;
    backgroundColor = "";

    constructor(readonly options: Record<string, unknown>) {
      super();
      electronMock.windows.push(this);
    }

    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);

    isDestroyed() {
      return this.destroyed;
    }

    isVisible() {
      return this.visible;
    }

    show() {
      this.visible = true;
      this.hidden = false;
    }

    hide() {
      this.visible = false;
      this.hidden = true;
    }

    focus() {
      this.focused = true;
    }

    isMinimized() {
      return this.minimized;
    }

    restore() {
      this.minimized = false;
    }

    setBackgroundColor(color: string) {
      this.backgroundColor = color;
    }
  },
  Menu: {
    buildFromTemplate: (template: Array<Record<string, unknown>>) => {
      electronMock.menuTemplate = template;
      return { template };
    },
  },
  nativeImage: {
    createEmpty: () => ({
      setTemplateImage: electronMock.trayImageSetTemplateImage,
    }),
    createFromDataURL: (dataUrl: string) => {
      electronMock.trayImageCreateFromDataURL(dataUrl);
      return {
        setTemplateImage: electronMock.trayImageSetTemplateImage,
      };
    },
    createFromPath: (iconPath: string) => {
      electronMock.trayImageCreateFromPath(iconPath);
      return {
        setTemplateImage: electronMock.trayImageSetTemplateImage,
      };
    },
  },
  nativeTheme: {
    shouldUseDarkColors: true,
  },
  Tray: class MockTray extends EventEmitter {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();

    constructor(readonly image: unknown) {
      super();
      electronMock.trayInstances.push(this);
    }
  },
}));

import { AppLifecycleController } from "./app-lifecycle";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("AppLifecycleController", () => {
  beforeEach(() => {
    delete process.env.EXO_TEST;
    delete process.env.ELECTRON_RENDERER_URL;
    delete process.env.VITE_DEV_SERVER_URL;
    electronMock.appQuit.mockClear();
    electronMock.commandServerStatus = { listening: true, port: 4317 };
    electronMock.dialogResponse = 1;
    electronMock.openSettings.mockClear();
    electronMock.restartCommandServer.mockClear();
    electronMock.showMessageBox.mockReset();
    electronMock.showMessageBox.mockImplementation(async () => ({ response: electronMock.dialogResponse }));
    electronMock.trayImageCreateFromDataURL.mockClear();
    electronMock.trayImageCreateFromPath.mockClear();
    electronMock.trayImageSetTemplateImage.mockClear();
    electronMock.trayInstances.length = 0;
    electronMock.windows.length = 0;
    electronMock.menuTemplate = [];
  });

  it("hides the workspace window on close so the process can keep running", () => {
    const controller = appLifecycleController();
    const window = controller.createWindow() as any;
    const event = { preventDefault: vi.fn() };

    window.show();
    window.emit("close", event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hidden).toBe(true);
    expect(controller.getMainWindow()).toBe(window);
  });

  it("destroys windows during explicit quit", async () => {
    const controller = appLifecycleController();
    const window = controller.createWindow() as any;
    const event = { preventDefault: vi.fn() };

    await controller.requestQuit();
    window.emit("close", event);

    expect(electronMock.appQuit).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("warns before quitting with live terminals", async () => {
    electronMock.dialogResponse = 0;
    const controller = appLifecycleController([{ id: "term-1", status: "running" }]);

    await controller.requestQuit();

    expect(electronMock.showMessageBox).toHaveBeenCalledOnce();
    expect(electronMock.appQuit).not.toHaveBeenCalled();
  });

  it("restores a hidden window from the tray show path", () => {
    const controller = appLifecycleController();
    const window = controller.createWindow() as any;
    window.hide();

    controller.showMainWindow();

    expect(window.visible).toBe(true);
    expect(window.focused).toBe(true);
  });

  it("builds a resident menu with status and recovery actions", () => {
    const controller = appLifecycleController([
      { id: "term-1", status: "running" },
      { id: "term-2", status: "exited" },
    ]);

    controller.createWindow();
    controller.setupTray();

    expect(electronMock.trayImageCreateFromDataURL).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
    expect(electronMock.trayImageCreateFromPath).not.toHaveBeenCalled();
    expect(electronMock.trayImageSetTemplateImage).toHaveBeenCalledWith(true);
    expect(electronMock.trayInstances).toHaveLength(1);
    expect(electronMock.trayInstances[0].setToolTip).toHaveBeenCalledWith("Exo");
    expect(menuLabels()).toContain("Show Exo");
    expect(menuLabels()).toContain("Settings...");
    expect(menuLabels()).toContain("Exo is Running");
    expect(menuLabels()).toContain("Window: Hidden");
    expect(menuLabels()).toContain("Command Server: Running:4317");
    expect(menuLabels()).toContain("Live Terminals: 1");
    expect(menuLabels()).toContain("Restart Command Server");
    expect(menuLabels()).toContain("Quit Exo");
  });

  it("does not require a packaged tray asset on disk", () => {
    const controller = appLifecycleController([], {
      currentDirectory: path.join(currentDirectory, "missing-packaged-dist"),
    });

    controller.setupTray();

    expect(electronMock.trayImageCreateFromDataURL).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
    expect(electronMock.trayImageCreateFromPath).not.toHaveBeenCalled();
    expect(electronMock.trayInstances).toHaveLength(1);
  });

  it("uses a transparent template tray glyph instead of a square app icon", () => {
    const controller = appLifecycleController();

    controller.setupTray();

    const dataUrl = electronMock.trayImageCreateFromDataURL.mock.calls[0]?.[0];
    expect(dataUrl).toEqual(expect.stringMatching(/^data:image\/png;base64,/));

    const image = decodePngRgba(dataUrl);
    expect(image.width).toBe(18);
    expect(image.height).toBe(18);
    expect(image.alphaAt(0, 0)).toBe(0);
    expect(image.alphaAt(image.width - 1, 0)).toBe(0);
    expect(image.alphaAt(0, image.height - 1)).toBe(0);
    expect(image.alphaAt(image.width - 1, image.height - 1)).toBe(0);
  });

  it("opens settings from the resident menu without quitting the runtime", () => {
    const controller = appLifecycleController();
    controller.createWindow();
    controller.setupTray();

    clickMenuItem("Settings...");

    expect(electronMock.openSettings).toHaveBeenCalledOnce();
    expect(electronMock.appQuit).not.toHaveBeenCalled();
  });

  it("restarts command-server discovery from the resident menu", () => {
    const controller = appLifecycleController();
    controller.createWindow();
    controller.setupTray();

    clickMenuItem("Restart Command Server");

    expect(electronMock.restartCommandServer).toHaveBeenCalledOnce();
    expect(electronMock.appQuit).not.toHaveBeenCalled();
  });

  it("reloads the renderer when Electron reports a killed renderer process", () => {
    vi.useFakeTimers();
    try {
      const controller = appLifecycleController();
      const window = controller.createWindow() as any;

      window.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 15 });
      vi.advanceTimersByTime(750);

      expect(window.loadFile).toHaveBeenCalledTimes(2);
      expect(window.visible).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers the packaged renderer entry after a failed hard reload without retrying Preview failures", () => {
    vi.useFakeTimers();
    try {
      const controller = appLifecycleController();
      const window = controller.createWindow() as any;
      const rendererUrl = pathToFileURL(path.join(currentDirectory, "../renderer/index.html")).toString();

      window.webContents.emit("did-fail-load", {}, -2, "ERR_FAILED", rendererUrl);
      vi.advanceTimersByTime(750);

      expect(window.loadFile).toHaveBeenCalledTimes(2);

      window.webContents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://localhost:8765");
      vi.advanceTimersByTime(750);

      expect(window.loadFile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

function appLifecycleController(
  terminals: Array<{ id: string; status: string }> = [],
  overrides: Partial<ConstructorParameters<typeof AppLifecycleController>[0]> = {},
) {
  return new AppLifecycleController({
    currentDirectory,
    getTerminals: () => terminals as any,
    getCommandServerStatus: () => electronMock.commandServerStatus,
    openSettings: electronMock.openSettings,
    restartCommandServer: electronMock.restartCommandServer,
    logMain: () => {},
    ...overrides,
  });
}

function menuLabels(): string[] {
  return electronMock.menuTemplate
    .map((item) => item.label)
    .filter((label): label is string => typeof label === "string");
}

function clickMenuItem(label: string): void {
  const item = electronMock.menuTemplate.find((entry) => entry.label === label);
  expect(item).toBeTruthy();
  expect(item?.click).toBeTypeOf("function");
  (item!.click as () => void)();
}

function decodePngRgba(dataUrl: string): { width: number; height: number; alphaAt: (x: number, y: number) => number } {
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[9]).toBe(6);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows: Buffer[] = [];
  let sourceOffset = 0;
  let previousRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilterPngRow(row, previousRow, filter);
    rows.push(row);
    previousRow = row;
  }

  return {
    width,
    height,
    alphaAt: (x: number, y: number) => rows[y][x * 4 + 3],
  };
}

function unfilterPngRow(row: Buffer, previousRow: Buffer, filter: number): void {
  const bytesPerPixel = 4;
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index];
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
    let value = row[index];

    if (filter === 1) {
      value += left;
    } else if (filter === 2) {
      value += up;
    } else if (filter === 3) {
      value += Math.floor((left + up) / 2);
    } else if (filter === 4) {
      value += paethPredictor(left, up, upLeft);
    } else {
      expect(filter).toBe(0);
    }

    row[index] = value & 0xff;
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}
