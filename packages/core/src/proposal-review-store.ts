import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseProposalBatch, serializeProposalBatch, validateProposalBatch, type ProposalBatch } from "./proposal-review";
import { safeStoreSegment } from "./routine-run-store";

export interface ProposalReviewStoreLayout {
  runtimeRoot: string;
  proposalsDir: string;
}

export function resolveProposalReviewStoreLayout(runtimeRoot: string): ProposalReviewStoreLayout {
  return {
    runtimeRoot,
    proposalsDir: path.join(runtimeRoot, "proposals"),
  };
}

export function proposalBatchPath(layout: ProposalReviewStoreLayout, proposalId: string): string {
  return path.join(layout.proposalsDir, `${safeStoreSegment(proposalId)}.json`);
}

export class ProposalReviewStore {
  readonly layout: ProposalReviewStoreLayout;

  constructor(runtimeRoot: string) {
    this.layout = resolveProposalReviewStoreLayout(runtimeRoot);
  }

  async writeProposal(proposal: ProposalBatch): Promise<string> {
    const validated = validateProposalBatch(proposal);
    await mkdir(this.layout.proposalsDir, { recursive: true });
    const target = proposalBatchPath(this.layout, validated.id);
    await writeFile(target, serializeProposalBatch(validated), "utf8");
    return target;
  }

  async readProposal(proposalId: string): Promise<ProposalBatch | null> {
    try {
      return parseProposalBatch(await readFile(proposalBatchPath(this.layout, proposalId), "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async listProposals(): Promise<ProposalBatch[]> {
    let entries: string[];
    try {
      entries = (await readdir(this.layout.proposalsDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const proposals = await Promise.all(
      entries.map(async (entry) => parseProposalBatch(await readFile(path.join(this.layout.proposalsDir, entry), "utf8"))),
    );
    return proposals.sort((left, right) => (right.updatedAt ?? right.createdAt ?? "").localeCompare(left.updatedAt ?? left.createdAt ?? ""));
  }

  async updateProposal(
    proposalId: string,
    updater: (proposal: ProposalBatch) => ProposalBatch | Promise<ProposalBatch>,
  ): Promise<ProposalBatch> {
    const existing = await this.readProposal(proposalId);
    if (!existing) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }
    const updated = await updater(existing);
    await this.writeProposal(updated);
    return updated;
  }
}
