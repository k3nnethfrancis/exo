import type { WorkspaceSettings } from "@exo/core";

/** Keep destination settings private until durable invocation recovery finishes. */
export async function activateWorkspaceAfterRecovery<T>(
  settings: WorkspaceSettings,
  recover: (settings: WorkspaceSettings) => Promise<void>,
  activate: (settings: WorkspaceSettings) => T | Promise<T>,
): Promise<T> {
  await recover(settings);
  return activate(settings);
}
