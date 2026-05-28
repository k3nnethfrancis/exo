import { ipcMain } from "electron";

import type { TerminalCreateOptions } from "../shared/api";
import type { TerminalManager } from "./terminal-manager";

export function registerTerminalIpcHandlers(
  terminalManager: TerminalManager,
  streamingTerminalIds: Set<string>,
): void {
  ipcMain.handle("terminals:ensure-default", async () => terminalManager.ensureDefault());
  ipcMain.handle("terminals:list", async () => terminalManager.list());
  ipcMain.handle("terminals:diagnostics", async () => terminalManager.diagnostics());
  ipcMain.handle("terminals:create", async (_event, options: TerminalCreateOptions) => terminalManager.create(options));
  ipcMain.handle("terminals:read", async (_event, id: string) => terminalManager.readBuffer(id) ?? "");
  ipcMain.handle("terminals:read-transcript", async (_event, id: string, tailChars?: number) =>
    terminalManager.readTranscript(id, typeof tailChars === "number" ? tailChars : 0) ?? "",
  );
  ipcMain.handle("terminals:write", async (_event, id: string, data: string) => terminalManager.write(id, data));
  ipcMain.handle("terminals:resize", async (_event, id: string, cols: number, rows: number) =>
    terminalManager.resize(id, cols, rows),
  );
  ipcMain.handle("terminals:set-streaming", async (_event, ids: string[]) => {
    streamingTerminalIds.clear();
    for (const id of ids) {
      streamingTerminalIds.add(id);
    }
  });
  ipcMain.handle("terminals:kill", async (_event, id: string) => terminalManager.kill(id, { terminate: true }));
}
