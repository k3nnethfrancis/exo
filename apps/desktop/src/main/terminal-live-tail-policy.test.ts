import { describe, expect, it } from "vitest";

import { selectTerminalLiveTail } from "./terminal-live-tail-policy";

describe("terminal live tail policy", () => {
  it("prefers a bounded tmux capture for line-limited reads", () => {
    expect(
      selectTerminalLiveTail({
        buffered: "cache-1\ncache-2\n",
        captured: "tmux-1\ntmux-2\ntmux-3\n",
        maxLines: 2,
      }),
    ).toEqual({
      text: "tmux-3\n",
      cacheCapturedTail: false,
    });
  });

  it("uses and caches a longer unbounded tmux capture", () => {
    expect(
      selectTerminalLiveTail({
        buffered: "cache\n",
        captured: "cache\nrestored\n",
      }),
    ).toEqual({
      text: "cache\nrestored\n",
      cacheCapturedTail: true,
    });
  });

  it("falls back to the bounded cache when tmux capture is unavailable", () => {
    expect(
      selectTerminalLiveTail({
        buffered: "cache-1\ncache-2\ncache-3\n",
        captured: null,
        maxLines: 2,
      }),
    ).toEqual({
      text: "cache-3\n",
      cacheCapturedTail: false,
    });
  });

  it("keeps the cache when an unbounded capture is not newer than the cache", () => {
    expect(
      selectTerminalLiveTail({
        buffered: "cache-output\n",
        captured: "old\n",
      }),
    ).toEqual({
      text: "cache-output\n",
      cacheCapturedTail: false,
    });
  });
});
