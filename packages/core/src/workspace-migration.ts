import type { WorkspaceSettings } from "./types";

export interface PendingMainWikiMigration {
  retiredNoteRoots: string[];
}

/** A once-only, local notice for users upgraded from multi-root Workspaces. */
export function pendingMainWikiMigration(settings: WorkspaceSettings): PendingMainWikiMigration | null {
  const metadata = settings.migrationMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const migration = (metadata as Record<string, unknown>).mainWiki;
  if (!migration || typeof migration !== "object" || Array.isArray(migration)) return null;
  const candidate = migration as Record<string, unknown>;
  if (typeof candidate.acknowledgedAt === "string") return null;
  const retiredNoteRoots = Array.isArray(candidate.retiredNoteRoots)
    ? candidate.retiredNoteRoots.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return retiredNoteRoots.length > 0 ? { retiredNoteRoots } : null;
}

export function acknowledgeMainWikiMigration(settings: WorkspaceSettings, acknowledgedAt = new Date().toISOString()): WorkspaceSettings {
  const metadata = settings.migrationMetadata;
  const existingMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const existingMigration = existingMetadata.mainWiki && typeof existingMetadata.mainWiki === "object" && !Array.isArray(existingMetadata.mainWiki)
    ? existingMetadata.mainWiki as Record<string, unknown>
    : {};
  return {
    ...settings,
    migrationMetadata: {
      ...existingMetadata,
      mainWiki: { ...existingMigration, acknowledgedAt },
    },
  };
}

export function normalizeMigrationMetadata(value: unknown, retiredNoteRoots: readonly string[]): Record<string, unknown> | null {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  if (retiredNoteRoots.length > 0) {
    const existing = metadata.mainWiki && typeof metadata.mainWiki === "object" && !Array.isArray(metadata.mainWiki)
      ? metadata.mainWiki as Record<string, unknown>
      : {};
    // A fresh legacy configuration is a new migration event. Do not let an
    // acknowledgement from an earlier migration hide it.
    const { acknowledgedAt: _acknowledgedAt, ...unacknowledgedMigration } = existing;
    metadata.mainWiki = {
      ...unacknowledgedMigration,
      retiredNoteRoots: [...new Set(retiredNoteRoots)],
    };
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}
