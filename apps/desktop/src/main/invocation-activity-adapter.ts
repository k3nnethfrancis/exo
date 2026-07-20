import { invocationActivityLabel, type AgentCommandAdapter, type InvocationActivityKind } from "@exo/core";

export interface ParsedInvocationActivity {
  kind: InvocationActivityKind;
  label?: string;
}

/**
 * Stateful JSONL parser for provider status facts. It never forwards assistant
 * text, reasoning, commands, or raw output; unknown events disappear here.
 */
export class InvocationActivityAdapter {
  private pending = "";

  constructor(private readonly adapter: AgentCommandAdapter) {}

  push(channel: "stdout" | "stderr", chunk: string): ParsedInvocationActivity[] {
    if (channel !== "stdout" || this.adapter === "generic") return [];
    this.pending = `${this.pending}${chunk}`.slice(-MAX_PENDING_CHARS);
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    return lines.flatMap((line) => this.parseLine(line));
  }

  finish(): ParsedInvocationActivity[] {
    const pending = this.pending;
    this.pending = "";
    return pending ? this.parseLine(pending) : [];
  }

  private parseLine(line: string): ParsedInvocationActivity[] {
    let event: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      event = value as Record<string, unknown>;
    } catch {
      return [];
    }
    return this.adapter === "claude-code" ? claudeActivity(event) : codexActivity(event);
  }
}

function claudeActivity(event: Record<string, unknown>): ParsedInvocationActivity[] {
  if (event.type === "system") return [{ kind: "working" }];
  if (event.type === "result") return [{ kind: "finishing" }];
  if (event.type !== "assistant") return [];
  const message = record(event.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.flatMap((entry) => {
    const block = record(entry);
    if (block?.type !== "tool_use" || typeof block.name !== "string") return [];
    return activityForTool(block.name, record(block.input));
  });
}

function codexActivity(event: Record<string, unknown>): ParsedInvocationActivity[] {
  if (event.type === "thread.started" || event.type === "turn.started") return [{ kind: "working" }];
  if (event.type === "turn.completed") return [{ kind: "finishing" }];
  if (event.type !== "item.started" && event.type !== "item.completed") return [];
  const item = record(event.item);
  if (!item || typeof item.type !== "string") return [];
  if (item.type === "reasoning" || item.type === "agent_message") return [];
  if (item.type === "command_execution") return [{ kind: "running" }];
  if (item.type === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const candidate = record(changes[0]);
    return [withLabel("editing", candidate?.path)];
  }
  if (item.type === "mcp_tool_call") return [{ kind: "running" }];
  return [];
}

function activityForTool(name: string, input: Record<string, unknown> | null): ParsedInvocationActivity[] {
  switch (name.toLowerCase()) {
    case "read":
      return [withLabel("reading", input?.file_path ?? input?.path)];
    case "glob":
    case "grep":
    case "search":
      return [withLabel("searching", input?.path)];
    case "edit":
    case "write":
    case "multiedit":
      return [withLabel("editing", input?.file_path ?? input?.path)];
    case "bash":
    case "shell":
      return [{ kind: "running" }];
    default:
      return [];
  }
}

function withLabel(kind: InvocationActivityKind, value: unknown): ParsedInvocationActivity {
  const label = invocationActivityLabel(value);
  return { kind, ...(label ? { label } : {}) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const MAX_PENDING_CHARS = 64_000;
