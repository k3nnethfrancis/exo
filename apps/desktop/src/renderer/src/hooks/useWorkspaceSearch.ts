import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import type { WorkspaceSearchResults } from "@exo/core";

const emptySearchResults: WorkspaceSearchResults = {
  notes: [],
  projectFiles: [],
  tags: [],
};

export function useWorkspaceSearch() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResults>(emptySearchResults);
  const deferredQuery = useDeferredValue(submittedQuery);
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;
    if (!deferredQuery.trim()) {
      setResults(emptySearchResults);
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const nextResults = await window.exo.workspace.searchWorkspace(deferredQuery);
        if (runRef.current !== runId) {
          return;
        }
        startTransition(() => {
          setResults(nextResults);
        });
      } catch (error) {
        if (runRef.current !== runId) {
          return;
        }
        console.warn("[exo] workspace search failed", error);
        startTransition(() => {
          setResults(emptySearchResults);
        });
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [deferredQuery]);

  return {
    query,
    setQuery,
    submittedQuery,
    setSubmittedQuery,
    results,
  };
}
