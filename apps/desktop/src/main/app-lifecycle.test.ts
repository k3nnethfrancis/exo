import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  appQuit: vi.fn(),
  windows: [] as Array<any>,
  menuTemplate: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  app: {
    quit: electronMock.appQuit,
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
      setTemplateImage: vi.fn(),
    }),
  },
  nativeTheme: {
    shouldUseDarkColors: true,
  },
  Tray: class MockTray extends EventEmitter {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
  },
}));

import { AppLifecycleController } from "./app-lifecycle";

describe("AppLifecycleController", () => {
  beforeEach(() => {
    delete process.env.EXO_TEST;
    delete process.env.ELECTRON_RENDERER_URL;
    delete process.env.VITE_DEV_SERVER_URL;
    electronMock.appQuit.mockClear();
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

  it("destroys windows during explicit quit", () => {
    const controller = appLifecycleController();
    const window = controller.createWindow() as any;
    const event = { preventDefault: vi.fn() };

    controller.requestQuit();
    window.emit("close", event);

    expect(electronMock.appQuit).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("restores a hidden window from the tray show path", () => {
    const controller = appLifecycleController();
    const window = controller.createWindow() as any;
    window.hide();

    controller.showMainWindow();

    expect(window.visible).toBe(true);
    expect(window.focused).toBe(true);
  });
});

function appLifecycleController() {
  return new AppLifecycleController({
    currentDirectory: "/workspace/apps/desktop/src/main",
    getTerminalDiagnostics: () => [],
    logMain: () => {},
  });
}
