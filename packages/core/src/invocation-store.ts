import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { normalizeInvocationRecord, type InvocationRecord } from "./agent-invocation";
import { safeStoreSegment } from "./store-paths";

export interface InvocationStoreLayout {
  workspaceRoot: string;
  runtimeRoot: string;
  invocationsDir: string;
}

export function resolveInvocationStoreLayout(workspaceRoot: string): InvocationStoreLayout {
  const runtimeRoot = path.join(workspaceRoot, ".exo");
  return {
    workspaceRoot,
    runtimeRoot,
    invocationsDir: path.join(runtimeRoot, "invocations"),
  };
}

export function invocationRecordPath(layout: InvocationStoreLayout, invocationId: string): string {
  return path.join(layout.invocationsDir, safeStoreSegment(invocationId), "record.json");
}

export class InvocationStore {
  readonly layout: InvocationStoreLayout;

  constructor(workspaceRoot: string) {
    this.layout = resolveInvocationStoreLayout(workspaceRoot);
  }

  async writeRecord(record: InvocationRecord): Promise<string> {
    const normalized = normalizeInvocationRecord(record);
    if (!normalized) {
      throw new Error("Invocation record is incomplete.");
    }

    const target = invocationRecordPath(this.layout, normalized.id);
    await mkdir(path.dirname(target), { recursive: true });
    await writeJsonAtomically(target, normalized);
    return target;
  }

  async readRecord(invocationId: string): Promise<InvocationRecord | null> {
    const raw = await readJsonOrNull(invocationRecordPath(this.layout, invocationId));
    return normalizeInvocationRecord(raw);
  }

  async listRecords(): Promise<InvocationRecord[]> {
    let entries: string[];
    try {
      const dirents = await readdir(this.layout.invocationsDir, { withFileTypes: true });
      entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return [];
      }
      throw error;
    }

    const records = await Promise.all(
      entries.map((entry) => readJsonOrNull(path.join(this.layout.invocationsDir, entry, "record.json"))),
    );
    return records
      .map((record) => normalizeInvocationRecord(record))
      .filter((record): record is InvocationRecord => Boolean(record))
      .sort((left, right) => {
        const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
        return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
      });
  }
}

async function writeJsonAtomically(target: string, value: unknown): Promise<void> {
  const temporaryPath = path.join(path.dirname(target), `.record-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, target);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJsonOrNull(pathname: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as unknown;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
