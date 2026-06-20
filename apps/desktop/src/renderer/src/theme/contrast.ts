export function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(parseHexColor(foreground));
  const bg = relativeLuminance(parseHexColor(background));
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(value: string): [number, number, number] {
  const normalized = value.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized);
  if (!match) {
    throw new Error(`Expected a hex color, received ${value}`);
  }
  const hex = match[1].length === 3
    ? match[1].split("").map((char) => `${char}${char}`).join("")
    : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
