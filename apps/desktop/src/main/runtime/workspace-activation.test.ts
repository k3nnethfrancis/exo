import { describe, expect, it } from "vitest";

import type { WorkspaceSettings } from "@exo/core";

import { activateWorkspaceAfterRecovery } from "./workspace-activation";

describe("workspace activation recovery ordering", () => {
  it("finishes destination recovery before any activation side effect", async () => {
    const events: string[] = [];
    const destination = { workspaceRoot: "/destination" } as WorkspaceSettings;
    let finishRecovery!: () => void;
    const recovery = new Promise<void>((resolve) => { finishRecovery = resolve; });
    const activating = activateWorkspaceAfterRecovery(
      destination,
      async (settings) => {
        events.push(`recover:${settings.workspaceRoot}`);
        await recovery;
        events.push("recovered");
      },
      (settings) => {
        events.push(`activate:${settings.workspaceRoot}`);
        return settings;
      },
    );

    await Promise.resolve();
    expect(events).toEqual(["recover:/destination"]);
    finishRecovery();
    await expect(activating).resolves.toBe(destination);
    expect(events).toEqual(["recover:/destination", "recovered", "activate:/destination"]);
  });
});
