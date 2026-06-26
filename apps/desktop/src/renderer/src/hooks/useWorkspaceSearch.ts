import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import type { WorkspaceSearchResults } from "@exo/core";

export type WorkspaceSearchResultMode = "idle" | "filename" | "index-loading" | "index" | "index-unavailable" | "error";

const emptySearchResults: WorkspaceSearchResults = {
  notes: [],
  projectFiles: [],
  tags: [],
};

export function useWorkspaceSearch(options: { indexedOnEnter: boolean }) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResults>(emptySearchResults);
  const [resultMode, setResultMode] = useState<WorkspaceSearchResultMode>("idle");
  const [resultQuery, setResultQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(submittedQuery);
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;
    if (!deferredQuery.trim()) {
      setResults(emptySearchResults);
      setResultMode("idle");
      setResultQuery("");
      setMessage(null);
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
          setResultMode("filename");
          setResultQuery(deferredQuery.trim());
          setMessage(null);
        });
      } catch (error) {
        if (runRef.current !== runId) {
          return;
        }
        console.warn("[exo] workspace search failed", error);
        startTransition(() => {
          setResults(emptySearchResults);
          setResultMode("error");
          setResultQuery(deferredQuery.trim());
          setMessage("Filename search failed.");
        });
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [deferredQuery]);

  async function runIndexedSearch() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }
    if (!options.indexedOnEnter) {
      setResultMode("index-unavailable");
      setResultQuery(trimmedQuery);
      setMessage("QMD advanced search is off. Showing core filename results.");
      return;
    }

    const runId = ++runRef.current;
    setResultMode("index-loading");
    setResultQuery(trimmedQuery);
    setMessage(null);
    try {
      const response = await window.exo.workspace.searchIndex(trimmedQuery, { limit: 30, forceMode: "lexical" });
      if (runRef.current !== runId) {
        return;
      }
      const nextResults: WorkspaceSearchResults = {
        notes: response.results.map((result) => ({
          filePath: result.filePath,
          title: result.title,
          snippet: result.snippet,
          kind: "note" as const,
        })),
        projectFiles: [],
        tags: [],
      };
      startTransition(() => {
        setResults(nextResults);
        setResultMode(response.source === "qmd" ? "index" : "index-unavailable");
        setResultQuery(response.query);
        setMessage(response.warnings[0] ?? null);
      });
    } catch (error) {
      if (runRef.current !== runId) {
        return;
      }
      console.warn("[exo] advanced workspace search failed", error);
      startTransition(() => {
        setResultMode("error");
        setResultQuery(trimmedQuery);
        setMessage(error instanceof Error ? error.message : "Advanced search failed.");
      });
    }
  }

  return {
    query,
    setQuery,
    submittedQuery,
    setSubmittedQuery,
    results,
    resultMode,
    resultQuery,
    message,
    runIndexedSearch,
  };
}
