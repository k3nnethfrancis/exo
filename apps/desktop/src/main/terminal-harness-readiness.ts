import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildExoMcpServerSpec, type RuntimeConfig } from "@exo/core";

import type { TerminalKind, TerminalSessionInfo } from "../shared/api";

export interface PendingTerminalWrite {
  data: string;
  delayedSubmit: boolean;
}

export interface HarnessReadinessTransition {
  readiness: TerminalSessionInfo["readiness"];
  readinessDetail?: string;
  flushQueued: boolean;
  clearTimer: boolean;
}

export function harnessLaunchArgs(kind: TerminalKind, args: string[], config: RuntimeConfig, cwd: string): string[] {
  return kind === "codex" ? withCodexMcpOverrides(args, config, cwd) : args;
}

export function initialHarnessReadiness(kind: TerminalKind): TerminalSessionInfo["readiness"] {
  return kind === "codex" ? "starting" : "ready";
}

export function initialHarnessReadinessDetail(kind: TerminalKind): string | undefined {
  return kind === "codex" ? "Waiting briefly for Codex startup interstitials." : undefined;
}

export function shouldGateHarnessStartupInput(info: TerminalSessionInfo): boolean {
  return info.kind === "codex" && info.status === "running" && info.readiness === "starting";
}

export function startupGraceReadyDetail(kind: TerminalKind): string {
  return kind === "codex" ? "Codex startup grace elapsed." : "Agent startup grace elapsed.";
}

export function shouldQueueRawWrite(info: TerminalSessionInfo, data: string): boolean {
  return (
    info.kind === "codex" &&
    info.status === "running" &&
    info.readiness !== "ready" &&
    looksLikeSubmittedChatMessage(data)
  );
}

export function shouldQueueSemanticMessage(info: TerminalSessionInfo, submit: boolean): boolean {
  return submit && info.kind === "codex" && info.status === "running" && info.readiness !== "ready";
}

export function semanticMessageWrite(kind: TerminalKind, message: string): string {
  return kind === "shell" ? message : bracketedPaste(message);
}

export function observeHarnessReadiness(
  info: TerminalSessionInfo,
  terminalTail: string,
): HarnessReadinessTransition | null {
  if (info.kind !== "codex" || info.readiness === "ready") {
    return null;
  }

  const startupState = getCodexStartupState(terminalTail);
  if (startupState === "ready") {
    return {
      readiness: "ready",
      readinessDetail: "Codex chat input is ready.",
      flushQueued: true,
      clearTimer: true,
    };
  }

  if (startupState === "trust-blocked") {
    return {
      readiness: "blocked",
      readinessDetail: "Codex startup trust prompt is waiting for interactive confirmation.",
      flushQueued: false,
      clearTimer: true,
    };
  }

  if (startupState === "update-blocked") {
    return {
      readiness: "blocked",
      readinessDetail: "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.",
      flushQueued: false,
      clearTimer: true,
    };
  }

  return null;
}

export function isAgentHarnessKind(kind: TerminalKind): boolean {
  return kind === "claude" || kind === "codex" || kind === "pi" || kind === "hermes";
}

function looksLikeSubmittedChatMessage(data: string): boolean {
  if (!data.endsWith("\r")) {
    return false;
  }

  const body = data.slice(0, -1);
  return body.length > 0 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(body);
}

function bracketedPaste(data: string): string {
  return `\x1b[200~${data}\x1b[201~`;
}

type CodexStartupState = "ready" | "trust-blocked" | "update-blocked" | "unknown";

function getCodexStartupState(buffer: string): CodexStartupState {
  const text = normalizeTerminalText(buffer);
  const readyIndex = latestRegexIndex(text, [
    /\bask codex\b/g,
    /\bopenai codex\b/g,
    /\btype (?:a )?message\b/g,
    /\bwhat can i help\b/g,
    /\bcodex is ready\b/g,
  ]);
  const trustIndex = latestRegexIndex(text, [
    /\bdo you trust\b/g,
    /\btrust (?:the )?(?:files|folder|directory|workspace|repo|repository)\b/g,
    /\b(?:folder|directory|workspace|repo|repository).{0,80}\btrust\b/g,
  ]);
  const updateIndex =
    /\bskip until next version\b/.test(text) ? latestRegexIndex(text, [/\bupdate available\b/g]) : -1;

  if (trustIndex > readyIndex) {
    return "trust-blocked";
  }
  if (updateIndex > readyIndex) {
    return "update-blocked";
  }
  return readyIndex >= 0 ? "ready" : "unknown";
}

function normalizeTerminalText(buffer: string): string {
  return buffer
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function latestRegexIndex(text: string, patterns: RegExp[]): number {
  let latest = -1;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      latest = Math.max(latest, match.index);
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }
  return latest;
}

function withCodexMcpOverrides(args: string[], config: RuntimeConfig, cwd: string): string[] {
  const exoRoot = findExoRepoRoot(config, cwd);
  if (!exoRoot) {
    return args;
  }

  const spec = buildExoMcpServerSpec({
    exoRoot,
    workspaceRoot: config.workspace.workspaceRoot,
  });

  return [
    ...args,
    "-c",
    `mcp_servers.${spec.serverName}.command=${tomlString(spec.command)}`,
    "-c",
    `mcp_servers.${spec.serverName}.args=${tomlStringArray(spec.args)}`,
    "-c",
    `mcp_servers.${spec.serverName}.env=${tomlInlineTable(spec.env)}`,
  ];
}

function findExoRepoRoot(config: RuntimeConfig, cwd: string): string | null {
  const candidates = [
    cwd,
    process.cwd(),
    config.workspace.workspaceRoot,
    config.workspace.defaultTerminalCwd,
    ...config.workspace.projectRoots.map((root) => root.path),
  ];

  for (const candidate of candidates) {
    const root = findExoRepoRootFrom(candidate);
    if (root) {
      return root;
    }
  }

  return null;
}

function findExoRepoRootFrom(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (isExoRepoRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isExoRepoRoot(candidate: string): boolean {
  const packageJsonPath = path.join(candidate, "package.json");
  const mcpLauncherPath = path.join(candidate, "packages", "mcp", "bin", "exo-mcp.mjs");
  if (!existsSync(packageJsonPath) || !existsSync(mcpLauncherPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    return packageJson.name === "exo";
  } catch {
    return false;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(", ")}}`;
}
