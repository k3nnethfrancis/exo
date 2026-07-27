import type { OnboardingStateReadResult } from "@exo/core";

/**
 * Environment roots are an operator/test fixture, not a substitute for a
 * user choosing a wiki. Only explicit desktop test runs may bypass onboarding.
 */
export function hasOperatorWorkspaceSetup(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXO_TEST === "1" && Boolean(env.EXO_NOTE_ROOTS?.trim());
}

export interface WorkspaceSetupDecision {
  complete: boolean;
  onboardingRecovery: { kind: "malformed"; message: string } | null;
}

export function workspaceSetupDecision(input: {
  hasWorkspaceSettings: boolean;
  onboarding: OnboardingStateReadResult;
  operatorSetupComplete: boolean;
}): WorkspaceSetupDecision {
  if (input.operatorSetupComplete) {
    return { complete: true, onboardingRecovery: null };
  }
  if (input.onboarding.kind === "malformed") {
    return {
      complete: false,
      onboardingRecovery: {
        kind: "malformed",
        message: input.onboarding.errorMessage,
      },
    };
  }
  if (!input.hasWorkspaceSettings) {
    return { complete: false, onboardingRecovery: null };
  }
  if (input.onboarding.kind === "missing") {
    // Settings predate durable onboarding progress. Do not trap a valid
    // existing install merely because it has no newer state file.
    return { complete: true, onboardingRecovery: null };
  }
  return {
    complete: input.onboarding.state.status === "complete",
    onboardingRecovery: null,
  };
}
