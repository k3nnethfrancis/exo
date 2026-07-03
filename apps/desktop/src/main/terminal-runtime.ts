export interface TerminalRuntimeProcess {
  onData(handler: (data: string) => void): void;
  onExit(handler: (event: { exitCode?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalRuntimeAvailable {
  available: true;
}

export interface TerminalRuntimeUnavailable {
  available: false;
  attempted: string[];
  reason: string;
}

export type TerminalRuntimeAvailability = TerminalRuntimeAvailable | TerminalRuntimeUnavailable;

export interface TerminalRuntimePaneInfo {
  sessionName: string;
  paneId: string;
  dead: boolean;
  currentCommand: string;
  currentPath: string;
}

export interface TerminalRuntimeCreateSessionOptions {
  sessionToken: string;
  workspaceRoot: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
  historyLimit: number;
}

export interface TerminalRuntimeAttachOptions {
  sessionName: string;
  paneId: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

export interface TerminalRuntimeSession {
  sessionName: string;
  paneId: string;
  process: TerminalRuntimeProcess;
}

export interface TerminalRuntimeSessionOptions {
  sessionName: string;
  historyLimit: number;
}

export interface TerminalRuntimeCaptureTailOptions {
  sessionName: string;
  paneId: string;
  historyLimit: number;
  lineLimit?: number;
}

export interface TerminalRuntimeCaptureRestoreSnapshotOptions {
  sessionName: string;
  paneId: string;
  historyLimit: number;
  liveScrollbackLines: number;
}

export interface TerminalRuntimeRestoreSnapshot {
  content: string;
  cols: number;
  rows: number;
  altScreen: boolean;
}

export interface TerminalRuntime {
  readonly kind: "tmux";
  availability(): TerminalRuntimeAvailability;
  createSession(options: TerminalRuntimeCreateSessionOptions): TerminalRuntimeSession;
  attachSession(options: TerminalRuntimeAttachOptions): TerminalRuntimeProcess;
  listPanes(): TerminalRuntimePaneInfo[];
  applySessionOptions(options: TerminalRuntimeSessionOptions): void;
  captureTailForDisplay(options: TerminalRuntimeCaptureTailOptions): string;
  captureRestoreSnapshot(options: TerminalRuntimeCaptureRestoreSnapshotOptions): TerminalRuntimeRestoreSnapshot;
  terminate(sessionName: string): void;
}
