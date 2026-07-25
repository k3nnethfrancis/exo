import { describe, expect, it } from "vitest";

import { isNewTerminalShortcut, shellPanelShortcut } from "./useAppKeybindings";

describe("app keybindings", () => {
  it("maps familiar primary and secondary sidebar shortcuts without accepting noisy variants", () => {
    expect(shellPanelShortcut({ code: "KeyB", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false })).toBe("explorer");
    expect(shellPanelShortcut({ code: "KeyB", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, repeat: false })).toBe("explorer");
    expect(shellPanelShortcut({ code: "KeyB", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true, repeat: false })).toBe("utility");
    expect(shellPanelShortcut({ code: "KeyB", metaKey: false, ctrlKey: true, shiftKey: false, altKey: true, repeat: false })).toBe("utility");
    expect(shellPanelShortcut({ code: "KeyB", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, repeat: false })).toBeNull();
    expect(shellPanelShortcut({ code: "KeyB", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: true })).toBeNull();
    expect(shellPanelShortcut({ code: "KeyN", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false })).toBeNull();
  });

  it("recognizes Mod+T as the new terminal shortcut", () => {
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false })).toBe(true);
    expect(isNewTerminalShortcut({ key: "T", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, repeat: false })).toBe(true);
  });

  it("ignores modified or repeated Mod+T events", () => {
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, repeat: false })).toBe(false);
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true, repeat: false })).toBe(false);
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: true })).toBe(false);
    expect(isNewTerminalShortcut({ key: "n", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false })).toBe(false);
  });
});
