import type { ITheme } from "@xterm/xterm";

import type { StemThemeVariant } from "./types";

export function stemXtermTheme(theme: StemThemeVariant): ITheme {
  return theme.terminal;
}
