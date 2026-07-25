import { describe, expect, it, vi } from "vitest";

import { focusTerminal, registerTerminal, unregisterTerminal, writeTerminalData } from "./terminalRegistry";

describe("terminal renderer registry", () => {
  it("refreshes the terminal surface before focusing after pane handoff", () => {
    const terminal = { focus: vi.fn() };
    const refresh = vi.fn();

    registerTerminal("terminal-1", 1, terminal as never, vi.fn(), refresh);
    try {
      expect(focusTerminal("terminal-1")).toBe(true);
      expect(refresh).toHaveBeenCalledBefore(terminal.focus);
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    } finally {
      unregisterTerminal("terminal-1");
    }
  });

  it("does not refresh unrelated registered terminal surfaces during pane handoff", () => {
    const refreshOne = vi.fn();
    const refreshTwo = vi.fn();

    registerTerminal("terminal-1", 1, { focus: vi.fn() } as never, vi.fn(), refreshOne);
    registerTerminal("terminal-2", 1, { focus: vi.fn() } as never, vi.fn(), refreshTwo);
    try {
      expect(focusTerminal("terminal-1")).toBe(true);
      expect(refreshOne).toHaveBeenCalledTimes(1);
      expect(refreshTwo).not.toHaveBeenCalled();
    } finally {
      unregisterTerminal("terminal-1");
      unregisterTerminal("terminal-2");
    }
  });

  it("accepts only the registered attach generation for mounted terminal writes", () => {
    const write = vi.fn();

    registerTerminal("terminal-1", 1, { focus: vi.fn() } as never, write);
    try {
      expect(writeTerminalData("terminal-1", 2, "new generation")).toBe(false);
      expect(writeTerminalData("terminal-1", 1, "current generation")).toBe(true);
      registerTerminal("terminal-1", 2, { focus: vi.fn() } as never, write);
      expect(writeTerminalData("terminal-1", 1, "stale generation")).toBe(false);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith("current generation");
    } finally {
      unregisterTerminal("terminal-1");
    }
  });
});
