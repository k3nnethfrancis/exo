import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { InvocationRecord } from "@exograph/core";

import type { InvocationFileReviewPayload, InvocationHistoryItem } from "../../../shared/api";
import {
  activeInvocationReviewChangeId,
  activeInvocationReviewEntry,
  applyInvocationReviewRecord,
  beginInvocationReviewHydration,
  cacheInvocationFileReview,
  closeInvocationHistoryReview,
  EMPTY_INVOCATION_REVIEW_QUEUE,
  invocationHistoryLoadDecision,
  invocationReviewAffectedOpenPaths,
  mergeInvocationReviewHydration,
  navigateInvocationReview,
  openInvocationHistoryReview,
  type InvocationReviewQueueEntry,
  type InvocationReviewQueueState,
} from "../invocationReviewQueue";

type ReviewAction = "keep" | "reject";

interface InvocationReviewControllerOptions {
  workspaceKey: string | null;
  historyDocument: { filePath: string; readOnly?: boolean } | null;
  openDocumentPaths: readonly string[];
  prepareDocumentsForReview: (filePaths: readonly string[]) => Promise<void>;
  reloadTrees: () => Promise<void>;
  onOpenReviewDocument: (payload: InvocationFileReviewPayload, source: "pending" | "history") => void;
  onReviewError: (command: InvocationReviewQueueEntry["command"], error: unknown) => void;
  onReviewResolved: (payload: InvocationFileReviewPayload, action: ReviewAction) => Promise<void>;
}

export interface InvocationReviewPayloadRequest {
  workspaceIdentity: InvocationReviewWorkspaceIdentity;
  invocationId: string;
  changeId: string;
  requestId: number;
}

export interface InvocationReviewWorkspaceIdentity {
  workspaceKey: string | null;
}

export interface InvocationReviewDecisionSnapshot {
  invocationId: string;
  changeId: string;
  payload: InvocationFileReviewPayload;
  affectedOpenPaths: string[];
}

export function captureInvocationReviewWorkspaceIdentity(
  current: InvocationReviewWorkspaceIdentity | null,
  workspaceKey: string | null,
): InvocationReviewWorkspaceIdentity {
  return current?.workspaceKey === workspaceKey
    ? current
    : { workspaceKey };
}

export function invocationReviewWorkspaceIdentityIsCurrent(
  captured: InvocationReviewWorkspaceIdentity,
  rendered: InvocationReviewWorkspaceIdentity,
): boolean {
  return captured === rendered;
}

export function invocationReviewPayloadRequestIsCurrent(request: InvocationReviewPayloadRequest, current: InvocationReviewPayloadRequest): boolean {
  return invocationReviewWorkspaceIdentityIsCurrent(request.workspaceIdentity, current.workspaceIdentity)
    && request.invocationId === current.invocationId
    && request.changeId === current.changeId
    && request.requestId === current.requestId;
}

export function beginInvocationReviewDecision(
  pending: boolean,
  payload: InvocationFileReviewPayload | null,
  openDocumentPaths: readonly string[],
): { started: boolean; pending: boolean; snapshot: InvocationReviewDecisionSnapshot | null } {
  if (pending) return { started: false, pending: true, snapshot: null };
  if (!payload) return { started: true, pending: true, snapshot: null };
  return {
    started: true,
    pending: true,
    snapshot: {
      invocationId: payload.invocation.id,
      changeId: payload.change.id,
      payload,
      affectedOpenPaths: invocationReviewAffectedOpenPaths([payload], openDocumentPaths),
    },
  };
}

export async function runInvocationReviewDecision<Result>(
  snapshot: InvocationReviewDecisionSnapshot,
  operations: { prepareDocumentsForReview: (filePaths: readonly string[]) => Promise<void>; decide: () => Promise<Result> },
): Promise<Result> {
  await operations.prepareDocumentsForReview(snapshot.affectedOpenPaths);
  return operations.decide();
}

export async function loadInvocationHistoryState(
  filePath: string,
  load: (filePath: string) => Promise<InvocationHistoryItem[]>,
): Promise<{ items: InvocationHistoryItem[] | null; error: string | null }> {
  try {
    return { items: await load(filePath), error: null };
  } catch (error) {
    return {
      items: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useInvocationReviewController(options: InvocationReviewControllerOptions) {
  const renderedWorkspaceIdentityRef = useRef<InvocationReviewWorkspaceIdentity | null>(null);
  renderedWorkspaceIdentityRef.current = captureInvocationReviewWorkspaceIdentity(renderedWorkspaceIdentityRef.current, options.workspaceKey);
  const workspaceIdentity = renderedWorkspaceIdentityRef.current;
  const workspaceStateIdentityRef = useRef(workspaceIdentity);
  const [queueState, setQueueState] = useState<InvocationReviewQueueState>(EMPTY_INVOCATION_REVIEW_QUEUE);
  const [historyState, setHistoryState] = useState<InvocationHistoryItem[]>([]);
  const [historyErrorState, setHistoryErrorState] = useState<string | null>(null);
  const [historyReloadNonce, setHistoryReloadNonce] = useState(0);
  const [decisionPendingState, setDecisionPendingState] = useState(false);
  const [frozenPathsState, setFrozenPathsState] = useState<string[]>([]);
  const hydrationRequestRef = useRef(0);
  const payloadRequestRef = useRef<InvocationReviewPayloadRequest | null>(null);
  const historyRequestRef = useRef(0);
  const decisionPendingRef = useRef<InvocationReviewWorkspaceIdentity | null>(null);
  const optionsRef = useLatest(options);
  const projectionIsCurrent = invocationReviewWorkspaceIdentityIsCurrent(workspaceStateIdentityRef.current, workspaceIdentity);
  const queue = projectionIsCurrent
    ? queueState
    : EMPTY_INVOCATION_REVIEW_QUEUE;
  const history = projectionIsCurrent
    ? historyState
    : [];
  const historyError = projectionIsCurrent
    ? historyErrorState
    : null;
  const decisionPending = projectionIsCurrent
    ? decisionPendingState
    : false;
  const frozenPaths = projectionIsCurrent
    ? frozenPathsState
    : [];
  const activeEntry = activeInvocationReviewEntry(queue);
  const activeChangeId = activeInvocationReviewChangeId(queue);
  const activePayload = activeEntry && activeChangeId ? activeEntry.payloads[activeChangeId] ?? null : null;
  const workspaceIsCurrent = useCallback((captured: InvocationReviewWorkspaceIdentity) =>
    renderedWorkspaceIdentityRef.current !== null
      && invocationReviewWorkspaceIdentityIsCurrent(captured, renderedWorkspaceIdentityRef.current), []);

  useEffect(() => {
    const identity = workspaceIdentity;
    if (!workspaceIsCurrent(identity)) return;
    const request = ++hydrationRequestRef.current;
    payloadRequestRef.current = null;
    decisionPendingRef.current = null;
    workspaceStateIdentityRef.current = identity;
    setDecisionPendingState(false);
    setFrozenPathsState([]);
    setHistoryState([]);
    setHistoryErrorState(null);
    setQueueState(options.workspaceKey ? beginInvocationReviewHydration() : EMPTY_INVOCATION_REVIEW_QUEUE);
    if (!options.workspaceKey) return;
    let cancelled = false;
    void window.exograph.workspace.listPendingInvocationReviews()
      .then((items) => {
        if (cancelled || !workspaceIsCurrent(identity) || request !== hydrationRequestRef.current) return;
        setQueueState((current) => mergeInvocationReviewHydration(current, items));
      })
      .catch((error) => {
        if (cancelled || !workspaceIsCurrent(identity) || request !== hydrationRequestRef.current) return;
        console.warn("[exograph] failed to load pending invocation reviews", error);
        setQueueState((current) => mergeInvocationReviewHydration(current, []));
      });
    return () => { cancelled = true; };
  }, [options.workspaceKey, workspaceIdentity, workspaceIsCurrent]);

  useEffect(() => {
    const identity = workspaceIdentity;
    if (!workspaceIsCurrent(identity)) return;
    const request = ++historyRequestRef.current;
    const decision = invocationHistoryLoadDecision(options.historyDocument);
    if (!options.workspaceKey || decision.kind === "clear") {
      setHistoryState([]);
      setHistoryErrorState(null);
      return;
    }
    if (decision.kind === "preserve") return;
    let cancelled = false;
    void loadInvocationHistoryState(decision.filePath, window.exograph.workspace.listInvocationHistory)
      .then((result) => {
        if (!cancelled && workspaceIsCurrent(identity) && request === historyRequestRef.current) {
          if (result.items) setHistoryState(result.items);
          setHistoryErrorState(result.error);
        }
      });
    return () => { cancelled = true; };
  }, [historyReloadNonce, options.historyDocument?.filePath, options.historyDocument?.readOnly, options.workspaceKey, workspaceIdentity, workspaceIsCurrent]);

  useEffect(() => {
    const identity = workspaceIdentity;
    if (!workspaceIsCurrent(identity) || !activeEntry || !activeChangeId || activePayload) return;
    const request: InvocationReviewPayloadRequest = {
      workspaceIdentity: identity,
      invocationId: activeEntry.invocationId,
      changeId: activeChangeId,
      requestId: (payloadRequestRef.current?.requestId ?? 0) + 1,
    };
    payloadRequestRef.current = request;
    let cancelled = false;
    void window.exograph.workspace.getInvocationFileReview({ invocationId: request.invocationId, changeId: request.changeId })
      .then((payload) => {
        if (cancelled || !workspaceIsCurrent(identity) || !payloadRequestRef.current || !invocationReviewPayloadRequestIsCurrent(request, payloadRequestRef.current)) return;
        setQueueState((current) => cacheInvocationFileReview(current, payload));
      })
      .catch((error) => {
        if (cancelled || !workspaceIsCurrent(identity) || !payloadRequestRef.current || !invocationReviewPayloadRequestIsCurrent(request, payloadRequestRef.current)) return;
        console.warn("[exograph] failed to load invocation file review", error);
        optionsRef.current.onReviewError(activeEntry.command, error);
      });
    return () => { cancelled = true; };
  }, [activeChangeId, activeEntry?.invocationId, activePayload, optionsRef, workspaceIdentity, workspaceIsCurrent]);

  useEffect(() => {
    const identity = workspaceIdentity;
    if (activePayload && workspaceIsCurrent(identity)) {
      optionsRef.current.onOpenReviewDocument(activePayload, activeEntry?.source ?? "pending");
    }
  }, [activeEntry?.source, activePayload?.change.id, activePayload?.invocation.id, optionsRef, workspaceIdentity, workspaceIsCurrent]);

  const applyRecord = useCallback((record: InvocationRecord) => {
    const identity = workspaceIdentity;
    if (!workspaceIsCurrent(identity) || (record.workspaceRoot && record.workspaceRoot !== identity.workspaceKey)) return;
    setQueueState((current) => applyInvocationReviewRecord(current, record));
    const document = options.historyDocument;
    if (!document || document.readOnly || record.taggedDocumentPath !== document.filePath) return;
    const request = ++historyRequestRef.current;
    void loadInvocationHistoryState(record.taggedDocumentPath, window.exograph.workspace.listInvocationHistory)
      .then((result) => {
        if (workspaceIsCurrent(identity) && request === historyRequestRef.current) {
          if (result.items) setHistoryState(result.items);
          setHistoryErrorState(result.error);
        }
      });
  }, [options.historyDocument, workspaceIdentity, workspaceIsCurrent]);

  const finishDecision = useCallback((identity: InvocationReviewWorkspaceIdentity) => {
    if (!workspaceIsCurrent(identity) || decisionPendingRef.current !== identity) return;
    decisionPendingRef.current = null;
    flushSync(() => {
      if (!workspaceIsCurrent(identity)) return;
      setDecisionPendingState(false);
      setFrozenPathsState([]);
    });
  }, [workspaceIsCurrent]);

  const resolveCurrent = useCallback(async (action: ReviewAction) => {
    const identity = workspaceIdentity;
    if (!workspaceIsCurrent(identity) || !activeEntry || !activeChangeId || !activePayload || activeEntry.source === "history") return;
    const started = beginInvocationReviewDecision(decisionPendingRef.current === identity, activePayload, options.openDocumentPaths);
    if (!started.started || !started.snapshot) return;
    const snapshot = started.snapshot;
    const entry = activeEntry;
    decisionPendingRef.current = identity;
    flushSync(() => {
      if (!workspaceIsCurrent(identity)) return;
      setDecisionPendingState(true);
      setFrozenPathsState(snapshot.affectedOpenPaths);
    });
    try {
      const resolvedRecord = await runInvocationReviewDecision(snapshot, {
        prepareDocumentsForReview: async (paths) => {
          if (!workspaceIsCurrent(identity)) return;
          await optionsRef.current.prepareDocumentsForReview(paths);
        },
        decide: () => {
          if (!workspaceIsCurrent(identity)) {
            return Promise.reject(new InvocationReviewWorkspaceChangedError());
          }
          return window.exograph.workspace.reviewInvocationFile({ invocationId: snapshot.invocationId, changeId: snapshot.changeId, action });
        },
      });
      if (!workspaceIsCurrent(identity)) return;
      setQueueState((current) => applyInvocationReviewRecord(current, resolvedRecord));
      await optionsRef.current.reloadTrees();
      if (!workspaceIsCurrent(identity)) return;
      const decision = resolvedRecord.changeset?.files.find((change) => change.id === snapshot.changeId)?.decision.status;
      if (decision === "kept" || decision === "rejected") {
        if (!workspaceIsCurrent(identity)) return;
        await optionsRef.current.onReviewResolved(snapshot.payload, action);
        if (!workspaceIsCurrent(identity)) return;
      }
    } catch (error) {
      if (workspaceIsCurrent(identity)) {
        optionsRef.current.onReviewError(entry.command, error);
        const refreshed = await window.exograph.workspace.getInvocationFileReview({ invocationId: snapshot.invocationId, changeId: snapshot.changeId }).catch(() => null);
        if (refreshed && workspaceIsCurrent(identity)) {
          setQueueState((current) => cacheInvocationFileReview(current, refreshed));
        }
      }
    } finally {
      finishDecision(identity);
    }
  }, [activeChangeId, activeEntry, activePayload, finishDecision, options.openDocumentPaths, optionsRef, workspaceIdentity, workspaceIsCurrent]);

  const resolveAll = useCallback(async (action: ReviewAction) => {
    const identity = workspaceIdentity;
    if (!workspaceIsCurrent(identity) || !activeEntry || activeEntry.source === "history") return;
    const started = beginInvocationReviewDecision(decisionPendingRef.current === identity, null, options.openDocumentPaths);
    if (!started.started) return;
    const entry = activeEntry;
    decisionPendingRef.current = identity;
    flushSync(() => {
      if (!workspaceIsCurrent(identity)) return;
      setDecisionPendingState(true);
      setFrozenPathsState([]);
    });
    try {
      const payloads: InvocationFileReviewPayload[] = [];
      for (const changeId of entry.changeIds) {
        if (!workspaceIsCurrent(identity)) return;
        const payload = entry.payloads[changeId] ?? await window.exograph.workspace.getInvocationFileReview({ invocationId: entry.invocationId, changeId });
        if (!workspaceIsCurrent(identity)) return;
        if (!entry.payloads[changeId]) setQueueState((current) => cacheInvocationFileReview(current, payload));
        payloads.push(payload);
      }
      const affectedOpenPaths = invocationReviewAffectedOpenPaths(payloads, options.openDocumentPaths);
      if (!workspaceIsCurrent(identity)) return;
      flushSync(() => {
        if (workspaceIsCurrent(identity)) setFrozenPathsState(affectedOpenPaths);
      });
      await optionsRef.current.prepareDocumentsForReview(affectedOpenPaths);
      if (!workspaceIsCurrent(identity)) return;
      const record = await window.exograph.workspace.reviewInvocationAll({ invocationId: entry.invocationId, action });
      if (!workspaceIsCurrent(identity)) return;
      setQueueState((current) => applyInvocationReviewRecord(current, record));
      await optionsRef.current.reloadTrees();
      if (!workspaceIsCurrent(identity)) return;
      for (const payload of payloads) {
        if (!workspaceIsCurrent(identity)) return;
        const decision = record.changeset?.files.find((change) => change.id === payload.change.id)?.decision.status;
        if (decision === "kept" || decision === "rejected") {
          await optionsRef.current.onReviewResolved(payload, action);
          if (!workspaceIsCurrent(identity)) return;
        }
      }
    } catch (error) {
      if (workspaceIsCurrent(identity)) optionsRef.current.onReviewError(entry.command, error);
    } finally {
      finishDecision(identity);
    }
  }, [activeEntry, finishDecision, options.openDocumentPaths, optionsRef, workspaceIdentity, workspaceIsCurrent]);

  const navigate = useCallback((index: number) => setQueueState((current) => navigateInvocationReview(current, index)), []);
  const openHistory = useCallback((item: InvocationHistoryItem) => setQueueState((current) => openInvocationHistoryReview(current, item)), []);
  const dismissHistory = useCallback(() => setQueueState(closeInvocationHistoryReview), []);
  const retryHistory = useCallback(() => setHistoryReloadNonce((current) => current + 1), []);
  const refreshActiveConflict = useCallback(() => {
    if (!activeEntry || !activeChangeId) return;
    setQueueState((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.invocationId === activeEntry.invocationId
        ? { ...entry, payloads: Object.fromEntries(Object.entries(entry.payloads).filter(([id]) => id !== activeChangeId)) }
        : entry),
    }));
  }, [activeChangeId, activeEntry]);

  return {
    activeEntry,
    activeChangeId,
    activePayload,
    decisionPending,
    frozenPaths,
    history,
    historyError,
    retryHistory,
    applyRecord,
    navigate,
    openHistory,
    dismissHistory,
    refreshActiveConflict,
    resolveCurrent,
    resolveAll,
  };
}

function useLatest<Value>(value: Value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

class InvocationReviewWorkspaceChangedError extends Error {}
