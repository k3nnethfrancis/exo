import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceSettings, type WorkspaceSettingsSaveRequest } from "@exograph/core";
import type { WorkspaceSettingsSaveOutcome } from "../../../shared/api";
import { useWorkspaceSettingsController } from "./useWorkspaceSettingsController";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function fixture(gate: Promise<void> = Promise.resolve()) {
  const settings = normalizeWorkspaceSettings({ workspaceRoot: "/workspace", noteRoots: ["/workspace/notes"], defaultTerminalCwd: "/workspace" })!;
  const save = vi.fn(async (request: WorkspaceSettingsSaveRequest): Promise<WorkspaceSettingsSaveOutcome> => {
    await gate;
    return { settings: normalizeWorkspaceSettings(request.settings)!, revision: "saved", runtimeApply: { status: "applied" } };
  });
  vi.stubGlobal("window", {
    // Drive saves explicitly so draft and in-flight states are observable.
    setTimeout: () => 1, clearTimeout: () => {},
    exograph: { workspace: {
      getSettings: async () => ({ settings, revision: "initial" }),
      getIndexStatus: async () => null,
      onIndexSyncState: () => () => {},
      saveSettings: save,
    } },
  });
  const options = { workspaceSettingsRef: { current: settings }, workspaceSettingsRevisionRef: { current: "initial" }, applyWorkspaceSettings: vi.fn(), refreshWorkspaceModel: async () => {}, setIndexStatus: vi.fn() };
  let controller!: ReturnType<typeof useWorkspaceSettingsController>;
  function Harness() { controller = useWorkspaceSettingsController(options); return null; }
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => controller.openDialog("appearance"));
  return { current: () => controller, save, options };
}

describe("numeric settings feedback", () => {
  it.each([
    ["editorFontSize", "1", "11"], ["editorFontSize", "99", "24"], ["editorFontSize", "", "11"], ["editorFontSize", "18", "18"],
    ["terminalFontSize", "1", "10"], ["terminalFontSize", "99", "22"],
    ["explorerScale", "0.1", "0.82"], ["explorerScale", "9", "1.35"],
  ] as const)("shows the saved %s value after editing %s", async (field, draft, expected) => {
    const f = await fixture();
    await act(async () => f.current().setDialog(current => current && { ...current, [field]: draft, saveStatus: "idle", defaultTerminalCwd: "/unapplied" }));
    expect(f.current().dialog?.[field]).toBe(draft);
    await act(async () => f.current().saveDialog());
    expect(f.current().dialog?.[field]).toBe(expected);
    expect(f.current().dialog?.saveStatus).toBe("saved");
    expect(String(f.options.workspaceSettingsRef.current[field])).toBe(expected);
    expect(f.current().dialog?.defaultTerminalCwd).toBe("/unapplied");
    expect(f.options.workspaceSettingsRef.current.defaultTerminalCwd).toBe("/workspace");
  });

  it.each([false, true])("does not replace newer input when includeStructural=%s", async (includeStructural) => {
    let release!: () => void;
    const f = await fixture(new Promise<void>(resolve => { release = resolve; }));
    await act(async () => f.current().setDialog(current => current && { ...current, editorFontSize: "1", saveStatus: "idle" }));
    let pending!: Promise<void>;
    await act(async () => { pending = f.current().saveDialog(f.current().dialog, { includeStructural }); });
    await act(async () => f.current().setDialog(current => current && { ...current, editorFontSize: "18", saveStatus: "idle" }));
    await act(async () => { release(); await pending; });
    expect(f.current().dialog?.editorFontSize).toBe("18");
    expect(f.current().dialog?.saveStatus).toBe("idle");
    expect(f.options.workspaceSettingsRef.current.editorFontSize).toBe(11);
  });
});
