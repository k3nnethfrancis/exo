export const TERMINAL_FONT_FAMILY = [
  '"IBM Plex Mono"',
  '"SF Mono"',
  "Menlo",
  "Monaco",
  '"Cascadia Mono"',
  '"Cascadia Code"',
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"Apple Symbols"',
  '"Apple Color Emoji"',
  "monospace",
].join(", ");

// Xterm's custom glyph renderer can corrupt very wide box-drawing/TUI lines
// after fit/reconnect cycles even when the tmux source tail is byte-correct.
// Let the configured monospace/symbol fonts own glyph drawing instead.
export const TERMINAL_CUSTOM_GLYPHS = false;
