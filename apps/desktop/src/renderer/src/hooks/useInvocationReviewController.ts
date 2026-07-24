import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { InvocationRecord } from "@exo/core";

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
  workspaceGeneration: number;
  invocationId: string;
  changeId: string;
  requestId: number;
}

export interface InvocationReviewDecisionSnapshot {
  invocationId: string;
  changeId: string;
  payload: InvocationFileReviewPayload;
  affectedOpenPaths: string[];
}

export function invocationReviewPayloadRequestIsCurrent(request: InvocationReviewPayloadRequest, current: InvocationReviewPayloadRequest): boolean {
  return request.workspaceGeneration === current.workspaceGeneration
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

export function useInvocationReviewController(options: InvocationReviewControllerOptions) {
  const [queue, setQueue] = useState<InvocationReviewQueueState>(EMPTY_INVOCATION_REVIEW_QUEUE);
  const [history, setHistory] = useState<InvocationHistoryItem[]>([]);
  const [decisionPending, setDecisionPending] = useState(false);
  const [frozenPaths, setFrozenPaths] = useState<string[]>([]);
  const workspaceGenerationRef = useRef(0);
  const hydrationRequestRef = useRef(0);
  const payloadRequestRef = useRef<InvocationReviewPayloadRequest | null>(null);
  const historyRequestRef = useRef(0);
  const decisionPendingRef = useRef(false);
  const historyDocumentRef = useLatest(options.historyDocument);
  const workspaceKeyRef = useLatest(options.workspaceKey);
  const optionsRef = useLatest(options);
  const activeEntry = activeInvocationReviewEntry(queue);
  const activeChangeId = activeInvocationReviewChangeId(queue);
  const activePayload = activeEntry && activeChangeId ? activeEntry.payloads[activeChangeId] ?? null : null;

  useEffect(() => {
    const workspaceGeneration = ++workspaceGenerationRef.current;
    const request = ++hydrationRequestRef.current;
    payloadRequestRef.current = null;
    decisionPendingRef.current = false;
    setDecisionPending(false);
    setFrozenPaths([]);
    setHistory([]);
    setQueue(options.workspaceKey ? beginInvocationReviewHydration() : EMPTY_INVOCATION_REVIEW_QUEUE);
    if (!options.workspaceKey) return;
    let cancelled = false;
    void window.exo.workspace.listPendingInvocationReviews()
      .then((items) => {
        if (cancelled || workspaceGeneration !== workspaceGenerationRef.current || request !== hydrationRequestRef.current) return;
        setQueue((current) => mergeInvocationReviewHydration(current, items));
      })
      .catch((error) => {
        if (cancelled || workspaceGeneration !== workspaceGenerationRef.current || request !== hydrationRequestRef.current) return;
        console.warn("[exo] failed to load pending invocation reviews", error);
        setQueue((current) => mergeInvocationReviewHydration(current, []));
      });
    return () => { cancelled = true; };
  }, [options.workspaceKey]);

  useEffect(() => {
    const request = ++historyRequestRef.current;
    const decision = invocationHistoryLoadDecision(options.historyDocument);
    if (!options.workspaceKey || decision.kind === "clear") {
      setHistory([]);
      return;
    }
    if (decision.kind === "preserve") return;
    let cancelled = false;
    void window.exo.workspace.listInvocationHistory(decision.filePath)
      .then((items) => { if (!cancelled && request === historyRequestRef.current) setHistory(items); })
      .catch(() => { if (!cancelled && request === historyRequestRef.current) setHistory([]); });
    return () => { cancelled = true; };
  }, [options.historyDocument?.filePath, options.historyDocument?.readOnly, options.workspaceKey]);

  useEffect(() => {
    if (!activeEntry || !activeChangeId || activePayload) return;
    const request: InvocationReviewPayloadRequest = {
      workspaceGeneration: workspaceGenerationRef.current,
      invocationId: activeEntry.invocationId,
      changeId: activeChangeId,
      requestId: (payloadRequestRef.current?.requestId ?? 0) + 1,
    };
    payloadRequestRef.current = request;
    let cancelled = false;
    void window.exo.workspace.getInvocationFileReview({ invocationId: request.invocationId, changeId: request.changeId })
      .then((payload) => {
        if (cancelled || !payloadRequestRef.current || !invocationReviewPayloadRequestIsCurrent(request, payloadRequestRef.current)) return;
        setQueue((current) => cacheInvocationFileReview(current, payload));
      })
      .catch((error) => {
        if (cancelled || !payloadRequestRef.current || !invocationReviewPayloadRequestIsCurrent(request, payloadRequestRef.current)) return;
        console.warn("[exo] failed to load invocation file review", error);
        optionsRef.current.onReviewError(activeEntry.command, error);
      });
    return () => { cancelled = true; };
  }, [activeChangeId, activeEntry?.invocationId, activePayload, optionsRef]);

  useEffect(() => {
    if (activePayload) optionsRef.current.onOpenReviewDocument(activePayload, activeEntry?.source ?? "pending");
  }, [activeEntry?.source, activePayload?.change.id, activePayload?.invocation.id, optionsRef]);

  const applyRecord = useCallback((record: InvocationRecord) => {
    if (record.workspaceRoot && record.workspaceRoot !== workspaceKeyRef.current) return;
    setQueue((current) => applyInvocationReviewRecord(current, record));
    const document = historyDocumentRef.current;
    if (!document || document.readOnly || record.taggedDocumentPath !== document.filePath) return;
    const request = ++historyRequestRef.current;
    void window.exo.workspace.listInvocationHistory(record.taggedDocumentPath)
      .then((items) => { if (request === historyRequestRef.current) setHistory(items); })
      .catch(() => undefined);
  }, [historyDocumentRef, workspaceKeyRef]);

  const finishDecision = useCallback((workspaceGeneration: number) => {
    if (workspaceGeneration !== workspaceGenerationRef.current) return;
    decisionPendingRef.current = false;
    flushSync(() => { setDecisionPending(false); setFrozenPaths([]); });
  }, []);

  const resolveCurrent = useCallback(async (action: ReviewAction) => {
    if (!activeEntry || !activeChangeId || !activePayload || activeEntry.source === "history") return;
    const started = beginInvocationReviewDecision(decisionPendingRef.current, activePayload, options.openDocumentPaths);
    if (!started.started || !started.snapshot) return;
    const snapshot = started.snapshot;
    const entry = activeEntry;
    const workspaceGeneration = workspaceGenerationRef.current;
    const workspaceKey = options.workspaceKey;
    decisionPendingRef.current = true;
    flushSync(() => { setDecisionPending(true); setFrozenPaths(snapshot.affectedOpenPaths); });
    try {
      const resolvedRecord = await runInvocationReviewDecision(snapshot, {
        prepareDocumentsForReview: async (paths) => {
          if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
          await optionsRef.current.prepareDocumentsForReview(paths);
        },
        decide: () => {
          if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) {
            return Promise.reject(new InvocationReviewWorkspaceChangedError());
          }
          return window.exo.workspace.reviewInvocationFile({ invocationId: snapshot.invocationId, changeId: snapshot.changeId, action });
        },
      });
      if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
      setQueue((current) => applyInvocationReviewRecord(current, resolvedRecord!));
      await optionsRef.current.reloadTrees();
      if (workspaceGeneration !== workspaceGenerationRef.current) return;
      const decision = resolvedRecord.changeset?.files.find((change) => change.id === snapshot.changeId)?.decision.status;
      if (decision === "kept" || decision === "rejected") await optionsRef.current.onReviewResolved(snapshot.payload, action);
    } catch (error) {
      if (workspaceGeneration === workspaceGenerationRef.current && workspaceKey === workspaceKeyRef.current) {
        optionsRef.current.onReviewError(entry.command, error);
        const refreshed = await window.exo.workspace.getInvocationFileReview({ invocationId: snapshot.invocationId, changeId: snapshot.changeId }).catch(() => null);
        if (refreshed && workspaceGeneration === workspaceGenerationRef.current) setQueue((current) => cacheInvocationFileReview(current, refreshed));
      }
    } finally {
      finishDecision(workspaceGeneration);
    }
  }, [activeChangeId, activeEntry, activePayload, finishDecision, options.openDocumentPaths, options.workspaceKey, optionsRef, workspaceKeyRef]);

  const resolveAll = useCallback(async (action: ReviewAction) => {
    if (!activeEntry || activeEntry.source === "history") return;
    const started = beginInvocationReviewDecision(decisionPendingRef.current, null, options.openDocumentPaths);
    if (!started.started) return;
    const entry = activeEntry;
    const workspaceGeneration = workspaceGenerationRef.current;
    const workspaceKey = options.workspaceKey;
    decisionPendingRef.current = true;
    flushSync(() => setDecisionPending(true));
    try {
      const payloads: InvocationFileReviewPayload[] = [];
      for (const changeId of entry.changeIds) {
        if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
        const payload = entry.payloads[changeId] ?? await window.exo.workspace.getInvocationFileReview({ invocationId: entry.invocationId, changeId });
        if (!entry.payloads[changeId] && workspaceGeneration === workspaceGenerationRef.current) setQueue((current) => cacheInvocationFileReview(current, payload));
        payloads.push(payload);
      }
      const affectedOpenPaths = invocationReviewAffectedOpenPaths(payloads, options.openDocumentPaths);
      if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
      flushSync(() => setFrozenPaths(affectedOpenPaths));
      await optionsRef.current.prepareDocumentsForReview(affectedOpenPaths);
      if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
      const record = await window.exo.workspace.reviewInvocationAll({ invocationId: entry.invocationId, action });
      if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
      setQueue((current) => applyInvocationReviewRecord(current, record));
      await optionsRef.current.reloadTrees();
      if (workspaceGeneration !== workspaceGenerationRef.current || workspaceKey !== workspaceKeyRef.current) return;
      for (const payload of payloads) {
        const decision = record.changeset?.files.find((change) => change.id === payload.change.id)?.decision.status;
        if (decision === "kept" || decision === "rejected") await optionsRef.current.onReviewResolved(payload, action);
      }
    } catch (error) {
      if (workspaceGeneration === workspaceGenerationRef.current && workspaceKey === workspaceKeyRef.current) optionsRef.current.onReviewError(entry.command, error);
    } finally {
      finishDecision(workspaceGeneration);
    }
  }, [activeEntry, finishDecision, options.openDocumentPaths, options.workspaceKey, optionsRef, workspaceKeyRef]);

  const navigate = useCallback((index: number) => setQueue((current) => navigateInvocationReview(current, index)), []);
  const openHistory = useCallback((item: InvocationHistoryItem) => setQueue((current) => openInvocationHistoryReview(current, item)), []);
  const dismissHistory = useCallback(() => setQueue(closeInvocationHistoryReview), []);
  const refreshActiveConflict = useCallback(() => {
    if (!activeEntry || !activeChangeId) return;
    setQueue((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.invocationId === activeEntry.invocationId
        ? { ...entry, payloads: Object.fromEntries(Object.entries(entry.payloads).filter(([id]) => id !== activeChangeId)) }
        : entry),
    }));
  }, [activeChangeId, activeEntry]);

  return { activeEntry, activeChangeId, activePayload, decisionPending, frozenPaths, history, applyRecord, navigate, openHistory, dismissHistory, refreshActiveConflict, resolveCurrent, resolveAll };
}

function useLatest<Value>(value: Value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

class InvocationReviewWorkspaceChangedError extends Error {}
