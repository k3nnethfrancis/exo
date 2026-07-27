export interface StemCliCommandHelp {
  usageToken: string;
  syntax: string;
  label: string;
}

/**
 * One non-executable catalog for the protected CLI surface. The CLI owns
 * behavior; other product surfaces may render this catalog without copying it.
 */
export const STEM_CLI_COMMANDS: readonly StemCliCommandHelp[] = [
  { usageToken: "[start]", syntax: "stem start", label: "Open app" },
  { usageToken: "show", syntax: "stem show", label: "Show window" },
  { usageToken: "workspaces", syntax: "stem workspaces", label: "List workspaces" },
  { usageToken: "status", syntax: "stem status", label: "Workspace status" },
  { usageToken: "search", syntax: "stem search <query>", label: "Search notes" },
  { usageToken: "index [status|sync]", syntax: "stem index [status|sync]", label: "Index" },
  { usageToken: "open", syntax: "stem open <path>", label: "Open note" },
  { usageToken: "invoke", syntax: "stem invoke @handle <task>", label: "Invoke command" },
  { usageToken: "mcp serve", syntax: "stem mcp serve", label: "Serve MCP" },
] as const;

export const STEM_CLI_USAGE = `Usage: stem ${STEM_CLI_COMMANDS.map((command) => command.usageToken).join(" | ")}`;
