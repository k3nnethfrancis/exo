export const DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS = 120;
export const DEFAULT_TERMINAL_INITIAL_COLUMNS = 120;
export const DEFAULT_TERMINAL_INITIAL_ROWS = 32;
export const DEFAULT_TERMINAL_IDLE_THRESHOLD_MS = 120_000;

// Runtime bounds, deliberately not persisted preferences. xterm owns the
// visible line scrollback while TerminalManager owns the replayable character
// tail; pending hydration is a smaller renderer race buffer.
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 100_000;
export const DEFAULT_TERMINAL_TAIL_CACHE_CHARS = 1_000_000;
export const DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS = 20_000;
