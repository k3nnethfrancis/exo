import { useEffect, useRef, useState } from "react";

import type { TerminalKind, TerminalSessionInfo } from "../../../shared/api";
import { writeTerminalData } from "../components/terminalRegistry";
import { terminalSessionsEqual } from "../terminalSessions";

export interface UseTerminalSessionsOptions {
  maxPendingDataChars: number;
  onExternalSessions: (sessions: TerminalSessionInfo[], options: { activateLatest: boolean }) => void;
}

export function useTerminalSessions(options: UseTerminalSessionsOptions) {
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalIdState] = useState<string | null>(null);
  const [hydrationSnapshots, setHydrationSnapshots] = useState<Record<string, string>>({});
  const [hydrationVersions, setHydrationVersions] = useState<Record<string, number>>({});
  const [, setAgentAnnotations] = useState<Record<string, { runLabel: string; parentId: string | null }>>({});
  const sessionsRef = useRef<TerminalSessionInfo[]>([]);
  const activeTerminalIdRef = useRef<string | null>(null);
  const hydratedSessionIdsRef = useRef(new Set<string>());
  const pendingHydrationIdsRef = useRef(new Set<string>());
  const pendingTerminalDataRef = useRef<Record<string, string>>({});
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeTerminalIdRef.current = activeTerminalId;
  }, [activeTerminalId]);

  useEffect(() => {
    setAgentAnnotations((current) => {
      const next = { ...current };
      const activeIds = new Set(sessions.map((session) => session.id));

      for (const session of sessions) {
        if (!next[session.id]) {
          next[session.id] = {
            runLabel: "",
            parentId: null,
          };
        }
      }

      for (const agentId of Object.keys(next)) {
        if (!activeIds.has(agentId)) {
          delete next[agentId];
        } else if (next[agentId]?.parentId && !activeIds.has(next[agentId].parentId!)) {
          next[agentId] = { ...next[agentId], parentId: null };
        }
      }

      return next;
    });
  }, [sessions]);

  useEffect(() => {
    const removeDataListener = window.exo.terminals.onData(({ id, data }) => {
      const rendered = writeTerminalData(id, data);
      if (!rendered || pendingHydrationIdsRef.current.has(id)) {
        pendingTerminalDataRef.current[id] = appendPendingTerminalData(
          pendingTerminalDataRef.current[id] ?? "",
          data,
          optionsRef.current.maxPendingDataChars,
        );
      }
    });

    const removeExitListener = window.exo.terminals.onExit(({ id, exitCode }) => {
      setSessions((current) =>
        current.map((session) => (session.id === id ? { ...session, status: "exited", exitCode } : session)),
      );
    });
    const removeCreatedListener = window.exo.terminals.onCreated((session) => {
      adoptExternalSessions([session], { activateLatest: true });
    });
    const syncInterval = window.setInterval(() => {
      void window.exo.terminals.list().then((nextSessions) => {
        const knownIds = new Set(sessionsRef.current.map((session) => session.id));
        const unseenSessions = nextSessions.filter((session) => !knownIds.has(session.id));
        setSessions((current) => (terminalSessionsEqual(current, nextSessions) ? current : nextSessions));
        if (unseenSessions.length > 0) {
          adoptExternalSessions(unseenSessions, { activateLatest: true });
        }
      });
    }, 1500);

    return () => {
      removeDataListener();
      removeExitListener();
      removeCreatedListener();
      window.clearInterval(syncInterval);
    };
  }, []);

  function initialize(nextSessions: TerminalSessionInfo[], activeId: string | null, activeSnapshot?: string): void {
    setSessions(nextSessions);
    setActiveTerminalIdState(activeId);
    if (activeId && activeSnapshot !== undefined) {
      setHydrationSnapshot(activeId, activeSnapshot);
    }
  }

  function setHydrationSnapshot(id: string, snapshot: string) {
    const pendingData = pendingTerminalDataRef.current[id] ?? "";
    if (pendingData.length > 0) {
      delete pendingTerminalDataRef.current[id];
    }
    const mergedSnapshot = mergeHydrationSnapshot(snapshot, pendingData);
    hydratedSessionIdsRef.current.add(id);
    pendingHydrationIdsRef.current.delete(id);
    setHydrationSnapshots((current) => ({ ...current, [id]: mergedSnapshot }));
    setHydrationVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  async function hydrateTerminal(id: string, options?: { force?: boolean }) {
    if ((!options?.force && hydratedSessionIdsRef.current.has(id)) || pendingHydrationIdsRef.current.has(id)) {
      return;
    }
    pendingHydrationIdsRef.current.add(id);
    try {
      const snapshot = await window.exo.terminals.read(id);
      setHydrationSnapshot(id, snapshot);
    } finally {
      pendingHydrationIdsRef.current.delete(id);
    }
  }

  function pruneHydration(activeIds: Set<string>) {
    setHydrationSnapshots((current) => pruneRecordToKeys(current, activeIds));
    setHydrationVersions((current) => pruneRecordToKeys(current, activeIds));
    hydratedSessionIdsRef.current = new Set([...hydratedSessionIdsRef.current].filter((id) => activeIds.has(id)));
    pendingHydrationIdsRef.current = new Set([...pendingHydrationIdsRef.current].filter((id) => activeIds.has(id)));
    pendingTerminalDataRef.current = pruneRecordToKeys(pendingTerminalDataRef.current, activeIds);
  }

  async function createTerminal(kind: TerminalKind, cwd?: string): Promise<TerminalSessionInfo> {
    const session = await window.exo.terminals.create({ kind, cwd });
    setSessions((current) =>
      current.some((existing) => existing.id === session.id) ? current : [...current, session],
    );
    return session;
  }

  function adoptExternalSessions(
    nextSessions: TerminalSessionInfo[],
    adoptOptions: { activateLatest: boolean },
  ) {
    if (nextSessions.length === 0) {
      return;
    }
    setSessions((current) => mergeSessions(current, nextSessions));
    optionsRef.current.onExternalSessions(nextSessions, adoptOptions);

    if (!adoptOptions.activateLatest) {
      return;
    }
    const latest = nextSessions.at(-1);
    if (latest) {
      setActiveTerminalIdState(latest.id);
      void hydrateTerminal(latest.id);
    }
  }

  async function activateTerminal(id: string) {
    setActiveTerminalIdState(id);
    await hydrateTerminal(id);
  }

  async function reconnectTerminal(id: string): Promise<TerminalSessionInfo | null> {
    const session = await window.exo.terminals.reconnect(id);
    if (!session) {
      return null;
    }
    setSessions((current) =>
      current.map((existing) => (existing.id === session.id ? session : existing)),
    );
    await hydrateTerminal(id);
    return session;
  }

  async function killTerminal(id: string): Promise<TerminalSessionInfo[]> {
    await window.exo.terminals.kill(id);
    const remainingSessions = sessionsRef.current.filter((session) => session.id !== id);
    setSessions(remainingSessions);
    setHydrationSnapshots((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setHydrationVersions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    hydratedSessionIdsRef.current.delete(id);
    pendingHydrationIdsRef.current.delete(id);
    delete pendingTerminalDataRef.current[id];
    setAgentAnnotations((current) => {
      const next = { ...current };
      delete next[id];
      for (const key of Object.keys(next)) {
        if (next[key]?.parentId === id) {
          next[key] = { ...next[key], parentId: null };
        }
      }
      return next;
    });

    if (activeTerminalIdRef.current === id) {
      const fallback = remainingSessions.at(-1);
      setActiveTerminalIdState(fallback?.id ?? null);
    }
    return remainingSessions;
  }

  return {
    sessions,
    activeTerminalId,
    hydrationSnapshots,
    hydrationVersions,
    initialize,
    pruneHydration,
    createTerminal,
    adoptExternalSessions,
    activateTerminal,
    reconnectTerminal,
    hydrateTerminal,
    killTerminal,
    setActiveTerminalId: setActiveTerminalIdState,
  };
}

function mergeSessions(current: TerminalSessionInfo[], nextSessions: TerminalSessionInfo[]): TerminalSessionInfo[] {
  const seen = new Set(current.map((session) => session.id));
  const next = [...current];
  for (const session of nextSessions) {
    if (!seen.has(session.id)) {
      next.push(session);
    }
  }
  return next;
}

function pruneRecordToKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  const entries = Object.entries(record).filter(([key]) => keys.has(key));
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries);
}

export function appendPendingTerminalData(current: string, data: string, maxChars: number): string {
  const next = `${current}${data}`;
  return next.length <= maxChars ? next : next.slice(-maxChars);
}

export function mergeHydrationSnapshot(snapshot: string, pendingData: string): string {
  if (pendingData.length === 0) {
    return snapshot;
  }

  const overlap = largestSuffixPrefixOverlap(snapshot, pendingData);
  return `${snapshot}${pendingData.slice(overlap)}`;
}

function largestSuffixPrefixOverlap(snapshot: string, pendingData: string): number {
  const maxOverlap = Math.min(snapshot.length, pendingData.length);
  const tail = snapshot.slice(snapshot.length - maxOverlap);
  const combined = new Array<number>(pendingData.length + 1 + tail.length);
  for (let index = 0; index < pendingData.length; index += 1) {
    combined[index] = pendingData.charCodeAt(index);
  }
  combined[pendingData.length] = -1;
  for (let index = 0; index < tail.length; index += 1) {
    combined[pendingData.length + 1 + index] = tail.charCodeAt(index);
  }
  const prefixLengths = new Array<number>(combined.length).fill(0);

  for (let index = 1; index < combined.length; index += 1) {
    let candidateLength = prefixLengths[index - 1];
    while (candidateLength > 0 && combined[index] !== combined[candidateLength]) {
      candidateLength = prefixLengths[candidateLength - 1];
    }
    if (combined[index] === combined[candidateLength]) {
      candidateLength += 1;
    }
    prefixLengths[index] = candidateLength;
  }

  return Math.min(prefixLengths[prefixLengths.length - 1] ?? 0, maxOverlap);
}
