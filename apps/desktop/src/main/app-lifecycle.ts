import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import type { TerminalDiagnostics } from "../shared/api";

const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAASoAMABAAAAAEAAAASAAAAAJqpslUAAAGfaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjEwMjQ8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+MTAyNDwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgpVgmNYAAACQElEQVQ4Ea1S0WoTURA9u5tdZYvFPlTUFkUJSdpoaU1JmmAtiiL6IPgJCj7om98k6EORIir2oaiIlWgo1mjapjW2VIUkNpVE3E2yu4kzVxJ3o0aEXri7996ZOTPnzEhm6WMTO7DkHcAQEP8EUlUfNE2DJEldc3YFkmUZ88kU7t57gFqt1hXsNyAO1jRVBJmmicxSFvW6hQ8bm1AUBarPBx/tzuUBYpCt0jaezScpuA69R8dwKIDVtRwC/qMiNp1ZxtJyFuzrXt4bWWbnnmD7a5kovYIiK5hMxBAeDopqFtPvsPD6DVK084WiB8xToyRLGDiwH6mFRYSHgpCJImg4GOB9bh2hYACWbaNH19HbuwfN5q/J8QA5toMzUydxYvQ4Hs7OIfniJXQKKpcruHHtCgYHDsIwDMGI9forELeYHfr39ZPYwK0706hWa+jr24tB0siqfBOjwACNRsMtEaTWZDPId8r2+OlzbH76jMjoCKYmE7BtC1ev38S506cwEY/ibToDwzRw8fxZQbFVVVtsbutKdg1Vmhdu70Q0AsuyKKuERGwcfqoou7KK3PqG0KlQ/PJnsVnE8FAIxa0SjlGXGCyfL2Dm/iMS2Y94PAY4Do4cPoRypSL+Dt1bq02NH5iepqpwiL9Cc3J7egbcyd3aLly+dIGmuy4SsN/PalswQJsaPzHfGg2iTdXZlC06PoYmgUbGRmBbtohiWycIGzwVCU/Xhzvoo820O7vkchNHzxx1GlkDtw6ddvfdQ81t+N/zD2rF6f+bjIXyAAAAAElFTkSuQmCC";

export interface AppLifecycleControllerOptions {
  currentDirectory: string;
  getTerminalDiagnostics: () => TerminalDiagnostics[];
  getCommandServerStatus: () => { listening: boolean; port: number | null };
  openSettings: () => void;
  restartCommandServer: () => void;
  logMain: (message: string, details?: unknown) => void;
}

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
      this.updateTrayMenu();
    });

    window.on("closed", () => {
      if (this.mainWindow === window) {
        this.mainWindow = null;
        this.rendererReady = false;
      }
      this.updateTrayMenu();
    });

    window.on("show", () => this.updateTrayMenu());
    window.on("hide", () => this.updateTrayMenu());

    return window;
  }

  setupTray() {
    if (this.tray) {
      this.updateTrayMenu();
      return;
    }

    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
    icon.setTemplateImage(true);

    this.tray = new Tray(icon);
    this.tray.setToolTip("Exo");
    this.updateTrayMenu();
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
    this.updateTrayMenu();
  }

  openSettings() {
    this.showMainWindow();
    this.options.openSettings();
    this.updateTrayMenu();
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

  async requestQuit() {
    if (!(await this.confirmQuit())) {
      return;
    }
    this.prepareToQuit();
    app.quit();
  }

  updateTrayMenu() {
    if (!this.tray) {
      return;
    }

    const runningTerminalCount = this.options.getTerminalDiagnostics()
      .filter((terminal) => terminal.status === "running").length;
    const commandServerStatus = this.options.getCommandServerStatus();
    const windowVisible = Boolean(this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible());

    const template: MenuItemConstructorOptions[] = [
      {
        label: "Show Exo",
        click: () => this.showMainWindow(),
      },
      {
        label: "Settings...",
        click: () => this.openSettings(),
      },
      { type: "separator" },
      {
        label: "Exo is Running",
        enabled: false,
      },
      {
        label: `Window: ${windowVisible ? "Visible" : "Hidden"}`,
        enabled: false,
      },
      {
        label: commandServerStatus.listening
          ? `Command Server: Running${commandServerStatus.port ? `:${commandServerStatus.port}` : ""}`
          : "Command Server: Stopped",
        enabled: false,
      },
      {
        label: `Live Terminals: ${runningTerminalCount}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Restart Command Server",
        click: () => {
          this.options.restartCommandServer();
          this.updateTrayMenu();
        },
      },
      { type: "separator" },
      { label: "Quit Exo", click: () => void this.requestQuit() },
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
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
    if (!shouldRecoverRenderer(reason)) {
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

  private async confirmQuit(): Promise<boolean> {
    const runningTerminals = this.options.getTerminalDiagnostics().filter((terminal) => terminal.status === "running");
    if (runningTerminals.length === 0) {
      return true;
    }

    const message = runningTerminals.length === 1 ? "Quit Exo and stop 1 live terminal?" : `Quit Exo and stop ${runningTerminals.length} live terminals?`;
    const detail = "Closing the window keeps Exo running in the background. Quitting Exo stops live terminal and agent processes.";
    const options = {
      type: "warning" as const,
      buttons: ["Cancel", "Quit Exo"],
      defaultId: 0,
      cancelId: 0,
      message,
      detail,
    };
    const result = this.mainWindow && !this.mainWindow.isDestroyed()
      ? await dialog.showMessageBox(this.mainWindow, options)
      : await dialog.showMessageBox(options);
    return result.response === 1;
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

function shouldRecoverRenderer(reason: string): boolean {
  return reason === "crashed" || reason === "oom" || reason === "killed" || reason === "abnormal-exit" || reason === "launch-failed";
}
