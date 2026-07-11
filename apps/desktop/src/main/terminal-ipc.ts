import type { TerminalManager } from "./terminal-manager";
import { handleDesktopInvoke } from "./typed-ipc";

export function registerTerminalIpcHandlers(
  terminalManager: TerminalManager,
): void {
  handleDesktopInvoke("terminals:ensure-default", async () => terminalManager.ensureDefault());
  handleDesktopInvoke("terminals:list", async () => terminalManager.list());
  handleDesktopInvoke("terminals:create", async (_event, options) => terminalManager.create(options));
  handleDesktopInvoke("terminals:read", async (_event, id, options) => terminalManager.readTail(id, options) ?? "");
  handleDesktopInvoke("terminals:write", async (_event, id, data) => terminalManager.write(id, data));
  handleDesktopInvoke("terminals:send-message", async (_event, id, message, submit) =>
    terminalManager.sendMessage(id, message, submit !== false),
  );
  handleDesktopInvoke("terminals:resize", async (_event, id, cols, rows) =>
    terminalManager.resize(id, cols, rows),
  );
  handleDesktopInvoke("terminals:kill", async (_event, id) => terminalManager.kill(id));
}
