/**
 * Environment roots are an operator/test fixture, not a substitute for a
 * user choosing a wiki. Only explicit desktop test runs may bypass onboarding.
 */
export function hasOperatorWorkspaceSetup(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXO_TEST === "1" && Boolean(env.EXO_NOTE_ROOTS?.trim());
}
