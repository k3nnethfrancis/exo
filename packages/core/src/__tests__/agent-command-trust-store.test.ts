import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand } from "../agent-invocation";
import { AgentCommandTrustStore, resolveAgentCommandTrustStorePath } from "../agent-command-trust-store";

describe("agent command trust store", () => {
  it("trusts command executable fingerprints and invalidates changed commands", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-"));
    const appStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-app-"));
    const store = new AgentCommandTrustStore(appStateRoot, workspaceRoot);
    const command = createDefaultClaudeAgentCommand();

    await expect(store.status(command)).resolves.toMatchObject({ trusted: false });
    const trusted = await store.trust(command, "2026-07-08T00:00:00.000Z");

    await expect(store.status(command)).resolves.toMatchObject({
      trusted: true,
      executableFingerprint: trusted.executableFingerprint,
      trustedCommand: trusted,
    });
    await expect(store.status({ ...command, command: "claude --print" })).resolves.toMatchObject({
      trusted: false,
    });
  });

  it("writes trust records under the app-local state root", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-"));
    const appStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-app-"));
    const store = new AgentCommandTrustStore(appStateRoot, workspaceRoot);
    await store.trust(createDefaultClaudeAgentCommand(), "2026-07-08T00:00:00.000Z");

    const trustPath = resolveAgentCommandTrustStorePath(appStateRoot);
    expect(trustPath).toBe(path.join(appStateRoot, "agent-command-trust.json"));
    await expect(readFile(trustPath, "utf8")).resolves.toContain("\"trustedCommands\"");
    await expect(readFile(trustPath, "utf8")).resolves.toContain(`"workspaceRoot": "${workspaceRoot}"`);
  });

  it("does not import workspace-local trust files", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-"));
    const appStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-app-"));
    const command = createDefaultClaudeAgentCommand();
    const workspaceTrustPath = path.join(workspaceRoot, ".exo", "agent-command-trust.json");
    await mkdir(path.dirname(workspaceTrustPath), { recursive: true });
    await writeFile(workspaceTrustPath, JSON.stringify({
      trustedCommands: [{
        workspaceRoot,
        commandId: command.id,
        handle: command.handle,
        executableFingerprint: "not-used",
        trustedAt: "2026-07-08T00:00:00.000Z",
      }],
    }), "utf8");

    const store = new AgentCommandTrustStore(appStateRoot, workspaceRoot);

    await expect(store.status(command)).resolves.toMatchObject({ trusted: false });
  });

  it("scopes trusted command fingerprints by workspace root", async () => {
    const firstWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-first-"));
    const secondWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-second-"));
    const appStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-trust-app-"));
    const command = createDefaultClaudeAgentCommand();

    await new AgentCommandTrustStore(appStateRoot, firstWorkspaceRoot).trust(command, "2026-07-08T00:00:00.000Z");

    await expect(new AgentCommandTrustStore(appStateRoot, firstWorkspaceRoot).status(command)).resolves.toMatchObject({
      trusted: true,
    });
    await expect(new AgentCommandTrustStore(appStateRoot, secondWorkspaceRoot).status(command)).resolves.toMatchObject({
      trusted: false,
    });
  });
});
