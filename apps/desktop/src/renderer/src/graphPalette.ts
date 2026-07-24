import type { GraphPresentationPalette } from "./graphPresentation";

/** Resolve Exo theme tokens once before the renderer-neutral presentation pass. */
export function resolveGraphPalette(element: Element): GraphPresentationPalette {
  const styles = getComputedStyle(element);
  const value = (name: string, fallback: string) => cssColorToRgba(styles.getPropertyValue(name).trim() || fallback);
  return {
    clearColor: null,
    text: value("--text", "#dcdcdc"),
    muted: value("--muted", "#a6a6a6"),
    accent: value("--accent", "#6ca8d8"),
    path: value("--warning-strong", "#f2d088"),
    unresolved: value("--danger-strong", "#ffb6b6"),
    external: value("--text-muted", "#b6b6b6"),
    nodeColors: new Uint32Array([
      value("--accent", "#6ca8d8"),
      value("--warning-strong", "#f2d088"),
      value("--tag-text", "#b8d7f3"),
      value("--text-soft", "#c8c8c8"),
    ]),
  };
}

export function cssColorToRgba(value: string): number {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((part) => `${part}${part}`).join("") : hex;
    const rgb = Number.parseInt(expanded.slice(0, 6), 16);
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) : 255;
    return ((rgb << 8) | alpha) >>> 0;
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/iu);
  if (!rgb) return 0x808080ff;
  const channel = (index: number) => Math.max(0, Math.min(255, Math.round(Number(rgb[index] ?? 0))));
  const alphaText = rgb[4];
  const alpha = alphaText?.endsWith("%")
    ? Math.round(Math.max(0, Math.min(100, Number.parseFloat(alphaText))) * 2.55)
    : Math.round(Math.max(0, Math.min(1, Number(alphaText ?? 1))) * 255);
  return ((channel(1) << 24) | (channel(2) << 16) | (channel(3) << 8) | alpha) >>> 0;
}
