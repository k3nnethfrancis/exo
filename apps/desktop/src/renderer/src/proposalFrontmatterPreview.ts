import type { ProposalItem } from "@exo/core";

const FRONTMATTER_PREVIEW_METADATA_KEY = "exo.frontmatterPreview.v1";

interface FrontmatterPatchPreviewEvidence {
  format: typeof FRONTMATTER_PREVIEW_METADATA_KEY;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
}

export function frontmatterPatchPreviewEvidence(item: ProposalItem): FrontmatterPatchPreviewEvidence | null {
  if (item.kind !== "frontmatterPatch") {
    return null;
  }
  const evidence = item.metadata?.[FRONTMATTER_PREVIEW_METADATA_KEY];
  if (!isRecord(evidence) || evidence.format !== FRONTMATTER_PREVIEW_METADATA_KEY) {
    return null;
  }
  if (
    typeof evidence.before !== "string"
    || typeof evidence.after !== "string"
    || typeof evidence.beforeHash !== "string"
    || typeof evidence.afterHash !== "string"
  ) {
    return null;
  }
  return {
    format: FRONTMATTER_PREVIEW_METADATA_KEY,
    before: evidence.before,
    after: evidence.after,
    beforeHash: evidence.beforeHash,
    afterHash: evidence.afterHash,
  };
}

export function renderFrontmatterPreviewEvidence(
  evidence: FrontmatterPatchPreviewEvidence,
  options: { baseHash?: string } = {},
): string {
  const lines = [
    "Frontmatter byte preview",
    `Before hash: ${evidence.beforeHash}`,
    `After hash: ${evidence.afterHash}`,
  ];
  if (options.baseHash && options.baseHash !== evidence.beforeHash) {
    lines.push(`Base hash mismatch: proposal base is ${options.baseHash}; current file is ${evidence.beforeHash}.`);
  }
  lines.push(
    "--- before bytes (JSON string) ---",
    JSON.stringify(evidence.before),
    "--- after bytes (JSON string) ---",
    JSON.stringify(evidence.after),
  );
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
