import { describe, expect, it } from "vitest";

import {
  initialTerminalHydrationViewState,
  markTerminalHydrationApplied,
  shouldApplyTerminalHydration,
} from "./terminalHydration";

describe("terminal hydration", () => {
  it("applies hydration only for first mount or explicit refresh", () => {
    const initial = initialTerminalHydrationViewState();
    const bootstrap = { snapshot: "first prompt\n", version: 1, reason: "bootstrap" as const };
    const liveMetadataRefresh = { snapshot: "stale prompt\n", version: 2, reason: "bootstrap" as const };
    const refresh = { snapshot: "refreshed prompt\n", version: 3, reason: "refresh" as const };

    expect(shouldApplyTerminalHydration(initial, { snapshot: "", version: 0, reason: "bootstrap" })).toBe(false);
    expect(shouldApplyTerminalHydration(initial, bootstrap)).toBe(true);

    const live = markTerminalHydrationApplied(initial, bootstrap);
    expect(shouldApplyTerminalHydration(live, liveMetadataRefresh)).toBe(false);
    expect(shouldApplyTerminalHydration(live, refresh)).toBe(true);
  });
});
