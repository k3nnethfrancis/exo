import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeUtf8TailBuffer, TerminalTranscriptStore } from "./terminal-transcripts";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("TerminalTranscriptStore", () => {
  it("decodes tail buffers without leading replacement characters when they start inside UTF-8 glyphs", () => {
    const splitBoxDrawing = Buffer.concat([
      Buffer.from("─", "utf8").subarray(1),
      Buffer.from("box", "utf8"),
    ]);
    const splitEmoji = Buffer.concat([
      Buffer.from("🙂", "utf8").subarray(2),
      Buffer.from("emoji", "utf8"),
    ]);

    expect(decodeUtf8TailBuffer(splitBoxDrawing)).toBe("box");
    expect(decodeUtf8TailBuffer(splitEmoji)).toBe("emoji");
  });

  it("preserves multibyte glyph transcript tails without introducing leading replacements", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-terminal-transcripts-"));
    tempPaths.push(tempRoot);
    const store = new TerminalTranscriptStore(path.join(tempRoot, "transcripts"));
    const transcriptPath = path.join(tempRoot, "transcripts", "term-1.ansi.log");

    const repeatedTail = "tail ─ 🙂 ".repeat(1200);
    await writeFile(transcriptPath, `prefix ─ 🙂\n${repeatedTail}`, "utf8");

    const tail = store.read(transcriptPath, 128);

    expect(tail.startsWith("\uFFFD")).toBe(false);
    expect(tail).toBe(repeatedTail.slice(-128));
    expect(tail).toContain("─");
    expect(tail).toContain("🙂");
  });
});
