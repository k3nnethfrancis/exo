import { describe, expect, it } from "vitest";

import {
  emptyOnboardingStateStore,
  markOnboardingComplete,
  markOnboardingWorkspaceBasicsSaved,
  validateOnboardingStateStore,
} from "../onboarding-state";

describe("onboarding state", () => {
  it("keeps the current empty state free of unused workspace progress", () => {
    expect(emptyOnboardingStateStore()).toEqual({
      version: 1,
      status: "not-started",
      phase: "workspace",
      workspaceBasicsSaved: false,
    });
  });

  it("accepts older workspace progress and unknown persisted keys without projecting them", () => {
    expect(validateOnboardingStateStore({
      version: 1,
      status: "in-progress",
      phase: "workspace",
      workspaceStep: "select",
      workspaceBasicsSaved: true,
      futureState: { enabled: true },
      updatedAt: "2026-07-26T10:00:00.000Z",
    })).toEqual({
      version: 1,
      status: "in-progress",
      phase: "workspace",
      workspaceBasicsSaved: true,
      updatedAt: "2026-07-26T10:00:00.000Z",
    });
  });

  it("preserves workspace-basics and completion transitions", () => {
    const basicsSaved = markOnboardingWorkspaceBasicsSaved(
      emptyOnboardingStateStore(),
      "2026-07-26T10:00:00.000Z",
    );
    expect(basicsSaved).toEqual({
      version: 1,
      status: "in-progress",
      phase: "workspace",
      workspaceBasicsSaved: true,
      updatedAt: "2026-07-26T10:00:00.000Z",
    });

    expect(markOnboardingComplete(basicsSaved, "2026-07-26T10:01:00.000Z")).toEqual({
      version: 1,
      status: "complete",
      phase: "done",
      workspaceBasicsSaved: true,
      updatedAt: "2026-07-26T10:01:00.000Z",
      completedAt: "2026-07-26T10:01:00.000Z",
    });
  });
});
