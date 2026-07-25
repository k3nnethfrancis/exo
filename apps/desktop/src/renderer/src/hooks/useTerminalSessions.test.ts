import { describe, expect, it } from "vitest";

import {
  appendPendingTerminalData,
  mergeHydrationSnapshot,
  shouldBufferTerminalDataForHydration,
  shouldSkipTerminalHydration,
} from "./useTerminalSessions";

describe("terminal session hydration state", () => {
  it("preserves terminal data that arrives before or during hydration", () => {
    expect(mergeHydrationSnapshot("", "claude ready\n")).toBe("claude ready\n");
    expect(mergeHydrationSnapshot("boot\nclaude", "claude ready\n")).toBe("boot\nclaude ready\n");
    expect(mergeHydrationSnapshot("boot\nclaude ready\n", "claude ready\n")).toBe("boot\nclaude ready\n");
  });

  it("caps pending terminal data to the newest content", () => {
    expect(appendPendingTerminalData({ generation: 1, data: "abcdef" }, 1, "ghij", 6)).toEqual({
      generation: 1,
      data: "efghij",
    });
    expect(appendPendingTerminalData({ generation: 1, data: "abcdef" }, 2, "ghij", 6)).toEqual({
      generation: 2,
      data: "ghij",
    });
  });

  it("does not split terminal Unicode while capping pending hydration data", () => {
    const emoji = "🙂";
    const high = emoji.charAt(0);
    const low = emoji.charAt(1);

    expect(appendPendingTerminalData({ generation: 1, data: `abc${high}` }, 1, low, 4).data).toBe(`bc${emoji}`);
    expect(appendPendingTerminalData({ generation: 1, data: `abc${emoji}` }, 1, "de", 4).data).toBe(`${emoji}de`);
    expect(appendPendingTerminalData({ generation: 1, data: `abc${emoji}` }, 1, "de", 3).data).toBe("de");
    expect(appendPendingTerminalData({ generation: 1, data: `abc${high}` }, 1, "", 1).data).toBe("");
  });

  it("skips mounted hydrated terminal reads unless refresh forces a snapshot", () => {
    const hydrated = new Set(["term-a"]);
    const pending = new Set<string>();

    expect(shouldSkipTerminalHydration("term-a", hydrated, pending)).toBe(true);
    expect(shouldSkipTerminalHydration("term-a", hydrated, pending, { force: true })).toBe(false);
    expect(shouldSkipTerminalHydration("term-b", hydrated, pending)).toBe(false);
    expect(shouldSkipTerminalHydration("term-a", hydrated, new Set(["term-a"]), { force: true })).toBe(true);
  });

  it("does not keep React-owned live terminal data after hydration is live", () => {
    expect(shouldBufferTerminalDataForHydration(false, undefined, true)).toBe(true);
    expect(shouldBufferTerminalDataForHydration(true, undefined, true)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "bootstrap", false)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "bootstrap", true)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "refresh", true)).toBe(false);
  });
});
