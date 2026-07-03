import { RefreshCw, X } from "lucide-react";
import type { ProposalBatch, ProposalItem } from "@exo/core";

import type { useProposalReviewState } from "../hooks/useProposalReviewState";

type ProposalReviewState = ReturnType<typeof useProposalReviewState>;

interface ProposalReviewDialogProps {
  review: ProposalReviewState;
  onClose: () => void;
}

export function ProposalReviewDialog({ review, onClose }: ProposalReviewDialogProps) {
  const selected = review.selectedProposal;
  const pendingItemCount = selected?.items.filter((item) => item.itemStatus === "pending").length ?? 0;

  return (
    <div className="dialog-overlay" data-testid="proposal-review-overlay">
      <div className="dialog-card dialog-card--proposal-review" data-testid="proposal-review-dialog">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Proposal Review</div>
            <div className="dialog-card__message">Review proposed workspace changes before Exo applies them to disk.</div>
          </div>
          <button className="dialog-card__close" data-testid="proposal-review-close" onClick={onClose} type="button" aria-label="Close proposal review">
            <X size={16} />
          </button>
        </div>

        <div className="proposal-review__toolbar">
          <button className="toolbar-button" onClick={() => void review.refreshProposals()} type="button">
            <RefreshCw size={14} />
            Refresh
          </button>
          <span>{review.pendingProposalCount} pending proposal{review.pendingProposalCount === 1 ? "" : "s"}</span>
        </div>

        {review.errorMessage ? <div className="dialog-card__status dialog-card__status--error">{review.errorMessage}</div> : null}
        {review.lastApplyResult ? (
          <div className="dialog-card__status dialog-card__status--success">
            Applied {review.lastApplyResult.appliedItems.length} item{review.lastApplyResult.appliedItems.length === 1 ? "" : "s"}.
          </div>
        ) : null}

        <div className="proposal-review">
          <div className="proposal-review__list" aria-label="Proposal batches">
            {review.loadState === "loading" && review.proposals.length === 0 ? <div className="dialog-card__status">Loading proposals...</div> : null}
            {review.loadState !== "loading" && review.proposals.length === 0 ? <div className="dialog-card__status">No proposal batches.</div> : null}
            {review.proposals.map((proposal) => (
              <button
                className={`proposal-review__batch ${proposal.id === review.selectedProposalId ? "proposal-review__batch--selected" : ""}`}
                data-testid="proposal-review-batch"
                key={proposal.id}
                onClick={() => review.selectProposal(proposal.id)}
                type="button"
              >
                <strong>{proposal.title ?? proposal.id}</strong>
                <span>{proposal.description ?? proposal.id}</span>
                <ProposalStatusLine proposal={proposal} />
              </button>
            ))}
          </div>

          <div className="proposal-review__detail" aria-label="Selected proposal">
            {!selected ? (
              <div className="dialog-card__status">Select a proposal to review.</div>
            ) : (
              <>
                <div className="proposal-review__detail-header">
                  <div>
                    <div className="proposal-review__kicker">{selected.status}{selected.atomic ? " · atomic" : ""}</div>
                    <h3>{selected.title ?? selected.id}</h3>
                    {selected.description ? <p>{selected.description}</p> : null}
                    <small>{selected.provenance.activityId}{selected.provenance.sessionId ? ` · ${selected.provenance.sessionId}` : ""}</small>
                  </div>
                  <div className="proposal-review__actions">
                    <button
                      className="toolbar-button toolbar-button--primary"
                      disabled={pendingItemCount === 0 || isDeciding(review, selected.id, "accept")}
                      onClick={() => void decidePendingItems(review, selected, "accept")}
                      type="button"
                    >
                      Accept all pending
                    </button>
                    <button
                      className="toolbar-button"
                      disabled={pendingItemCount === 0 || isDeciding(review, selected.id, "reject")}
                      onClick={() => void decidePendingItems(review, selected, "reject")}
                      type="button"
                    >
                      Reject all pending
                    </button>
                  </div>
                </div>

                <div className="proposal-review__items">
                  {selected.atomic ? <div className="dialog-card__status">Atomic batch: decide the full batch.</div> : null}
                  {selected.items.map((item) => (
                    <ProposalItemRow
                      atomic={selected.atomic === true}
                      item={item}
                      key={item.id}
                      onAccept={() => void review.acceptItem(selected.id, item.id)}
                      onReject={() => void review.rejectItem(selected.id, item.id)}
                      pending={review.decisionState?.proposalId === selected.id && review.decisionState?.itemId === item.id}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProposalStatusLine({ proposal }: { proposal: ProposalBatch }) {
  const counts = proposal.items.reduce<Record<string, number>>((current, item) => {
    current[item.itemStatus] = (current[item.itemStatus] ?? 0) + 1;
    return current;
  }, {});
  return (
    <small>
      {proposal.items.length} item{proposal.items.length === 1 ? "" : "s"} · {proposal.status}
      {counts.pending ? ` · ${counts.pending} pending` : ""}
      {counts.stale ? ` · ${counts.stale} stale` : ""}
    </small>
  );
}

function ProposalItemRow({
  atomic,
  item,
  onAccept,
  onReject,
  pending,
}: {
  atomic: boolean;
  item: ProposalItem;
  onAccept: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  const canDecide = item.itemStatus === "pending" && !atomic;
  return (
    <section className={`proposal-review__item proposal-review__item--${item.itemStatus}`} data-testid="proposal-review-item">
      <div className="proposal-review__item-header">
        <div>
          <strong>{item.path}</strong>
          <small>
            {item.kind} · {item.itemStatus}{item.baseHash ? ` · ${shortHash(item.baseHash)}` : ""}
          </small>
        </div>
        <div className="proposal-review__item-actions">
          <button className="toolbar-button" disabled={!canDecide || pending} onClick={onAccept} type="button">
            Accept
          </button>
          <button className="toolbar-button" disabled={!canDecide || pending} onClick={onReject} type="button">
            Reject
          </button>
        </div>
      </div>
      {item.statusReason ? <div className="dialog-card__status dialog-card__status--warning">{item.statusReason}</div> : null}
      <ProposalItemPreview item={item} />
    </section>
  );
}

function ProposalItemPreview({ item }: { item: ProposalItem }) {
  if (item.kind === "filePatch") {
    return <pre className="proposal-review__preview">{item.unifiedDiff}</pre>;
  }
  if (item.kind === "fileCreate") {
    return <pre className="proposal-review__preview">{item.contents}</pre>;
  }
  if (item.kind === "frontmatterPatch") {
    return (
      <ul className="proposal-review__operations">
        {item.operations.map((operation, index) => (
          <li key={`${operation.kind}:${operation.keyPath.join(".")}:${index}`}>
            <code>{operation.kind}</code> {operation.keyPath.join(".") || "(root)"}
            {operation.kind !== "remove" ? ` = ${JSON.stringify(operation.value)}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  return <div className="dialog-card__status dialog-card__status--warning">{item.kind} proposals are typed but not applied in proposal v1.</div>;
}

function isDeciding(review: ProposalReviewState, proposalId: string, decision: "accept" | "reject"): boolean {
  return review.decisionState?.proposalId === proposalId && review.decisionState.decision === decision && !review.decisionState.itemId;
}

async function decidePendingItems(review: ProposalReviewState, proposal: ProposalBatch, decision: "accept" | "reject"): Promise<void> {
  if (proposal.atomic) {
    await (decision === "accept" ? review.acceptProposal(proposal.id) : review.rejectProposal(proposal.id));
    return;
  }
  for (const item of proposal.items) {
    if (item.itemStatus !== "pending") {
      continue;
    }
    await (decision === "accept" ? review.acceptItem(proposal.id, item.id) : review.rejectItem(proposal.id, item.id));
  }
}

function shortHash(hash: string): string {
  return hash.startsWith("sha256:") ? `sha256:${hash.slice(7, 15)}` : hash.slice(0, 12);
}
