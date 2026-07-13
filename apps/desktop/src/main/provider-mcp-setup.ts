import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderMcpSetupInput, ProviderMcpSetupResult } from "../shared/api";

const execFileAsync = promisify(execFile);

export type ProviderMcpTarget = ProviderMcpSetupInput["providers"][number];

/**
 * One explicit handoff to providers' native MCP registries. Exo neither stores
 * these definitions nor hosts an MCP server; provider authentication remains
 * provider-owned as well.
 */
export async function configureProviderMcp(input: ProviderMcpSetupInput): Promise<ProviderMcpSetupResult[]> {
  const normalized = normalizeInput(input);
  const results = await Promise.all(normalized.providers.map(async (provider) => {
    const [file, args] = providerMcpCommand(provider, normalized);
    try {
      const { stdout, stderr } = await execFileAsync(file, args, {
        shell: false,
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 128 * 1024,
      });
      const detail = [stdout, stderr].map((value) => value.trim()).filter(Boolean).join("\n");
      return { provider, ok: true, detail: detail || `Added ${normalized.name} to ${provider}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { provider, ok: false, detail: `${provider} could not be configured: ${message}` };
    }
  }));
  return results;
}

export function providerMcpCommand(provider: ProviderMcpTarget, input: ProviderMcpSetupInput): [string, string[]] {
  const normalized = normalizeInput(input);
  if (provider === "claude") {
    return normalized.transport === "http"
      ? ["claude", ["mcp", "add", "--scope", "user", "--transport", "http", normalized.name, normalized.url!]]
      : ["claude", ["mcp", "add", "--scope", "user", normalized.name, "--", normalized.command!, ...(normalized.args ?? [])]];
  }
  return normalized.transport === "http"
    ? ["codex", ["mcp", "add", normalized.name, "--url", normalized.url!]]
    : ["codex", ["mcp", "add", normalized.name, "--", normalized.command!, ...(normalized.args ?? [])]];
}

function normalizeInput(input: ProviderMcpSetupInput): Required<Pick<ProviderMcpSetupInput, "providers" | "name" | "transport">> & ProviderMcpSetupInput {
  const providers = [...new Set(input.providers)].filter((provider): provider is ProviderMcpTarget => provider === "claude" || provider === "codex");
  if (providers.length === 0) throw new Error("Choose at least one agent.");
  const name = input.name.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)) throw new Error("Use a short MCP name with letters, numbers, hyphens, or underscores.");
  if (input.transport === "http") {
    try {
      const url = new URL(input.url?.trim() ?? "");
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
      return { ...input, providers, name, transport: "http", url: url.toString() };
    } catch {
      throw new Error("Enter a valid http or https MCP URL.");
    }
  }
  const command = input.command?.trim() ?? "";
  if (!command || /[\r\n\0]/.test(command)) throw new Error("Enter the MCP executable name or absolute path.");
  const args = (input.args ?? []).map((arg) => arg.trim()).filter(Boolean);
  if (args.some((arg) => /[\r\n\0]/.test(arg))) throw new Error("MCP arguments must be one argument per line.");
  return { ...input, providers, name, transport: "stdio", command, args };
}
