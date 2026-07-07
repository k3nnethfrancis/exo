import { useEffect, useMemo, useState } from "react";
import type { OnboardingProfileStep, PluginInventory, PluginInventoryItem } from "@exo/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { AgentInstructionConfig, AgentInstructionProviderId, AgentInstructionScopeId } from "../../../shared/api";

import {
  buildOnboardingCapabilitySections,
  onboardingCapabilitySelectable,
  onboardingCapabilitySelected,
  onboardingCapabilityStatus,
  onboardingCapabilityTone,
} from "../onboardingCapabilities";
import { pluginActionInput } from "../pluginManagerModel";
import { AgentInstructionFilePreview } from "./AgentInstructionFilePreview";

const SETUP_STEP_ORDER: Array<[OnboardingSetupStep, string]> = [
  ["plugins", "Plugins"],
  ["routines", "Routines"],
  ["instructions", "Agent context"],
  ["skills", "Skills"],
  ["review", "Profile"],
];

const STANDARD_SKILL_ROWS = [
  {
    name: "Plugin development",
    detail: "Guidance for building Exo plugins without crossing core boundaries.",
  },
  {
    name: "Terminal stability",
    detail: "Rules for changing Exo terminal code without weakening persistence or rendering.",
  },
  {
    name: "Submit Exo issue",
    detail: "A contributor workflow for reporting bugs into the project issue process.",
  },
  {
    name: "Deslopify frontend",
    detail: "A UI cleanup checklist for setup, settings, and manager surfaces.",
  },
];

interface OnboardingCapabilityReviewProps {
  notesFolder: string;
  initialStep?: OnboardingProfileStep;
  onBack: () => void;
  onEnterWorkspace: () => void;
}

type OnboardingSetupStep = OnboardingProfileStep;

export function isAgentPromptRoutineHarness(item: PluginInventoryItem): boolean {
  return item.kind === "core:agentHarness" && item.id !== "shell";
}

export function OnboardingCapabilityReview({
  notesFolder,
  initialStep = "plugins",
  onBack,
  onEnterWorkspace,
}: OnboardingCapabilityReviewProps) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({});
  const [setupStep, setSetupStep] = useState<OnboardingSetupStep>(initialStep);
  const [profileName, setProfileName] = useState("My Exograph");
  const [defaultHarnessId, setDefaultHarnessId] = useState<string | null>(null);
  const [agentInstructionConfig, setAgentInstructionConfig] = useState<AgentInstructionConfig | null>(null);
  const [contextBody, setContextBody] = useState("");
  const [agentInstructionStatus, setAgentInstructionStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [agentInstructionMergeStatus, setAgentInstructionMergeStatus] = useState<"idle" | "merging" | "merged" | "error">("idle");
  const [agentInstructionMergeMessage, setAgentInstructionMergeMessage] = useState<string | null>(null);
  const [exographContextApplied, setExographContextApplied] = useState(false);
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

  useEffect(() => {
    void window.exo.workspace.markOnboardingProfileStep({ step: setupStep }).catch((error) => {
      console.error("[exo] failed to persist onboarding profile step", error);
    });
  }, [setupStep]);

  const sections = useMemo(() => buildOnboardingCapabilitySections(inventory), [inventory]);
  const selectedHarnesses = useMemo(() => {
    const rows = sections.flatMap((section) => section.rows);
    return rows.filter((item) =>
      item.kind === "core:agentHarness" && (selectionOverrides[item.id] ?? onboardingCapabilitySelected(item))
    );
  }, [sections, selectionOverrides]);
  const selectedRoutineHarnesses = useMemo(() => selectedHarnesses.filter(isAgentPromptRoutineHarness), [selectedHarnesses]);

  useEffect(() => {
    if (!defaultHarnessId && selectedRoutineHarnesses.length > 0) {
      setDefaultHarnessId(selectedRoutineHarnesses[0].id);
    }
    if (defaultHarnessId && selectedRoutineHarnesses.length > 0 && !selectedRoutineHarnesses.some((item) => item.id === defaultHarnessId)) {
      setDefaultHarnessId(selectedRoutineHarnesses[0].id);
    }
  }, [defaultHarnessId, selectedRoutineHarnesses]);

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
    setAgentInstructionMergeStatus("idle");
    setAgentInstructionMergeMessage(null);
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const config = await window.exo.workspace.applyGlobalExographContext({ body: contextBody });
      setAgentInstructionConfig(config);
      setExographContextApplied(true);
      setActionMessage("Exograph context applied to global agent instruction files.");
      setAgentInstructionStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setAgentInstructionStatus("error");
    }
  }

  async function mergeAgentInstructionFiles(input: { scopeId: AgentInstructionScopeId; sourceProviderId: AgentInstructionProviderId }) {
    setAgentInstructionMergeStatus("merging");
    setAgentInstructionMergeMessage("Merging instruction files...");
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const config = await window.exo.workspace.mergeAgentInstructionFiles(input);
      const scope = config.scopes.find((entry) => entry.id === input.scopeId);
      const sourceFile = scope?.files[input.sourceProviderId];
      setAgentInstructionConfig(config);
      setAgentInstructionMergeStatus("merged");
      setAgentInstructionMergeMessage(`Merged ${scope?.label ?? "scope"} from ${sourceFile?.label ?? input.sourceProviderId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentInstructionMergeStatus("error");
      setAgentInstructionMergeMessage(message);
      setErrorMessage(message);
    }
  }

  async function finishOnboarding() {
    setPendingPluginId("profile");
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const selectedDefaultHarnessId = selectedRoutineHarnesses.find((item) => item.id === defaultHarnessId)?.id
        ?? selectedRoutineHarnesses[0]?.id;
      await window.exo.workspace.setActiveProfile({
        profileId: "exograph-baseline.profile",
        capabilityId: "exograph-baseline.profile",
        pluginId: "exograph-baseline.plugin",
        source: "built-in",
        label: profileName.trim() || "My Exograph",
        setup: {
          enabledHarnessIds: selectedHarnesses.map((item) => item.id),
          defaultHarnessId: selectedDefaultHarnessId,
          routineTemplateIds: selectedDefaultHarnessId ? [
            graphHealthEnabled ? "graph-health.template" : null,
            instructionSyncEnabled ? "agent-instruction-sync.template" : null,
          ].filter((id): id is string => Boolean(id)) : [],
          exographContextApplied,
        },
      });
      await window.exo.workspace.markOnboardingComplete();
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
      onMergeAgentInstructionFiles={(input) => void mergeAgentInstructionFiles(input)}
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
      agentInstructionMergeStatus={agentInstructionMergeStatus}
      agentInstructionMergeMessage={agentInstructionMergeMessage}
      contextBody={contextBody}
      setContextBody={setContextBody}
      exographContextApplied={exographContextApplied}
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
  onMergeAgentInstructionFiles,
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
  agentInstructionMergeStatus = "idle",
  agentInstructionMergeMessage = null,
  contextBody = "",
  setContextBody,
  exographContextApplied = false,
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
  onMergeAgentInstructionFiles?: (input: { scopeId: AgentInstructionScopeId; sourceProviderId: AgentInstructionProviderId }) => void;
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
  agentInstructionMergeStatus?: "idle" | "merging" | "merged" | "error";
  agentInstructionMergeMessage?: string | null;
  contextBody?: string;
  setContextBody?: (value: string) => void;
  exographContextApplied?: boolean;
  graphHealthEnabled?: boolean;
  setGraphHealthEnabled?: (value: boolean) => void;
  instructionSyncEnabled?: boolean;
  setInstructionSyncEnabled?: (value: boolean) => void;
  selectionOverrides?: Record<string, boolean>;
  sections: ReturnType<typeof buildOnboardingCapabilitySections>;
}) {
  const visibleChoiceCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const routineHarnesses = selectedHarnesses.filter(isAgentPromptRoutineHarness);
  const [selectedInstructionScopeId, setSelectedInstructionScopeId] = useState<AgentInstructionScopeId>("global");
  const [selectedInstructionProviderId, setSelectedInstructionProviderId] = useState<AgentInstructionProviderId>("agents");
  const selectedInstructionScope = agentInstructionConfig?.scopes.find((scope) => scope.id === selectedInstructionScopeId)
    ?? agentInstructionConfig?.scopes[0]
    ?? null;
  const selectedInstructionFile = selectedInstructionScope?.files[selectedInstructionProviderId] ?? selectedInstructionScope?.files.agents ?? null;
  const selectedInstructionMergeSourceReady = Boolean(
    selectedInstructionFile?.exists
      && selectedInstructionFile.body.trim()
      && !selectedInstructionFile.errorMessage
      && agentInstructionMergeStatus !== "merging"
      && agentInstructionStatus !== "saving",
  );
  const selectedHarness = routineHarnesses.find((item) => item.id === defaultHarnessId) ?? routineHarnesses[0] ?? null;
  const selectedCapabilityRows = sections
    .flatMap((section) => section.rows)
    .filter((item) => selectionOverrides[item.id] ?? onboardingCapabilitySelected(item));
  const selectedSearchProviders = selectedCapabilityRows.filter((item) => item.kind === "core:searchProvider");
  const selectedRoutineLabels = [
    selectedHarness && graphHealthEnabled ? "Graph health" : null,
    selectedHarness && instructionSyncEnabled ? "Agent instruction sync" : null,
  ].filter((label): label is string => Boolean(label));
  const selectedHarnessLabels = selectedHarnesses.map((item) => item.label).join(", ");
  const profileConfigPreview = JSON.stringify({
    profile: {
      name: profileName.trim() || "My Exograph",
      baseProfile: "exograph-baseline.profile",
    },
    selections: {
      searchProviders: selectedSearchProviders.map((item) => item.id),
      enabledHarnesses: selectedHarnesses.map((item) => item.id),
      defaultHarnessId: selectedHarness?.id ?? null,
      routineTemplateIds: [
        selectedHarness && graphHealthEnabled ? "graph-health.template" : null,
        selectedHarness && instructionSyncEnabled ? "agent-instruction-sync.template" : null,
      ].filter(Boolean),
      agentContext: exographContextApplied ? "applied-to-global-instructions" : "not-applied",
      skills: {
        status: "pending-agent-config-review",
        recommended: STANDARD_SKILL_ROWS.map((skill) => skill.name),
      },
      surfaces: {
        cli: "not-configured-pending-future-policy",
        mcp: "not-configured-pending-future-policy",
      },
    },
    submitEffect: [
      "save active profile selection",
      "save onboarding choices",
      "mark onboarding complete",
    ],
    deferredEffects: [
      "install or move skill folders",
      "enable profile templates",
      "schedule routines",
      "write MCP or CLI exposure policy",
      "grant plugin permissions",
    ],
  }, null, 2);
  const setupStepIndex = SETUP_STEP_ORDER.findIndex(([id]) => id === setupStep);
  const previousStep = setupStepIndex > 0 ? SETUP_STEP_ORDER[setupStepIndex - 1]?.[0] : null;
  const nextStep = setupStepIndex >= 0 && setupStepIndex < SETUP_STEP_ORDER.length - 1
    ? SETUP_STEP_ORDER[setupStepIndex + 1]?.[0]
    : null;
  return (
    <>
      <div className="onboarding-card__body" data-testid="onboarding-card-body">
        <h1 className="onboarding-card__title">Set up your Exograph</h1>
        <p className="onboarding-card__copy">
          Choose optional plugins, starter routines, agent context, and a workspace profile. Core editing, files, terminal host, and preview are already on.
        </p>
        <div className="onboarding-stepper" aria-label="Setup steps">
          {SETUP_STEP_ORDER.map(([id, label]) => (
            <button
              className={`onboarding-stepper__item${setupStep === id ? " onboarding-stepper__item--active" : ""}`}
              key={id}
              onClick={() => setSetupStep?.(id)}
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
          </>
        ) : null}
        {setupStep === "routines" ? (
          <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-routines">
            <div className="onboarding-capability-section__header">
              <div>
                <div className="dialog-field__label">Starter routine templates</div>
                <div className="onboarding-section__hint">
                  These are manual templates saved with your profile. They do not run on a schedule or change files during setup.
                </div>
              </div>
            </div>
            {routineHarnesses.length > 0 ? (
              <div className="onboarding-routine-harness">
                <label className="dialog-field__label" htmlFor="onboarding-routine-harness">Default harness</label>
                <select
                  className="onboarding-select"
                  id="onboarding-routine-harness"
                  onChange={(event) => setDefaultHarnessId?.(event.target.value)}
                  value={defaultHarnessId ?? routineHarnesses[0]?.id ?? ""}
                >
                  {routineHarnesses.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="dialog-card__status dialog-card__status--warning">
                Select a launchable harness before enabling agent-backed routines.
              </div>
            )}
            <label className="onboarding-routine-toggle">
              <input checked={Boolean(selectedHarness) && graphHealthEnabled} disabled={!selectedHarness} onChange={(event) => setGraphHealthEnabled?.(event.target.checked)} type="checkbox" />
              <span>
                <strong>Graph health</strong>
                <small>Manual audit template for orphaned notes, unresolved links, stale markers, and missing source context. Outputs a reviewable report/artifact.</small>
              </span>
            </label>
            <label className="onboarding-routine-toggle">
              <input checked={Boolean(selectedHarness) && instructionSyncEnabled} disabled={!selectedHarness} onChange={(event) => setInstructionSyncEnabled?.(event.target.checked)} type="checkbox" />
              <span>
                <strong>Agent instruction sync</strong>
                <small>Manual proposal template for merging AGENTS.md and CLAUDE.md into agent-agnostic instructions. No silent overwrites.</small>
              </span>
            </label>
          </section>
        ) : null}
        {setupStep === "instructions" ? (
          <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-agent-instructions">
            <div className="onboarding-capability-section__header">
              <div>
                <div className="dialog-field__label">Agent instruction files</div>
                <div className="onboarding-section__hint">
                  Exo keeps its context in a separate managed block so existing AGENTS.md and CLAUDE.md content stays readable.
                </div>
              </div>
            </div>
            {agentInstructionStatus === "loading" ? <div className="dialog-card__status">Loading global instruction files...</div> : null}
            {agentInstructionConfig ? (
              <AgentInstructionFilePreview
                onSelectProvider={setSelectedInstructionProviderId}
                onSelectScope={setSelectedInstructionScopeId}
                scopes={agentInstructionConfig.scopes}
                selectedProviderId={selectedInstructionProviderId}
                selectedScopeId={selectedInstructionScope?.id ?? "global"}
              />
            ) : null}
            {agentInstructionMergeMessage ? (
              <div
                className={`dialog-card__status${agentInstructionMergeStatus === "error" ? " dialog-card__status--error" : agentInstructionMergeStatus === "merged" ? " dialog-card__status--success" : ""}`}
                data-testid="onboarding-agent-instruction-merge-status"
              >
                {agentInstructionMergeMessage}
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
                onClick={() => {
                  setSelectedInstructionScopeId("global");
                  setSelectedInstructionProviderId("agents");
                  onApplyExographContext?.();
                }}
                type="button"
              >
                {agentInstructionStatus === "saving" ? "Applying..." : "Apply Exograph context"}
              </button>
              {instructionSyncEnabled ? (
                <button
                  className="toolbar-button"
                  data-testid="onboarding-agent-instruction-merge"
                  disabled={!onMergeAgentInstructionFiles || !selectedInstructionScope || !selectedInstructionMergeSourceReady}
                  onClick={() => selectedInstructionScope ? onMergeAgentInstructionFiles?.({
                    scopeId: selectedInstructionScope.id,
                    sourceProviderId: selectedInstructionFile?.id ?? "agents",
                  }) : undefined}
                  title={selectedInstructionMergeSourceReady ? "Write the selected visible instruction file to both AGENTS.md and CLAUDE.md for this scope." : "Select an existing non-empty instruction file to merge from."}
                  type="button"
                >
                  {agentInstructionMergeStatus === "merging" ? "Merging..." : "Merge instruction files"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {setupStep === "skills" ? (
          <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-skills">
            <div className="onboarding-capability-section__header">
              <div>
                <div className="dialog-field__label">Skills review</div>
                <div className="onboarding-section__hint">
                  Onboarding records recommendations only. Skill folders are reviewed and applied in Agent Config.
                </div>
              </div>
            </div>
            <div className="onboarding-review-summary">
              <div>
                <span>Selected harnesses</span>
                <strong>{selectedHarnessLabels || "None selected"}</strong>
              </div>
              <div>
                <span>Default harness</span>
                <strong>{selectedHarness?.label ?? "None selected"}</strong>
              </div>
              <div>
                <span>Apply path</span>
                <strong>Agent Config</strong>
              </div>
            </div>
            <div className="onboarding-skill-list">
              {STANDARD_SKILL_ROWS.map((skill) => (
                <div className="onboarding-skill-row" key={skill.name}>
                  <div className="onboarding-skill-row__title">
                    <strong>{skill.name}</strong>
                    <span>Pending review</span>
                  </div>
                  <span>{skill.detail}</span>
                  <small>Applies after setup through Agent Config for selected harnesses.</small>
                </div>
              ))}
            </div>
            <div className="onboarding-card__actions onboarding-card__actions--inline">
              <button
                className="toolbar-button"
                disabled
                title="Enter the workspace, then open Agent Config to inspect, enable, disable, sync, or install skills."
                type="button"
              >
                Review/apply in Agent Config
              </button>
            </div>
            <div className="onboarding-deferred-note">
              This setup will not install, enable, disable, move, or sync skill folders.
            </div>
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
                <span>Profile name</span>
                <strong>{profileName.trim() || "My Exograph"}</strong>
              </div>
              <div>
                <span>Base profile</span>
                <strong>Exograph default</strong>
              </div>
              <div>
                <span>Search</span>
                <strong>{selectedSearchProviders.map((item) => item.label).join(", ") || "Basic file search only"}</strong>
              </div>
              <div>
                <span>Harnesses</span>
                <strong>{selectedHarnessLabels || "None selected"}</strong>
              </div>
              <div>
                <span>Default harness</span>
                <strong>{selectedHarness?.label ?? "None selected"}</strong>
              </div>
              <div>
                <span>Routines</span>
                <strong>{selectedRoutineLabels.join(", ") || "None selected"}</strong>
              </div>
              <div>
                <span>Agent context</span>
                <strong>{exographContextApplied ? "Applied" : "Not applied"}</strong>
              </div>
              <div>
                <span>Skills</span>
                <strong>Review-only; Agent Config applies</strong>
              </div>
              <div>
                <span>CLI / MCP exposure</span>
                <strong>Not configured</strong>
              </div>
            </div>
            <label className="dialog-field__label" htmlFor="onboarding-profile-config-preview">Resolved profile config preview</label>
            <textarea
              className="onboarding-textarea onboarding-config-preview"
              id="onboarding-profile-config-preview"
              readOnly
              value={profileConfigPreview}
            />
            <div className="onboarding-deferred-note" data-testid="onboarding-profile-routine-note">
              Enter workspace saves this profile state and onboarding completion only. File templates, skill folders, routine schedules, MCP/CLI exposure, plugin settings, and permission grants require separate review.
            </div>
          </section>
        ) : null}
      </div>
      <div className="onboarding-card__actions">
        <button
          className="toolbar-button"
          onClick={() => {
            if (previousStep) {
              setSetupStep?.(previousStep);
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
            if (nextStep) {
              setSetupStep?.(nextStep);
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
