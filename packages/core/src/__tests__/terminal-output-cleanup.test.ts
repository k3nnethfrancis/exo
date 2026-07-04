import { StringDecoder } from "node:string_decoder";

import { describe, expect, it } from "vitest";

import { cleanTerminalOutput } from "../terminal-output-cleanup";

describe("terminal output cleanup", () => {
  it("formats deterministic fake agent output for operator readback", () => {
    const decoder = new StringDecoder("utf8");
    const splitEuro = Buffer.from("€", "utf8");
    const splitEmoji = Buffer.from("🙂", "utf8");
    const transcript = [
      "\u001b[?25l",
      "\u001b(0lqqqqqqqqk\u001b(B\r⠋ Thinking",
      "\r⠙ Thinking",
      "\r\u001b[2K\u001b(0x\u001b(B Codex ready ",
      decoder.write(splitEuro.subarray(0, 1)),
      decoder.write(splitEuro.subarray(1)),
      " ",
      decoder.write(splitEmoji.subarray(0, 2)),
      decoder.write(splitEmoji.subarray(2)),
      " \u001b(0x\u001b(B\n",
      "\u001b(0mqqqqqqqqj\u001b(B\n",
      "\u001b]0;agent-title\u0007answer line\u001b[?25h\n",
      decoder.end(),
    ].join("");

    const output = cleanTerminalOutput(transcript);

    expect(output).toContain("│ Codex ready € 🙂 │");
    expect(output).toContain("└────────┘");
    expect(output).toContain("answer line");
    expect(output).not.toContain("qqqq");
    expect(output).not.toContain("Thinking");
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\ufffd");
  });

  it("drops absolute cursor-addressed repaint fragments from transcript tails", () => {
    const output = cleanTerminalOutput(
      "\u001b[55;2H\u001b[0m\u001b[m\u001b[K\u001b[56;3HW\u001b[56;8H\u001b[1mn\u001b[22mg\u001b[m\u001b[0 q\u001b[?25h\u001b[59;3H\u001b[?2026l\n",
    );

    expect(output).toBe("");
  });

  it("drops leading partial CSI fragments when a bounded tail starts inside an escape", () => {
    expect(cleanTerminalOutput("0m\u001b[m\u001b[K")).toBe("");
    expect(cleanTerminalOutput("2H\n")).toBe("");
    expect(cleanTerminalOutput("[58;2H\n")).toBe("");
  });
});
