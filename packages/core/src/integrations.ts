export type ExoMcpIntegrationClient = "codex" | "claude";

export const EXO_MCP_INTEGRATION_CLIENTS: ExoMcpIntegrationClient[] = ["codex", "claude"];

export interface ExoMcpIntegrationConfig {
  exoRoot: string;
  workspaceRoot: string;
  serverName?: string;
  startCommand?: string;
}

export interface ExoMcpServerSpec {
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ExoMcpIntegrationSpec {
  client: ExoMcpIntegrationClient;
  server: ExoMcpServerSpec;
  installCommand: string;
  installArgs: string[];
  installDisplay: string;
}

export interface ParsedMcpList {
  configured: boolean;
  matchedLine?: string;
}

export function buildExoMcpServerSpec(config: ExoMcpIntegrationConfig): ExoMcpServerSpec {
  const serverName = config.serverName ?? "exo";
  return {
    serverName,
    command: "pnpm",
    args: ["--dir", config.exoRoot, "--filter", "@exo/mcp", "start"],
    env: {
      EXO_WORKSPACE_ROOT: config.workspaceRoot,
      EXO_MCP_AUTOSTART: "1",
      EXO_MCP_START_COMMAND: config.startCommand ?? `${config.exoRoot}/bin/exo dev`,
    },
  };
}

export function buildExoMcpIntegrationSpec(
  client: ExoMcpIntegrationClient,
  config: ExoMcpIntegrationConfig,
): ExoMcpIntegrationSpec {
  const server = buildExoMcpServerSpec(config);
  const envArgs = Object.entries(server.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const installArgs =
    client === "codex"
      ? ["mcp", "add", server.serverName, ...envArgs, "--", server.command, ...server.args]
      : [
          "mcp",
          "add",
          "--transport",
          "stdio",
          "--scope",
          "user",
          ...envArgs,
          server.serverName,
          "--",
          server.command,
          ...server.args,
        ];

  return {
    client,
    server,
    installCommand: client,
    installArgs,
    installDisplay: formatShellCommand([client, ...installArgs]),
  };
}

export function parseMcpListOutput(output: string, serverName = "exo"): ParsedMcpList {
  const escapedName = escapeRegExp(serverName);
  const serverLinePattern = new RegExp(`^${escapedName}(?:\\s|:|\\t|$)`);
  const matchedLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => serverLinePattern.test(line));

  return {
    configured: Boolean(matchedLine),
    matchedLine,
  };
}

export function formatMcpServerJson(spec: ExoMcpServerSpec): string {
  return JSON.stringify(
    {
      mcpServers: {
        [spec.serverName]: {
          command: spec.command,
          args: spec.args,
          env: spec.env,
        },
      },
    },
    null,
    2,
  );
}

export function formatShellCommand(parts: string[]): string {
  return parts.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
