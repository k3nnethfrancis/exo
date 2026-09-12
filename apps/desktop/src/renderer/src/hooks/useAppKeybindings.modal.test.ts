import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useAppKeybindings } from "./useAppKeybindings";
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it("yields capture keys to Settings without firing background actions or preventing native input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let listener: (event: KeyboardEvent) => void;
  vi.stubGlobal("window", { addEventListener: (_: string, callback: typeof listener) => { listener = callback; }, removeEventListener() {} });
  const actions = { saveDocument: vi.fn(async () => {}), createUntitledNote: vi.fn(async () => {}), openOrCreateDailyNote: vi.fn(async () => {}), createShellTerminal: vi.fn(async () => {}), toggleExplorerPanel: vi.fn(), toggleUtilityPanel: vi.fn(), updateAppZoom: vi.fn() };
  function Harness({ settingsOpen }: { settingsOpen: boolean }) { useAppKeybindings({ activeDocumentPath: "/note.md", settingsOpen, ...actions }); return null; }
  await act(async () => { renderer = create(createElement(Harness, { settingsOpen: true })); });
  const event = (code: string, key: string) => ({ key, code, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, composedPath: () => [], preventDefault: vi.fn(), stopPropagation: vi.fn() });
  for (const [code, key] of [["KeyB", "b"], ["KeyN", "n"], ["KeyT", "t"], ["KeyS", "s"], ["Equal", "="], ["KeyC", "c"]]) {
    const input = event(code, key);
    listener!(input as unknown as KeyboardEvent);
    expect(input.preventDefault).not.toHaveBeenCalled();
  }
  for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  await act(async () => renderer!.update(createElement(Harness, { settingsOpen: false })));
  listener!(event("KeyB", "b") as unknown as KeyboardEvent);
  expect(actions.toggleExplorerPanel).toHaveBeenCalledOnce();
});
