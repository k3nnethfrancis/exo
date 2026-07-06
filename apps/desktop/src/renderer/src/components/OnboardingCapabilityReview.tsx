import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import {
  buildOnboardingCapabilitySections,
  onboardingCapabilitySelectable,
  onboardingCapabilitySelected,
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
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({});

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
      if (item.kind === "core:searchProvider" && item.id === "qmd" && item.source === "bundled") {
        const settings = await window.exo.workspace.getSettings();
        const mode = enabled
          ? settings.indexing.mode === "off"
            ? "hybrid"
            : settings.indexing.mode
          : "off";
        await window.exo.workspace.saveSettings({
          ...settings,
          indexing: { ...settings.indexing, enabled, mode, backend: "qmd" },
        });
        setSelectionOverrides((current) => ({ ...current, [item.id]: enabled }));
      } else {
        const input = pluginActionInput(item);
        const nextInventory = enabled
          ? await window.exo.workspace.enablePlugin(input)
          : await window.exo.workspace.disablePlugin(input);
        setInventory(nextInventory);
      }
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
      selectionOverrides={selectionOverrides}
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
  selectionOverrides = {},
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
  selectionOverrides?: Record<string, boolean>;
  sections: ReturnType<typeof buildOnboardingCapabilitySections>;
}) {
  const visibleChoiceCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  return (
    <>
      <h1 className="onboarding-card__title">Set up your Exograph</h1>
      <p className="onboarding-card__copy">
        Choose the optional plugins to start with. Core editing, files, terminal host, and preview are already on.
      </p>
      <div className="onboarding-review-summary" data-testid="onboarding-capability-summary">
        <div>
          <span>Workspace</span>
          <strong>{notesFolder}</strong>
        </div>
        {inventory ? (
          <div>
            <span>Setup choices</span>
            <strong>{visibleChoiceCount} detected</strong>
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
      <div className="onboarding-capability-sections" data-testid="onboarding-capability-review">
        {sections.map((section) => (
          <section className="onboarding-capability-section" data-testid={`onboarding-capability-section-${section.id}`} key={section.id}>
            <div className="onboarding-capability-section__header">
              <div>
                <div className="dialog-field__label">{section.label}</div>
                <div className="onboarding-section__hint">{section.id === "core:searchProvider" ? "Advanced search is optional; basic file search always works." : "Only detected, launchable harnesses start selected."}</div>
              </div>
            </div>
            <div className="onboarding-capability-list">
              {section.rows.map((item) => (
                <OnboardingCapabilityRow
                  item={item}
                  key={`${item.source}:${item.id}`}
                  onTogglePlugin={onTogglePlugin}
                  pending={pendingPluginId === (item.pluginId ?? item.id)}
                  selectedOverride={selectionOverrides[item.id]}
                />
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && loadState !== "loading" ? (
          <div className="onboarding-section onboarding-section--summary">No optional plugins found. Core Exo features are available now.</div>
        ) : null}
      </div>
      <div className="onboarding-deferred-note" data-testid="onboarding-profile-routine-note">
        Profiles and routines are configured later in Settings. They never override manual plugin choices without review.
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
  selectedOverride,
}: {
  item: PluginInventoryItem;
  onTogglePlugin?: (item: PluginInventoryItem, enabled: boolean) => void;
  pending?: boolean;
  selectedOverride?: boolean;
}) {
  const tone = onboardingCapabilityTone(item);
  const Icon = tone === "warning" ? ShieldAlert : ShieldCheck;
  const dependencyDetail = item.dependencies?.length
    ? item.dependencies.map((dependency) => `${dependency.label}: ${dependency.statusLabel}`).join("; ")
    : null;
  const selected = selectedOverride ?? onboardingCapabilitySelected(item);
  const selectable = onboardingCapabilitySelectable(item);
  const toggleDisabled = !onTogglePlugin || pending || !selectable;
  const description = dependencyDetail ?? (item.kind === "core:agentHarness" && !selected ? item.statusLabel : item.description);

  return (
    <div className={`onboarding-capability-row onboarding-capability-row--${tone}`}>
      <label className="onboarding-capability-toggle" title={toggleDisabled ? onboardingCapabilityStatus(item) : item.enabled ? "Disable this optional plugin" : "Enable this optional plugin"}>
        <input
          checked={selected}
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
        <div className="onboarding-capability-row__description">{description}</div>
      </div>
    </div>
  );
}
