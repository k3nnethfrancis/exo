export interface ShellApi {
  openExternal: (target: string) => Promise<void>;
  focusWindow: () => Promise<void>;
  changeZoom: (direction: -1 | 0 | 1) => Promise<number>;
}
