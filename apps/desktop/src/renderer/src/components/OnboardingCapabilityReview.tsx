import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import {
  buildOnboardingCapabilitySections,
  buildOnboardingProfileReviews,
  onboardingCapabilityStatus,
  onboardingCapabilityTone,
} from "../onboardingCapabilities";
import { pluginActionInput } from "../pluginManagerModel";

interface OnboardingCapabilityReviewProps {
  notesFolder: string;
  onBack: () => void;
  onEnterWorkspace: () => void;
}

export function OnboardingCapabilityReview({
  notesFolder,
  onBack,
  onEnterWorkspace,
}: OnboardingCapabilityReviewProps) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);

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

  async function setPluginEnabled(item: PluginInventoryItem, enabled: boolean) {
    const actionKey = item.pluginId ?? item.id;
    setPendingPluginId(actionKey);
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const input = pluginActionInput(item);
      const nextInventory = enabled
        ? await window.exo.workspace.enablePlugin(input)
        : await window.exo.workspace.disablePlugin(input);
      setInventory(nextInventory);
      setLoadState("idle");
      setActionMessage(`${item.pluginName ?? item.label} ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setLoadState("error");
    } finally {
      setPendingPluginId(null);
    }
  }

  return (
    <OnboardingCapabilityReviewContent
      actionMessage={actionMessage}
      errorMessage={errorMessage}
      inventory={inventory}
      loadState={loadState}
      notesFolder={notesFolder}
      onBack={onBack}
      onEnterWorkspace={onEnterWorkspace}
      onTogglePlugin={(item, enabled) => void setPluginEnabled(item, enabled)}
      pendingPluginId={pendingPluginId}
      sections={sections}
    />
  );
}

export function OnboardingCapabilityReviewContent({
  actionMessage,
  errorMessage,
  inventory,
  loadState,
  notesFolder,
  onBack,
  onEnterWorkspace,
  onTogglePlugin,
  pendingPluginId,
  sections,
}: {
  actionMessage?: string | null;
  errorMessage: string | null;
  inventory: PluginInventory | null;
  loadState: "loading" | "idle" | "error";
  notesFolder: string;
  onBack: () => void;
  onEnterWorkspace: () => void;
  onTogglePlugin?: (item: PluginInventoryItem, enabled: boolean) => void;
  pendingPluginId?: string | null;
  sections: ReturnType<typeof buildOnboardingCapabilitySections>;
}) {
  const profileReviews = buildOnboardingProfileReviews(inventory);
  return (
    <>
      <h1 className="onboarding-card__title">Set up your Exograph</h1>
      <p className="onboarding-card__copy">
        Your workspace is ready. Review the optional plugin layers Exo found; core Markdown, terminal, settings, and preview features are already available.
      </p>
      <div className="onboarding-review-summary" data-testid="onboarding-capability-summary">
        <div>
          <span>Workspace</span>
          <strong>{notesFolder}</strong>
        </div>
        {inventory ? (
          <div>
            <span>Optional plugins</span>
            <strong>{inventory.counts.official} official, {inventory.counts.local + inventory.counts.developer} local</strong>
          </div>
        ) : null}
      </div>
      {loadState === "loading" ? <div className="dialog-card__status">Loading plugin inventory...</div> : null}
      {actionMessage ? <div className="dialog-card__status dialog-card__status--success">{actionMessage}</div> : null}
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
                <div className="onboarding-section__hint">Bundled and local plugin inventory. Manage detailed settings later in Plugin Manager.</div>
              </div>
            </div>
            <div className="onboarding-capability-list">
              {section.rows.map((item) => (
                <OnboardingCapabilityRow
                  item={item}
                  key={`${item.source}:${item.id}`}
                  onTogglePlugin={onTogglePlugin}
                  pending={pendingPluginId === (item.pluginId ?? item.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && loadState !== "loading" ? (
          <div className="onboarding-section onboarding-section--summary">No optional plugins found. Core Exo features are available now.</div>
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
          Continue
        </button>
      </div>
    </>
  );
}

function OnboardingCapabilityRow({
  item,
  onTogglePlugin,
  pending,
}: {
  item: PluginInventoryItem;
  onTogglePlugin?: (item: PluginInventoryItem, enabled: boolean) => void;
  pending?: boolean;
}) {
  const tone = onboardingCapabilityTone(item);
  const Icon = tone === "warning" ? ShieldAlert : ShieldCheck;
  const dependencyDetail = item.dependencies?.length
    ? item.dependencies.map((dependency) => `${dependency.label}: ${dependency.statusLabel}`).join("; ")
    : null;
  const toggleDisabled = !onTogglePlugin || pending || item.trust === "untrusted";

  return (
    <div className={`onboarding-capability-row onboarding-capability-row--${tone}`}>
      <label className="onboarding-capability-toggle" title={toggleDisabled ? onboardingCapabilityStatus(item) : item.enabled ? "Disable this optional plugin" : "Enable this optional plugin"}>
        <input
          checked={item.enabled}
          data-testid={`onboarding-plugin-toggle-${item.id}`}
          disabled={toggleDisabled}
          onChange={(event) => onTogglePlugin?.(item, event.target.checked)}
          type="checkbox"
        />
      </label>
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
