import type { ColorThemeId } from "@stem/core";
import type { ResolvedAppearance } from "../appearance";

export type { ColorThemeId };

export type ThemeCssVariable = `--${string}`;

export interface StemSyntaxTheme {
  keyword: string;
  atom: string;
  string: string;
  number: string;
  variable: string;
  functionName: string;
  definition: string;
  property: string;
  operator: string;
  comment: string;
  punctuation: string;
  invalid: string;
  meta: string;
}

export interface StemTerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface StemThemeVariant {
  id: string;
  appearance: ResolvedAppearance;
  colorScheme: "light" | "dark";
  css: Record<ThemeCssVariable, string>;
  syntax: StemSyntaxTheme;
  terminal: StemTerminalTheme;
}

export interface StemThemeFamily {
  id: ColorThemeId;
  label: string;
  description: string;
  variants: Partial<Record<ResolvedAppearance, StemThemeVariant>>;
}
