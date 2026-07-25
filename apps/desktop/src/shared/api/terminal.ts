export type TerminalKind = "shell";
export type TerminalLaunchKind = "shell";
export type TerminalHealthState = "healthy" | "idle" | "unhealthy" | "exited";

export interface TerminalGeometryRecord {
  cols: number;
  rows: number;
  reportedAt: string;
  source: "renderer-fit" | "initial-default";
}

export interface TerminalSessionInfo {
  id: string;
  title: string;
  cwd: string;
  kind: TerminalKind;
  command: string;
  status: "running" | "exited";
  exitCode?: number;
  health?: TerminalHealthState;
  healthDetail?: string;
  geometry?: TerminalGeometryRecord;
  attachGeneration: number;
}

export interface TerminalCreateOptions {
  terminalKind?: TerminalLaunchKind;
  cwd?: string;
}

export interface TerminalDataEvent {
  id: string;
  generation: number;
  data: string;
}

export interface TerminalWriteResult {
  ok: boolean;
  delivery: "sent" | "queued" | "not-found";
  writeId?: number;
}

export interface TerminalMessageResult extends TerminalWriteResult {}

export interface TerminalsApi {
  ensureDefault: () => Promise<TerminalSessionInfo>;
  list: () => Promise<TerminalSessionInfo[]>;
  create: (options: TerminalCreateOptions) => Promise<TerminalSessionInfo>;
  read: (id: string, options?: { maxLines?: number }) => Promise<string>;
  write: (id: string, data: string) => Promise<TerminalWriteResult>;
  sendMessage: (id: string, message: string, submit?: boolean) => Promise<TerminalMessageResult>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  resolveDroppedFilePaths: (files: File[]) => string[];
  onCreated: (callback: (session: TerminalSessionInfo) => void) => () => void;
  onUpdated: (callback: (session: TerminalSessionInfo) => void) => () => void;
  onData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onExit: (callback: (event: { id: string; exitCode?: number }) => void) => () => void;
}
