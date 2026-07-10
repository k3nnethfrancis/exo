import { describe, expect, it } from "vitest";

import {
  normalizeSemanticTraceEvent,
  semanticTraceEventsToAgentAnswerText,
  semanticTraceEventToActivityTracePacket,
  type SemanticTraceInput,
} from "../semantic-trace";

const baseEvent: SemanticTraceInput = {
  id: "event-1",
  activityId: "activity-1",
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

  it("converts semantic trace events to the activity trace packet shape", () => {
    const packet = semanticTraceEventToActivityTracePacket(normalizeSemanticTraceEvent(baseEvent));

    expect(packet).toMatchObject({
      id: "event-1",
      activityId: "activity-1",
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

  it("keeps public semantic trace events non-private in activity packets", () => {
    const event = normalizeSemanticTraceEvent({
      ...baseEvent,
      kind: "message",
      visibility: "public",
      payload: { text: "Task complete." },
    });

    expect(semanticTraceEventToActivityTracePacket(event)).toMatchObject({
      kind: "message",
      private: false,
    });
  });

  it("extracts agent answer text without depending on terminal transcript tails", () => {
    const events = [
      normalizeSemanticTraceEvent({
        ...baseEvent,
        id: "harness-event",
        kind: "lifecycle",
        actor: { id: "fake-pi", kind: "harness" },
        payload: { status: "generating" },
      }),
      normalizeSemanticTraceEvent({
        ...baseEvent,
        id: "agent-answer",
        kind: "message",
        actor: { id: "fake-pi", kind: "agent" },
        payload: { text: "PI_FIXTURE_ANSWER OK" },
      }),
    ];

    expect(semanticTraceEventsToAgentAnswerText(events)).toBe("PI_FIXTURE_ANSWER OK");
  });

  it("round-trips lifecycle and raw harness events through activity packets", () => {
    const lifecycle = semanticTraceEventToActivityTracePacket(normalizeSemanticTraceEvent({
      ...baseEvent,
      id: "event-lifecycle",
      kind: "lifecycle",
      payload: { lifecycle: "exit", status: "succeeded" },
    }));
    const raw = semanticTraceEventToActivityTracePacket(normalizeSemanticTraceEvent({
      ...baseEvent,
      id: "event-raw",
      kind: "harness.raw",
      payload: { rawKind: "provider-specific", raw: { type: "provider-specific" } },
    }));

    expect(lifecycle).toMatchObject({
      kind: "event",
      payload: {
        semanticKind: "lifecycle",
        payload: { lifecycle: "exit", status: "succeeded" },
      },
    });
    expect(raw).toMatchObject({
      kind: "event",
      payload: {
        semanticKind: "harness.raw",
        payload: { rawKind: "provider-specific", raw: { type: "provider-specific" } },
      },
    });
  });

  it("requires identity, harness, and activity context before conversion", () => {
    expect(() => normalizeSemanticTraceEvent({ ...baseEvent, id: "" })).toThrow("event id must be non-empty");
    expect(() => normalizeSemanticTraceEvent({ ...baseEvent, harnessId: "" })).toThrow("harnessId must be non-empty");
    expect(() => normalizeSemanticTraceEvent({ ...baseEvent, actor: { id: "", kind: "agent" } })).toThrow("actor id must be non-empty");
    expect(() => semanticTraceEventToActivityTracePacket(normalizeSemanticTraceEvent({
      ...baseEvent,
      activityId: undefined,
      runId: undefined,
    }))).toThrow("requires activityId");
  });
});
