import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SemanticTraceStore,
  captureFakeHarnessTraceFixture,
  ingestHarnessRawTraceSidecar,
  fakeHarnessTraceCaptureDeclaration,
  mapHarnessRawTraceEvent,
  semanticTraceMetadataPath,
  semanticTracePath,
  semanticTraceSidecarPath,
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

  it("keeps trace files isolated by sanitized session id", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-semantic-trace-isolation-"));
    const store = new SemanticTraceStore(runtimeRoot);

    try {
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "claude/session",
        harnessId: "claude",
        rawEvents: [{ type: "assistant-text", text: "CLAUDE_ONLY" }],
        now: () => "2026-07-03T16:00:00.000Z",
      });
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "pi.session",
        harnessId: "pi",
        rawEvents: [{ type: "assistant-text", text: "PI_ONLY" }],
        now: () => "2026-07-03T16:00:01.000Z",
      });

      expect(path.dirname(semanticTracePath(store.layout, "claude/session"))).toBe(path.join(runtimeRoot, "traces"));
      expect(semanticTracePath(store.layout, "claude/session")).not.toBe(semanticTracePath(store.layout, "claude-session"));
      expect((await store.readEvents("claude/session")).map((event) => event.payload.text)).toEqual(["CLAUDE_ONLY"]);
      expect((await store.readEvents("pi.session")).map((event) => event.payload.text)).toEqual(["PI_ONLY"]);
      expect(await store.readEvents("claude-session")).toEqual([]);
      expect(await store.readEvents("missing-session")).toEqual([]);
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

  it("lists trace sessions and dry-runs cleanup without deleting files", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-semantic-trace-cleanup-dry-"));
    const store = new SemanticTraceStore(runtimeRoot);

    try {
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "old-session",
        harnessId: "fake-claude",
        rawEvents: [{ type: "assistant-text", timestamp: "2026-07-01T10:00:00.000Z", text: "OLD_ONLY" }],
      });
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "new-session",
        harnessId: "fake-pi",
        rawEvents: [{ type: "assistant-text", timestamp: "2026-07-05T10:00:00.000Z", text: "NEW_ONLY" }],
      });
      await mkdir(path.dirname(semanticTraceSidecarPath(store.layout, "old-session")), { recursive: true });
      await writeFile(semanticTraceSidecarPath(store.layout, "old-session"), `${JSON.stringify({ type: "assistant-text", text: "raw" })}\n`, "utf8");

      const sessions = await store.listSessions();
      expect(sessions.map((session) => session.sessionId).sort()).toEqual(["new-session", "old-session"]);
      expect(sessions.find((session) => session.sessionId === "old-session")).toMatchObject({
        harnessId: "fake-claude",
        eventCount: 1,
        sidecarPath: semanticTraceSidecarPath(store.layout, "old-session"),
      });

      const result = await store.cleanupSessions({ before: "2026-07-04T00:00:00.000Z", dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.sessions.map((session) => session.sessionId)).toEqual(["old-session"]);
      expect(result.files.sort()).toEqual([
        semanticTraceMetadataPath(store.layout, "old-session"),
        semanticTracePath(store.layout, "old-session"),
        semanticTraceSidecarPath(store.layout, "old-session"),
      ].sort());
      expect((await store.readEvents("old-session")).map((event) => event.payload.text)).toEqual(["OLD_ONLY"]);
      expect(await readFile(semanticTraceSidecarPath(store.layout, "old-session"), "utf8")).toContain("raw");
      expect((await store.readEvents("new-session")).map((event) => event.payload.text)).toEqual(["NEW_ONLY"]);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("explicitly deletes only the requested trace session", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-semantic-trace-cleanup-session-"));
    const store = new SemanticTraceStore(runtimeRoot);

    try {
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "claude/session",
        harnessId: "claude",
        rawEvents: [{ type: "assistant-text", text: "SLASH_SESSION" }],
      });
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "claude-session",
        harnessId: "claude",
        rawEvents: [{ type: "assistant-text", text: "DASH_SESSION" }],
      });

      const result = await store.cleanupSessions({ sessionId: "claude/session" });
      expect(result.dryRun).toBe(false);
      expect(result.sessions.map((session) => session.sessionId)).toEqual(["claude/session"]);
      expect(result.deletedFiles.sort()).toEqual([
        semanticTraceMetadataPath(store.layout, "claude/session"),
        semanticTracePath(store.layout, "claude/session"),
      ].sort());
      expect(await store.readEvents("claude/session")).toEqual([]);
      expect(await store.readMetadata("claude/session")).toBeNull();
      expect((await store.readEvents("claude-session")).map((event) => event.payload.text)).toEqual(["DASH_SESSION"]);
      expect(await store.readMetadata("claude-session")).not.toBeNull();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("ingests sidecar JSONL incrementally without duplicating prior raw events", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-semantic-trace-sidecar-"));
    const sidecarPath = path.join(runtimeRoot, "traces", "sidecars", "session-1.ndjson");
    const store = new SemanticTraceStore(runtimeRoot);

    try {
      await mkdir(path.dirname(sidecarPath), { recursive: true });
      await writeFile(
        sidecarPath,
        `${JSON.stringify({ type: "assistant-text", text: "first" })}\n${JSON.stringify({ type: "assistant-text", text: "partial" })}`,
        "utf8",
      );

      const first = await ingestHarnessRawTraceSidecar(store, {
        sidecarPath,
        sessionId: "session-1",
        harnessId: "pi",
        traceCapture: fakeHarnessTraceCaptureDeclaration,
      });

      expect(first.ingestedEvents).toBe(1);
      expect(first.state.nextSequence).toBe(2);
      expect((await store.readEvents("session-1")).map((event) => event.payload.text)).toEqual(["first"]);

      await writeFile(
        sidecarPath,
        `${JSON.stringify({ type: "assistant-text", text: "first" })}\n${JSON.stringify({ type: "assistant-text", text: "partial" })}\n${JSON.stringify({ type: "assistant-text", text: "third" })}\n`,
        "utf8",
      );
      const second = await ingestHarnessRawTraceSidecar(store, {
        sidecarPath,
        sessionId: "session-1",
        harnessId: "pi",
        state: first.state,
        traceCapture: fakeHarnessTraceCaptureDeclaration,
      });

      expect(second.ingestedEvents).toBe(2);
      expect((await store.readEvents("session-1")).map((event) => event.payload.text)).toEqual(["first", "partial", "third"]);
      expect((await store.readMetadata("session-1"))?.metadata).toMatchObject({
        sidecarPath,
        traceCapture: fakeHarnessTraceCaptureDeclaration,
      });
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
