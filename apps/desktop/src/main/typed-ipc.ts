import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { DesktopInvokeChannel, DesktopInvokeHandlers } from "../shared/desktop-ipc";

type IpcHandler<C extends DesktopInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: Parameters<DesktopInvokeHandlers[C]>
) => ReturnType<DesktopInvokeHandlers[C]> | Awaited<ReturnType<DesktopInvokeHandlers[C]>>;

export function handleDesktopInvoke<C extends DesktopInvokeChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}
