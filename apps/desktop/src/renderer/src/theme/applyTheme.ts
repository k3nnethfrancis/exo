import type { StemThemeVariant } from "./types";

export function applyTheme(root: HTMLElement, theme: StemThemeVariant): void {
  root.dataset.colorTheme = theme.id.replace(/-(light|dark)$/, "");
  for (const [name, value] of Object.entries(theme.css)) {
    root.style.setProperty(name, value);
  }
}
