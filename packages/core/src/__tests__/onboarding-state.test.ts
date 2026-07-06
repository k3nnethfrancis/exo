import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  emptyOnboardingStateStore,
  markOnboardingComplete,
  markOnboardingProfileStep,
  markOnboardingWorkspaceBasicsSaved,
  markOnboardingWorkspaceStep,
  onboardingStatePath,
  readOnboardingStateStore,
  validateOnboardingStateStore,
  writeOnboardingStateStore,
} from "../onboarding-state";

describe("onboarding state", () => {
  it("uses a user-data onboarding state file", () => {
    expect(onboardingStatePath("/tmp/exo-user-data")).toBe(path.join("/tmp/exo-user-data", "onboarding-state.json"));
  });

  it("returns an empty store when no state file exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-onboarding-state-missing-"));
    try {
      await expect(readOnboardingStateStore(root)).resolves.toEqual(emptyOnboardingStateStore());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("round-trips a store on disk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-onboarding-state-"));
    try {
      const store = markOnboardingProfileStep(
        markOnboardingWorkspaceBasicsSaved(emptyOnboardingStateStore(), "plugins", "2026-07-06T10:00:00.000Z"),
        "instructions",
        "2026-07-06T10:05:00.000Z",
      );

      await writeOnboardingStateStore(root, store);

      await expect(readOnboardingStateStore(root)).resolves.toEqual(store);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tracks workspace, profile, and complete phases explicitly", () => {
    const workspace = markOnboardingWorkspaceStep(emptyOnboardingStateStore(), "select", "2026-07-06T10:00:00.000Z");
    expect(workspace).toMatchObject({
      status: "in-progress",
      phase: "workspace",
      workspaceStep: "select",
      workspaceBasicsSaved: false,
    });

    const profile = markOnboardingWorkspaceBasicsSaved(workspace, "plugins", "2026-07-06T10:01:00.000Z");
    expect(profile).toMatchObject({
      status: "in-progress",
      phase: "profile",
      profileStep: "plugins",
      workspaceBasicsSaved: true,
    });

    const complete = markOnboardingComplete(profile, "2026-07-06T10:02:00.000Z");
    expect(complete).toMatchObject({
      status: "complete",
      phase: "done",
      workspaceBasicsSaved: true,
      completedAt: "2026-07-06T10:02:00.000Z",
    });
  });

  it("rejects malformed stores clearly", () => {
    expect(() => validateOnboardingStateStore({ version: 2 })).toThrow("version 1 object");
    expect(() => validateOnboardingStateStore({ version: 1, status: "done", phase: "done" })).toThrow("status contains unsupported value");
    expect(() => validateOnboardingStateStore({ version: 1, status: "complete", phase: "bad" })).toThrow("phase contains unsupported value");
    expect(() => validateOnboardingStateStore({ version: 1, status: "complete", phase: "done", completedAt: "today" })).toThrow("ISO timestamp");
  });
});
