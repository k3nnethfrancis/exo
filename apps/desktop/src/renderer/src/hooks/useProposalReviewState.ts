import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProposalApplyResult, ProposalBatch, ProposalDecision } from "@exo/core";

type LoadState = "loading" | "idle" | "error";

export interface ProposalDecisionState {
  proposalId: string;
  itemId?: string;
  decision: ProposalDecision;
}

export function useProposalReviewState() {
  const [proposals, setProposals] = useState<ProposalBatch[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalBatch | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [decisionState, setDecisionState] = useState<ProposalDecisionState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastApplyResult, setLastApplyResult] = useState<ProposalApplyResult | null>(null);

  const pendingProposalCount = useMemo(
    () => proposals.filter((proposal) => proposal.items.some((item) => item.itemStatus === "pending")).length,
    [proposals],
  );

  const refreshProposals = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const nextProposals = await window.exo.workspace.listProposals();
      setProposals(nextProposals);
      setLoadState("idle");
      setSelectedProposalId((current) => current ?? nextProposals.find((proposal) => proposal.items.some((item) => item.itemStatus === "pending"))?.id ?? nextProposals[0]?.id ?? null);
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const selectProposal = useCallback((id: string | null) => {
    setSelectedProposalId(id);
  }, []);

  const decideProposal = useCallback(async (proposalId: string, decision: ProposalDecision, itemId?: string) => {
    setDecisionState({ proposalId, itemId, decision });
    setErrorMessage(null);
    try {
      const result = await window.exo.workspace.decideProposal(proposalId, itemId ? { decision, itemId } : { decision });
      setLastApplyResult(result);
      const nextProposals = await window.exo.workspace.listProposals();
      setProposals(nextProposals);
      setSelectedProposalId(proposalId);
      setSelectedProposal(result.proposal);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDecisionState(null);
      setLoadState("idle");
    }
  }, []);

  useEffect(() => {
    void refreshProposals();
  }, [refreshProposals]);

  useEffect(() => {
    function handleProposalsChanged() {
      void refreshProposals();
    }
    window.addEventListener("exo:proposals-changed", handleProposalsChanged);
    return () => {
      window.removeEventListener("exo:proposals-changed", handleProposalsChanged);
    };
  }, [refreshProposals]);

  useEffect(() => {
    if (!selectedProposalId) {
      setSelectedProposal(null);
      return;
    }
    let cancelled = false;
    window.exo.workspace.readProposal(selectedProposalId)
      .then((proposal) => {
        if (!cancelled) {
          setSelectedProposal(proposal);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProposalId]);

  return {
    proposals,
    selectedProposalId,
    selectedProposal,
    loadState,
    decisionState,
    errorMessage,
    lastApplyResult,
    pendingProposalCount,
    refreshProposals,
    selectProposal,
    acceptProposal: (proposalId: string) => decideProposal(proposalId, "accept"),
    rejectProposal: (proposalId: string) => decideProposal(proposalId, "reject"),
    acceptItem: (proposalId: string, itemId: string) => decideProposal(proposalId, "accept", itemId),
    rejectItem: (proposalId: string, itemId: string) => decideProposal(proposalId, "reject", itemId),
    clearLastApplyResult: () => setLastApplyResult(null),
  };
}
