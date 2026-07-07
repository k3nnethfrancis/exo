import { describe, expect, it } from "vitest";

import { safeTmuxAttachCommand, terminalDebugAttachInfo } from "./terminal-diagnostics";

describe("terminal diagnostics", () => {
  it("builds a safe human tmux attach command", () => {
    expect(safeTmuxAttachCommand("exo-work-term-1")).toBe("tmux attach-session -t 'exo-work-term-1'");
    expect(safeTmuxAttachCommand("exo'quoted")).toBe("tmux attach-session -t 'exo'\\''quoted'");
    expect(safeTmuxAttachCommand("exo-work-term-1", "exo-work")).toBe("tmux -L 'exo-work' attach-session -t 'exo-work-term-1'");
    expect(safeTmuxAttachCommand("exo-work-term-1", "exo'quoted")).toBe("tmux -L 'exo'\\''quoted' attach-session -t 'exo-work-term-1'");
  });

  it("standardizes debug attach info", () => {
    expect(terminalDebugAttachInfo("exo-work-term-1", "%3")).toEqual({
      tmuxSessionName: "exo-work-term-1",
      tmuxPaneId: "%3",
      safeAttachCommand: "tmux attach-session -t 'exo-work-term-1'",
    });
  });
});
