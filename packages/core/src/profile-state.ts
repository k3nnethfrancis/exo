import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PluginSource } from "./plugin";

export const EXO_PROFILE_STATE_FILE = "profile-state.json";

export interface ActiveProfileIdentity {
  profileId: string;
  capabilityId: string;
  label?: string;
  setup?: ActiveProfileSetupSummary;
  pluginId?: string;
  source?: PluginSource;
  manifestPath?: string;
  rootDirectory?: string;
  manifestHash?: string;
}

export interface ActiveProfileSetupSummary {
  enabledHarnessIds: string[];
  defaultHarnessId?: string;
  routineTemplateIds: string[];
  exographContextApplied?: boolean;
}

export interface ProfileStateStore {
  version: 1;
  activeProfile: ActiveProfileIdentity | null;
  autoUpdate: boolean;
  reviewRequired: boolean;
  updatedAt?: string;
}

type ProfileStateTimestamp = Date | string;

export function profileStatePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, EXO_PROFILE_STATE_FILE);
}

export function emptyProfileStateStore(): ProfileStateStore {
  return {
    version: 1,
    activeProfile: null,
    autoUpdate: false,
    reviewRequired: false,
  };
}

export async function readProfileStateStore(runtimeRoot: string): Promise<ProfileStateStore> {
  try {
    const raw = await readFile(profileStatePath(runtimeRoot), "utf8");
    return validateProfileStateStore(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyProfileStateStore();
    }
    throw error;
  }
}

export async function writeProfileStateStore(runtimeRoot: string, store: ProfileStateStore): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(profileStatePath(runtimeRoot), `${JSON.stringify(validateProfileStateStore(store), null, 2)}\n`, "utf8");
}

export function validateProfileStateStore(input: unknown): ProfileStateStore {
  if (!isRecord(input) || input.version !== 1) {
    throw new Error("Profile state store must be a version 1 object.");
  }
  return {
    version: 1,
    activeProfile: validateActiveProfile(input.activeProfile),
    autoUpdate: input.autoUpdate === undefined ? false : requiredBoolean(input, "autoUpdate"),
    reviewRequired: input.reviewRequired === undefined ? false : requiredBoolean(input, "reviewRequired"),
    updatedAt: optionalIsoString(input, "updatedAt"),
  };
}

export function setActiveProfile(
  store: ProfileStateStore,
  identity: ActiveProfileIdentity,
  now?: ProfileStateTimestamp,
): ProfileStateStore {
  return validateProfileStateStore({
    ...store,
    activeProfile: validateActiveProfileIdentity(identity),
    updatedAt: timestamp(now),
  });
}

export function clearActiveProfile(store: ProfileStateStore, now?: ProfileStateTimestamp): ProfileStateStore {
  return validateProfileStateStore({
    ...store,
    activeProfile: null,
    updatedAt: timestamp(now),
  });
}

export function setProfileAutoUpdate(
  store: ProfileStateStore,
  autoUpdate: boolean,
  now?: ProfileStateTimestamp,
): ProfileStateStore {
  return validateProfileStateStore({
    ...store,
    autoUpdate,
    updatedAt: timestamp(now),
  });
}

export function markProfileReviewRequired(
  store: ProfileStateStore,
  reviewRequired: boolean,
  now?: ProfileStateTimestamp,
): ProfileStateStore {
  return validateProfileStateStore({
    ...store,
    reviewRequired,
    updatedAt: timestamp(now),
  });
}

function validateActiveProfile(input: unknown): ActiveProfileIdentity | null {
  if (input === undefined || input === null) {
    return null;
  }
  return validateActiveProfileIdentity(input);
}

function validateActiveProfileIdentity(input: unknown): ActiveProfileIdentity {
  if (!isRecord(input)) {
    throw new Error("Profile state activeProfile must be an object or null.");
  }
  return {
    profileId: requiredString(input, "profileId"),
    capabilityId: requiredString(input, "capabilityId"),
    label: optionalString(input, "label"),
    setup: validateOptionalSetup(input.setup),
    pluginId: optionalString(input, "pluginId"),
    source: validateOptionalSource(optionalString(input, "source")),
    manifestPath: optionalString(input, "manifestPath"),
    rootDirectory: optionalString(input, "rootDirectory"),
    manifestHash: optionalString(input, "manifestHash"),
  };
}

function validateOptionalSetup(input: unknown): ActiveProfileSetupSummary | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Profile state activeProfile.setup must be an object when provided.");
  }
  return {
    enabledHarnessIds: stringArray(input, "enabledHarnessIds"),
    defaultHarnessId: optionalString(input, "defaultHarnessId"),
    routineTemplateIds: stringArray(input, "routineTemplateIds"),
    exographContextApplied: input.exographContextApplied === undefined ? undefined : requiredBoolean(input, "exographContextApplied"),
  };
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`Profile state field ${key} must be an array of non-empty strings.`);
  }
  return value;
}

function validateOptionalSource(value: string | undefined): PluginSource | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "built-in" && value !== "dev" && value !== "user" && value !== "workspace") {
    throw new Error(`Profile state source contains unsupported value: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Profile state field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Profile state field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function optionalIsoString(record: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(record, key);
  if (value === undefined) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Profile state field ${key} must be an ISO timestamp when provided.`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Profile state field ${key} must be a boolean.`);
  }
  return value;
}

function timestamp(now: ProfileStateTimestamp | undefined): string {
  if (now === undefined) {
    return new Date().toISOString();
  }
  if (now instanceof Date) {
    return now.toISOString();
  }
  return optionalIsoString({ now }, "now") ?? now;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
