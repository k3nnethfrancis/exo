import { useEffect, useMemo, useState } from "react";
import type { ActiveProfileIdentity, OnboardingProfileStep, PluginInventory, PluginInventoryItem } from "@exo/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type {
  AgentInstructionConfig,
  AgentInstructionProviderId,
  AgentInstructionScopeId,
  AgentSkillHarnessId,
  AgentSkillInventory,
} from "../../../shared/api";

import {
  buildOnboardingCapabilitySections,
  isPromptableAgentHarnessInventoryItem,
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
  return isPromptableAgentHarnessInventoryItem(item);
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
  const [profileConfigDraft, setProfileConfigDraft] = useState("");
  const [profileConfigDirty, setProfileConfigDirty] = useState(false);
  const [profileConfigStatus, setProfileConfigStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [profileConfigError, setProfileConfigError] = useState<string | null>(null);
  const [profileSavedAt, setProfileSavedAt] = useState<string | null>(null);
  const [defaultHarnessId, setDefaultHarnessId] = useState<string | null>(null);
  const [agentInstructionConfig, setAgentInstructionConfig] = useState<AgentInstructionConfig | null>(null);
  const [contextBody, setContextBody] = useState("");
  const [agentInstructionStatus, setAgentInstructionStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [agentInstructionSyncStatus, setAgentInstructionSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [agentInstructionSyncMessage, setAgentInstructionSyncMessage] = useState<string | null>(null);
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
      isPromptableAgentHarnessInventoryItem(item) && (selectionOverrides[item.id] ?? onboardingCapabilitySelected(item))
    );
  }, [sections, selectionOverrides]);
  const selectedRoutineHarnesses = useMemo(() => selectedHarnesses.filter(isAgentPromptRoutineHarness), [selectedHarnesses]);
  const resolvedProfileConfig = useMemo(() => buildOnboardingProfileConfig({
    profileName,
    selectedHarnesses,
    defaultHarnessId,
    graphHealthEnabled,
    instructionSyncEnabled,
    exographContextApplied,
  }), [
    defaultHarnessId,
    exographContextApplied,
    graphHealthEnabled,
    instructionSyncEnabled,
    profileName,
    selectedHarnesses,
  ]);

  useEffect(() => {
    if (!profileConfigDirty) {
      setProfileConfigDraft(formatProfileConfig(resolvedProfileConfig));
    }
  }, [profileConfigDirty, resolvedProfileConfig]);

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
    setAgentInstructionSyncStatus("idle");
    setAgentInstructionSyncMessage(null);
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

  async function syncAgentInstructionFilesFromProvider(input: { scopeId: AgentInstructionScopeId; sourceProviderId: AgentInstructionProviderId }) {
    const scope = agentInstructionConfig?.scopes.find((entry) => entry.id === input.scopeId);
    const sourceFile = scope?.files[input.sourceProviderId];
    const targetLabels = scope
      ? Object.values(scope.files).filter((file) => file.id !== input.sourceProviderId).map((file) => file.label).join(", ")
      : "the other provider files";
    const confirmed = window.confirm([
      `Sync instruction files from ${sourceFile?.label ?? input.sourceProviderId}?`,
      "",
      `This will overwrite ${targetLabels || "the other provider files"} in the ${scope?.label ?? input.scopeId} scope with the selected file's contents.`,
      "Unique content in overwritten files will be replaced.",
    ].join("\n"));
    if (!confirmed) {
      setAgentInstructionSyncStatus("idle");
      setAgentInstructionSyncMessage("Instruction file sync cancelled.");
      return;
    }
    setAgentInstructionSyncStatus("syncing");
    setAgentInstructionSyncMessage("Syncing instruction files from selected source...");
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const config = await window.exo.workspace.syncAgentInstructionFilesFromProvider(input);
      const nextScope = config.scopes.find((entry) => entry.id === input.scopeId);
      const nextSourceFile = nextScope?.files[input.sourceProviderId];
      setAgentInstructionConfig(config);
      setAgentInstructionSyncStatus("synced");
      setAgentInstructionSyncMessage(`Synced ${nextScope?.label ?? "scope"} from ${nextSourceFile?.label ?? input.sourceProviderId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentInstructionSyncStatus("error");
      setAgentInstructionSyncMessage(message);
      setErrorMessage(message);
    }
  }

  function updateProfileName(value: string) {
    setProfileName(value);
    setProfileConfigDirty(true);
    setProfileConfigStatus("idle");
    setProfileConfigError(null);
    setProfileConfigDraft((current) => patchProfileConfigLabel(current || formatProfileConfig(resolvedProfileConfig), value));
  }

  function updateProfileConfigDraft(value: string) {
    setProfileConfigDraft(value);
    setProfileConfigDirty(true);
    setProfileConfigStatus("idle");
    setProfileConfigError(null);
  }

  function createNewProfileDraft() {
    const nextName = "Untitled Exograph";
    const nextConfig = buildOnboardingProfileConfig({
      profileName: nextName,
      selectedHarnesses,
      defaultHarnessId,
      graphHealthEnabled,
      instructionSyncEnabled,
      exographContextApplied,
    });
    setProfileName(nextName);
    setProfileConfigDraft(formatProfileConfig(nextConfig));
    setProfileConfigDirty(true);
    setProfileConfigStatus("idle");
    setProfileConfigError(null);
    setProfileSavedAt(null);
  }

  async function saveProfileConfig(): Promise<ActiveProfileIdentity> {
    setPendingPluginId("profile");
    setProfileConfigStatus("saving");
    setProfileConfigError(null);
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const parsed = parseProfileConfigDraft(profileConfigDraft || formatProfileConfig(resolvedProfileConfig));
      const nextState = await window.exo.workspace.setActiveProfile(parsed);
      window.dispatchEvent(new CustomEvent("exo:profile-state-changed", { detail: nextState }));
      setProfileName(parsed.label ?? parsed.profileId);
      setProfileConfigDraft(formatProfileConfig(parsed));
      setProfileConfigDirty(false);
      setProfileConfigStatus("saved");
      setProfileSavedAt(new Date().toLocaleString());
      setActionMessage("Profile config saved.");
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfileConfigError(message);
      setProfileConfigStatus("error");
      setErrorMessage(message);
      throw error;
    } finally {
      setPendingPluginId(null);
    }
  }

  async function finishOnboarding() {
    setPendingPluginId("profile");
    setActionMessage(null);
    setErrorMessage(null);
    try {
      await saveProfileConfig();
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
      onSyncAgentInstructionFilesFromProvider={(input) => void syncAgentInstructionFilesFromProvider(input)}
      onCreateProfileDraft={createNewProfileDraft}
      onSaveProfileConfig={() => void saveProfileConfig()}
      pendingPluginId={pendingPluginId}
      profileName={profileName}
      setProfileName={updateProfileName}
      profileConfigDraft={profileConfigDraft}
      setProfileConfigDraft={updateProfileConfigDraft}
      profileConfigStatus={profileConfigStatus}
      profileConfigError={profileConfigError}
      profileSavedAt={profileSavedAt}
      setupStep={setupStep}
      setSetupStep={setSetupStep}
      selectedHarnesses={selectedHarnesses}
      defaultHarnessId={defaultHarnessId}
      setDefaultHarnessId={setDefaultHarnessId}
      agentInstructionConfig={agentInstructionConfig}
      agentInstructionStatus={agentInstructionStatus}
      agentInstructionSyncStatus={agentInstructionSyncStatus}
      agentInstructionSyncMessage={agentInstructionSyncMessage}
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

export function buildOnboardingProfileConfig({
  profileName,
  selectedHarnesses,
  defaultHarnessId,
  graphHealthEnabled,
  instructionSyncEnabled,
  exographContextApplied,
}: {
  profileName: string;
  selectedHarnesses: PluginInventoryItem[];
  defaultHarnessId?: string | null;
  graphHealthEnabled: boolean;
  instructionSyncEnabled: boolean;
  exographContextApplied: boolean;
}): ActiveProfileIdentity {
  const routineHarnesses = selectedHarnesses.filter(isAgentPromptRoutineHarness);
  const selectedDefaultHarnessId = routineHarnesses.find((item) => item.id === defaultHarnessId)?.id
    ?? routineHarnesses[0]?.id;
  return {
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
  };
}

export function formatProfileConfig(config: ActiveProfileIdentity): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function parseProfileConfigDraft(draft: string): ActiveProfileIdentity {
  const parsed = JSON.parse(draft) as Partial<ActiveProfileIdentity>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Profile config must be a JSON object.");
  }
  if (typeof parsed.profileId !== "string" || parsed.profileId.trim().length === 0) {
    throw new Error("Profile config requires a non-empty profileId.");
  }
  if (typeof parsed.capabilityId !== "string" || parsed.capabilityId.trim().length === 0) {
    throw new Error("Profile config requires a non-empty capabilityId.");
  }
  return parsed as ActiveProfileIdentity;
}

function patchProfileConfigLabel(draft: string, label: string): string {
  try {
    const parsed = parseProfileConfigDraft(draft);
    return formatProfileConfig({ ...parsed, label: label.trim() || "My Exograph" });
  } catch {
    return draft;
  }
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
  onSyncAgentInstructionFilesFromProvider,
  onCreateProfileDraft,
  onSaveProfileConfig,
  pendingPluginId,
  profileName = "My Exograph",
  setProfileName,
  profileConfigDraft,
  setProfileConfigDraft,
  profileConfigStatus = "idle",
  profileConfigError = null,
  profileSavedAt = null,
  setupStep = "plugins",
  setSetupStep,
  selectedHarnesses = [],
  defaultHarnessId,
  setDefaultHarnessId,
  agentInstructionConfig = null,
  agentInstructionStatus = "idle",
  agentInstructionSyncStatus = "idle",
  agentInstructionSyncMessage = null,
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
  onSyncAgentInstructionFilesFromProvider?: (input: { scopeId: AgentInstructionScopeId; sourceProviderId: AgentInstructionProviderId }) => void;
  onCreateProfileDraft?: () => void;
  onSaveProfileConfig?: () => void;
  pendingPluginId?: string | null;
  profileName?: string;
  setProfileName?: (value: string) => void;
  profileConfigDraft?: string;
  setProfileConfigDraft?: (value: string) => void;
  profileConfigStatus?: "idle" | "saving" | "saved" | "error";
  profileConfigError?: string | null;
  profileSavedAt?: string | null;
  setupStep?: OnboardingSetupStep;
  setSetupStep?: (value: OnboardingSetupStep) => void;
  selectedHarnesses?: PluginInventoryItem[];
  defaultHarnessId?: string | null;
  setDefaultHarnessId?: (value: string) => void;
  agentInstructionConfig?: AgentInstructionConfig | null;
  agentInstructionStatus?: "idle" | "loading" | "saving" | "error";
  agentInstructionSyncStatus?: "idle" | "syncing" | "synced" | "error";
  agentInstructionSyncMessage?: string | null;
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
  const [selectedInstructionScopeId, setSelectedInstructionScopeId] = useState<AgentInstructionScopeId>("global");
  const [selectedInstructionProviderId, setSelectedInstructionProviderId] = useState<AgentInstructionProviderId>("agents");
  const selectedInstructionScope = agentInstructionConfig?.scopes.find((scope) => scope.id === selectedInstructionScopeId)
    ?? agentInstructionConfig?.scopes[0]
    ?? null;
  const selectedInstructionFile = selectedInstructionScope?.files[selectedInstructionProviderId] ?? selectedInstructionScope?.files.agents ?? null;
  const selectedInstructionSyncSourceReady = Boolean(
    selectedInstructionFile?.exists
      && selectedInstructionFile.body.trim()
      && !selectedInstructionFile.errorMessage
      && agentInstructionSyncStatus !== "syncing"
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
  const profileConfigText = profileConfigDraft ?? formatProfileConfig(buildOnboardingProfileConfig({
    profileName,
    selectedHarnesses,
    defaultHarnessId,
    graphHealthEnabled,
    instructionSyncEnabled,
    exographContextApplied,
  }));
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
            {agentInstructionSyncMessage ? (
              <div
                className={`dialog-card__status${agentInstructionSyncStatus === "error" ? " dialog-card__status--error" : agentInstructionSyncStatus === "synced" ? " dialog-card__status--success" : ""}`}
                data-testid="onboarding-agent-instruction-sync-status"
              >
                {agentInstructionSyncMessage}
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
                  data-testid="onboarding-agent-instruction-sync"
                  disabled={!onSyncAgentInstructionFilesFromProvider || !selectedInstructionScope || !selectedInstructionSyncSourceReady}
                  onClick={() => selectedInstructionScope ? onSyncAgentInstructionFilesFromProvider?.({
                    scopeId: selectedInstructionScope.id,
                    sourceProviderId: selectedInstructionFile?.id ?? "agents",
                  }) : undefined}
                  title={selectedInstructionSyncSourceReady ? "After confirmation, overwrite the other provider file with the selected visible instruction file." : "Select an existing non-empty instruction file to sync from."}
                  type="button"
                >
                  {agentInstructionSyncStatus === "syncing" ? "Syncing..." : "Sync from selected file"}
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
            <div className="onboarding-profile-header">
              <div>
                <div className="dialog-field__label">Profile</div>
                <div className="onboarding-section__hint">Edit the workspace profile config saved under Exo state. Saving here does not apply templates, install skills, enable plugins, or write notes files.</div>
              </div>
              <button className="toolbar-button" onClick={onCreateProfileDraft} type="button">
                New profile draft
              </button>
            </div>
            <label className="dialog-field__label" htmlFor="onboarding-profile-name">Profile name</label>
            <input
              className="settings-input"
              id="onboarding-profile-name"
              onChange={(event) => setProfileName?.(event.target.value)}
              value={profileName}
            />
            <div className="onboarding-review-summary onboarding-review-summary--compact">
              <div>
                <span>Saved status</span>
                <strong>{profileConfigStatus === "saved" ? "Saved" : profileConfigStatus === "saving" ? "Saving" : profileConfigStatus === "error" ? "Needs fix" : "Not saved"}</strong>
              </div>
              <div>
                <span>Last saved</span>
                <strong>{profileSavedAt ?? "Not saved this session"}</strong>
              </div>
              <div>
                <span>Profile package</span>
                <strong>Exograph baseline</strong>
              </div>
              <div>
                <span>Harnesses</span>
                <strong>{selectedHarnessLabels || "None selected"}</strong>
              </div>
              <div>
                <span>Routines</span>
                <strong>{selectedRoutineLabels.join(", ") || "None selected"}</strong>
              </div>
              <div>
                <span>Search</span>
                <strong>{selectedSearchProviders.map((item) => item.label).join(", ") || "Basic file search only"}</strong>
              </div>
              <div>
                <span>Agent context</span>
                <strong>{exographContextApplied ? "Applied" : "Not applied"}</strong>
              </div>
              <div>
                <span>Skills</span>
                <strong>{standardSkillsEnabled ? "Standard set enabled for selected harnesses" : "Standard set disabled for selected harnesses"}</strong>
              </div>
            </div>
            <label className="dialog-field__label" htmlFor="onboarding-profile-config-preview">Profile config JSON</label>
            <textarea
              className="onboarding-textarea onboarding-config-preview"
              id="onboarding-profile-config-preview"
              onChange={(event) => setProfileConfigDraft?.(event.target.value)}
              readOnly={!setProfileConfigDraft}
              value={profileConfigText}
            />
            <div className="onboarding-card__actions onboarding-card__actions--inline">
              <button
                className="toolbar-button toolbar-button--primary"
                disabled={!onSaveProfileConfig || profileConfigStatus === "saving"}
                onClick={onSaveProfileConfig}
                type="button"
              >
                {profileConfigStatus === "saving" ? "Saving..." : "Save profile config"}
              </button>
              {profileConfigStatus === "saved" ? <span className="onboarding-profile-status">Saved to active workspace profile.</span> : null}
              {profileConfigStatus === "error" ? <span className="onboarding-profile-status onboarding-profile-status--error">{profileConfigError ?? "Fix the JSON and save again."}</span> : null}
            </div>
            <div className="onboarding-deferred-note" data-testid="onboarding-profile-routine-note">
              Profile save updates Exo workspace state only. File templates, routine schedules, MCP/CLI exposure, plugin settings, GitHub skill sources, and permission grants require separate review.
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
