import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { registerTerminalRecoveryService } from "./terminal-recovery-service";

describe("terminal recovery service", () => {
  it("reconnects recoverable terminal bridges when macOS resumes", () => {
    const powerMonitor = new EventEmitter() as EventEmitter & {
      on: (event: "resume", listener: () => void) => EventEmitter;
    };
    const terminalManager = {
      reconnectRecoverableTerminals: vi.fn(),
    };
    const logMain = vi.fn();

    registerTerminalRecoveryService({
      powerMonitor,
      terminalManager,
      logMain,
    });

    powerMonitor.emit("resume");

    expect(logMain).toHaveBeenCalledWith("power resume detected; reconciling terminal sessions");
    expect(terminalManager.reconnectRecoverableTerminals).toHaveBeenCalledOnce();
  });
});
