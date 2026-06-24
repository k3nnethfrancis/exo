import { describe, expect, it } from "vitest";

import { terminalHealth, terminalHealthDetail } from "./terminal-health";

const options = {
  unresponsiveThresholdMs: 5_000,
  idleThresholdMs: 30_000,
};

describe("terminal health classification", () => {
  it("reports exited sessions as exited with process detail", () => {
    const input = {
      status: "exited" as const,
      exitCode: 0,
    };

    expect(terminalHealth(input, options)).toBe("exited");
    expect(terminalHealthDetail(input, options)).toBe("Process exited with code 0.");
  });

  it("reports missing tmux panes as unhealthy with the transcript recovery detail", () => {
    const input = {
      status: "running" as const,
      paneStatus: "missing" as const,
    };

    expect(terminalHealth(input, options)).toBe("unhealthy");
    expect(terminalHealthDetail(input, options)).toBe("Tmux session is missing; transcript remains available.");
  });

  it("reports delayed output after input as unhealthy", () => {
    const input = {
      status: "running" as const,
      paneStatus: "alive" as const,
      lastInputAt: 10_000,
      lastOutputAt: 9_000,
    };

    expect(terminalHealth(input, options, 16_000)).toBe("unhealthy");
    expect(terminalHealthDetail(input, options, 16_000)).toBe("Input was sent but no terminal output has been observed for more than 5 seconds.");
  });

  it("reports detached tmux bridges as unhealthy with reconnect detail", () => {
    const input = {
      status: "running" as const,
      paneStatus: "alive" as const,
      bridgeDetached: true,
    };

    expect(terminalHealth(input, options)).toBe("unhealthy");
    expect(terminalHealthDetail(input, options)).toBe("Tmux session is alive but Exo's attach bridge is detached; reconnect the terminal.");
  });

  it("reports old output as idle", () => {
    const input = {
      status: "running" as const,
      paneStatus: "alive" as const,
      lastOutputAt: 10_000,
    };

    expect(terminalHealth(input, options, 41_000)).toBe("idle");
    expect(terminalHealthDetail(input, options, 41_000)).toBe("No recent terminal output; terminal may simply be waiting for input.");
  });

  it("reports recent output as healthy", () => {
    const input = {
      status: "running" as const,
      paneStatus: "alive" as const,
      lastInputAt: 39_000,
      lastOutputAt: 40_000,
    };

    expect(terminalHealth(input, options, 41_000)).toBe("healthy");
    expect(terminalHealthDetail(input, options, 41_000)).toBe("Recent terminal input/output observed.");
  });
});
