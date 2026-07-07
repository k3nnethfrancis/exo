import { useEffect, useMemo, useState } from "react";
import type { OnboardingProfileStep, PluginInventory, PluginInventoryItem } from "@exo/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { AgentInstructionConfig, AgentSkillHarnessId, AgentSkillInventory } from "../../../shared/api";

import {
  buildOnboardingCapabilitySections,
  onboardingCapabilitySelectable,
  onboardingCapabilitySelected,
  onboardingCapabilityStatus,
  onboardingCapabilityTone,
} from "../onboardingCapabilities";
import { pluginActionInput } from "../pluginManagerModel";

const SETUP_STEP_ORDER: Array<[OnboardingSetupStep, string]> = [
  ["plugins", "Plugins"],
  ["routines", "Routines"],
  ["instructions", "Agent context"],
  ["skills", "Skills"],
  ["review", "Profile"],
];

const STANDARD_SKILL_ROWS = [
  {
    id: "plugin-development",
    name: "Plugin development",
    detail: "Guidance for building Exo plugins without crossing core boundaries.",
  },
  {
    id: "terminal-stability",
    name: "Terminal stability",
    detail: "Rules for changing Exo terminal code without weakening persistence or rendering.",
  },
  {
    id: "submit-exo-issue",
    name: "Submit Exo issue",
    detail: "A contributor workflow for reporting bugs into the project issue process.",
  },
  {
    id: "deslopify-frontend",
    name: "Deslopify frontend",
    detail: "A UI cleanup checklist for setup, settings, and manager surfaces.",
  },
];

const STANDARD_SKILL_SOURCE_ID = "exo-standard";

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
  const [exographContextApplied, setExographContextApplied] = useState(false);
  const [graphHealthEnabled, setGraphHealthEnabled] = useState(true);
  const [instructionSyncEnabled, setInstructionSyncEnabled] = useState(true);
  const [skillInventory, setSkillInventory] = useState<AgentSkillInventory | null>(null);
  const [standardSkillsEnabled, setStandardSkillsEnabled] = useState(true);
  const [skillApplyState, setSkillApplyState] = useState<"idle" | "loading" | "applying" | "applied" | "error">("idle");
  const [skillApplyMessage, setSkillApplyMessage] = useState<string | null>(null);

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

  useEffect(() => {
    if (setupStep !== "skills" || skillInventory || skillApplyState === "loading") {
      return;
    }
    let cancelled = false;
    setSkillApplyState("loading");
    setSkillApplyMessage(null);
    window.exo.workspace.listAgentSkills()
      .then((inventory) => {
        if (cancelled) return;
        setSkillInventory(inventory);
        setSkillApplyState("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setSkillApplyMessage(error instanceof Error ? error.message : String(error));
        setSkillApplyState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [setupStep, skillApplyState, skillInventory]);

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
      setExographContextApplied(true);
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

  async function applyStandardSkills() {
    setSkillApplyState("applying");
    setSkillApplyMessage(null);
    setErrorMessage(null);
    try {
      const summary = await applyStandardSkillSelection({
        enabled: standardSkillsEnabled,
        inventory: skillInventory ?? await window.exo.workspace.listAgentSkills(),
        selectedHarnesses,
      });
      setSkillInventory(summary.inventory);
      setSkillApplyState("applied");
      setSkillApplyMessage(summary.message);
    } catch (error) {
      setSkillApplyState("error");
      setSkillApplyMessage(error instanceof Error ? error.message : String(error));
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
      exographContextApplied={exographContextApplied}
      graphHealthEnabled={graphHealthEnabled}
      setGraphHealthEnabled={setGraphHealthEnabled}
      instructionSyncEnabled={instructionSyncEnabled}
      setInstructionSyncEnabled={setInstructionSyncEnabled}
      skillApplyMessage={skillApplyMessage}
      skillApplyState={skillApplyState}
      skillInventory={skillInventory}
      standardSkillsEnabled={standardSkillsEnabled}
      setStandardSkillsEnabled={setStandardSkillsEnabled}
      onApplyStandardSkills={() => void applyStandardSkills()}
      selectionOverrides={selectionOverrides}
      sections={sections}
    />
  );
}

async function applyStandardSkillSelection({
  enabled,
  inventory,
  selectedHarnesses,
}: {
  enabled: boolean;
  inventory: AgentSkillInventory;
  selectedHarnesses: PluginInventoryItem[];
}): Promise<{ inventory: AgentSkillInventory; message: string }> {
  let nextInventory = inventory;
  const targetHarnesses = selectedHarnesses.map(standardSkillHarnessId).filter((id): id is AgentSkillHarnessId => Boolean(id));
  const targetLocations = nextInventory.locations.filter((location) =>
    location.enabled && location.scope === "workspace" && targetHarnesses.includes(location.harness)
  );
  if (targetLocations.length === 0) {
    return { inventory: nextInventory, message: "Select a Claude or Codex harness before applying standard skills." };
  }

  const librarySkills = STANDARD_SKILL_ROWS.map((row) =>
    nextInventory.librarySkills.find((skill) => skill.sourceId === STANDARD_SKILL_SOURCE_ID && skill.name === row.id),
  );
  const availableLibrarySkills = librarySkills.filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  if (enabled && availableLibrarySkills.length === 0) {
    return { inventory: nextInventory, message: "Exo standard skill library is unavailable in this build." };
  }

  let installed = 0;
  let enabledCount = 0;
  let disabled = 0;
  let already = 0;

  for (const location of targetLocations) {
    for (const row of STANDARD_SKILL_ROWS) {
      const existing = nextInventory.skills.find((skill) =>
        skill.name === row.id && skill.harness === location.harness && skill.scope === location.scope
      );
      if (enabled) {
        if (existing?.enabled) {
          already += 1;
          continue;
        }
        if (existing && !existing.enabled) {
          nextInventory = await window.exo.workspace.setAgentSkillEnabled({ skillId: existing.id, enabled: true });
          enabledCount += 1;
          continue;
        }
        const librarySkill = nextInventory.librarySkills.find((skill) => skill.sourceId === STANDARD_SKILL_SOURCE_ID && skill.name === row.id);
        if (!librarySkill) {
          continue;
        }
        nextInventory = await window.exo.workspace.installAgentLibrarySkill({
          librarySkillId: librarySkill.id,
          locationId: location.id,
        });
        installed += 1;
      } else if (existing?.enabled) {
        nextInventory = await window.exo.workspace.setAgentSkillEnabled({ skillId: existing.id, enabled: false });
        disabled += 1;
      } else if (existing) {
        already += 1;
      }
    }
  }

  const targetLabels = targetLocations.map((location) => location.label).join(", ");
  const message = enabled
    ? `Standard skills applied to ${targetLabels}: ${installed} installed, ${enabledCount} enabled, ${already} already active.`
    : `Standard skills disabled for ${targetLabels}: ${disabled} disabled, ${already} already inactive.`;
  return { inventory: nextInventory, message };
}

function standardSkillHarnessId(item: PluginInventoryItem): AgentSkillHarnessId | null {
  if (item.kind !== "core:agentHarness") {
    return null;
  }
  if (item.id === "claude" || item.id === "codex") {
    return item.id;
  }
  return null;
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
  exographContextApplied = false,
  graphHealthEnabled = true,
  setGraphHealthEnabled,
  instructionSyncEnabled = true,
  setInstructionSyncEnabled,
  skillApplyMessage,
  skillApplyState = "idle",
  skillInventory = null,
  standardSkillsEnabled = true,
  setStandardSkillsEnabled,
  onApplyStandardSkills,
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
  exographContextApplied?: boolean;
  graphHealthEnabled?: boolean;
  setGraphHealthEnabled?: (value: boolean) => void;
  instructionSyncEnabled?: boolean;
  setInstructionSyncEnabled?: (value: boolean) => void;
  skillApplyMessage?: string | null;
  skillApplyState?: "idle" | "loading" | "applying" | "applied" | "error";
  skillInventory?: AgentSkillInventory | null;
  standardSkillsEnabled?: boolean;
  setStandardSkillsEnabled?: (value: boolean) => void;
  onApplyStandardSkills?: () => void;
  selectionOverrides?: Record<string, boolean>;
  sections: ReturnType<typeof buildOnboardingCapabilitySections>;
}) {
  const visibleChoiceCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const routineHarnesses = selectedHarnesses.filter(isAgentPromptRoutineHarness);
  const globalScope = agentInstructionConfig?.scopes.find((scope) => scope.id === "global") ?? null;
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
        status: standardSkillsEnabled ? "standard-skills-enabled-for-selected-harnesses" : "standard-skills-disabled-for-selected-harnesses",
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
  const skillHarnessLabels = selectedHarnesses.filter((item) => standardSkillHarnessId(item)).map((item) => item.label).join(", ");
  const standardSkillLibraryAvailable = Boolean(skillInventory?.librarySkills.some((skill) => skill.sourceId === STANDARD_SKILL_SOURCE_ID));
  const standardSkillActionDisabled = !onApplyStandardSkills
    || skillApplyState === "loading"
    || skillApplyState === "applying"
    || !skillHarnessLabels
    || (standardSkillsEnabled && !standardSkillLibraryAvailable);
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
        {setupStep === "skills" ? (
          <section className="onboarding-section onboarding-section--primary" data-testid="onboarding-skills">
            <div className="onboarding-capability-section__header">
              <div>
                <div className="dialog-field__label">Standard skills</div>
                <div className="onboarding-section__hint">
                  Bulk enable or disable Exo's bundled skillset for the selected Claude/Codex harnesses. Agent Config manages individual skills after setup.
                </div>
              </div>
            </div>
            <div className="onboarding-review-summary">
              <div>
                <span>Compatible harnesses</span>
                <strong>{skillHarnessLabels || "Select Claude or Codex"}</strong>
              </div>
              <div>
                <span>Default harness</span>
                <strong>{selectedHarness?.label ?? "None selected"}</strong>
              </div>
              <div>
                <span>Standard library</span>
                <strong>{skillApplyState === "loading" ? "Loading" : standardSkillLibraryAvailable ? "Available" : "Unavailable"}</strong>
              </div>
            </div>
            <label className="onboarding-skill-bulk-toggle">
              <input
                checked={standardSkillsEnabled}
                onChange={(event) => setStandardSkillsEnabled?.(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Enable Exo standard skills</strong>
                <small>Applies the bundled skill folders to each selected workspace harness folder. Turning this off disables the standard set for those harnesses.</small>
              </span>
            </label>
            <div className="onboarding-skill-list">
              {STANDARD_SKILL_ROWS.map((skill) => (
                <div className="onboarding-skill-row" key={skill.name}>
                  <div className="onboarding-skill-row__title">
                    <strong>{skill.name}</strong>
                    <span>{standardSkillsEnabled ? "Will enable" : "Will disable"}</span>
                  </div>
                  <span>{skill.detail}</span>
                  <small>Managed through the same skill inventory and enablement path as Agent Config.</small>
                </div>
              ))}
            </div>
            <div className="onboarding-card__actions onboarding-card__actions--inline">
              <button
                className="toolbar-button"
                disabled={standardSkillActionDisabled}
                onClick={onApplyStandardSkills}
                title={standardSkillLibraryAvailable ? "Apply standard skill choices for selected harnesses." : "The bundled Exo standard skill library is not available in this build."}
                type="button"
              >
                {skillApplyState === "applying" ? "Applying..." : "Apply standard skills"}
              </button>
            </div>
            {skillApplyMessage ? (
              <div className={`dialog-card__status ${skillApplyState === "error" ? "dialog-card__status--error" : "dialog-card__status--success"}`}>
                {skillApplyMessage}
              </div>
            ) : null}
            <div className="onboarding-deferred-note" data-testid="onboarding-skills-note">
              GitHub skill sources and per-skill file edits live in Agent Config Skills. GitHub sync only manages source files; it does not execute downloaded code.
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
                <strong>{standardSkillsEnabled ? "Standard set enabled for selected harnesses" : "Standard set disabled for selected harnesses"}</strong>
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
              Enter workspace saves this profile state and onboarding completion. File templates, routine schedules, MCP/CLI exposure, plugin settings, GitHub skill sources, and permission grants require separate review.
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
