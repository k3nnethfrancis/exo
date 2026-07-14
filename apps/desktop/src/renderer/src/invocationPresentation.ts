import type { InvocationRecord } from "@exo/core/agent-invocation";
import { commandForClaudeResume } from "@exo/core/provider-session";

export type InvocationPresentationTone = "active" | "success" | "danger" | "neutral";

export interface InvocationPresentation {
  title: string;
  detail: string;
  tone: InvocationPresentationTone;
  resumeCommand: string | null;
  dismissible: boolean;
}

export function presentInvocation(record: InvocationRecord, hasDirtyConflict = false): InvocationPresentation {
  const resumeCommand = record.command.handle === "claude" && record.providerSessionId
    ? commandForClaudeResume(record.command, record.providerSessionId)
    : null;

  if (hasDirtyConflict) {
    return {
      title: `Review @${record.command.handle}`,
      detail: "Unsaved editor changes conflict with the agent's version.",
      tone: "danger",
      resumeCommand,
      dismissible: false,
    };
  }
  if (record.status === "pending" || record.status === "running") {
    return {
      title: `@${record.command.handle} running`,
      detail: "Watching this note for changes.",
      tone: "active",
      resumeCommand: null,
      dismissible: false,
    };
  }
  if (record.status === "failed" || record.status === "orphaned") {
    return {
      title: `@${record.command.handle} failed`,
      detail: record.failureReason ?? (record.status === "orphaned" ? "Exo closed before this invocation finished." : "The command did not complete."),
      tone: "danger",
      resumeCommand,
      dismissible: true,
    };
  }
  if (record.review?.status === "pending") {
    return {
      title: `Review @${record.command.handle} changes`,
      detail: changedFilesDetail(record),
      tone: "neutral",
      resumeCommand,
      dismissible: false,
    };
  }
  if (record.review?.status === "kept" || record.review?.status === "rejected") {
    const kept = record.review.status === "kept";
    return {
      title: kept ? "Changes kept" : "Changes rejected",
      detail: `@${record.command.handle} session complete.`,
      tone: "success",
      resumeCommand,
      dismissible: true,
    };
  }
  return {
    title: `@${record.command.handle} finished`,
    detail: record.changedFileRefs.length === 0 ? "No changes to this note." : changedFilesDetail(record),
    tone: "success",
    resumeCommand,
    dismissible: true,
  };
}

function changedFilesDetail(record: InvocationRecord): string {
  const ambiguous = record.changedFileRefs.some((file) => file.attribution === "ambiguous");
  return `${record.changedFileRefs.length} changed file${record.changedFileRefs.length === 1 ? "" : "s"}${ambiguous ? " · attribution uncertain" : ""}`;
}
