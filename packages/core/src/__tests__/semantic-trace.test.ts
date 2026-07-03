import { describe, expect, it } from "vitest";

import {
  normalizeSemanticTraceEvent,
  semanticTraceEventToRunTracePacket,
  type SemanticTraceInput,
} from "../semantic-trace";

const baseEvent: SemanticTraceInput = {
  id: "event-1",
  runId: "run-1",
  sessionId: "session-1",
  harnessId: "codex",
  timestamp: "2026-07-03T16:00:00.000Z",
  kind: "tool.call",
  actor: { id: "codex", kind: "agent", label: "Codex" },
  refs: {
    transcript: { path: ".exo/terminal-transcripts/session-1.ansi.log", offset: 128, length: 64 },
    files: [{ path: "projects/exo/tasks.md", action: "write" }],
    tools: [{ name: "apply_patch", callId: "tool-1", status: "started" }],
    evidence: [{ id: "task", kind: "markdown", path: "tasks.md" }],
  },
  payload: {
    name: "apply_patch",
  },
};

describe("semantic trace contract", () => {
  it("normalizes semantic trace events with stable defaults", () => {
    expect(normalizeSemanticTraceEvent(baseEvent)).toEqual({
      ...baseEvent,
      schemaVersion: "exo.semantic-trace.v1",
      visibility: "private",
    });
  });

  it("converts semantic trace events to the existing RunTracePacket artifact shape", () => {
    const packet = semanticTraceEventToRunTracePacket(normalizeSemanticTraceEvent(baseEvent));

    expect(packet).toMatchObject({
      id: "event-1",
      runId: "run-1",
      kind: "toolCall",
      actor: "codex",
      private: true,
      evidence: [{ id: "task", kind: "markdown", path: "tasks.md" }],
      payload: {
        schemaVersion: "exo.semantic-trace.v1",
        semanticKind: "tool.call",
        harnessId: "codex",
        sessionId: "session-1",
        refs: {
          transcript: { path: ".exo/terminal-transcripts/session-1.ansi.log", offset: 128, length: 64 },
          files: [{ path: "projects/exo/tasks.md", action: "write" }],
        },
        actor: { id: "codex", kind: "agent", label: "Codex" },
        payload: { name: "apply_patch" },
      },
    });
  });

  it("keeps public semantic trace events non-private in run compatibility packets", () => {
    const event = normalizeSemanticTraceEvent({
      ...baseEvent,
      kind: "message",
      visibility: "public",
      payload: { text: "Task complete." },
    });

    expect(semanticTraceEventToRunTracePacket(event)).toMatchObject({
      kind: "message",
      private: false,
    });
  });

  it("requires identity, harness, and run/activity context before conversion", () => {
    expect(() => normalizeSemanticTraceEvent({ ...baseEvent, id: "" })).toThrow("event id must be non-empty");
    expect(() => normalizeSemanticTraceEvent({ ...baseEvent, harnessId: "" })).toThrow("harnessId must be non-empty");
    expect(() => normalizeSemanticTraceEvent({ ...baseEvent, actor: { id: "", kind: "agent" } })).toThrow("actor id must be non-empty");
    expect(() => semanticTraceEventToRunTracePacket(normalizeSemanticTraceEvent({
      ...baseEvent,
      runId: undefined,
      activityId: undefined,
    }))).toThrow("requires runId or activityId");
  });
});
