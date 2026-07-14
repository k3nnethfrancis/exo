import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand, agentCommandExecutableFingerprint } from "../agent-invocation";
import { InvocationContinuityStore, type InvocationContinuityLane } from "../invocation-continuity-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("InvocationContinuityStore", () => {
  it("writes an atomic Workspace-local head and reads it only for the exact lane", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const command = createDefaultClaudeAgentCommand();
    const lane = laneFor(workspaceRoot, command.id, agentCommandExecutableFingerprint(command));
    const store = new InvocationContinuityStore(workspaceRoot);

    const written = await store.writeHead(lane, {
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      sourceInvocationId: "invocation-1",
      updatedAt: "2026-07-13T00:00:00.000Z",
    });

    expect(await store.readHead(lane)).toEqual(written);
    expect(store.headPath(lane)).toContain(`${path.sep}.exo${path.sep}invocation-continuity${path.sep}v1${path.sep}`);
    expect(await readFile(store.headPath(lane), "utf8")).toContain('"sourceInvocationId": "invocation-1"');
    expect(await store.readHead({ ...lane, commandFingerprint: "b".repeat(64) })).toBeNull();
    expect(await store.readHead({ ...lane, cwd: path.join(workspaceRoot, "other") })).toBeNull();
  });

  it("never accepts a lane from another Workspace", async () => {
    const workspaceA = await temporaryWorkspace();
    const workspaceB = await temporaryWorkspace();
    const command = createDefaultClaudeAgentCommand();
    const store = new InvocationContinuityStore(workspaceA);
    const foreignLane = laneFor(workspaceB, command.id, agentCommandExecutableFingerprint(command));

    await expect(store.readHead(foreignLane)).rejects.toThrow("another Workspace");
    await expect(store.writeHead(foreignLane, {
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      sourceInvocationId: "invocation-1",
    })).rejects.toThrow("another Workspace");
  });

  it("reset clears only the derived head", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const command = createDefaultClaudeAgentCommand();
    const lane = laneFor(workspaceRoot, command.id, agentCommandExecutableFingerprint(command));
    const store = new InvocationContinuityStore(workspaceRoot);
    await store.writeHead(lane, {
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      sourceInvocationId: "invocation-1",
    });

    await expect(store.clearHead(lane)).resolves.toBe(true);
    await expect(store.readHead(lane)).resolves.toBeNull();
    await expect(store.clearHead(lane)).resolves.toBe(false);
  });

  it("finds and resets every cwd lane for one Command only", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const command = createDefaultClaudeAgentCommand();
    const store = new InvocationContinuityStore(workspaceRoot);
    const lane = laneFor(workspaceRoot, command.id, agentCommandExecutableFingerprint(command));
    await store.writeHead(lane, { providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792", sourceInvocationId: "inv-1" });
    await store.writeHead({ ...lane, cwd: path.join(workspaceRoot, "notes") }, { providerSessionId: "de4b9e26-2574-4433-a054-1110cd403793", sourceInvocationId: "inv-2" });
    await store.writeHead({ ...lane, commandId: "other" }, { providerSessionId: "ee4b9e26-2574-4433-a054-1110cd403794", sourceInvocationId: "inv-3" });

    await expect(store.hasCommandHead(command.id)).resolves.toBe(true);
    await expect(store.clearCommandHeads(command.id)).resolves.toBe(2);
    await expect(store.hasCommandHead(command.id)).resolves.toBe(false);
    await expect(store.hasCommandHead("other")).resolves.toBe(true);
  });
});

function laneFor(workspaceRoot: string, commandId: string, commandFingerprint: string): InvocationContinuityLane {
  return {
    workspaceRoot,
    commandId,
    commandFingerprint,
    adapter: "claude-code",
    cwd: workspaceRoot,
  };
}

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-continuity-"));
  roots.push(root);
  return root;
}
