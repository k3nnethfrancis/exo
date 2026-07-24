export interface AppKeybindingHelp {
  id: string;
  label: string;
  mac: string;
  other: string;
}

export const APP_KEYBINDINGS: readonly AppKeybindingHelp[] = [
  { id: "explorer", label: "Explorer", mac: "⌘ B", other: "Ctrl B" },
  { id: "utility", label: "Utility", mac: "⌘ ⌥ B", other: "Ctrl Alt B" },
  { id: "daily-note", label: "Daily note", mac: "⌘ N", other: "Ctrl N" },
  { id: "terminal", label: "New terminal", mac: "⌘ T", other: "Ctrl T" },
  { id: "save", label: "Save", mac: "⌘ S", other: "Ctrl S" },
  { id: "invoke", label: "Invoke", mac: "⌘ ↵", other: "Ctrl Enter" },
  { id: "zoom", label: "Zoom", mac: "⌘ + / − / 0", other: "Ctrl + / − / 0" },
] as const;

export function isMacPlatform(platform = globalThis.navigator?.platform ?? ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}
