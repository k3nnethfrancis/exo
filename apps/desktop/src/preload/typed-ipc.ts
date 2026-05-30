import { ipcRenderer } from "electron";

import type { DesktopInvokeChannel, DesktopInvokeHandlers } from "../shared/desktop-ipc";

export function invokeDesktop<C extends DesktopInvokeChannel>(
  channel: C,
  ...args: Parameters<DesktopInvokeHandlers[C]>
): ReturnType<DesktopInvokeHandlers[C]> {
  return ipcRenderer.invoke(channel, ...args) as ReturnType<DesktopInvokeHandlers[C]>;
}
