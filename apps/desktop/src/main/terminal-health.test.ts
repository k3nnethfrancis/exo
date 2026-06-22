import { describe, expect, it } from "vitest";

import { terminalHealth, terminalHealthDetail } from "./terminal-health";

const options = {
  unresponsiveThresholdMs: 5_000,
  idleThresholdMs: 30_000,
};

describe("terminal health classification", () => {
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
});
