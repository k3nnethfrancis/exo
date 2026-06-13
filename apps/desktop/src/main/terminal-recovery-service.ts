import type { TerminalManager } from "./terminal-manager";

export interface ResumeEventSource {
  on(event: "resume", listener: () => void): unknown;
}

export interface TerminalRecoveryServiceOptions {
  powerMonitor: ResumeEventSource;
  terminalManager: Pick<TerminalManager, "reconnectRecoverableTerminals">;
  logMain: (message: string, data?: Record<string, unknown>) => void;
}

export function registerTerminalRecoveryService(options: TerminalRecoveryServiceOptions): void {
  options.powerMonitor.on("resume", () => {
    options.logMain("power resume detected; reconciling terminal sessions");
    options.terminalManager.reconnectRecoverableTerminals();
  });
}
