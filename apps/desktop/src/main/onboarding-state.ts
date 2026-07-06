import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { OnboardingProfileSetupState, OnboardingSetupStep } from "../shared/api";

const ONBOARDING_STATE_FILE = "onboarding-state.json";

interface OnboardingStateFile {
  version: 1;
  workspaces: OnboardingProfileSetupState[];
}

const EMPTY_STORE: OnboardingStateFile = {
  version: 1,
  workspaces: [],
};

export class OnboardingStateStore {
  constructor(private readonly userDataPath: string) {}

  resolvePath(): string {
    return path.join(this.userDataPath, ONBOARDING_STATE_FILE);
  }

  async getWorkspaceState(workspaceRoot: string): Promise<OnboardingProfileSetupState | null> {
    const store = await this.read();
    return store.workspaces.find((entry) => entry.workspaceRoot === workspaceRoot) ?? null;
  }

  async markProfileSetup(input: {
    workspaceRoot: string;
    status: OnboardingProfileSetupState["status"];
    setupStep?: OnboardingSetupStep;
  }): Promise<OnboardingProfileSetupState> {
    const store = await this.read();
    const now = new Date().toISOString();
    const next: OnboardingProfileSetupState = {
      workspaceRoot: input.workspaceRoot,
      status: input.status,
      setupStep: input.status === "complete" ? "review" : input.setupStep ?? "plugins",
      updatedAt: now,
    };
    const existingIndex = store.workspaces.findIndex((entry) => entry.workspaceRoot === input.workspaceRoot);
    const workspaces = existingIndex >= 0
      ? store.workspaces.map((entry, index) => index === existingIndex ? next : entry)
      : [...store.workspaces, next];
    const nextStore: OnboardingStateFile = { version: 1, workspaces };
    await this.write(nextStore);
    return next;
  }

  private async read(): Promise<OnboardingStateFile> {
    try {
      const raw = await readFile(this.resolvePath(), "utf8");
      return validateStore(JSON.parse(raw));
    } catch (error) {
      if (isNotFound(error)) {
        return EMPTY_STORE;
      }
      throw error;
    }
  }

  private async write(store: OnboardingStateFile): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });
    await writeFile(this.resolvePath(), `${JSON.stringify(validateStore(store), null, 2)}\n`, "utf8");
  }
}

function validateStore(input: unknown): OnboardingStateFile {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.workspaces)) {
    return EMPTY_STORE;
  }
  return {
    version: 1,
    workspaces: input.workspaces.flatMap((entry) => validateEntry(entry) ?? []),
  };
}

function validateEntry(input: unknown): OnboardingProfileSetupState | null {
  if (!isRecord(input) || typeof input.workspaceRoot !== "string" || !isSetupStatus(input.status)) {
    return null;
  }
  return {
    workspaceRoot: input.workspaceRoot,
    status: input.status,
    setupStep: isSetupStep(input.setupStep) ? input.setupStep : input.status === "complete" ? "review" : "plugins",
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString(),
  };
}

function isSetupStatus(value: unknown): value is OnboardingProfileSetupState["status"] {
  return value === "pending" || value === "complete";
}

function isSetupStep(value: unknown): value is OnboardingSetupStep {
  return value === "plugins" || value === "instructions" || value === "routines" || value === "review";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
