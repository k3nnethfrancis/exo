import type { InvocationRecord } from "@exo/core";

export function hasInvocationDirtyConflict(
  record: InvocationRecord,
  filePath: string,
  document: { dirty: boolean } | undefined,
  keptConflicts: ReadonlySet<string>,
): boolean {
  if (!document?.dirty || keptConflicts.has(invocationConflictKey(record.id, filePath))) {
    return false;
  }
  return record.changedFileRefs.some((changedFile) => changedFile.path === filePath);
}

export function invocationConflictKey(invocationId: string, filePath: string): string {
  return `${invocationId}:${filePath}`;
}
