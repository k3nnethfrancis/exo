import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { AgentInstructionConfig } from "../../../shared/api";

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

type OnboardingSetupStep = "plugins" | "instructions" | "routines" | "review";

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
  const [setupStep, setSetupStep] = useState<OnboardingSetupStep>("plugins");
  const [profileName, setProfileName] = useState("My Exograph");
  const [defaultHarnessId, setDefaultHarnessId] = useState<string | null>(null);
  const [agentInstructionConfig, setAgentInstructionConfig] = useState<AgentInstructionConfig | null>(null);
  const [contextBody, setContextBody] = useState("");
  const [agentInstructionStatus, setAgentInstructionStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [graphHealthEnabled, setGraphHealthEnabled] = useState(true);
  const [instructionSyncEnabled, setInstructionSyncEnabled] = useState(true);

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
  const selectedHarnesses = useMemo(() => {
    const rows = sections.flatMap((section) => section.rows);
    return rows.filter((item) => item.kind === "core:agentHarness" && (selectionOverrides[item.id] ?? onboardingCapabilitySelected(item)));
  }, [sections, selectionOverrides]);

  useEffect(() => {
    if (!defaultHarnessId && selectedHarnesses.length > 0) {
      setDefaultHarnessId(selectedHarnesses[0].id);
    }
    if (defaultHarnessId && selectedHarnesses.length > 0 && !selectedHarnesses.some((item) => item.id === defaultHarnessId)) {
      setDefaultHarnessId(selectedHarnesses[0].id);
    }
  }, [defaultHarnessId, selectedHarnesses]);

  useEffect(() => {
    if (setupStep !== "instructions" || agentInstructionConfig) {
      return;
    }
    let cancelled = false;
    setAgentInstructionStatus("loading");
    window.exo.workspace.getAgentInstructionConfig()
      .then((config) => {
        if (cancelled) return;
        setAgentInstructionConfig(config);
        setContextBody(config.exographContextTemplate);
        setAgentInstructionStatus("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setAgentInstructionStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [agentInstructionConfig, setupStep]);

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
      } else if (item.kind === "core:agentHarness" && item.source === "bundled") {
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

  async function applyExographContext() {
    setAgentInstructionStatus("saving");
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const config = await window.exo.workspace.applyGlobalExographContext({ body: contextBody });
      setAgentInstructionConfig(config);
      setActionMessage("Exograph context applied to global agent instruction files.");
      setAgentInstructionStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setAgentInstructionStatus("error");
    }
  }

  async function finishOnboarding() {
    setPendingPluginId("profile");
    setActionMessage(null);
    setErrorMessage(null);
    try {
      await window.exo.workspace.setActiveProfile({
        profileId: "exograph-baseline.profile",
        capabilityId: "exograph-baseline.profile",
        pluginId: "exograph-baseline.plugin",
        source: "built-in",
        label: profileName.trim() || "My Exograph",
      });
      onEnterWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
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
      onFinishOnboarding={() => void finishOnboarding()}
      onTogglePlugin={(item, enabled) => void setPluginEnabled(item, enabled)}
      onApplyExographContext={() => void applyExographContext()}
      pendingPluginId={pendingPluginId}
      profileName={profileName}
      setProfileName={setProfileName}
      setupStep={setupStep}
      setSetupStep={setSetupStep}
      selectedHarnesses={selectedHarnesses}
      defaultHarnessId={defaultHarnessId}
      setDefaultHarnessId={setDefaultHarnessId}
      agentInstructionConfig={agentInstructionConfig}
      agentInstructionStatus={agentInstructionStatus}
      contextBody={contextBody}
      setContextBody={setContextBody}
      graphHealthEnabled={graphHealthEnabled}
      setGraphHealthEnabled={setGraphHealthEnabled}
      instructionSyncEnabled={instructionSyncEnabled}
      setInstructionSyncEnabled={setInstructionSyncEnabled}
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
  onFinishOnboarding,
  onTogglePlugin,
  onApplyExographContext,
  pendingPluginId,
  profileName = "My Exograph",
  setProfileName,
  setupStep = "plugins",
  setSetupStep,
  selectedHarnesses = [],
  defaultHarnessId,
  setDefaultHarnessId,
  agentInstructionConfig = null,
  agentInstructionStatus = "idle",
  contextBody = "",
  setContextBody,
  graphHealthEnabled = true,
  setGraphHealthEnabled,
  instructionSyncEnabled = true,
  setInstructionSyncEnabled,
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
  onFinishOnboarding?: () => void;
  onTogglePlugin?: (item: PluginInventoryItem, enabled: boolean) => void;
  onApplyExographContext?: () => void;
  pendingPluginId?: string | null;
  profileName?: string;
  setProfileName?: (value: string) => void;
  setupStep?: OnboardingSetupStep;
  setSetupStep?: (value: OnboardingSetupStep) => void;
  selectedHarnesses?: PluginInventoryItem[];
  defaultHarnessId?: string | null;
  setDefaultHarnessId?: (value: string) => void;
  agentInstructionConfig?: AgentInstructionConfig | null;
  agentInstructionStatus?: "idle" | "loading" | "saving" | "error";
  contextBody?: string;
  setContextBody?: (value: string) => void;
  graphHealthEnabled?: boolean;
  setGraphHealthEnabled?: (value: boolean) => void;
  instructionSyncEnabled?: boolean;
  setInstructionSyncEnabled?: (value: boolean) => void;
  selectionOverrides?: Record<string, boolean>;
  sections: ReturnType<typeof buildOnboardingCapabilitySections>;
}) {
  const visibleChoiceCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const globalScope = agentInstructionConfig?.scopes.find((scope) => scope.id === "global") ?? null;
  const selectedHarness = selectedHarnesses.find((item) => item.id === defaultHarnessId) ?? selectedHarnesses[0] ?? null;
  return (
    <>
      <h1 className="onboarding-card__title">Set up your Exograph</h1>
      <p className="onboarding-card__copy">
        Choose plugins, agent context, and routine defaults. Core editing, files, terminal host, and preview are already on.
      </p>
      <div className="onboarding-stepper" aria-label="Setup steps">
        {[
          ["plugins", "Plugins"],
          ["instructions", "Agent context"],
          ["routines", "Routines"],
          ["review", "Review"],
        ].map(([id, label]) => (
          <button
            className={`onboarding-stepper__item${setupStep === id ? " onboarding-stepper__item--active" : ""}`}
            key={id}
            onClick={() => setSetupStep?.(id as OnboardingSetupStep)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
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
      {setupStep === "plugins" ? (
        <>
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
          {selectedHarnesses.length > 0 ? (
            <div className="onboarding-section">
              <label className="dialog-field__label" htmlFor="onboarding-default-harness">Default harness for routines</label>
              <select
                className="onboarding-select"
                id="onboarding-default-harness"
                onChange={(event) => setDefaultHarnessId?.(event.target.value)}
                value={defaultHarnessId ?? selectedHarnesses[0]?.id ?? ""}
              >
                {selectedHarnesses.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
              <div className="onboarding-section__hint">Used for setup routines such as instruction merge proposals and future graph maintenance.</div>
            </div>
          ) : null}
        </>
      ) : null}
      {setupStep === "instructions" ? (
        <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-agent-instructions">
          <div className="onboarding-capability-section__header">
            <div>
              <div className="dialog-field__label">Global agent instruction files</div>
              <div className="onboarding-section__hint">
                Exo keeps its context in a separate managed block so existing AGENTS.md and CLAUDE.md content stays readable.
              </div>
            </div>
          </div>
          {agentInstructionStatus === "loading" ? <div className="dialog-card__status">Loading global instruction files...</div> : null}
          {globalScope ? (
            <div className="onboarding-review-summary">
              <div>
                <span>Global files</span>
                <strong>{globalScope.status}</strong>
              </div>
              <div>
                <span>AGENTS.md</span>
                <strong>{globalScope.files.agents.exists ? "found" : "missing"}</strong>
              </div>
              <div>
                <span>CLAUDE.md</span>
                <strong>{globalScope.files.claude.exists ? "found" : "missing"}</strong>
              </div>
            </div>
          ) : null}
          <label className="dialog-field__label" htmlFor="onboarding-exograph-context">Exograph context to append</label>
          <textarea
            className="onboarding-textarea"
            id="onboarding-exograph-context"
            onChange={(event) => setContextBody?.(event.target.value)}
            value={contextBody}
          />
          <div className="onboarding-card__actions onboarding-card__actions--inline">
            <button
              className="toolbar-button"
              disabled={!onApplyExographContext || agentInstructionStatus === "saving"}
              onClick={onApplyExographContext}
              type="button"
            >
              {agentInstructionStatus === "saving" ? "Applying..." : "Apply Exograph context"}
            </button>
            {instructionSyncEnabled ? (
              <button
                className="toolbar-button"
                disabled={!selectedHarness}
                title="Creates a reviewable routine handoff for the default harness to propose an agent-agnostic merge of divergent global instruction files. It does not silently overwrite or symlink files."
                type="button"
              >
                Merge instruction files
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {setupStep === "routines" ? (
        <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-routines">
          <div className="dialog-field__label">Built-in routines</div>
          <label className="onboarding-routine-toggle">
            <input checked={graphHealthEnabled} onChange={(event) => setGraphHealthEnabled?.(event.target.checked)} type="checkbox" />
            <span>
              <strong>Graph health</strong>
              <small>Review orphaned notes, stale metadata, conflicts, and source coverage.</small>
            </span>
          </label>
          <label className="onboarding-routine-toggle">
            <input checked={instructionSyncEnabled} onChange={(event) => setInstructionSyncEnabled?.(event.target.checked)} type="checkbox" />
            <span>
              <strong>Agent instruction sync</strong>
              <small>Use the default harness to propose provider-agnostic merges when global instruction files diverge.</small>
            </span>
          </label>
        </section>
      ) : null}
      {setupStep === "review" ? (
        <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-profile-review">
          <label className="dialog-field__label" htmlFor="onboarding-profile-name">Workspace profile name</label>
          <input
            className="settings-input"
            id="onboarding-profile-name"
            onChange={(event) => setProfileName?.(event.target.value)}
            value={profileName}
          />
          <div className="onboarding-review-summary">
            <div>
              <span>Base profile</span>
              <strong>Exograph default</strong>
            </div>
            <div>
              <span>Default harness</span>
              <strong>{selectedHarness?.label ?? "None selected"}</strong>
            </div>
            <div>
              <span>Routines</span>
              <strong>{[graphHealthEnabled ? "graph health" : null, instructionSyncEnabled ? "instruction sync" : null].filter(Boolean).join(", ") || "none"}</strong>
            </div>
          </div>
          <div className="onboarding-deferred-note" data-testid="onboarding-profile-routine-note">
            This records your workspace profile selection. Profile templates, routine schedules, and file changes still require review before they modify local files.
          </div>
        </section>
      ) : null}
      <div className="onboarding-card__actions">
        <button
          className="toolbar-button"
          onClick={() => {
            if (setupStep === "review") {
              setSetupStep?.("routines");
            } else if (setupStep === "routines") {
              setSetupStep?.("instructions");
            } else if (setupStep === "instructions") {
              setSetupStep?.("plugins");
            } else {
              onBack();
            }
          }}
          type="button"
        >
          Back
        </button>
        <button
          className="toolbar-button toolbar-button--primary"
          data-testid="onboarding-enter-workspace"
          onClick={() => {
            if (setupStep === "plugins") {
              setSetupStep?.("instructions");
            } else if (setupStep === "instructions") {
              setSetupStep?.("routines");
            } else if (setupStep === "routines") {
              setSetupStep?.("review");
            } else {
              (onFinishOnboarding ?? onEnterWorkspace)();
            }
          }}
          type="button"
        >
          {setupStep === "review" ? "Enter workspace" : "Continue"}
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
