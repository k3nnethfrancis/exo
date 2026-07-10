export type TerminalHydrationReason = "bootstrap" | "refresh";

export interface TerminalHydrationFrame {
  snapshot: string;
  version: number;
  reason: TerminalHydrationReason;
}

export interface TerminalHydrationViewState {
  appliedVersion: number;
  hasAppliedInitialSnapshot: boolean;
}

export function initialTerminalHydrationViewState(): TerminalHydrationViewState {
  return {
    appliedVersion: -1,
    hasAppliedInitialSnapshot: false,
  };
}

export function shouldApplyTerminalHydration(
  state: TerminalHydrationViewState,
  frame: TerminalHydrationFrame,
): boolean {
  if (state.appliedVersion === frame.version) {
    return false;
  }
  if (!state.hasAppliedInitialSnapshot && frame.version === 0 && frame.snapshot.length === 0) {
    return false;
  }
  if (!state.hasAppliedInitialSnapshot) {
    return true;
  }
  return frame.reason === "refresh";
}

export function markTerminalHydrationApplied(
  state: TerminalHydrationViewState,
  frame: TerminalHydrationFrame,
): TerminalHydrationViewState {
  return {
    appliedVersion: frame.version,
    hasAppliedInitialSnapshot: true,
  };
}
