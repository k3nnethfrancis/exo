import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentLaunchPlan, resolveRuntimeConfig, syncRuntimeContextFiles } from "../runtime";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { recursive: true, force: true })));
});

describe("runtime", () => {
  it("resolves runtime config from workspace env", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/lab",
      EXO_NOTE_ROOTS: "/tmp/lab/notes",
      EXO_PROJECT_ROOTS: "/tmp/lab/projects",
      EXO_QMD_COMMAND: "qmd-local",
    });

    expect(config.workspace.workspaceRoot).toBe("/tmp/lab");
    expect(config.retrieval.command).toBe("qmd-local");
    expect(config.instructions.primary).toContain("/tmp/lab/.exo/instructions/AGENTS.md");
  });

  it("builds launch plans with runtime context env", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/lab",
      EXO_NOTE_ROOTS: "/tmp/lab/notes",
      EXO_PROJECT_ROOTS: "/tmp/lab/projects",
      EXO_CLAUDE_COMMAND: "claude",
    });

    const plan = resolveAgentLaunchPlan(config, "claude", "/tmp/lab/projects/helm");

    expect(plan.cwd).toBe("/tmp/lab/projects/helm");
    expect(plan.command).toBe("claude");
    expect(plan.env.EXO_RUNTIME_PRIMARY_INSTRUCTIONS).toBe(config.instructions.primary);
    expect(plan.env.EXO_AGENT_TRANSPORT).toBe("file-sqlite");
    expect(plan.secondaryInstructionsPath).toBe(config.instructions.claude);
  });

  it("adds a supported Codex reasoning-effort override by default", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/lab",
      EXO_NOTE_ROOTS: "/tmp/lab/notes",
      EXO_PROJECT_ROOTS: "/tmp/lab/projects",
      EXO_CODEX_COMMAND: "codex",
    });

    const plan = resolveAgentLaunchPlan(config, "codex", "/tmp/lab");

    expect(plan.command).toBe("codex");
    expect(plan.args).toContain("-c");
    expect(plan.args).toContain('model_reasoning_effort="high"');
  });

  it("keeps an explicit Codex reasoning-effort override when provided", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/lab",
      EXO_NOTE_ROOTS: "/tmp/lab/notes",
      EXO_PROJECT_ROOTS: "/tmp/lab/projects",
      EXO_CODEX_COMMAND: "codex",
      EXO_CODEX_ARGS: '-c,model_reasoning_effort="medium"',
    });

    const plan = resolveAgentLaunchPlan(config, "codex", "/tmp/lab");

    expect(plan.args).toEqual(["-c", 'model_reasoning_effort="medium"']);
  });

  it("writes generated instruction files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-runtime-"));
    tempPaths.push(tempRoot);

    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: tempRoot,
      EXO_NOTE_ROOTS: path.join(tempRoot, "notes"),
      EXO_PROJECT_ROOTS: path.join(tempRoot, "projects"),
    });

    const paths = await syncRuntimeContextFiles(config);
    const primaryText = await readFile(paths.primary, "utf8");
    const claudeText = await readFile(paths.claude, "utf8");

    expect(primaryText).toContain("Exo Runtime");
    expect(primaryText).toContain("exo-cli runtime launch-plan");
    expect(claudeText).toContain("Exo Claude Overlay");
  });
});
