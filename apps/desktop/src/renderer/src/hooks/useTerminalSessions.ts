import { useEffect, useRef, useState } from "react";

import type { TerminalSessionInfo } from "../../../shared/api";
import { hasRegisteredTerminal, writeTerminalData } from "../components/terminalRegistry";
import { terminalSessionsEqual } from "../terminalSessions";

export interface UseTerminalSessionsOptions {
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
      writeTerminalData(id, data);
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
    setHydrationSnapshots((current) => ({ ...current, [id]: snapshot }));
    setHydrationVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  async function hydrateTerminal(id: string) {
    if (hasRegisteredTerminal(id)) {
      return;
    }
    const snapshot = await window.exo.terminals.read(id);
    setHydrationSnapshot(id, snapshot);
  }

  function pruneHydration(activeIds: Set<string>) {
    setHydrationSnapshots((current) => pruneRecordToKeys(current, activeIds));
    setHydrationVersions((current) => pruneRecordToKeys(current, activeIds));
  }

  async function createTerminal(kind: "shell" | "claude" | "codex", cwd?: string): Promise<TerminalSessionInfo> {
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
