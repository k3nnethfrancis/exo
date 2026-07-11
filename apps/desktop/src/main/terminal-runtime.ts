export interface TerminalProcess {
  onData(handler: (data: string) => void): void;
  onExit(handler: (event: { exitCode?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

/**
 * The only production implementation creates a direct node-pty process.
 * This narrow seam exists solely to make TerminalManager deterministic to test;
 * it is not a selectable terminal runtime or a session persistence boundary.
 */
export interface TerminalProcessFactory {
  create(options: TerminalProcessOptions): TerminalProcess;
}
