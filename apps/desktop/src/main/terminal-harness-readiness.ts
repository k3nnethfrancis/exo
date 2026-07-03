import {
  agentHarnessRegistry,
  type AgentHarness,
  type HarnessReadinessBlockPattern,
  type HarnessReadinessContract,
  type HarnessSemanticMessageContract,
  type RuntimeConfig,
} from "@exo/core";

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
  const harness = builtInHarness(kind);
  return harness?.prepareLaunchArgs ? harness.prepareLaunchArgs({ args, runtimeConfig: config, cwd, env: process.env }) : args;
}

export function initialHarnessReadiness(kind: TerminalKind): TerminalSessionInfo["readiness"] {
  return readinessContract(kind)?.initialReadiness ?? "ready";
}

export function initialHarnessReadinessDetail(kind: TerminalKind): string | undefined {
  return readinessContract(kind)?.initialDetail;
}

export function shouldGateHarnessStartupInput(info: TerminalSessionInfo): boolean {
  return shouldQueueUntilReady(info) && info.status === "running" && info.readiness === "starting";
}

export function startupGraceReadyDetail(kind: TerminalKind): string {
  return readinessContract(kind)?.graceReadyDetail ?? "Agent startup grace elapsed.";
}

export function shouldQueueRawWrite(info: TerminalSessionInfo, data: string): boolean {
  return (
    shouldQueueUntilReady(info) &&
    info.status === "running" &&
    info.readiness !== "ready" &&
    looksLikeSubmittedChatMessage(data)
  );
}

export function shouldQueueSemanticMessage(info: TerminalSessionInfo, submit: boolean): boolean {
  return submit && shouldQueueUntilReady(info) && info.status === "running" && info.readiness !== "ready";
}

export function semanticMessageWrite(kind: TerminalKind, message: string): string {
  const semanticMessages = semanticMessageContract(kind);
  switch (semanticMessages?.defaultMode) {
    case "paste-enter":
      return bracketedPaste(message);
    case "stdin":
    case "command":
    case "file":
    case undefined:
      return message;
  }
}

export function observeHarnessReadiness(
  info: TerminalSessionInfo,
  terminalTail: string,
): HarnessReadinessTransition | null {
  const readiness = readinessContract(info.kind);
  if (!readiness || info.readiness === "ready") {
    return null;
  }

  const startupState = getHarnessStartupState(terminalTail, readiness);
  if (startupState.kind === "ready") {
    return {
      readiness: "ready",
      readinessDetail: readiness.readyDetail ?? "Agent input is ready.",
      flushQueued: true,
      clearTimer: true,
    };
  }

  if (startupState.kind === "blocked") {
    return {
      readiness: "blocked",
      readinessDetail: startupState.block.detail,
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

type HarnessStartupState =
  | { kind: "ready" }
  | { kind: "blocked"; block: HarnessReadinessBlockPattern }
  | { kind: "unknown" };

function getHarnessStartupState(buffer: string, readiness: HarnessReadinessContract): HarnessStartupState {
  const text = normalizeTerminalText(buffer);
  const readyIndex = latestPatternIndex(text, readinessPatterns(readiness));
  const blocked = latestBlockedPattern(text, readiness.blockedPatterns ?? []);

  if (blocked && blocked.index > readyIndex) {
    return { kind: "blocked", block: blocked.block };
  }
  return readyIndex >= 0 ? { kind: "ready" } : { kind: "unknown" };
}

function normalizeTerminalText(buffer: string): string {
  return buffer
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function latestPatternIndex(text: string, patterns: readonly string[]): number {
  return latestRegexIndex(text, patterns.map((pattern) => new RegExp(pattern, "g")));
}

function latestBlockedPattern(
  text: string,
  blocks: readonly HarnessReadinessBlockPattern[],
): { block: HarnessReadinessBlockPattern; index: number } | null {
  let latest: { block: HarnessReadinessBlockPattern; index: number } | null = null;
  for (const block of blocks) {
    const index = latestPatternIndex(text, block.patterns);
    if (index >= 0 && (!latest || index > latest.index)) {
      latest = { block, index };
    }
  }
  return latest;
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

function readinessPatterns(readiness: HarnessReadinessContract): readonly string[] {
  if (readiness.patterns && readiness.patterns.length > 0) {
    return readiness.patterns;
  }
  return readiness.pattern ? [readiness.pattern] : [];
}

function shouldQueueUntilReady(info: TerminalSessionInfo): boolean {
  return semanticMessageContract(info.kind)?.queueSubmittedInputUntilReady === true;
}

function semanticMessageContract(kind: TerminalKind): HarnessSemanticMessageContract | undefined {
  return builtInHarness(kind)?.semanticMessages;
}

function readinessContract(kind: TerminalKind): HarnessReadinessContract | undefined {
  return semanticMessageContract(kind)?.readiness;
}

function builtInHarness(kind: TerminalKind): AgentHarness | undefined {
  const harness = agentHarnessRegistry.get(kind);
  // Manifest-discovered harnesses are metadata-only in this slice; only reviewed
  // built-ins may expose callable launch/readiness hooks.
  if (harness?.metadata.lifecycle !== "built-in") {
    return undefined;
  }
  return harness;
}
