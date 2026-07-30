import type { ITheme } from "@xterm/xterm";

import type { ExographThemeVariant } from "./types";

export function exographXtermTheme(theme: ExographThemeVariant): ITheme {
  return theme.terminal;
}
