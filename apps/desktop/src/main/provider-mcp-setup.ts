import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProviderMcpSetupInput, ProviderMcpSetupResult } from "../shared/api";
import { commandEnvironment } from "./command-environment";

const execFileAsync = promisify(execFile);

export type ProviderMcpTarget = ProviderMcpSetupInput["providers"][number];
type ProviderMcpExecutor = (file: string, args: string[], environment: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;

/**
 * One explicit installation of Exo's read-only stdio MCP server into providers'
 * native registries. The provider owns its config and authentication; Exo owns
 * only this small read-only server.
 */
export async function configureProviderMcp(
  input: ProviderMcpSetupInput,
  options: { env?: NodeJS.ProcessEnv; execute?: ProviderMcpExecutor } = {},
): Promise<ProviderMcpSetupResult[]> {
  const normalized = normalizeInput(input);
  const environment = commandEnvironment(options.env);
  const exoCommand = await resolveExoCliCommand(environment);
  const execute = options.execute ?? executeProviderMcpCommand;
  const results = await Promise.all(normalized.providers.map(async (provider) => {
    const [file, args] = providerMcpCommand(provider, normalized, exoCommand);
    try {
      const { stdout, stderr } = await execute(file, args, environment);
      const detail = [stdout, stderr].map((value) => value.trim()).filter(Boolean).join("\n");
      return { provider, ok: true, detail: detail || `Added Exo MCP to ${providerLabel(provider)}.` };
    } catch (error) {
      if (isExistingMcpRegistration(error)) {
        return { provider, ok: true, detail: `Exo MCP is already installed for ${providerLabel(provider)}.` };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider,
        ok: false,
        detail: isExecutableMissing(error)
          ? `${providerLabel(provider)} CLI was not found. Install it or add it to Exo's PATH, then try again.`
          : `${providerLabel(provider)} MCP setup failed: ${message}`,
      };
    }
  }));
  return results;
}

async function executeProviderMcpCommand(
  file: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, {
    env: environment,
    shell: false,
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 128 * 1024,
  });
}

function isExistingMcpRegistration(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /mcp server\s+exo\s+already exists|server\s+exo\s+already exists/i.test(message);
}

function isExecutableMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function providerLabel(provider: ProviderMcpTarget): string {
  return provider === "claude" ? "Claude" : "Codex";
}

export function providerMcpCommand(provider: ProviderMcpTarget, input: ProviderMcpSetupInput, exoCommand = "exo"): [string, string[]] {
  normalizeInput(input);
  if (provider === "claude") {
    return ["claude", ["mcp", "add", "--scope", "user", "exo", "--", exoCommand, "mcp", "serve"]];
  }
  return ["codex", ["mcp", "add", "exo", "--", exoCommand, "mcp", "serve"]];
}

function normalizeInput(input: ProviderMcpSetupInput): { providers: ProviderMcpTarget[] } {
  const providers = [...new Set(input.providers)].filter((provider): provider is ProviderMcpTarget => provider === "claude" || provider === "codex");
  if (providers.length === 0) throw new Error("Choose at least one agent.");
  return { providers };
}

async function resolveExoCliCommand(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const explicit = env.EXO_CLI_PATH?.trim();
  if (explicit && await isExecutable(explicit)) return explicit;
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "exo");
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error("Exo’s command-line tool is not installed. Install Exo with its CLI, then try again.");
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}
