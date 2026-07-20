import type { InvocationRecord } from "@exo/core";
import type {
  InvocationFileReviewPayload,
  InvocationHistoryItem,
  InvocationReviewListItem,
} from "../../shared/api";
import type { InvocationReviewItemProjection } from "./components/invocation";

export interface InvocationReviewQueueEntry {
  invocationId: string;
  command: { handle: string; label: string };
  createdAt: string;
  changeIds: string[];
  currentIndex: number;
  source: "pending" | "history";
  payloads: Record<string, InvocationFileReviewPayload>;
}

export interface InvocationReviewQueueState {
  entries: InvocationReviewQueueEntry[];
  activeInvocationId: string | null;
}

export const EMPTY_INVOCATION_REVIEW_QUEUE: InvocationReviewQueueState = {
  entries: [],
  activeInvocationId: null,
};

export function invocationHistoryLoadDecision(
  document: { filePath: string; readOnly?: boolean } | null,
): { kind: "clear" } | { kind: "preserve" } | { kind: "load"; filePath: string } {
  if (!document) return { kind: "clear" };
  if (document.readOnly) return { kind: "preserve" };
  return { kind: "load", filePath: document.filePath };
}

export function hydrateInvocationReviewQueue(items: readonly InvocationReviewListItem[]): InvocationReviewQueueState {
  const entries = items.filter((item) => item.pendingChangeIds.length > 0).map((item) => ({
    invocationId: item.invocationId,
    command: item.command,
    createdAt: item.createdAt,
    changeIds: [...item.pendingChangeIds],
    currentIndex: 0,
    source: "pending" as const,
    payloads: {},
  }));
  return { entries, activeInvocationId: entries[0]?.invocationId ?? null };
}

export function openInvocationHistoryReview(
  state: InvocationReviewQueueState,
  item: InvocationHistoryItem,
): InvocationReviewQueueState {
  const historical: InvocationReviewQueueEntry = {
    invocationId: item.invocationId,
    command: item.command,
    createdAt: item.createdAt,
    changeIds: [...item.changeIds],
    currentIndex: 0,
    source: "history",
    payloads: {},
  };
  return {
    entries: [historical, ...state.entries.filter((entry) => entry.invocationId !== item.invocationId)],
    activeInvocationId: item.invocationId,
  };
}

export function closeInvocationHistoryReview(state: InvocationReviewQueueState): InvocationReviewQueueState {
  const entries = state.entries.filter((entry) => entry.source !== "history");
  return { entries, activeInvocationId: entries[0]?.invocationId ?? null };
}

export function activeInvocationReviewEntry(state: InvocationReviewQueueState): InvocationReviewQueueEntry | null {
  return state.entries.find((entry) => entry.invocationId === state.activeInvocationId) ?? null;
}

export function activeInvocationReviewChangeId(state: InvocationReviewQueueState): string | null {
  const entry = activeInvocationReviewEntry(state);
  return entry?.changeIds[clampQueueIndex(entry.currentIndex, entry.changeIds.length)] ?? null;
}

export function cacheInvocationFileReview(
  state: InvocationReviewQueueState,
  payload: InvocationFileReviewPayload,
): InvocationReviewQueueState {
  return {
    ...state,
    entries: state.entries.map((entry) => entry.invocationId !== payload.invocation.id ? entry : {
      ...entry,
      payloads: { ...entry.payloads, [payload.change.id]: payload },
    }),
  };
}

export function navigateInvocationReview(
  state: InvocationReviewQueueState,
  index: number,
): InvocationReviewQueueState {
  return {
    ...state,
    entries: state.entries.map((entry) => entry.invocationId !== state.activeInvocationId ? entry : {
      ...entry,
      currentIndex: clampQueueIndex(index, entry.changeIds.length),
    }),
  };
}

export function applyInvocationReviewRecord(
  state: InvocationReviewQueueState,
  record: InvocationRecord,
): InvocationReviewQueueState {
  const current = state.entries.find((entry) => entry.invocationId === record.id);
  const unresolved = record.changeset?.files
    .filter((change) => change.decision.status === "pending" || change.decision.status === "conflict")
    .map((change) => change.id) ?? [];
  if (!current && unresolved.length === 0) return state;
  if (!current) {
    const next = {
      invocationId: record.id,
      command: { handle: record.command.handle, label: record.command.label },
      createdAt: record.createdAt,
      changeIds: unresolved,
      currentIndex: 0,
      source: "pending" as const,
      payloads: {},
    };
    return { entries: [...state.entries, next], activeInvocationId: state.activeInvocationId ?? record.id };
  }
  if (current.source === "history") {
    return {
      ...state,
      entries: state.entries.map((entry) => entry.invocationId === record.id
        ? { ...entry, payloads: refreshCachedPayloadRecords(entry.payloads, record) }
        : entry),
    };
  }
  if (unresolved.length === 0) {
    const entries = state.entries.filter((entry) => entry.invocationId !== record.id);
    return {
      entries,
      activeInvocationId: state.activeInvocationId === record.id
        ? entries[0]?.invocationId ?? null
        : state.activeInvocationId,
    };
  }
  const previousId = current.changeIds[current.currentIndex];
  const nextIndex = previousId && unresolved.includes(previousId)
    ? unresolved.indexOf(previousId)
    : Math.min(current.currentIndex, unresolved.length - 1);
  return {
    ...state,
    entries: state.entries.map((entry) => entry.invocationId !== record.id ? entry : {
      ...entry,
      changeIds: unresolved,
      currentIndex: nextIndex,
      payloads: refreshCachedPayloadRecords(entry.payloads, record),
    }),
  };
}

export function invocationReviewProjection(entry: InvocationReviewQueueEntry): InvocationReviewItemProjection[] {
  return entry.changeIds.map((changeId, index) => {
    const payload = entry.payloads[changeId];
    if (!payload) return { id: changeId, path: `File ${index + 1}`, operation: "modified" };
    const { change } = payload;
    const path = change.after?.path ?? change.before?.path ?? `File ${index + 1}`;
    const decision = change.decision.status;
    return {
      id: change.id,
      path,
      ...(change.operation === "renamed" && change.before?.path ? { previousPath: change.before.path } : {}),
      operation: change.operation,
      mediaType: change.after?.mediaType ?? change.before?.mediaType,
      ...(change.operation === "deleted" ? { summary: "Former content · empty after invocation" } : {}),
      ...(decision === "conflict" ? { conflict: change.decision.reason } : {}),
      ...(decision === "kept" || decision === "rejected" ? { resolved: decision } : {}),
    };
  });
}

export function invocationReviewSourcePath(payload: InvocationFileReviewPayload): string | null {
  return payload.change.after?.path ?? payload.change.before?.path ?? null;
}

export function invocationReviewVirtualPath(payload: InvocationFileReviewPayload): string | null {
  const sourcePath = invocationReviewSourcePath(payload);
  if (!sourcePath) return null;
  const name = sourcePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? "File";
  return `exo-review://${encodeURIComponent(payload.invocation.id)}/${encodeURIComponent(payload.change.id)}/${encodeURIComponent(name)}`;
}

export function invocationReviewMatchesPath(
  payload: InvocationFileReviewPayload,
  filePath: string,
  source: "pending" | "history",
): boolean {
  const mediaType = payload.change.after?.mediaType ?? payload.change.before?.mediaType;
  if (source === "history" || payload.change.operation === "deleted" || mediaType === "binary") {
    return filePath === invocationReviewVirtualPath(payload);
  }
  return filePath === invocationReviewSourcePath(payload);
}

export function clampQueueIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length - 1));
}

function refreshCachedPayloadRecords(
  payloads: Record<string, InvocationFileReviewPayload>,
  record: InvocationRecord,
): Record<string, InvocationFileReviewPayload> {
  return Object.fromEntries(Object.entries(payloads).map(([id, payload]) => {
    const change = record.changeset?.files.find((candidate) => candidate.id === id) ?? payload.change;
    return [id, { ...payload, invocation: record, change, canKeep: change.decision.status === "pending" || change.decision.status === "conflict", canReject: change.decision.status === "pending" }];
  }));
}
