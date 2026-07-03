import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { builtInAgentHarnesses } from "../agent-harnesses/builtins";
import {
  resolveAgentLaunchPlan,
  resolveDebugAgentLaunchPlan,
  resolveLaunchableAgentLaunchPlan,
  resolveRuntimeConfig,
  syncRuntimeContextFiles,
} from "../runtime";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { recursive: true, force: true })));
});

describe("runtime", () => {
  it("exposes built-in agent harness metadata", () => {
    expect(builtInAgentHarnesses.shell.metadata).toMatchObject({
      id: "shell",
      kind: "core:agentHarness",
      lifecycle: "built-in",
    });
    expect(builtInAgentHarnesses.claude.metadata).toMatchObject({
      id: "claude",
      kind: "core:agentHarness",
      lifecycle: "built-in",
    });
    expect(builtInAgentHarnesses.codex.metadata).toMatchObject({
      id: "codex",
      kind: "core:agentHarness",
      lifecycle: "built-in",
    });
  });

  it("resolves runtime config from workspace env", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      EXO_QMD_COMMAND: "qmd-local",
    });

    expect(config.workspace.workspaceRoot).toBe("/tmp/exo-test-workspace");
    expect(config.retrieval.command).toBe("qmd-local");
    expect(config.instructions.primary).toContain("/tmp/exo-test-workspace/.exo/instructions/AGENTS.md");
  });

  it("builds launch plans with runtime context env", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      EXO_CLAUDE_COMMAND: "claude",
    });

    const plan = resolveAgentLaunchPlan(config, "claude", "/tmp/exo-test-workspace/projects/helm");

    expect(plan.cwd).toBe("/tmp/exo-test-workspace/projects/helm");
    expect(plan.command).toBe("claude");
    expect(plan.env.EXO_RUNTIME_PRIMARY_INSTRUCTIONS).toBe(config.instructions.primary);
    expect(plan.env.EXO_RUNTIME_SECONDARY_INSTRUCTIONS).toBe("");
    expect(plan.env.EXO_AGENT_TRANSPORT).toBe("file-sqlite");
    expect(plan.secondaryInstructionsPath).toBeUndefined();
  });

  it("resolves shell launchers through the built-in shell harness", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      EXO_SHELL: "/bin/zsh",
    });

    const plan = resolveAgentLaunchPlan(config, "shell", "/tmp/exo-test-workspace");

    expect(plan.title).toBe("Terminal");
    expect(plan.command).toBe("/bin/zsh");
    expect(plan.args).toEqual(["-l"]);
  });

  it("adds a supported Codex reasoning-effort override by default", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      EXO_CODEX_COMMAND: "codex",
    });

    const plan = resolveAgentLaunchPlan(config, "codex", "/tmp/exo-test-workspace");

    expect(plan.command).toBe("codex");
    expect(plan.args).toContain("-c");
    expect(plan.args).toContain('model_reasoning_effort="high"');
  });

  it("keeps an explicit Codex reasoning-effort override when provided", () => {
    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      EXO_CODEX_COMMAND: "codex",
      EXO_CODEX_ARGS: '-c,model_reasoning_effort="medium"',
    });

    const plan = resolveAgentLaunchPlan(config, "codex", "/tmp/exo-test-workspace");

    expect(plan.args).toEqual(["-c", 'model_reasoning_effort="medium"']);
  });

  it("keeps raw Pi launch plans available only as an explicit debug surface", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-pi-runtime-"));
    tempPaths.push(tempRoot);
    const cliPath = path.join(tempRoot, "packages", "coding-agent", "dist", "cli.js");
    await mkdir(path.dirname(cliPath), { recursive: true });
    await writeFile(cliPath, "#!/usr/bin/env node\n", "utf8");

    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: tempRoot,
    });

    const plan = resolveDebugAgentLaunchPlan(config, "pi", "/tmp/exo-test-workspace/projects/ga-pi");

    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual([cliPath]);
    expect(plan.env.EXO_AGENT_KIND).toBe("pi");
    expect(plan.env.EXO_RUNTIME_PRIMARY_INSTRUCTIONS).toBe(config.instructions.primary);
    expect(() =>
      resolveLaunchableAgentLaunchPlan(config, "pi", "/tmp/exo-test-workspace/projects/ga-pi", {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
        EXO_PROJECT_ROOTS: tempRoot,
      }),
    ).toThrow("Agent harness is not launchable: pi (Missing dependency).");
  });

  it("resolves production Pi launch plans only when readiness is launchable", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-pi-launchable-runtime-"));
    tempPaths.push(tempRoot);
    const cliPath = path.join(tempRoot, "packages", "coding-agent", "dist", "cli.js");
    await mkdir(path.dirname(cliPath), { recursive: true });
    await writeFile(cliPath, "#!/usr/bin/env node\n", "utf8");

    const env = {
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
      EXO_PROJECT_ROOTS: tempRoot,
      EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
    };
    const config = resolveRuntimeConfig(env);
    const plan = resolveLaunchableAgentLaunchPlan(config, "pi", "/tmp/exo-test-workspace/projects/ga-pi", env);

    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual([cliPath]);
    expect(plan.env.EXO_AGENT_KIND).toBe("pi");
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
    expect(primaryText).toContain("Prefer Exo MCP tools");
    expect(primaryText).toContain("exo runtime launch-plan");
    expect(primaryText).toContain("Optional Notes Index / Retrieval Backend");
    expect(primaryText).toContain("index_mode: off");
    expect(primaryText).toContain("exo search");
    expect(primaryText).not.toContain("exo-cli");
    expect(claudeText).toBe(primaryText);
  });
});
