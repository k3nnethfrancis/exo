import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { contentSha256 } from "./proposal-apply-host";
import type { ProposalBatch, ProposalItem } from "./proposal-review";
import type { ProfileDefinition, ProfileTemplateReference } from "./profile";

export interface ProfileApplyProposalOptions {
  profile: ProfileDefinition;
  pluginRoot: string;
  workspaceRoot: string;
  activityId: string;
  sessionId?: string;
  target?: "fixtureVault";
  now?: string;
}

export async function createProfileApplyProposal(options: ProfileApplyProposalOptions): Promise<ProposalBatch | null> {
  const now = options.now ?? new Date().toISOString();
  const items = await proposalItemsForTemplates(options);
  if (items.length === 0) {
    return null;
  }
  return {
    id: `profile-apply-${slug(options.profile.id)}-${timestampSlug(now)}`,
    title: `Apply ${options.profile.label} profile templates`,
    description: "Review profile-owned instruction/context/config template writes before Exo applies them to disk.",
    status: "pending",
    provenance: {
      activityId: options.activityId,
      sessionId: options.sessionId,
    },
    items,
    createdAt: now,
    updatedAt: now,
    metadata: {
      source: "profileApply",
      profileId: options.profile.id,
      profileLabel: options.profile.label,
      ...(options.target ? { profileApplyTarget: options.target } : {}),
    },
  };
}

async function proposalItemsForTemplates(options: ProfileApplyProposalOptions): Promise<ProposalItem[]> {
  const groups: Array<{ prefix: string; templates: ProfileTemplateReference[] }> = [
    { prefix: "context", templates: options.profile.contextTemplates },
    { prefix: "instruction", templates: options.profile.instructionTemplates },
    { prefix: "mcp", templates: options.profile.mcpConfigTemplates },
  ];
  const items: ProposalItem[] = [];
  for (const group of groups) {
    for (const template of group.templates) {
      const item = await proposalItemForTemplate(options, group.prefix, template);
      if (item) {
        items.push(item);
      }
    }
  }
  return items;
}

async function proposalItemForTemplate(
  options: ProfileApplyProposalOptions,
  prefix: string,
  template: ProfileTemplateReference,
): Promise<ProposalItem | null> {
  const contents = await readFile(resolvePluginTemplatePath(options.pluginRoot, template.templatePath), "utf8");
  const targetPath = normalizedRelativeWorkspacePath(template.target ?? template.templatePath);
  const existing = await readWorkspaceFileIfExists(options.workspaceRoot, targetPath);
  const id = `${prefix}-${slug(template.id)}`;
  if (existing === null) {
    return {
      id,
      kind: "fileCreate",
      path: targetPath,
      itemStatus: "pending",
      contents,
      metadata: { profileTemplateId: template.id, profileTemplateLabel: template.label, profileTemplateKind: prefix },
    };
  }
  if (existing === contents) {
    return null;
  }
  return {
    id,
    kind: "filePatch",
    path: targetPath,
    itemStatus: "pending",
    baseHash: contentSha256(existing),
    unifiedDiff: wholeFileUnifiedDiff(targetPath, existing, contents),
    metadata: { profileTemplateId: template.id, profileTemplateLabel: template.label, profileTemplateKind: prefix },
  };
}

function resolvePluginTemplatePath(pluginRoot: string, templatePath: string): string {
  const target = path.resolve(pluginRoot, templatePath);
  const relative = path.relative(pluginRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Profile template path escapes plugin root: ${templatePath}`);
  }
  return target;
}

function normalizedRelativeWorkspacePath(targetPath: string): string {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Profile target path must stay inside the workspace: ${targetPath}`);
  }
  return normalized;
}

async function readWorkspaceFileIfExists(workspaceRoot: string, targetPath: string): Promise<string | null> {
  const target = path.resolve(workspaceRoot, targetPath);
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Profile target path escapes workspace root: ${targetPath}`);
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      return null;
    }
    return readFile(target, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function wholeFileUnifiedDiff(targetPath: string, existing: string, next: string): string {
  const oldLines = stripTrailingNewline(existing).split("\n");
  const newLines = stripTrailingNewline(next).split("\n");
  const oldCount = existing.length === 0 ? 0 : oldLines.length;
  const newCount = next.length === 0 ? 0 : newLines.length;
  const removed = oldCount === 0 ? [] : oldLines.map((line) => `-${line}`);
  const added = newCount === 0 ? [] : newLines.map((line) => `+${line}`);
  return [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...removed,
    ...added,
    "",
  ].join("\n");
}

function stripTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "profile";
}

function timestampSlug(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}
