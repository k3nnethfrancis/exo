import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import type { TerminalDiagnostics } from "../shared/api";

export interface AppLifecycleControllerOptions {
  currentDirectory: string;
  getTerminalDiagnostics: () => TerminalDiagnostics[];
  logMain: (message: string, details?: unknown) => void;
}

const MENU_BAR_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaklEQVQ4T2NkoBAwUqifgWoGzP7/n+E/AwMDIyMjw+z//xkYGBgZGGb9/8/AABJjZGRkmMXIwMAAEmNiYmKYxcDAwACyAcQGsUFiIHVMTEyzGEBOALsBpA/mBJAbQOEACweKkgHVkgEA+XIjEZSfLzQAAAAASUVORK5CYII=";

export class AppLifecycleController {
  private mainWindow: BrowserWindow | null = null;
  private rendererReady = false;
  private tray: Tray | null = null;
  private quitRequested = false;
  private readonly rendererRecoveryTimestamps: number[] = [];

  constructor(private readonly options: AppLifecycleControllerOptions) {}

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  isRendererReady(): boolean {
    return this.rendererReady;
  }

  createWindow(): BrowserWindow {
    const preloadPath = this.resolvePreloadPath();
    const isTestWindow = process.env.EXO_TEST === "1";
    const window = new BrowserWindow({
      width: 1680,
      height: 1060,
      minWidth: 640,
      minHeight: 480,
      show: false,
      title: "Exo",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#111318" : "#f6ecda",
      icon: this.resolveWindowIconPath(),
      titleBarStyle: "hiddenInset",
      trafficLightPosition: {
        x: 16,
        y: 14,
      },
      webPreferences: {
        preload: preloadPath,
        webviewTag: true,
      },
    });

    this.loadRenderer(window);

    window.webContents.on("did-start-loading", () => {
      if (this.mainWindow === window) {
        this.rendererReady = false;
      }
    });

    const showTimeout = isTestWindow
      ? null
      : setTimeout(() => {
          if (!window.isDestroyed() && !window.isVisible()) {
            window.show();
          }
        }, 5000);

    window.once("ready-to-show", () => {
      if (showTimeout) clearTimeout(showTimeout);
      if (isTestWindow) {
        return;
      }
      window.show();
    });

    window.webContents.on("did-finish-load", () => {
      if (showTimeout) clearTimeout(showTimeout);
      if (window.isDestroyed()) {
        return;
      }
      if (this.mainWindow === window) {
        this.rendererReady = true;
      }
      if (isTestWindow) {
        return;
      }
      if (!window.isVisible()) {
        window.show();
      }
    });

    window.webContents.on("render-process-gone", (_event, details) => {
      if (this.mainWindow === window) {
        this.rendererReady = false;
      }
      const diagnostics = {
        ...details,
        gpuDisabled: process.env.EXO_ENABLE_GPU !== "1",
        terminals: this.options.getTerminalDiagnostics(),
      };
      console.error("[main] renderer process gone", diagnostics);
      this.options.logMain("renderer process gone", diagnostics);
      this.scheduleRendererRecovery(window, details.reason);
    });

    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      const details = { errorCode, errorDescription, validatedURL };
      console.error("[main] renderer failed to load", details);
      this.options.logMain("renderer failed to load", details);
    });

    this.mainWindow = window;

    window.on("close", (event) => {
      if (this.shouldDestroyWindowOnClose()) {
        return;
      }
      event.preventDefault();
      window.hide();
    });

    window.on("closed", () => {
      if (this.mainWindow === window) {
        this.mainWindow = null;
        this.rendererReady = false;
      }
    });

    return window;
  }

  setupTray() {
    const icon = nativeImage.createFromDataURL(MENU_BAR_ICON_DATA_URL);
    icon.setTemplateImage(true);

    this.tray = new Tray(icon);
    this.tray.setToolTip("Exo");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Exo",
        click: () => this.showMainWindow(),
      },
      { type: "separator" },
      { label: "Quit", click: () => this.requestQuit() },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.on("click", () => this.showMainWindow());
  }

  showMainWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.createWindow();
      return;
    }

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }

    if (!this.mainWindow.isVisible()) {
      this.mainWindow.show();
    }

    this.mainWindow.focus();
  }

  updateBackgroundForTheme() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111318" : "#f6ecda");
  }

  activate() {
    if (BrowserWindow.getAllWindows().length === 0) {
      this.createWindow();
      return;
    }
    this.showMainWindow();
  }

  prepareToQuit() {
    this.quitRequested = true;
  }

  requestQuit() {
    this.prepareToQuit();
    app.quit();
  }

  private loadRenderer(window: BrowserWindow) {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      void window.loadURL(devServerUrl);
    } else {
      void window.loadFile(path.join(this.options.currentDirectory, "../renderer/index.html"));
    }
  }

  private scheduleRendererRecovery(window: BrowserWindow, reason: string) {
    if (process.env.EXO_AUTO_RECOVER_RENDERER === "0") {
      return;
    }
    if (reason !== "crashed" && reason !== "oom") {
      return;
    }

    const now = Date.now();
    while (this.rendererRecoveryTimestamps.length > 0 && now - this.rendererRecoveryTimestamps[0] > 60_000) {
      this.rendererRecoveryTimestamps.shift();
    }
    if (this.rendererRecoveryTimestamps.length >= 3) {
      this.options.logMain("renderer auto recovery suppressed", {
        reason,
        recentRecoveries: this.rendererRecoveryTimestamps.length,
      });
      return;
    }
    this.rendererRecoveryTimestamps.push(now);

    setTimeout(() => {
      if (window.isDestroyed() || this.mainWindow !== window) {
        return;
      }
      this.options.logMain("renderer auto recovery reload", { reason });
      this.loadRenderer(window);
      if (!window.isVisible()) {
        window.show();
      }
    }, 750);
  }

  private shouldDestroyWindowOnClose(): boolean {
    return this.quitRequested || process.env.EXO_TEST === "1";
  }

  private resolveWindowIconPath(): string | undefined {
    const iconPath = path.join(this.options.currentDirectory, "../../build/icon.png");
    return existsSync(iconPath) ? iconPath : undefined;
  }

  private resolvePreloadPath(): string {
    const candidatePaths = [
      path.join(this.options.currentDirectory, "../preload/index.js"),
      path.join(this.options.currentDirectory, "../preload/index.mjs"),
    ];
    const existing = candidatePaths.find((candidate) => existsSync(candidate));
    return existing ?? candidatePaths[0];
  }
}
