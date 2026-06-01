import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  appQuit: vi.fn(),
  commandServerStatus: { listening: true, port: 4317 as number | null },
  dialogResponse: 1,
  openSettings: vi.fn(),
  restartCommandServer: vi.fn(),
  showMessageBox: vi.fn(),
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
    createFromDataURL: () => ({
      setTemplateImage: electronMock.trayImageSetTemplateImage,
    }),
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
});

function appLifecycleController(terminals: Array<{ id: string; status: string }> = []) {
  return new AppLifecycleController({
    currentDirectory: "/workspace/apps/desktop/src/main",
    getTerminalDiagnostics: () => terminals as any,
    getCommandServerStatus: () => electronMock.commandServerStatus,
    openSettings: electronMock.openSettings,
    restartCommandServer: electronMock.restartCommandServer,
    logMain: () => {},
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
