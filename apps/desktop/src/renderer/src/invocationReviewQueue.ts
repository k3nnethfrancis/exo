import type { InvocationRecord } from "@exo/core";
import type {
  InvocationFileReviewPayload,
  InvocationHistoryItem,
  InvocationReviewListItem,
} from "../../shared/api";
import type { InvocationReviewItemProjection } from "./components/invocation";
import { invocationReviewMetadata } from "./invocationInlineReview";

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
  hydrationPending: boolean;
  /** Settlements observed while the one-shot startup snapshot may still be stale. */
  settledDuringHydration: string[];
}

export const EMPTY_INVOCATION_REVIEW_QUEUE: InvocationReviewQueueState = {
  entries: [],
  activeInvocationId: null,
  hydrationPending: false,
  settledDuringHydration: [],
};

export function beginInvocationReviewHydration(): InvocationReviewQueueState {
  return { ...EMPTY_INVOCATION_REVIEW_QUEUE, hydrationPending: true };
}

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
  return { entries, activeInvocationId: entries[0]?.invocationId ?? null, hydrationPending: false, settledDuringHydration: [] };
}

/**
 * Reconcile the startup snapshot without overwriting a newer live settlement
 * event that arrived while the pending-review IPC request was in flight.
 */
export function mergeInvocationReviewHydration(
  current: InvocationReviewQueueState,
  items: readonly InvocationReviewListItem[],
): InvocationReviewQueueState {
  const hydrated = hydrateInvocationReviewQueue(items);
  const settled = new Set(current.settledDuringHydration);
  const hydratedEntries = hydrated.entries.filter((entry) => !settled.has(entry.invocationId));
  if (current.entries.length === 0) {
    return {
      entries: hydratedEntries,
      activeInvocationId: hydratedEntries[0]?.invocationId ?? null,
      hydrationPending: false,
      settledDuringHydration: [],
    };
  }
  const currentIds = new Set(current.entries.map((entry) => entry.invocationId));
  return {
    entries: [
      ...current.entries,
      ...hydratedEntries.filter((entry) => !currentIds.has(entry.invocationId)),
    ],
    activeInvocationId: current.activeInvocationId ?? hydratedEntries[0]?.invocationId ?? null,
    hydrationPending: false,
    settledDuringHydration: [],
  };
}

export function openInvocationHistoryReview(
  state: InvocationReviewQueueState,
  item: InvocationHistoryItem,
): InvocationReviewQueueState {
  const pending = state.entries.find((entry) => entry.invocationId === item.invocationId && entry.source === "pending");
  if (pending) return { ...state, activeInvocationId: pending.invocationId };
  if (item.changeIds.length === 0) return state;
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
    ...state,
    entries: [historical, ...state.entries.filter((entry) => entry.invocationId !== item.invocationId)],
    activeInvocationId: item.invocationId,
  };
}

export function closeInvocationHistoryReview(state: InvocationReviewQueueState): InvocationReviewQueueState {
  const entries = state.entries.filter((entry) => entry.source !== "history");
  return { ...state, entries, activeInvocationId: entries[0]?.invocationId ?? null };
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
  if (!current && unresolved.length === 0) {
    return !state.hydrationPending || !record.changeset || state.settledDuringHydration.includes(record.id)
      ? state
      : { ...state, settledDuringHydration: [...state.settledDuringHydration, record.id] };
  }
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
    return { ...state, entries: [...state.entries, next], activeInvocationId: state.activeInvocationId ?? record.id };
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
      ...state,
      entries,
      activeInvocationId: state.activeInvocationId === record.id
        ? entries[0]?.invocationId ?? null
        : state.activeInvocationId,
      settledDuringHydration: !state.hydrationPending || state.settledDuringHydration.includes(record.id)
        ? state.settledDuringHydration
        : [...state.settledDuringHydration, record.id],
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
    const metadata = invocationReviewMetadata(payload);
    return {
      id: change.id,
      path,
      ...(change.operation === "renamed" && change.before?.path ? { previousPath: change.before.path } : {}),
      operation: change.operation,
      mediaType: change.after?.mediaType ?? change.before?.mediaType,
      ...(metadata.frontmatter.length > 0 ? { metadataChanges: metadata.frontmatter } : {}),
      ...(metadata.permission ? { permissionChange: metadata.permission } : {}),
      ...(change.operation === "deleted" ? { summary: "Former content · empty after invocation" } : {}),
      ...(decision === "conflict" ? { conflict: change.decision.reason } : {}),
      ...(decision === "kept" || decision === "rejected" ? { resolved: decision } : {}),
    };
  });
}

export function invocationReviewSourcePath(payload: InvocationFileReviewPayload): string | null {
  return payload.change.after?.path ?? payload.change.before?.path ?? null;
}

export function invocationReviewNavigablePath(payload: InvocationFileReviewPayload): string | null {
  const sourcePath = invocationReviewSourcePath(payload);
  if (!sourcePath) return null;
  const sourceIdentity = invocationReviewPathIdentity(sourcePath);
  for (const root of payload.invocation.noteRoots ?? []) {
    const rootIdentity = invocationReviewPathIdentity(root).replace(/\/$/u, "");
    if (sourceIdentity === rootIdentity) return root;
    if (sourceIdentity.startsWith(`${rootIdentity}/`)) {
      return `${root.replace(/\/$/u, "")}${sourceIdentity.slice(rootIdentity.length)}`;
    }
  }
  return sourcePath;
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
  const sourcePath = invocationReviewSourcePath(payload);
  return sourcePath !== null && invocationReviewPathIdentity(filePath) === invocationReviewPathIdentity(sourcePath);
}

/** Return the actual editor identities that a decision must freeze and flush. */
export function invocationReviewAffectedOpenPaths(
  payloads: readonly InvocationFileReviewPayload[],
  openPaths: readonly string[],
): string[] {
  const affected = new Set(payloads.flatMap((payload) => [
    payload.change.before?.path,
    payload.change.after?.path,
  ]).filter((value): value is string => Boolean(value)).map(invocationReviewPathIdentity));
  return [...new Set(openPaths)].filter((filePath) => affected.has(invocationReviewPathIdentity(filePath)));
}

/**
 * macOS exposes the same temporary file through both /var and /private/var
 * (likewise /tmp and /private/tmp). The main process canonicalizes artifacts,
 * while an already-open editor may retain the user-visible alias.
 */
function invocationReviewPathIdentity(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.replace(/^\/private\/(?=(?:var|tmp)\/)/u, "/");
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
