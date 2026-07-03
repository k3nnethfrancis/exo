import { spawn } from "node:child_process";

import type { AgentHarnessDependencyAutoStart, AgentHarnessDependencyStatus } from "@exo/core";

export interface HarnessDependencyStarter {
  ensureStarted(dependencies: AgentHarnessDependencyStatus[]): Promise<Record<string, string>>;
}

interface PendingStart {
  promise: Promise<Record<string, string>>;
}

export class DefaultHarnessDependencyStarter implements HarnessDependencyStarter {
  private readonly pending = new Map<string, PendingStart>();

  async ensureStarted(dependencies: AgentHarnessDependencyStatus[]): Promise<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const dependency of dependencies) {
      if (!dependency.required || dependency.satisfied || !dependency.autoStart) {
        continue;
      }
      Object.assign(env, await this.ensureOneStarted(dependency.label, dependency.autoStart));
    }
    return env;
  }

  private async ensureOneStarted(label: string, autoStart: AgentHarnessDependencyAutoStart): Promise<Record<string, string>> {
    const key = startKey(autoStart);
    const existing = this.pending.get(key);
    if (existing) {
      return existing.promise;
    }

    const promise = this.startAndProbe(label, autoStart).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, { promise });
    return promise;
  }

  private async startAndProbe(label: string, autoStart: AgentHarnessDependencyAutoStart): Promise<Record<string, string>> {
    if (!autoStart.probeUrl) {
      throw new Error(`${label} can be auto-started only when a probe URL is configured.`);
    }

    if (await probeUrl(autoStart.probeUrl)) {
      return autoStart.readyEnv ?? {};
    }

    // The command is explicitly user-configured harness dependency behavior.
    // Plugin manifests must not reach this path; desktop main only runs it as
    // part of a launch request for a harness that already declared this
    // dependency metadata.
    const child = spawn(autoStart.command, [], {
      cwd: autoStart.cwd,
      detached: true,
      env: process.env,
      shell: true,
      stdio: "ignore",
    });
    child.unref();

    const timeoutMs = autoStart.timeoutMs ?? 30_000;
    const intervalMs = autoStart.intervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await probeUrl(autoStart.probeUrl)) {
        return autoStart.readyEnv ?? {};
      }
      await delay(intervalMs);
    }

    throw new Error(
      `${label} did not become ready within ${timeoutMs}ms after running: ${autoStart.command}. Probe URL: ${autoStart.probeUrl}`,
    );
  }
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(1_500),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startKey(autoStart: AgentHarnessDependencyAutoStart): string {
  return [autoStart.command, autoStart.cwd ?? "", autoStart.probeUrl ?? ""].join("\0");
}
