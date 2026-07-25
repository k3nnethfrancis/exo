import { describe, expect, it } from "vitest";

import { isTerminalGeneratedResponse } from "./terminalInputFilters";

describe("terminal input filtering", () => {
  it("identifies xterm-generated device response sequences", () => {
    expect(isTerminalGeneratedResponse("\x1b[>0;276;0c")).toBe(true);
    expect(isTerminalGeneratedResponse("0;276;0c")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b[0n")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b[24;80R")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;rgb:5858/6e6e/7575\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]11;rgb:fdfd/f6f6/e3e3\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]12;rgb:5858/6e6e/7575\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]4;2;rgb:0000/8080/0000\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;rgb:5858/6e6e/7575\x1b\\\x1b]11;rgb:fdfd/f6f6/e3e3\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;rgb:5858/6e6e/7575\x07")).toBe(true);
    expect(isTerminalGeneratedResponse("]10;rgb:5858/6e6e/7575\\")).toBe(true);
    expect(isTerminalGeneratedResponse("]10;rgb:5858/6e6e/7575\\]11;rgb:fdfd/f6f6/e3e3\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;not-rgb\x1b\\")).toBe(false);
    expect(isTerminalGeneratedResponse("hello")).toBe(false);
    expect(isTerminalGeneratedResponse("try this out")).toBe(false);
  });
});
