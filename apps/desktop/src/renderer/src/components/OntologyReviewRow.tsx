import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { OntologyReviewState } from "@exo/core";

type BusyState = "preview" | "keep" | "reject" | null;

export function OntologyReviewRow() {
  const [review, setReview] = useState<OntologyReviewState | null>(null);
  const [busy, setBusy] = useState<BusyState>("preview");
  const [notice, setNotice] = useState<string | null>(null);
  const [reopened, setReopened] = useState(false);
  const operationEpochRef = useRef(0);

  const preview = useCallback(async () => {
    const epoch = ++operationEpochRef.current;
    setBusy("preview");
    try {
      const next = await window.exo.workspace.previewOntology();
      if (operationEpochRef.current !== epoch) return;
      setReview(next);
      setNotice(null);
      setReopened(false);
    } catch {
      if (operationEpochRef.current !== epoch) return;
      setReview(null);
      setNotice("Preview unavailable");
    } finally {
      if (operationEpochRef.current === epoch) setBusy(null);
    }
  }, []);

  useEffect(() => {
    void preview();
    return window.exo.workspace.onOntologyCandidateChanged(() => void preview());
  }, [preview]);

  async function keep() {
    if (!review) return;
    const epoch = ++operationEpochRef.current;
    setBusy("keep");
    try {
      const result = await window.exo.workspace.keepOntology(review.guard);
      if (operationEpochRef.current !== epoch) return;
      setReview(result.review);
      setReopened(false);
      setNotice(result.status === "stale" ? "Changed—review again" : "Applied");
    } catch {
      if (operationEpochRef.current !== epoch) return;
      setNotice("Could not apply");
    } finally {
      if (operationEpochRef.current === epoch) setBusy(null);
    }
  }

  async function reject() {
    if (!review) return;
    const epoch = ++operationEpochRef.current;
    setBusy("reject");
    try {
      const result = await window.exo.workspace.rejectOntology(review.guard);
      if (operationEpochRef.current !== epoch) return;
      setReview(result.review);
      setReopened(false);
      setNotice(result.status === "stale" ? "Changed—review again" : null);
    } catch {
      if (operationEpochRef.current !== epoch) return;
      setNotice("Could not reject");
    } finally {
      if (operationEpochRef.current === epoch) setBusy(null);
    }
  }

  return (
    <OntologyReviewPresentation
      busy={busy}
      notice={notice}
      onKeep={() => void keep()}
      onReject={() => void reject()}
      onReopen={() => { setReopened(true); setNotice(null); }}
      reopened={reopened}
      review={review}
    />
  );
}

export function OntologyReviewPresentation({
  busy,
  notice,
  onKeep,
  onReject,
  onReopen,
  reopened,
  review,
}: {
  busy: BusyState;
  notice: string | null;
  onKeep: () => void;
  onReject: () => void;
  onReopen: () => void;
  reopened: boolean;
  review: OntologyReviewState | null;
}) {
  const pending = review?.candidate.pending ?? false;
  const rejected = review?.candidate.rejected ?? false;
  const activeUnavailable = review?.active.state === "invalid-state";
  const showActions = pending && !activeUnavailable && (!rejected || reopened);
  const identity = review ? activeIdentity(review) : "Ontology";
  const candidateIdentity = review && pending ? pendingIdentity(review) : null;
  const effects = review?.effects;
  const findingCount = effects
    ? effects.after.findings.info + effects.after.findings.warning + effects.after.findings.error
    : 0;
  const relationDelta = effects ? effects.after.ontologyRelations - effects.before.ontologyRelations : 0;
  const firstDiagnostic = review?.diagnostics[0];

  return (
    <section className="ontology-review" data-testid="workspace-settings-ontology">
      <div className="ontology-review__main">
        <div className="ontology-review__identity">
          <span className="dialog-field__label">Ontology</span>
          <strong>{identity}</strong>
          {candidateIdentity ? <span className="ontology-review__candidate">→ {candidateIdentity}</span> : null}
        </div>
        <div className="ontology-review__tokens" aria-label="Ontology graph effects">
          {effects ? <span>{effects.after.typedConcepts} typed</span> : null}
          {effects ? <span>{signedCount(relationDelta)} relations</span> : null}
          {effects ? <span>{findingCount} findings</span> : null}
          {notice ? <span className="ontology-review__notice" role="status">{notice}</span> : null}
          {busy ? <span className="ontology-review__notice" role="status">{busy === "preview" ? "Previewing…" : "Applying…"}</span> : null}
          {rejected && !reopened ? <span className="ontology-review__notice">Not applied</span> : null}
        </div>
      </div>
      <div className="ontology-review__actions">
        {busy ? <LoaderCircle aria-label={busy === "preview" ? "Previewing ontology" : "Applying ontology review"} className="ontology-review__spinner" size={15} /> : null}
        {!busy && rejected && !reopened ? (
          <button aria-label="Review ontology again" className="icon-button" onClick={onReopen} title="Review again" type="button">
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        ) : null}
        {!busy && showActions ? (
          <>
            <button
              aria-label="Keep ontology"
              className="icon-button"
              disabled={review?.candidate.state === "invalid"}
              onClick={onKeep}
              title="Keep"
              type="button"
            >
              <Check size={16} aria-hidden="true" />
            </button>
            <button aria-label="Reject ontology" className="icon-button" onClick={onReject} title="Reject" type="button">
              <X size={16} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      {firstDiagnostic ? (
        review && review.diagnostics.length + review.omittedDiagnostics > 1 ? (
          <details className="ontology-review__diagnostic">
            <summary>{firstDiagnostic.message}</summary>
            {review.diagnostics.slice(1).map((diagnostic) => <div key={`${diagnostic.code}:${diagnostic.message}`}>{diagnostic.message}</div>)}
            {review.omittedDiagnostics > 0 ? <div>{review.omittedDiagnostics} more</div> : null}
          </details>
        ) : <div className="ontology-review__diagnostic">{firstDiagnostic.message}</div>
      ) : null}
    </section>
  );
}

function activeIdentity(review: OntologyReviewState): string {
  if (review.active.state === "invalid-state") return "Active unavailable";
  if (review.active.state !== "active") return "Generic";
  return `${review.active.label ?? review.active.id ?? "Active"}${review.active.version ? ` · v${review.active.version}` : ""}`;
}

function pendingIdentity(review: OntologyReviewState): string {
  if (review.candidate.state === "absent") return "Generic";
  if (review.candidate.state === "invalid") return "Invalid candidate";
  return `${review.candidate.label ?? review.candidate.id ?? "Candidate"}${review.candidate.version ? ` · v${review.candidate.version}` : ""}`;
}

function signedCount(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
