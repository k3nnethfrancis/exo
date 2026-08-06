import type { WorkspaceShortcutBinding, WorkspaceShortcutBindings, WorkspaceShortcutId } from "@exograph/core";

export interface AppKeybindingHelp {
  id: WorkspaceShortcutId | "invoke" | "zoom";
  label: string;
  mac: string;
  other: string;
}

export const APP_KEYBINDINGS: readonly AppKeybindingHelp[] = [
  { id: "explorer", label: "Explorer", mac: "⌘ B", other: "Ctrl B" },
  { id: "utility", label: "Utility", mac: "⌘ ⌥ B", other: "Ctrl Alt B" },
  { id: "new-note", label: "New note", mac: "⌘ N", other: "Ctrl N" },
  { id: "daily-note", label: "Daily note", mac: "⌘ ⇧ N", other: "Ctrl Shift N" },
  { id: "terminal", label: "New terminal", mac: "⌘ T", other: "Ctrl T" },
  { id: "save", label: "Save", mac: "⌘ S", other: "Ctrl S" },
  { id: "invoke", label: "Invoke", mac: "⌘ ↵", other: "Ctrl Enter" },
  { id: "zoom", label: "App zoom", mac: "⌘ + / − / 0", other: "Ctrl + / − / 0" },
] as const;

export const DEFAULT_WORKSPACE_SHORTCUT_BINDINGS: Record<WorkspaceShortcutId, WorkspaceShortcutBinding> = {
  explorer: { code: "KeyB" },
  utility: { code: "KeyB", alt: true },
  "new-note": { code: "KeyN" },
  "daily-note": { code: "KeyN", shift: true },
  terminal: { code: "KeyT" },
  save: { code: "KeyS" },
};

export function resolvedWorkspaceShortcutBindings(overrides: WorkspaceShortcutBindings | undefined): Record<WorkspaceShortcutId, WorkspaceShortcutBinding> {
  return {
    explorer: { ...DEFAULT_WORKSPACE_SHORTCUT_BINDINGS.explorer, ...overrides?.explorer },
    utility: { ...DEFAULT_WORKSPACE_SHORTCUT_BINDINGS.utility, ...overrides?.utility },
    "new-note": { ...DEFAULT_WORKSPACE_SHORTCUT_BINDINGS["new-note"], ...overrides?.["new-note"] },
    "daily-note": { ...DEFAULT_WORKSPACE_SHORTCUT_BINDINGS["daily-note"], ...overrides?.["daily-note"] },
    terminal: { ...DEFAULT_WORKSPACE_SHORTCUT_BINDINGS.terminal, ...overrides?.terminal },
    save: { ...DEFAULT_WORKSPACE_SHORTCUT_BINDINGS.save, ...overrides?.save },
  };
}

export function shortcutLabel(binding: WorkspaceShortcutBinding, isMac = isMacPlatform()): string {
  const modifier = isMac ? "⌘" : "Ctrl";
  const alt = binding.alt ? (isMac ? "⌥" : "Alt ") : "";
  const shift = binding.shift ? (isMac ? "⇧" : "Shift ") : "";
  const key = binding.code === "Enter" ? (isMac ? "↵" : "Enter") : binding.code.replace("Key", "");
  return isMac ? [modifier, alt, shift, key].filter(Boolean).join(" ") : `${modifier} ${alt}${shift}${key}`.replace(/\s+/g, " ");
}

export function workspaceHelpKeybindings(overrides: WorkspaceShortcutBindings | undefined, isMac = isMacPlatform()): AppKeybindingHelp[] {
  const bindings = resolvedWorkspaceShortcutBindings(overrides);
  return APP_KEYBINDINGS.map((entry) => {
    if (!(entry.id in bindings)) return entry;
    const label = shortcutLabel(bindings[entry.id as WorkspaceShortcutId], isMac);
    return { ...entry, mac: isMac ? label : entry.mac, other: isMac ? entry.other : label };
  });
}

export function shortcutMatches(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat">, binding: WorkspaceShortcutBinding): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return mod && !event.repeat && event.code === binding.code && Boolean(event.shiftKey) === Boolean(binding.shift) && Boolean(event.altKey) === Boolean(binding.alt);
}

export function shortcutBindingFromEvent(event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): WorkspaceShortcutBinding | null {
  if (!(event.metaKey || event.ctrlKey) || !/^(?:Key[A-Z]|Enter)$/.test(event.code)) return null;
  return { code: event.code, shift: event.shiftKey, alt: event.altKey };
}

export function shortcutBindingsHaveConflict(bindings: WorkspaceShortcutBindings | undefined): boolean {
  const values = Object.values(resolvedWorkspaceShortcutBindings(bindings));
  return new Set(values.map((binding) => `${binding.code}:${Boolean(binding.shift)}:${Boolean(binding.alt)}`)).size !== values.length;
}

export function isMacPlatform(platform = globalThis.navigator?.platform ?? ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}
