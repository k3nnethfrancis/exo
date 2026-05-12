import { execFile } from "node:child_process";
import path from "node:path";

import type { RetrievalBackendConfig, SemanticSearchResult } from "./types";

export interface QmdConfig {
  command: string;
  enabled: boolean;
  /** Absolute path to the collection root (e.g., the vault directory). */
  collectionRoot: string;
}

interface QmdRawResult {
  docid: string;
  score: number;
  file: string;
  title: string;
  snippet: string;
}

/**
 * Build a QmdConfig from the runtime retrieval config and the first note root.
 * QMD is treated as optional notes index / retrieval infrastructure; app search
 * intentionally stays on the fast local note path until unified search is designed.
 */
export function buildQmdConfig(
  retrieval: RetrievalBackendConfig,
  noteRootPaths: string[],
): QmdConfig | null {
  if (!retrieval.enabled || noteRootPaths.length === 0) {
    return null;
  }

  return {
    command: retrieval.command,
    enabled: true,
    collectionRoot: noteRootPaths[0],
  };
}

/**
 * BM25 keyword query against the QMD index. Keep this on explicit retrieval
 * paths; do not wire it into live UI search without strict caps/cancellation.
 */
export async function searchQmd(
  query: string,
  config: QmdConfig,
  options?: { limit?: number },
): Promise<SemanticSearchResult[]> {
  const limit = options?.limit ?? 10;
  const args = ["search", query, "--collection", "vault", "--limit", String(limit), "--json"];
  return runQmd(config, args);
}

/**
 * Hybrid QMD query with reranking. This is a future memory/retrieval primitive,
 * not the current top-bar search path.
 */
export async function queryQmd(
  query: string,
  config: QmdConfig,
  options?: { limit?: number },
): Promise<SemanticSearchResult[]> {
  const limit = options?.limit ?? 10;
  const args = ["query", query, "--collection", "vault", "--limit", String(limit), "--json"];
  return runQmd(config, args);
}

/**
 * Check if the QMD binary is available.
 */
export async function isQmdAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, ["status"], { timeout: 5000 }, (error) => {
      resolve(error === null);
    });
  });
}

function runQmd(config: QmdConfig, args: string[]): Promise<SemanticSearchResult[]> {
  return new Promise((resolve) => {
    execFile(config.command, args, { timeout: 30000 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      try {
        const raw: QmdRawResult[] = JSON.parse(stdout);
        resolve(raw.map((item) => mapResult(item, config.collectionRoot)));
      } catch {
        resolve([]);
      }
    });
  });
}

function mapResult(raw: QmdRawResult, collectionRoot: string): SemanticSearchResult {
  // qmd returns file as "qmd://vault/relative/path.md" — extract relative path
  const relativePath = raw.file.replace(/^qmd:\/\/[^/]+\//, "");
  const filePath = path.resolve(collectionRoot, relativePath);

  // Clean up snippet — remove the @@ line-range header if present
  const snippet = raw.snippet.replace(/^@@\s*-\d+,\d+\s*@@\s*\([^)]*\)\n+/, "").trim();

  return {
    filePath,
    title: raw.title,
    snippet: snippet.slice(0, 200),
    score: raw.score,
    docid: raw.docid,
  };
}
