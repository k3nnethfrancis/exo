import type { ITheme } from "xterm";

import type { ExoThemeVariant } from "./types";

export function exoXtermTheme(theme: ExoThemeVariant): ITheme {
  return theme.terminal;
}
