import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeSemanticTraceEvent,
  type SemanticTraceActor,
  type SemanticTraceEvent,
  type SemanticTraceEventKind,
  type SemanticTraceInput,
  type SemanticTraceVisibility,
} from "./semantic-trace";
import type { ActivityArtifactRef } from "./run";
import { safeStoreSegment } from "./routine-run-store";
import type { AgentLauncherTraceCaptureConfig } from "./types";

export interface SemanticTraceStoreLayout {
  runtimeRoot: string;
  tracesDir: string;
}

export interface SemanticTraceSessionMetadata {
  sessionId: string;
  harnessId: string;
  tracePath: string;
  artifact: ActivityArtifactRef;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  firstSequence?: number;
  lastSequence?: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticTraceReadOptions {
  limit?: number;
  sinceSequence?: number;
}

export interface SemanticTraceSessionListEntry {
  sessionId: string;
  harnessId: string;
  tracePath: string;
  metadataPath: string;
  sidecarPath?: string;
  createdAt?: string;
  updatedAt?: string;
  eventCount?: number;
  firstSequence?: number;
  lastSequence?: number;
  traceBytes?: number;
  metadataBytes?: number;
  sidecarBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticTraceCleanupOptions {
  sessionId?: string;
  before?: string | Date;
  dryRun?: boolean;
}

export interface SemanticTraceCleanupResult {
  dryRun: boolean;
  before?: string;
  sessions: SemanticTraceSessionListEntry[];
  files: string[];
  deletedFiles: string[];
}

export interface SemanticTraceAppendOptions {
  retentionLimit?: number;
  metadata?: Record<string, unknown>;
}

export type HarnessRawTraceKind =
  | "session-start"
  | "turn-start"
  | "assistant-text"
  | "tool-call"
  | "tool-result"
  | "lifecycle";

export interface HarnessRawTraceEvent {
  id?: string;
  type?: string;
  event?: string;
  timestamp?: string;
  sessionId?: string;
  harnessId?: string;
  turnId?: string;
  toolCallId?: string;
  command?: string;
  cwd?: string;
  text?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  lifecycle?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface HarnessRawTraceContext {
  sessionId: string;
  harnessId: string;
  activityId?: string;
  runId?: string;
  defaultVisibility?: SemanticTraceVisibility;
  now?: () => string;
}

export interface HarnessRawTraceSidecarIngestState {
  byteOffset: number;
  pendingText: string;
  nextSequence: number;
}

export interface HarnessRawTraceSidecarIngestInput extends HarnessRawTraceContext {
  sidecarPath: string;
  state?: HarnessRawTraceSidecarIngestState;
  retentionLimit?: number;
  metadata?: Record<string, unknown>;
  traceCapture?: AgentLauncherTraceCaptureConfig;
}

export interface HarnessRawTraceSidecarIngestResult {
  state: HarnessRawTraceSidecarIngestState;
  ingestedEvents: number;
  metadata?: SemanticTraceSessionMetadata;
}

export interface FakeHarnessTraceFixtureInput extends HarnessRawTraceContext {
  rawEvents?: HarnessRawTraceEvent[];
  retentionLimit?: number;
  metadata?: Record<string, unknown>;
}

export const fakeHarnessTraceCaptureDeclaration: AgentLauncherTraceCaptureConfig = {
  schemaVersion: "exo.semantic-trace.v1",
  source: "sidecar-jsonl",
  artifactFileName: "semantic-trace.ndjson",
  eventFormat: "stream-json",
  envVar: "EXO_FAKE_HARNESS_TRACE_PATH",
};

export function resolveSemanticTraceStoreLayout(runtimeRoot: string): SemanticTraceStoreLayout {
  return {
    runtimeRoot,
    tracesDir: path.join(runtimeRoot, "traces"),
  };
}

export function semanticTracePath(layout: SemanticTraceStoreLayout, sessionId: string): string {
  return path.join(layout.tracesDir, `${semanticTraceStoreSegment(sessionId)}.ndjson`);
}

export function semanticTraceMetadataPath(layout: SemanticTraceStoreLayout, sessionId: string): string {
  return path.join(layout.tracesDir, `${semanticTraceStoreSegment(sessionId)}.json`);
}

export function semanticTraceSidecarPath(layout: SemanticTraceStoreLayout, sessionId: string): string {
  return path.join(layout.tracesDir, "sidecars", `${safeStoreSegment(sessionId)}.ndjson`);
}

export function defaultHarnessRawTraceSidecarIngestState(): HarnessRawTraceSidecarIngestState {
  return { byteOffset: 0, pendingText: "", nextSequence: 1 };
}

export class SemanticTraceStore {
  readonly layout: SemanticTraceStoreLayout;

  constructor(runtimeRoot: string) {
    this.layout = resolveSemanticTraceStoreLayout(runtimeRoot);
  }

  async appendEvents(
    sessionId: string,
    events: readonly SemanticTraceInput[],
    options: SemanticTraceAppendOptions = {},
  ): Promise<SemanticTraceSessionMetadata> {
    const existing = await this.readEvents(sessionId);
    const nextEvents = events.map((event, index) =>
      normalizeSemanticTraceEvent({
        ...event,
        sessionId: event.sessionId ?? sessionId,
        sequence: event.sequence ?? existing.length + index + 1,
      }),
    );
    const retained = applyRetention([...existing, ...nextEvents], options.retentionLimit);
    await this.writeEvents(sessionId, retained);
    return this.writeMetadata(sessionId, retained, options.metadata);
  }

  async readEvents(sessionId: string, options: SemanticTraceReadOptions = {}): Promise<SemanticTraceEvent[]> {
    const target = semanticTracePath(this.layout, sessionId);
    let raw: string;
    try {
      raw = await readFile(target, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    let events = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => normalizeSemanticTraceEvent(JSON.parse(line) as SemanticTraceInput));
    if (options.sinceSequence !== undefined) {
      events = events.filter((event) => (event.sequence ?? 0) > options.sinceSequence!);
    }
    return applyReadLimit(events, options.limit);
  }

  async readMetadata(sessionId: string): Promise<SemanticTraceSessionMetadata | null> {
    try {
      return JSON.parse(await readFile(semanticTraceMetadataPath(this.layout, sessionId), "utf8")) as SemanticTraceSessionMetadata;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async listSessions(): Promise<SemanticTraceSessionListEntry[]> {
    const sessionIds = new Set<string>();
    const metadataSessionBySegment = new Map<string, string>();
    const entries = await listDirectoryEntries(this.layout.tracesDir);
    for (const entry of entries) {
      if (entry.name.endsWith(".json")) {
        const parsed = await readTraceMetadataFile(path.join(this.layout.tracesDir, entry.name));
        const segment = path.basename(entry.name, ".json");
        const sessionId = parsed?.sessionId ?? segment;
        metadataSessionBySegment.set(segment, sessionId);
        sessionIds.add(sessionId);
      }
    }
    for (const entry of entries) {
      if (entry.name.endsWith(".ndjson")) {
        const segment = path.basename(entry.name, ".ndjson");
        sessionIds.add(metadataSessionBySegment.get(segment) ?? segment);
      }
    }
    for (const entry of await listDirectoryEntries(path.join(this.layout.tracesDir, "sidecars"))) {
      if (entry.name.endsWith(".ndjson")) {
        sessionIds.add(path.basename(entry.name, ".ndjson"));
      }
    }

    const sessions = await Promise.all([...sessionIds].map((sessionId) => this.describeSession(sessionId)));
    return sessions.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.sessionId.localeCompare(right.sessionId));
  }

  async cleanupSessions(options: SemanticTraceCleanupOptions): Promise<SemanticTraceCleanupResult> {
    const before = normalizeCleanupBefore(options.before);
    if (!options.sessionId && !before) {
      throw new Error("Semantic trace cleanup requires an explicit session id or before date.");
    }
    const sessions = (await this.listSessions()).filter((session) =>
      options.sessionId ? session.sessionId === options.sessionId : before ? isSessionBefore(session, before) : false,
    );
    const files = uniquePaths(sessions.flatMap((session) => sessionFiles(session)));
    const deletedFiles: string[] = [];
    if (!options.dryRun) {
      for (const file of files) {
        await rm(file, { force: true });
        deletedFiles.push(file);
      }
    }
    return {
      dryRun: options.dryRun === true,
      before: before?.toISOString(),
      sessions,
      files,
      deletedFiles,
    };
  }

  private async describeSession(sessionId: string): Promise<SemanticTraceSessionListEntry> {
    const metadata = await this.readMetadata(sessionId);
    const tracePath = semanticTracePath(this.layout, metadata?.sessionId ?? sessionId);
    const metadataPath = semanticTraceMetadataPath(this.layout, metadata?.sessionId ?? sessionId);
    const sidecarPath = semanticTraceSidecarPath(this.layout, metadata?.sessionId ?? sessionId);
    const traceInfo = await fileInfo(tracePath);
    const metadataInfo = await fileInfo(metadataPath);
    const sidecarInfo = await fileInfo(sidecarPath);
    return {
      sessionId: metadata?.sessionId ?? sessionId,
      harnessId: metadata?.harnessId ?? "unknown",
      tracePath,
      metadataPath,
      sidecarPath: sidecarInfo.exists ? sidecarPath : undefined,
      createdAt: metadata?.createdAt ?? traceInfo.mtime?.toISOString() ?? metadataInfo.mtime?.toISOString() ?? sidecarInfo.mtime?.toISOString(),
      updatedAt: metadata?.updatedAt ?? traceInfo.mtime?.toISOString() ?? metadataInfo.mtime?.toISOString() ?? sidecarInfo.mtime?.toISOString(),
      eventCount: metadata?.eventCount,
      firstSequence: metadata?.firstSequence,
      lastSequence: metadata?.lastSequence,
      traceBytes: traceInfo.bytes,
      metadataBytes: metadataInfo.bytes,
      sidecarBytes: sidecarInfo.bytes,
      metadata: metadata?.metadata,
    };
  }

  private async writeEvents(sessionId: string, events: readonly SemanticTraceEvent[]): Promise<void> {
    const target = semanticTracePath(this.layout, sessionId);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""), "utf8");
    await rename(temp, target);
  }

  private async writeMetadata(
    sessionId: string,
    events: readonly SemanticTraceEvent[],
    metadata?: Record<string, unknown>,
  ): Promise<SemanticTraceSessionMetadata> {
    const tracePath = semanticTracePath(this.layout, sessionId);
    const first = events[0];
    const last = events[events.length - 1];
    const now = last?.timestamp ?? new Date().toISOString();
    const harnessId = first?.harnessId ?? last?.harnessId ?? "unknown";
    const saved: SemanticTraceSessionMetadata = {
      sessionId,
      harnessId,
      tracePath,
      artifact: {
        id: "semantic-trace",
        activityId: first?.activityId ?? first?.runId ?? sessionId,
        kind: "trace",
        path: tracePath,
        title: "Semantic trace NDJSON",
        mimeType: "application/x-ndjson",
        sourceCapabilityId: harnessId,
        createdAt: first?.timestamp ?? now,
        metadata: {
          sessionId,
          firstSequence: first?.sequence,
          lastSequence: last?.sequence,
        },
      },
      createdAt: first?.timestamp ?? now,
      updatedAt: now,
      eventCount: events.length,
      firstSequence: first?.sequence,
      lastSequence: last?.sequence,
      metadata,
    };
    await mkdir(path.dirname(tracePath), { recursive: true });
    await writeFile(semanticTraceMetadataPath(this.layout, sessionId), `${JSON.stringify(saved, null, 2)}\n`, "utf8");
    return saved;
  }
}

export function mapHarnessRawTraceEvent(
  raw: HarnessRawTraceEvent,
  context: HarnessRawTraceContext,
  sequence: number,
): SemanticTraceEvent {
  const rawKind = raw.type ?? raw.event ?? "unknown";
  const timestamp = raw.timestamp ?? context.now?.() ?? new Date().toISOString();
  const sessionId = raw.sessionId ?? context.sessionId;
  const harnessId = raw.harnessId ?? context.harnessId;
  const turnId = raw.turnId;
  const knownKind = semanticKindForRaw(rawKind);
  const actor = actorForRawKind(rawKind, harnessId, raw);
  const payload = payloadForRaw(rawKind, raw);

  return normalizeSemanticTraceEvent({
    id: raw.id ?? `${sessionId}-${sequence}`,
    activityId: context.activityId,
    runId: context.runId,
    sessionId,
    harnessId,
    sequence,
    timestamp,
    kind: knownKind,
    actor,
    visibility: context.defaultVisibility ?? "private",
    parentId: turnId && knownKind !== "turn.started" ? `${sessionId}-turn-${turnId}` : undefined,
    correlationId: raw.toolCallId ?? turnId,
    refs: refsForRaw(raw),
    payload,
    metadata: raw.metadata,
  });
}

export async function captureFakeHarnessTraceFixture(
  store: SemanticTraceStore,
  input: FakeHarnessTraceFixtureInput,
): Promise<SemanticTraceSessionMetadata> {
  const rawEvents = input.rawEvents ?? defaultFakeHarnessRawTraceEvents(input);
  const events = rawEvents.map((event, index) => mapHarnessRawTraceEvent(event, input, index + 1));
  return store.appendEvents(input.sessionId, events, {
    retentionLimit: input.retentionLimit,
    metadata: {
      fixture: "fake-harness-stream-json",
      traceCapture: fakeHarnessTraceCaptureDeclaration,
      ...input.metadata,
    },
  });
}

export async function ingestHarnessRawTraceSidecar(
  store: SemanticTraceStore,
  input: HarnessRawTraceSidecarIngestInput,
): Promise<HarnessRawTraceSidecarIngestResult> {
  const previousState = input.state ?? defaultHarnessRawTraceSidecarIngestState();
  let rawBuffer: Buffer;
  try {
    rawBuffer = await readFile(input.sidecarPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { state: previousState, ingestedEvents: 0 };
    }
    throw error;
  }

  const byteOffset = Math.min(previousState.byteOffset, rawBuffer.length);
  const appendedText = rawBuffer.subarray(byteOffset).toString("utf8");
  const combined = `${previousState.pendingText}${appendedText}`;
  const lines = combined.split(/\r?\n/);
  const pendingText = combined.endsWith("\n") || combined.endsWith("\r") ? "" : lines.pop() ?? "";
  const rawEvents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HarnessRawTraceEvent);

  if (rawEvents.length === 0) {
    return {
      state: {
        byteOffset: rawBuffer.length,
        pendingText,
        nextSequence: previousState.nextSequence,
      },
      ingestedEvents: 0,
    };
  }

  const events = rawEvents.map((event, index) =>
    mapHarnessRawTraceEvent(event, input, previousState.nextSequence + index),
  );
  const metadata = await store.appendEvents(input.sessionId, events, {
    retentionLimit: input.retentionLimit,
    metadata: {
      sidecarPath: input.sidecarPath,
      traceCapture: input.traceCapture,
      ...input.metadata,
    },
  });

  return {
    state: {
      byteOffset: rawBuffer.length,
      pendingText,
      nextSequence: previousState.nextSequence + events.length,
    },
    ingestedEvents: events.length,
    metadata,
  };
}

function semanticKindForRaw(rawKind: string): SemanticTraceEventKind {
  switch (rawKind) {
    case "session-start":
      return "session.started";
    case "turn-start":
      return "turn.started";
    case "assistant-text":
      return "message";
    case "tool-call":
      return "tool.call";
    case "tool-result":
      return "tool.result";
    case "lifecycle":
      return "lifecycle";
    default:
      return "harness.raw";
  }
}

function actorForRawKind(rawKind: string, harnessId: string, raw: HarnessRawTraceEvent): SemanticTraceActor {
  if (rawKind === "tool-call" || rawKind === "tool-result") {
    return { id: raw.name ?? "tool", kind: "tool" };
  }
  if (rawKind === "assistant-text") {
    return { id: harnessId, kind: "agent" };
  }
  return { id: harnessId, kind: "harness" };
}

function payloadForRaw(rawKind: string, raw: HarnessRawTraceEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    rawKind,
    ...(raw.payload ?? {}),
  };
  if (raw.command) payload.command = raw.command;
  if (raw.cwd) payload.cwd = raw.cwd;
  if (raw.turnId) payload.turnId = raw.turnId;
  if (raw.text) payload.text = raw.text;
  if (raw.name) payload.name = raw.name;
  if (raw.toolCallId) payload.toolCallId = raw.toolCallId;
  if (raw.status) payload.status = raw.status;
  if (raw.lifecycle) payload.lifecycle = raw.lifecycle;
  if (raw.input !== undefined) payload.inputDigest = digestUnknown(raw.input);
  if (raw.output !== undefined) payload.outputDigest = digestUnknown(raw.output);
  if (semanticKindForRaw(rawKind) === "harness.raw") payload.raw = raw;
  return payload;
}

function refsForRaw(raw: HarnessRawTraceEvent): SemanticTraceEvent["refs"] {
  if (!raw.name && !raw.toolCallId && !raw.status) {
    return undefined;
  }
  return {
    tools: [
      {
        name: raw.name ?? "unknown",
        callId: raw.toolCallId,
        status: toolStatus(raw.status),
        metadata: {
          inputDigest: raw.input !== undefined ? digestUnknown(raw.input) : undefined,
          outputDigest: raw.output !== undefined ? digestUnknown(raw.output) : undefined,
        },
      },
    ],
  };
}

function toolStatus(status?: string): "started" | "succeeded" | "failed" | "cancelled" | undefined {
  switch (status) {
    case "started":
    case "succeeded":
    case "failed":
    case "cancelled":
      return status;
    default:
      return undefined;
  }
}

function defaultFakeHarnessRawTraceEvents(input: HarnessRawTraceContext): HarnessRawTraceEvent[] {
  const timestamp = input.now?.() ?? "2026-07-03T16:00:00.000Z";
  return [
    { type: "session-start", timestamp, command: "fake-claude --stream-json", cwd: "/fixture/workspace" },
    { type: "turn-start", timestamp, turnId: "turn-1" },
    { type: "assistant-text", timestamp, turnId: "turn-1", text: "I will inspect the workspace and report back." },
    { type: "tool-call", timestamp, turnId: "turn-1", toolCallId: "tool-1", name: "read_file", input: { path: "tasks.md" }, status: "started" },
    { type: "tool-result", timestamp, turnId: "turn-1", toolCallId: "tool-1", name: "read_file", output: { bytes: 128 }, status: "succeeded" },
    { type: "lifecycle", timestamp, lifecycle: "exit", status: "succeeded" },
  ];
}

function applyRetention(events: SemanticTraceEvent[], retentionLimit?: number): SemanticTraceEvent[] {
  if (!retentionLimit || retentionLimit <= 0 || events.length <= retentionLimit) {
    return events;
  }
  return events.slice(-retentionLimit);
}

function applyReadLimit(events: SemanticTraceEvent[], limit?: number): SemanticTraceEvent[] {
  if (!limit || limit <= 0 || events.length <= limit) {
    return events;
  }
  return events.slice(-limit);
}

async function listDirectoryEntries(directory: string): Promise<Array<{ name: string }>> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readTraceMetadataFile(filePath: string): Promise<SemanticTraceSessionMetadata | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as SemanticTraceSessionMetadata;
  } catch {
    return null;
  }
}

async function fileInfo(filePath: string): Promise<{ exists: boolean; bytes?: number; mtime?: Date }> {
  try {
    const details = await stat(filePath);
    return { exists: true, bytes: details.size, mtime: details.mtime };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

function normalizeCleanupBefore(value: string | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Invalid semantic trace cleanup before date: ${String(value)}`);
  }
  return parsed;
}

function isSessionBefore(session: SemanticTraceSessionListEntry, before: Date): boolean {
  const updatedAt = session.updatedAt ? new Date(session.updatedAt) : undefined;
  return updatedAt !== undefined && !Number.isNaN(updatedAt.valueOf()) && updatedAt < before;
}

function sessionFiles(session: SemanticTraceSessionListEntry): string[] {
  return [
    session.traceBytes === undefined ? undefined : session.tracePath,
    session.metadataBytes === undefined ? undefined : session.metadataPath,
    session.sidecarPath,
  ].filter((file): file is string => Boolean(file));
}

function uniquePaths(files: readonly string[]): string[] {
  return [...new Set(files)];
}

function semanticTraceStoreSegment(sessionId: string): string {
  const trimmed = sessionId.trim();
  const safe = safeStoreSegment(sessionId);
  return safe === trimmed ? safe : `${safe}-${createHash("sha256").update(trimmed).digest("hex").slice(0, 12)}`;
}

function digestUnknown(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
