import { describe, expect, it } from "vitest";

import { terminalRenderStabilityBody, terminalRenderStabilityIssues } from "../../../../tests/terminalRenderStability";
import { TerminalOutputChunker, chunkTerminalData } from "./terminalOutputChunks";

describe("terminal output chunking", () => {
  it("preserves the terminal render-stability corpus across renderer write chunks", () => {
    const renderStabilityOutput = terminalRenderStabilityBody();

    const chunks = chunkTerminalData(renderStabilityOutput, 7);

    expect(chunks.join("")).toBe(renderStabilityOutput);
    expect(terminalRenderStabilityIssues(chunks.join(""), { requireExpectedFragments: true })).toEqual([]);
    expect(chunks.every((chunk) => !endsWithHighSurrogate(chunk) && !startsWithLowSurrogate(chunk))).toBe(true);
  });

  it("does not split surrogate-pair emoji across xterm write chunks", () => {
    const chunks = chunkTerminalData(`ab🙂cd`, 3);

    expect(chunks).toEqual(["ab", "🙂c", "d"]);
    expect(chunks.join("")).toBe("ab🙂cd");
    expect(chunks.every((chunk) => !endsWithHighSurrogate(chunk) && !startsWithLowSurrogate(chunk))).toBe(true);
  });

  it("does not split CSI cursor-position sequences across xterm write chunks", () => {
    const chunks = chunkTerminalData("abcd\x1b[12;34Hef", 7);

    expect(chunks).toEqual(["abcd", "\x1b[12;34H", "ef"]);
    expect(chunks.join("")).toBe("abcd\x1b[12;34Hef");
  });

  it("does not split OSC sequences across xterm write chunks", () => {
    const chunks = chunkTerminalData("ab\x1b]10;rgb:ffff/ffff/ffff\x1b\\cd", 8);

    expect(chunks).toEqual(["ab", "\x1b]10;rgb:ffff/ffff/ffff\x1b\\", "cd"]);
    expect(chunks.join("")).toBe("ab\x1b]10;rgb:ffff/ffff/ffff\x1b\\cd");
  });

  it("carries surrogate pairs split across terminal data events", () => {
    const chunker = new TerminalOutputChunker();
    const emoji = "🙂";
    const high = emoji.charAt(0);
    const low = emoji.charAt(1);

    expect(chunker.chunks(`prompt ${high}`, 64)).toEqual(["prompt "]);
    expect(chunker.chunks(`${low} ready`, 64)).toEqual(["🙂 ready"]);
  });

  it("clears pending surrogate data when the terminal stream resets", () => {
    const chunker = new TerminalOutputChunker();
    const emoji = "🙂";

    expect(chunker.chunks(emoji.charAt(0), 64)).toEqual([]);
    chunker.reset();
    expect(chunker.chunks("fresh", 64)).toEqual(["fresh"]);
  });
});

function endsWithHighSurrogate(value: string): boolean {
  const code = value.charCodeAt(value.length - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

function startsWithLowSurrogate(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}
