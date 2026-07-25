export interface ShellApi {
  openExternal: (target: string) => Promise<void>;
  focusWindow: () => Promise<void>;
}
