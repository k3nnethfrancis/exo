import type { ExoThemeVariant } from "./types";

export function applyTheme(root: HTMLElement, theme: ExoThemeVariant): void {
  root.dataset.colorTheme = theme.id.replace(/-(light|dark)$/, "");
  for (const [name, value] of Object.entries(theme.css)) {
    root.style.setProperty(name, value);
  }
}
