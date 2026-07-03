export type ProposalItemStatus = "pending" | "accepted" | "rejected" | "stale";
export type ProposalBatchStatus = "pending" | "partial" | "accepted" | "rejected" | "stale";
export type ProposalItemKind = "filePatch" | "frontmatterPatch" | "fileCreate" | "fileMove" | "fileDelete";
export type ProposalDecision = "accept" | "reject";
export type ProposalDecisionSurface = "ui" | "cli" | "mcp";
export type ProposalPermissionOperation = "create" | "list" | "decide";
export type FrontmatterPatchOperationKind = "set" | "remove" | "appendToList";

export interface ProposalProvenance {
  activityId: string;
  sessionId?: string;
  traceRef?: string;
}

export interface ProposalBatch {
  id: string;
  title?: string;
  description?: string;
  atomic?: boolean;
  status: ProposalBatchStatus;
  provenance: ProposalProvenance;
  items: ProposalItem[];
  supersedes?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ProposalItemBase {
  id: string;
  kind: ProposalItemKind;
  path: string;
  itemStatus: ProposalItemStatus;
  statusReason?: string;
  baseHash?: string;
  decidedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface FilePatchProposalItem extends ProposalItemBase {
  kind: "filePatch";
  baseHash: string;
  unifiedDiff: string;
}

export interface FrontmatterPatchProposalItem extends ProposalItemBase {
  kind: "frontmatterPatch";
  baseHash: string;
  operations: FrontmatterPatchOperation[];
}

export interface FileCreateProposalItem extends ProposalItemBase {
  kind: "fileCreate";
  contents: string;
  baseHash?: undefined;
}

export interface FileMoveProposalItem extends ProposalItemBase {
  kind: "fileMove";
  baseHash: string;
  toPath: string;
}

export interface FileDeleteProposalItem extends ProposalItemBase {
  kind: "fileDelete";
  baseHash: string;
}

export type ProposalItem =
  | FilePatchProposalItem
  | FrontmatterPatchProposalItem
  | FileCreateProposalItem
  | FileMoveProposalItem
  | FileDeleteProposalItem;

export interface FrontmatterPatchOperation {
  kind: FrontmatterPatchOperationKind;
  keyPath: string[];
  value?: unknown;
}

export interface ProposalDecisionOptions {
  surface: ProposalDecisionSurface;
  decidedAt?: string;
  currentHashes?: Record<string, string | null | undefined>;
}

export interface ProposalDecisionForbiddenErrorShape {
  code: "proposal-decision-forbidden";
  message: "Proposals are decided by the user in Exo (UI or CLI). Agent surfaces may create and list proposals only.";
}

export interface ProposalPermissionRequirement {
  operation: ProposalPermissionOperation;
  action: "read" | "propose" | "write";
  reviewCopy: string;
}

export const PROPOSAL_DECISION_FORBIDDEN_ERROR = {
  code: "proposal-decision-forbidden",
  message: "Proposals are decided by the user in Exo (UI or CLI). Agent surfaces may create and list proposals only.",
} satisfies ProposalDecisionForbiddenErrorShape;

export const PROPOSAL_UNSUPPORTED_MOVE_DELETE_REASON = "not yet supported: fileMove/fileDelete land in proposals v2";
export const PROPOSAL_PERMISSION_REQUIREMENTS = {
  create: {
    operation: "create",
    action: "propose",
    reviewCopy: "Can draft proposed file changes for user review.",
  },
  list: {
    operation: "list",
    action: "read",
    reviewCopy: "Can read proposal metadata and review status.",
  },
  decide: {
    operation: "decide",
    action: "write",
    reviewCopy: "Can accept or reject proposed file changes from a human UI/CLI surface.",
  },
} satisfies Record<ProposalPermissionOperation, ProposalPermissionRequirement>;

export class ProposalDecisionForbiddenError extends Error {
  readonly code = PROPOSAL_DECISION_FORBIDDEN_ERROR.code;

  constructor() {
    super(PROPOSAL_DECISION_FORBIDDEN_ERROR.message);
    this.name = "ProposalDecisionForbiddenError";
  }
}

export function parseProposalBatch(raw: string): ProposalBatch {
  return validateProposalBatch(JSON.parse(raw));
}

export function serializeProposalBatch(proposal: ProposalBatch): string {
  return `${JSON.stringify(validateProposalBatch(proposal), null, 2)}\n`;
}

export function validateProposalBatch(input: unknown): ProposalBatch {
  if (!isRecord(input)) {
    throw new Error("Proposal batch must be an object.");
  }
  const items = arrayField(input, "items").map(validateProposalItem);
  if (items.length === 0) {
    throw new Error("Proposal batch must contain at least one item.");
  }
  const proposal: ProposalBatch = {
    id: requiredString(input, "id"),
    title: optionalString(input, "title"),
    description: optionalString(input, "description"),
    atomic: optionalBoolean(input, "atomic"),
    status: validateProposalBatchStatus(optionalString(input, "status") ?? proposalStatusForItems(items)),
    provenance: validateProposalProvenance(input.provenance),
    items,
    supersedes: optionalString(input, "supersedes"),
    createdAt: optionalString(input, "createdAt"),
    updatedAt: optionalString(input, "updatedAt"),
    metadata: optionalRecord(input, "metadata"),
  };
  if (proposal.status !== proposalStatusForItems(items)) {
    throw new Error(`Proposal batch ${proposal.id} status does not match item statuses.`);
  }
  return withoutUndefined(proposal);
}

export function decideProposalItem(
  proposal: ProposalBatch,
  itemId: string,
  decision: ProposalDecision,
  options: ProposalDecisionOptions,
): ProposalBatch {
  assertProposalDecisionAllowed(options.surface);
  const current = validateProposalBatch(proposal);
  if (current.atomic) {
    throw new Error(`Proposal batch ${current.id} is atomic; decide the full batch instead of individual items.`);
  }
  const items = current.items.map((item) =>
    item.id === itemId ? decideItem(item, decision, options) : item,
  );
  if (!items.some((item) => item.id === itemId)) {
    throw new Error(`Proposal item not found: ${itemId}`);
  }
  return validateProposalBatch({ ...current, status: proposalStatusForItems(items), items, updatedAt: options.decidedAt ?? current.updatedAt });
}

export function decideProposalBatch(
  proposal: ProposalBatch,
  decision: ProposalDecision,
  options: ProposalDecisionOptions,
): ProposalBatch {
  assertProposalDecisionAllowed(options.surface);
  const current = validateProposalBatch(proposal);
  const items = current.items.map((item) => decideItem(item, decision, options));
  return validateProposalBatch({ ...current, status: proposalStatusForItems(items), items, updatedAt: options.decidedAt ?? current.updatedAt });
}

// "Apply" means apply the human decision to metadata; filesystem mutation is a future, separate host contract.
export const applyProposalItemDecision = decideProposalItem;
export const applyProposalBatchDecision = decideProposalBatch;

export function proposalStatusForItems(items: readonly Pick<ProposalItem, "itemStatus">[]): ProposalBatchStatus {
  const statuses = new Set(items.map((item) => item.itemStatus));
  if (statuses.size === 1) {
    const [status] = [...statuses];
    if (status === "accepted" || status === "rejected" || status === "stale") {
      return status;
    }
    return "pending";
  }
  return statuses.has("pending") || statuses.has("accepted") || statuses.has("rejected") || statuses.has("stale")
    ? "partial"
    : "pending";
}

export function assertProposalDecisionAllowed(surface: ProposalDecisionSurface): void {
  if (surface === "mcp") {
    // MCP may create/list proposal metadata, but user decisions stay on UI/CLI planes.
    throw new ProposalDecisionForbiddenError();
  }
}

export function proposalPermissionRequirement(operation: ProposalPermissionOperation): ProposalPermissionRequirement {
  return PROPOSAL_PERMISSION_REQUIREMENTS[operation];
}

export function isProposalDecisionForbiddenError(error: unknown): error is ProposalDecisionForbiddenError {
  return error instanceof ProposalDecisionForbiddenError;
}

function decideItem(item: ProposalItem, decision: ProposalDecision, options: ProposalDecisionOptions): ProposalItem {
  if (item.itemStatus !== "pending") {
    throw new Error(`Proposal item ${item.id} is already ${item.itemStatus}.`);
  }
  if (decision === "reject") {
    return withItemDecision(item, "rejected", options.decidedAt);
  }
  const staleReason = staleReasonForItem(item, options.currentHashes ?? {});
  if (staleReason) {
    return withItemDecision(item, "stale", options.decidedAt, staleReason);
  }
  if (item.kind === "fileMove" || item.kind === "fileDelete") {
    return withItemDecision(item, "stale", options.decidedAt, PROPOSAL_UNSUPPORTED_MOVE_DELETE_REASON);
  }
  return withItemDecision(item, "accepted", options.decidedAt);
}

function staleReasonForItem(item: ProposalItem, currentHashes: Record<string, string | null | undefined>): string | undefined {
  if (item.kind === "fileCreate") {
    return currentHashes[item.path] ? `baseHash mismatch: file changed since proposal (${item.path})` : undefined;
  }
  const currentHash = currentHashes[item.path];
  if (currentHash !== undefined && currentHash !== item.baseHash) {
    return `baseHash mismatch: file changed since proposal (${item.path})`;
  }
  return undefined;
}

function withItemDecision<T extends ProposalItem>(
  item: T,
  itemStatus: ProposalItemStatus,
  decidedAt: string | undefined,
  statusReason?: string,
): T {
  return withoutUndefined({
    ...item,
    itemStatus,
    decidedAt,
    statusReason,
  }) as T;
}

function validateProposalProvenance(input: unknown): ProposalProvenance {
  if (!isRecord(input)) {
    throw new Error("Proposal provenance must be an object.");
  }
  return withoutUndefined({
    activityId: requiredString(input, "activityId"),
    sessionId: optionalString(input, "sessionId"),
    traceRef: optionalString(input, "traceRef"),
  });
}

function validateProposalItem(input: unknown): ProposalItem {
  if (!isRecord(input)) {
    throw new Error("Proposal item must be an object.");
  }
  const base = {
    id: requiredString(input, "id"),
    kind: validateProposalItemKind(requiredString(input, "kind")),
    path: validateProposalPath(requiredString(input, "path")),
    itemStatus: validateProposalItemStatus(optionalString(input, "itemStatus") ?? "pending"),
    statusReason: optionalString(input, "statusReason"),
    decidedAt: optionalString(input, "decidedAt"),
    metadata: optionalRecord(input, "metadata"),
  };
  switch (base.kind) {
    case "filePatch":
      return withoutUndefined({ ...base, kind: base.kind, baseHash: requiredString(input, "baseHash"), unifiedDiff: requiredString(input, "unifiedDiff") });
    case "frontmatterPatch":
      return withoutUndefined({ ...base, kind: base.kind, baseHash: requiredString(input, "baseHash"), operations: arrayField(input, "operations").map(validateFrontmatterPatchOperation) });
    case "fileCreate":
      return withoutUndefined({ ...base, kind: base.kind, contents: requiredString(input, "contents") });
    case "fileMove":
      return withoutUndefined({ ...base, kind: base.kind, baseHash: requiredString(input, "baseHash"), toPath: validateProposalPath(requiredString(input, "toPath")) });
    case "fileDelete":
      return withoutUndefined({ ...base, kind: base.kind, baseHash: requiredString(input, "baseHash") });
  }
}

function validateProposalPath(value: string): string {
  if (value.startsWith("/") || value.split("/").some((segment) => segment === "..")) {
    throw new Error(`Proposal path must be workspace-relative and cannot contain '..': ${value}`);
  }
  return value;
}

function validateFrontmatterPatchOperation(input: unknown): FrontmatterPatchOperation {
  if (!isRecord(input)) {
    throw new Error("Frontmatter patch operation must be an object.");
  }
  return withoutUndefined({
    kind: validateFrontmatterPatchOperationKind(requiredString(input, "kind")),
    keyPath: arrayField(input, "keyPath").map((value) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("Frontmatter patch operation keyPath must contain non-empty strings.");
      }
      return value;
    }),
    value: input.value,
  });
}

function validateProposalItemKind(value: string): ProposalItemKind {
  if (value !== "filePatch" && value !== "frontmatterPatch" && value !== "fileCreate" && value !== "fileMove" && value !== "fileDelete") {
    throw new Error(`Proposal item kind is unsupported: ${value}`);
  }
  return value;
}

function validateProposalItemStatus(value: string): ProposalItemStatus {
  if (value !== "pending" && value !== "accepted" && value !== "rejected" && value !== "stale") {
    throw new Error(`Proposal item status is unsupported: ${value}`);
  }
  return value;
}

function validateProposalBatchStatus(value: string): ProposalBatchStatus {
  if (value !== "pending" && value !== "partial" && value !== "accepted" && value !== "rejected" && value !== "stale") {
    throw new Error(`Proposal batch status is unsupported: ${value}`);
  }
  return value;
}

function validateFrontmatterPatchOperationKind(value: string): FrontmatterPatchOperationKind {
  if (value !== "set" && value !== "remove" && value !== "appendToList") {
    throw new Error(`Frontmatter patch operation kind is unsupported: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Proposal field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Proposal field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Proposal field ${key} must be a boolean when provided.`);
  }
  return value;
}

function optionalRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Proposal field ${key} must be an object when provided.`);
  }
  return value;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Proposal field ${key} must be an array.`);
  }
  return value;
}

function withoutUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
