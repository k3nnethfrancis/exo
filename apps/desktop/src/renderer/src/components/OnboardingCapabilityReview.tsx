import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  buildOnboardingCapabilitySections,
  buildOnboardingProfileReviews,
  onboardingCapabilityStatus,
  onboardingCapabilityTone,
} from "../onboardingCapabilities";

interface OnboardingCapabilityReviewProps {
  indexMode: string;
  notesFolder: string;
  onBack: () => void;
  onEnterWorkspace: () => void;
}

export function OnboardingCapabilityReview({
  indexMode,
  notesFolder,
  onBack,
  onEnterWorkspace,
}: OnboardingCapabilityReviewProps) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setErrorMessage(null);
    window.exo.workspace.listPluginInventory()
      .then((nextInventory) => {
        if (!cancelled) {
          setInventory(nextInventory);
          setLoadState("idle");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo(() => buildOnboardingCapabilitySections(inventory), [inventory]);

  return (
    <OnboardingCapabilityReviewContent
      errorMessage={errorMessage}
      indexMode={indexMode}
      inventory={inventory}
      loadState={loadState}
      notesFolder={notesFolder}
      onBack={onBack}
      onEnterWorkspace={onEnterWorkspace}
      sections={sections}
    />
  );
}

export function OnboardingCapabilityReviewContent({
  errorMessage,
  indexMode,
  inventory,
  loadState,
  notesFolder,
  onBack,
  onEnterWorkspace,
  sections,
}: {
  errorMessage: string | null;
  indexMode: string;
  inventory: PluginInventory | null;
  loadState: "loading" | "idle" | "error";
  notesFolder: string;
  onBack: () => void;
  onEnterWorkspace: () => void;
  sections: ReturnType<typeof buildOnboardingCapabilitySections>;
}) {
  const profileReviews = buildOnboardingProfileReviews(inventory);
  return (
    <>
      <h1 className="onboarding-card__title">Review capabilities</h1>
      <p className="onboarding-card__copy">
        This workspace starts with the Exograph core baseline. Official, local, and developer plugins are optional capability layers that can be managed later in Plugin Manager.
      </p>
      <div className="onboarding-review-summary" data-testid="onboarding-capability-summary">
        <div>
          <span>Workspace</span>
          <strong>{notesFolder}</strong>
        </div>
        <div>
          <span>Advanced search default</span>
          <strong>{indexMode === "off" ? "Core search only" : `QMD ${indexMode}`}</strong>
        </div>
        {inventory ? (
          <div>
            <span>Plugin layers</span>
            <strong>{inventory.counts.official} official, {inventory.counts.local + inventory.counts.developer} local</strong>
          </div>
        ) : null}
      </div>
      {loadState === "loading" ? <div className="dialog-card__status">Loading plugin inventory...</div> : null}
      {loadState === "error" ? (
        <div className="dialog-card__status dialog-card__status--warning">
          Plugin inventory is unavailable: {errorMessage}. You can continue with core defaults.
        </div>
      ) : null}
      {inventory && inventory.errors.length > 0 ? (
        <div className="dialog-card__status dialog-card__status--warning" data-testid="onboarding-capability-errors">
          Some local plugin manifests need review in Plugin Manager.
        </div>
      ) : null}
      {profileReviews.length > 0 ? (
        <section className="onboarding-section onboarding-section--summary" data-testid="onboarding-profile-apply-review">
          <div className="dialog-field__label">Profile plan preview</div>
          {profileReviews.map((review) => (
            <div className="onboarding-profile-review" key={review.id}>
              <div className="onboarding-capability-row__title">
                <span>{review.label}</span>
                <strong>{review.plan?.apply.label ?? "Review unavailable"}</strong>
              </div>
              <div className="onboarding-capability-row__description">
                {review.errorMessage
                  ? `Profile payload needs review: ${review.errorMessage}`
                  : review.plan
                    ? `${review.plan.summary.totalActions} recommendations, ${review.plan.summary.readyPluginRecommendations} ready plugins, ${review.plan.apply.blockedBy.length} apply blockers. No templates, skills, plugin enablement, or routines are applied during onboarding. ${review.plan.apply.reason}`
                    : `${review.status}. Profile payload is unavailable.`}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      <div className="onboarding-capability-sections" data-testid="onboarding-capability-review">
        {sections.map((section) => (
          <section className="onboarding-capability-section" data-testid={`onboarding-capability-section-${section.id}`} key={section.id}>
            <div className="onboarding-capability-section__header">
              <div>
                <div className="dialog-field__label">{section.label}</div>
                <div className="onboarding-section__hint">{section.id === "core" ? "Always available; not a plugin toggle." : "Optional plugin inventory; manage after entering the workspace."}</div>
              </div>
            </div>
            <div className="onboarding-capability-list">
              {section.rows.map((item) => <OnboardingCapabilityRow item={item} key={`${item.source}:${item.id}`} />)}
            </div>
          </section>
        ))}
        {sections.length === 0 && loadState !== "loading" ? (
          <div className="onboarding-section onboarding-section--summary">Core defaults are available. Plugin inventory can be reviewed later.</div>
        ) : null}
      </div>
      <div className="onboarding-card__actions">
        <button className="toolbar-button" onClick={onBack} type="button">
          Back
        </button>
        <button
          className="toolbar-button toolbar-button--primary"
          data-testid="onboarding-enter-workspace"
          onClick={onEnterWorkspace}
          type="button"
        >
          Enter workspace
        </button>
      </div>
    </>
  );
}

function OnboardingCapabilityRow({ item }: { item: PluginInventoryItem }) {
  const tone = onboardingCapabilityTone(item);
  const Icon = tone === "locked" ? LockKeyhole : tone === "warning" ? ShieldAlert : ShieldCheck;
  const dependencyDetail = item.dependencies?.length
    ? item.dependencies.map((dependency) => `${dependency.label}: ${dependency.statusLabel}`).join("; ")
    : null;

  return (
    <div className={`onboarding-capability-row onboarding-capability-row--${tone}`}>
      <Icon size={16} />
      <div className="onboarding-capability-row__body">
        <div className="onboarding-capability-row__title">
          <span>{item.label}</span>
          <strong>{onboardingCapabilityStatus(item)}</strong>
        </div>
        <div className="onboarding-capability-row__description">{dependencyDetail ?? item.description}</div>
      </div>
    </div>
  );
}
