import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SemanticTraceStore,
  captureFakeHarnessTraceFixture,
  fakeHarnessTraceCaptureDeclaration,
  mapHarnessRawTraceEvent,
  semanticTraceMetadataPath,
  semanticTracePath,
} from "../semantic-trace-store";

describe("semantic trace store", () => {
  it("captures deterministic fake-harness stream-json events into linked NDJSON", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-semantic-trace-"));
    const store = new SemanticTraceStore(runtimeRoot);

    try {
      const metadata = await captureFakeHarnessTraceFixture(store, {
        sessionId: "fake-session",
        harnessId: "fake-claude",
        activityId: "activity-1",
        defaultVisibility: "public",
        now: () => "2026-07-03T16:00:00.000Z",
      });
      const events = await store.readEvents("fake-session");

      expect(metadata).toMatchObject({
        sessionId: "fake-session",
        harnessId: "fake-claude",
        tracePath: semanticTracePath(store.layout, "fake-session"),
        eventCount: 6,
        firstSequence: 1,
        lastSequence: 6,
        artifact: {
          id: "semantic-trace",
          activityId: "activity-1",
          kind: "trace",
          path: semanticTracePath(store.layout, "fake-session"),
          mimeType: "application/x-ndjson",
          sourceCapabilityId: "fake-claude",
        },
        metadata: {
          fixture: "fake-harness-stream-json",
          traceCapture: fakeHarnessTraceCaptureDeclaration,
        },
      });
      expect(await store.readMetadata("fake-session")).toEqual(metadata);
      expect(events.map((event) => event.kind)).toEqual([
        "session.started",
        "turn.started",
        "message",
        "tool.call",
        "tool.result",
        "lifecycle",
      ]);
      expect(events[2]).toMatchObject({
        sessionId: "fake-session",
        harnessId: "fake-claude",
        sequence: 3,
        visibility: "public",
        actor: { id: "fake-claude", kind: "agent" },
        payload: {
          rawKind: "assistant-text",
          text: "I will inspect the workspace and report back.",
        },
      });
      expect(events[3].payload.inputDigest).toMatch(/^sha256:/);
      expect(events[4].payload.outputDigest).toMatch(/^sha256:/);

      const rawLines = (await readFile(semanticTracePath(store.layout, "fake-session"), "utf8")).trim().split("\n");
      expect(rawLines).toHaveLength(6);
      expect(JSON.parse(rawLines[0]!).schemaVersion).toBe("exo.semantic-trace.v1");
      expect(await readFile(semanticTraceMetadataPath(store.layout, "fake-session"), "utf8")).toContain('"artifact"');
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("maps required raw events and preserves unknown source data as harness.raw", () => {
    const context = {
      sessionId: "session-1",
      harnessId: "fake-harness",
      now: () => "2026-07-03T16:00:00.000Z",
    };

    expect(mapHarnessRawTraceEvent({ type: "session-start", command: "fake", cwd: "/tmp" }, context, 1)).toMatchObject({
      kind: "session.started",
      payload: { rawKind: "session-start", command: "fake", cwd: "/tmp" },
    });
    expect(mapHarnessRawTraceEvent({ type: "turn-start", turnId: "turn-1" }, context, 2)).toMatchObject({
      kind: "turn.started",
      payload: { rawKind: "turn-start", turnId: "turn-1" },
    });
    expect(mapHarnessRawTraceEvent({ type: "assistant-text", text: "done" }, context, 3)).toMatchObject({
      kind: "message",
      actor: { kind: "agent" },
      payload: { rawKind: "assistant-text", text: "done" },
    });
    expect(mapHarnessRawTraceEvent({ type: "tool-call", name: "read", input: { path: "a.md" }, toolCallId: "call-1" }, context, 4)).toMatchObject({
      kind: "tool.call",
      actor: { kind: "tool" },
      payload: { rawKind: "tool-call", name: "read", toolCallId: "call-1" },
    });
    expect(mapHarnessRawTraceEvent({ type: "tool-result", name: "read", output: "ok", status: "succeeded" }, context, 5)).toMatchObject({
      kind: "tool.result",
      payload: { rawKind: "tool-result", status: "succeeded" },
    });
    expect(mapHarnessRawTraceEvent({ type: "lifecycle", lifecycle: "exit", status: "succeeded" }, context, 6)).toMatchObject({
      kind: "lifecycle",
      payload: { rawKind: "lifecycle", lifecycle: "exit", status: "succeeded" },
    });
    expect(mapHarnessRawTraceEvent({ type: "provider-specific", payload: { token: "kept" } }, context, 7)).toMatchObject({
      kind: "harness.raw",
      payload: {
        rawKind: "provider-specific",
        token: "kept",
        raw: { type: "provider-specific", payload: { token: "kept" } },
      },
    });
  });

  it("retains only the bounded tail and supports bounded reads", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-semantic-trace-retention-"));
    const store = new SemanticTraceStore(runtimeRoot);

    try {
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "retained-session",
        harnessId: "fake-claude",
        retentionLimit: 4,
        now: () => "2026-07-03T16:00:00.000Z",
      });

      const retained = await store.readEvents("retained-session");
      expect(retained.map((event) => event.sequence)).toEqual([3, 4, 5, 6]);
      expect((await store.readMetadata("retained-session"))?.eventCount).toBe(4);
      expect((await store.readEvents("retained-session", { limit: 2 })).map((event) => event.sequence)).toEqual([5, 6]);
      expect((await store.readEvents("retained-session", { sinceSequence: 4 })).map((event) => event.sequence)).toEqual([5, 6]);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
