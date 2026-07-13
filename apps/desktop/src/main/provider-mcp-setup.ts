import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProviderMcpSetupInput, ProviderMcpSetupResult } from "../shared/api";

const execFileAsync = promisify(execFile);

export type ProviderMcpTarget = ProviderMcpSetupInput["providers"][number];

/**
 * One explicit installation of Exo's read-only stdio MCP server into providers'
 * native registries. The provider owns its config and authentication; Exo owns
 * only this small read-only server.
 */
export async function configureProviderMcp(input: ProviderMcpSetupInput): Promise<ProviderMcpSetupResult[]> {
  const normalized = normalizeInput(input);
  const exoCommand = await resolveExoCliCommand();
  const results = await Promise.all(normalized.providers.map(async (provider) => {
    const [file, args] = providerMcpCommand(provider, normalized, exoCommand);
    try {
      const { stdout, stderr } = await execFileAsync(file, args, {
        shell: false,
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 128 * 1024,
      });
      const detail = [stdout, stderr].map((value) => value.trim()).filter(Boolean).join("\n");
      return { provider, ok: true, detail: detail || `Added Exo tools to ${provider}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { provider, ok: false, detail: `${provider} could not be configured: ${message}` };
    }
  }));
  return results;
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
