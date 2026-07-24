import { describe, expect, it } from "vitest";

import { onboardingRuntimeApplyDecision } from "./useWorkspaceBootstrap";

describe("onboarding runtime apply decisions", () => {
  it("only completes onboarding after a fully applied runtime", () => {
    expect(onboardingRuntimeApplyDecision({ status: "applied" })).toEqual({ action: "complete" });
  });

  it("keeps a committed-but-degraded workspace retryable without marking setup healthy", () => {
    expect(onboardingRuntimeApplyDecision({
      status: "degraded",
      errorMessage: "command discovery needs recovery",
    })).toEqual({
      action: "retry",
      errorMessage: "Your workspace is open, but one runtime service needs attention: command discovery needs recovery Retry to recover it before continuing.",
    });
  });
});
