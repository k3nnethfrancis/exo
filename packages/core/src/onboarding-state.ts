import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const EXO_ONBOARDING_STATE_FILE = "onboarding-state.json";

export type OnboardingWorkspaceStep = "select" | "configure";

export interface OnboardingStateStore {
  version: 1;
  status: "not-started" | "in-progress" | "complete";
  phase: "workspace" | "done";
  workspaceStep?: OnboardingWorkspaceStep;
  workspaceBasicsSaved: boolean;
  updatedAt?: string;
  completedAt?: string;
}

type OnboardingStateTimestamp = Date | string;

export function onboardingStatePath(userDataPath: string): string {
  return path.join(userDataPath, EXO_ONBOARDING_STATE_FILE);
}

export function emptyOnboardingStateStore(): OnboardingStateStore {
  return {
    version: 1,
    status: "not-started",
    phase: "workspace",
    workspaceStep: "configure",
    workspaceBasicsSaved: false,
  };
}

export async function readOnboardingStateStore(userDataPath: string): Promise<OnboardingStateStore> {
  try {
    const raw = await readFile(onboardingStatePath(userDataPath), "utf8");
    return validateOnboardingStateStore(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyOnboardingStateStore();
    }
    throw error;
  }
}

export async function writeOnboardingStateStore(userDataPath: string, store: OnboardingStateStore): Promise<void> {
  await mkdir(userDataPath, { recursive: true });
  await writeFile(onboardingStatePath(userDataPath), `${JSON.stringify(validateOnboardingStateStore(store), null, 2)}\n`, "utf8");
}

export function markOnboardingWorkspaceStep(
  store: OnboardingStateStore,
  workspaceStep: OnboardingWorkspaceStep,
  now?: OnboardingStateTimestamp,
): OnboardingStateStore {
  return validateOnboardingStateStore({
    ...store,
    status: "in-progress",
    phase: "workspace",
    workspaceStep,
    updatedAt: timestamp(now),
  });
}

export function markOnboardingWorkspaceBasicsSaved(store: OnboardingStateStore, now?: OnboardingStateTimestamp): OnboardingStateStore {
  return validateOnboardingStateStore({
    ...store,
    status: "in-progress",
    phase: "workspace",
    workspaceBasicsSaved: true,
    updatedAt: timestamp(now),
  });
}

export function markOnboardingComplete(store: OnboardingStateStore, now?: OnboardingStateTimestamp): OnboardingStateStore {
  const completedAt = timestamp(now);
  return validateOnboardingStateStore({
    ...store,
    status: "complete",
    phase: "done",
    workspaceBasicsSaved: true,
    updatedAt: completedAt,
    completedAt,
  });
}

export function validateOnboardingStateStore(input: unknown): OnboardingStateStore {
  if (!isRecord(input) || input.version !== 1) {
    throw new Error("Onboarding state store must be a version 1 object.");
  }
  const status = requiredUnion(input, "status", ["not-started", "in-progress", "complete"]);
  const phase = requiredUnion(input, "phase", ["workspace", "done"]);
  return {
    version: 1,
    status,
    phase,
    workspaceStep: optionalUnion(input, "workspaceStep", ["select", "configure"]),
    workspaceBasicsSaved: input.workspaceBasicsSaved === undefined ? false : requiredBoolean(input, "workspaceBasicsSaved"),
    updatedAt: optionalIsoString(input, "updatedAt"),
    completedAt: optionalIsoString(input, "completedAt"),
  };
}

function requiredUnion<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`Onboarding state field ${key} contains unsupported value: ${String(value)}`);
  }
  return value as T;
}

function optionalUnion<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[]): T | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`Onboarding state field ${key} contains unsupported value: ${String(value)}`);
  }
  return value as T;
}

function optionalIsoString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new Error(`Onboarding state field ${key} must be an ISO timestamp when provided.`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Onboarding state field ${key} must be a boolean.`);
  }
  return value;
}

function timestamp(now?: OnboardingStateTimestamp): string {
  if (now instanceof Date) {
    return now.toISOString();
  }
  if (typeof now === "string") {
    return now;
  }
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
