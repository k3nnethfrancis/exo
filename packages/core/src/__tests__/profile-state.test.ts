import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  clearActiveProfile,
  emptyProfileStateStore,
  markProfileReviewRequired,
  profileStatePath,
  readProfileStateStore,
  setActiveProfile,
  setProfileAutoUpdate,
  validateProfileStateStore,
  writeProfileStateStore,
  type ActiveProfileIdentity,
} from "../profile-state";

const identity: ActiveProfileIdentity = {
  profileId: "shoshin",
  capabilityId: "shoshin.profile",
  label: "Shoshin",
  pluginId: "shoshin-profile.plugin",
  source: "workspace",
  manifestPath: "/workspace/.exo/plugins/shoshin/exo.plugin.json",
  rootDirectory: "/workspace/.exo/plugins/shoshin",
  manifestHash: "hash-shoshin-profile",
};

describe("profile state", () => {
  it("uses a runtime-root profile state file", () => {
    expect(profileStatePath("/tmp/exo-runtime")).toBe(path.join("/tmp/exo-runtime", "profile-state.json"));
  });

  it("returns an empty store when no state file exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-state-missing-"));
    try {
      await expect(readProfileStateStore(root)).resolves.toEqual(emptyProfileStateStore());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("round-trips a store on disk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-state-"));
    try {
      const store = {
        version: 1 as const,
        activeProfile: identity,
        autoUpdate: true,
        reviewRequired: true,
        updatedAt: "2026-06-28T10:00:00.000Z",
      };

      await writeProfileStateStore(root, store);

      await expect(readProfileStateStore(root)).resolves.toEqual(store);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sets and clears the active profile with timestamps", () => {
    const active = setActiveProfile(emptyProfileStateStore(), identity, "2026-06-28T10:00:00.000Z");

    expect(active).toEqual({
      version: 1,
      activeProfile: identity,
      autoUpdate: false,
      reviewRequired: false,
      updatedAt: "2026-06-28T10:00:00.000Z",
    });

    expect(clearActiveProfile(active, "2026-06-28T10:05:00.000Z")).toEqual({
      version: 1,
      activeProfile: null,
      autoUpdate: false,
      reviewRequired: false,
      updatedAt: "2026-06-28T10:05:00.000Z",
    });
  });

  it("toggles auto-update without applying profile writes", () => {
    const store = setProfileAutoUpdate(emptyProfileStateStore(), true, "2026-06-28T10:00:00.000Z");

    expect(store).toMatchObject({
      autoUpdate: true,
      updatedAt: "2026-06-28T10:00:00.000Z",
    });

    expect(setProfileAutoUpdate(store, false, "2026-06-28T10:01:00.000Z")).toMatchObject({
      autoUpdate: false,
      updatedAt: "2026-06-28T10:01:00.000Z",
    });
  });

  it("toggles profile review-required state", () => {
    const store = markProfileReviewRequired(emptyProfileStateStore(), true, "2026-06-28T10:00:00.000Z");

    expect(store).toMatchObject({
      reviewRequired: true,
      updatedAt: "2026-06-28T10:00:00.000Z",
    });

    expect(markProfileReviewRequired(store, false, "2026-06-28T10:01:00.000Z")).toMatchObject({
      reviewRequired: false,
      updatedAt: "2026-06-28T10:01:00.000Z",
    });
  });

  it("rejects malformed stores clearly", () => {
    expect(() => validateProfileStateStore({ version: 2 })).toThrow("version 1 object");
    expect(() => validateProfileStateStore({ version: 1, autoUpdate: "yes" })).toThrow("autoUpdate must be a boolean");
    expect(() =>
      validateProfileStateStore({
        version: 1,
        activeProfile: { profileId: "shoshin", capabilityId: "" },
      }),
    ).toThrow("capabilityId must be a non-empty string");
    expect(() =>
      validateProfileStateStore({
        version: 1,
        activeProfile: { profileId: "shoshin", capabilityId: "shoshin.profile", source: "remote" },
      }),
    ).toThrow("source contains unsupported value");
    expect(() => validateProfileStateStore({ version: 1, updatedAt: "not-a-date" })).toThrow("ISO timestamp");
  });

  it("defaults missing optional state fields and preserves identity metadata fields", () => {
    expect(validateProfileStateStore({ version: 1 })).toEqual(emptyProfileStateStore());

    const store = validateProfileStateStore({
      version: 1,
      activeProfile: identity,
    });

    expect(store).toEqual({
      version: 1,
      activeProfile: identity,
      autoUpdate: false,
      reviewRequired: false,
    });
  });
});
