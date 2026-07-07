import { useEffect, useMemo, useState } from "react";
import type { AgentHarnessDetection, PiHarnessSettings, WorkspaceSettings } from "@exo/core";
import { X } from "lucide-react";

import type { AgentLibrarySkill, AgentSkillFile, AgentSkillInventory, AgentSkillSummary } from "../../../shared/api";
import { agentInstructionStatusLabel, type useAgentInstructionEditor } from "../hooks/useAgentInstructionEditor";
import { isPromptableAgentHarnessDetection } from "../onboardingCapabilities";

type AgentInstructionEditor = ReturnType<typeof useAgentInstructionEditor>;
type AgentConfigTab = "instructions" | "harnesses" | "skills";

interface AgentConfigEditorDialogProps {
  editor: AgentInstructionEditor;
  onClose: () => void;
}

export function AgentConfigEditorDialog({ editor, onClose }: AgentConfigEditorDialogProps) {
  const [activeTab, setActiveTab] = useState<AgentConfigTab>("instructions");
  const { partialErrors } = editor;

  return (
    <div className="dialog-overlay" data-testid="agent-context-manager-overlay">
      <div className="dialog-card dialog-card--agent-context-manager" data-testid="agent-context-manager">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Agent Config Editor</div>
            <div className="dialog-card__message">Manage agent instruction files and harness skills from one place.</div>
          </div>
          <button
            aria-label="Close agent config editor"
            className="dialog-card__close"
            data-testid="agent-context-manager-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {partialErrors.length > 0 ? (
          <div className="dialog-card__status dialog-card__status--error" data-testid="agent-context-manager-partial-errors">
            <div>Some agent instruction data could not be loaded.</div>
            {partialErrors.slice(0, 3).map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        ) : null}

        <div className="dialog-tabs" role="tablist" aria-label="Agent config sections">
          <button
            className={`dialog-tabs__button ${activeTab === "instructions" ? "dialog-tabs__button--active" : ""}`}
            data-testid="agent-config-tab-instructions"
            onClick={() => setActiveTab("instructions")}
            role="tab"
            type="button"
          >
            Instructions
          </button>
          <button
            className={`dialog-tabs__button ${activeTab === "skills" ? "dialog-tabs__button--active" : ""}`}
            data-testid="agent-config-tab-skills"
            onClick={() => setActiveTab("skills")}
            role="tab"
            type="button"
          >
            Skills
          </button>
          <button
            className={`dialog-tabs__button ${activeTab === "harnesses" ? "dialog-tabs__button--active" : ""}`}
            data-testid="agent-config-tab-harnesses"
            onClick={() => setActiveTab("harnesses")}
            role="tab"
            type="button"
          >
            Harnesses
          </button>
        </div>

        {activeTab === "instructions" ? <AgentInstructionsPanel editor={editor} /> : null}
        {activeTab === "harnesses" ? <AgentHarnessesPanel /> : null}
        {activeTab === "skills" ? <AgentSkillsPanel /> : null}
      </div>
    </div>
  );
}

function AgentHarnessesPanel() {
  const [harnesses, setHarnesses] = useState<AgentHarnessDetection[]>([]);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [piDraft, setPiDraft] = useState<PiHarnessDraft>(createPiHarnessDraft());
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.exo.workspace.listAgentHarnesses(),
      window.exo.workspace.getSettings(),
    ])
      .then(([nextHarnesses, nextSettings]) => {
        if (!cancelled) {
          setHarnesses(nextHarnesses);
          setSettings(nextSettings);
          setPiDraft(createPiHarnessDraft(nextSettings.piHarness));
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

  async function refreshHarnesses() {
    setHarnesses(await window.exo.workspace.listAgentHarnesses());
  }

  async function savePiHarnessSettings() {
    const currentSettings = settings ?? await window.exo.workspace.getSettings();
    setSaveState("saving");
    setSaveMessage(null);
    try {
      const saved = await window.exo.workspace.saveSettings({
        ...currentSettings,
        piHarness: piHarnessSettingsFromDraft(piDraft),
      });
      setSettings(saved);
      setPiDraft(createPiHarnessDraft(saved.piHarness));
      await refreshHarnesses();
      setSaveState("idle");
      setSaveMessage("Pi configuration saved.");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Unable to save Pi configuration.");
    }
  }

  const piHarness = harnesses.find((harness) => harness.id === "pi");
  const agentHarnesses = harnesses.filter(isPromptableAgentHarnessDetection);

  return (
    <div className="agent-harnesses" data-testid="agent-harnesses-manager">
      {loadState === "loading" ? <div className="dialog-card__status">Loading harnesses...</div> : null}
      {loadState === "error" ? <div className="dialog-card__status dialog-card__status--error">{errorMessage}</div> : null}
      {piHarness ? (
        <PiHarnessSettingsPanel
          draft={piDraft}
          harness={piHarness}
          onChange={setPiDraft}
          onSave={savePiHarnessSettings}
          saveMessage={saveMessage}
          saveState={saveState}
        />
      ) : null}
      {agentHarnesses.map((harness) => (
        <div className="agent-harnesses__row" data-testid={`agent-harness-${harness.id}`} key={harness.id}>
          <div>
            <div className="agent-harnesses__title">
              <strong>{harness.label}</strong>
              <span className={`agent-harnesses__status agent-harnesses__status--${harness.status}`}>
                {harness.statusLabel}
              </span>
            </div>
            <div className="agent-config-editor__path">
              {harness.productName}
              {harness.channel ? ` · ${harness.channel}` : ""}
              {harness.build ? ` · ${harness.build}` : ""}
            </div>
          </div>
          <div className="agent-harnesses__meta">
            <span>{harness.enabled ? "Enabled" : "Disabled"}</span>
            <span>{harness.launchable ? "Launchable" : "Setup needed"}</span>
            {harness.executablePath ? <small>{harness.executablePath}</small> : null}
            {!harness.executablePath && harness.repoPath ? <small>{harness.repoPath}</small> : null}
            {!harness.executablePath && !harness.repoPath && harness.install?.label ? <small>{harness.install.label}</small> : null}
            {harness.dependencies?.map((dependency) => (
              <small key={dependency.id}>
                {dependency.label}: {dependency.statusLabel}
                {dependency.detail ? ` · ${dependency.detail}` : ""}
              </small>
            ))}
            {harness.detail ? <small>{harness.detail}</small> : null}
          </div>
        </div>
      ))}
      {loadState === "idle" && agentHarnesses.length === 0 ? (
        <div className="dialog-card__status dialog-card__status--warning">
          No agent harnesses are ready yet. Shell remains available as a terminal tool from the terminal dock.
        </div>
      ) : null}
    </div>
  );
}

export interface PiHarnessDraft {
  enabled: boolean;
  label: string;
  command: string;
  repoPath: string;
  args: string;
  backendUrl: string;
  backendCommand: string;
  backendLabel: string;
  backendKind: string;
  backendReady: "" | "true" | "false";
}

export function PiHarnessSettingsPanel({
  draft,
  harness,
  onChange,
  onSave,
  saveMessage,
  saveState,
}: {
  draft: PiHarnessDraft;
  harness: AgentHarnessDetection;
  onChange: (draft: PiHarnessDraft) => void;
  onSave: () => void | Promise<void>;
  saveMessage: string | null;
  saveState: "idle" | "saving" | "error";
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const hasCustomConfig = hasAdvancedPiConfig(draft);
  const backendStatus = harness.dependencies?.find((dependency) => dependency.id === "pi-inference-backend")?.statusLabel;
  const guidance = harness.setupSummary
    ?? (harness.launchable ? "Pi is ready to launch." : "Configure a Pi-compatible command or source checkout and a ready inference backend before launch.");

  return (
    <section className="agent-harnesses__settings" data-testid="pi-harness-settings">
      <div className="agent-harnesses__settings-header">
        <div>
          <div className="dialog-field__label">Pi-compatible setup</div>
          <div className="agent-config-editor__path">
            {harness.statusLabel}
            {backendStatus ? ` · Backend: ${backendStatus}` : ""}
          </div>
        </div>
        <button className="toolbar-button" data-testid="pi-harness-save" disabled={saveState === "saving"} onClick={onSave} type="button">
          {saveState === "saving" ? "Saving..." : "Save"}
        </button>
      </div>
      <div className="agent-harnesses__settings-summary">
        <span>{guidance}</span>
        {hasCustomConfig ? <strong>Custom config saved</strong> : <strong>Default config</strong>}
      </div>
      {saveMessage ? (
        <div className={`dialog-card__status ${saveState === "error" ? "dialog-card__status--error" : ""}`} data-testid="pi-harness-save-message">
          {saveMessage}
        </div>
      ) : null}
      <label className="dialog-field agent-harnesses__checkbox">
        <input
          checked={draft.enabled}
          data-testid="pi-harness-enabled"
          onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
          type="checkbox"
        />
        <span>Enabled</span>
      </label>
      <button
        className="toolbar-button agent-harnesses__advanced-toggle"
        data-testid="pi-harness-advanced-toggle"
        onClick={() => setShowAdvanced((current) => !current)}
        type="button"
      >
        {showAdvanced ? "Hide custom config" : hasCustomConfig ? "Edit custom config" : "Show custom config"}
      </button>
      {showAdvanced ? (
        <div className="agent-harnesses__settings-grid" data-testid="pi-harness-advanced-config">
          <PiTextField draftKey="label" label="Label" draft={draft} onChange={onChange} testId="pi-harness-label" />
          <PiTextField draftKey="repoPath" label="Repo path" draft={draft} onChange={onChange} testId="pi-harness-repo-path" />
          <PiTextField draftKey="command" label="Command" draft={draft} onChange={onChange} testId="pi-harness-command" />
          <PiTextField draftKey="args" label="Args" draft={draft} onChange={onChange} testId="pi-harness-args" />
          <PiTextField draftKey="backendUrl" label="Backend URL" draft={draft} onChange={onChange} testId="pi-harness-backend-url" />
          <PiTextField draftKey="backendCommand" label="Backend command" draft={draft} onChange={onChange} testId="pi-harness-backend-command" />
          <PiTextField draftKey="backendLabel" label="Backend label" draft={draft} onChange={onChange} testId="pi-harness-backend-label" />
          <PiTextField draftKey="backendKind" label="Backend kind" draft={draft} onChange={onChange} testId="pi-harness-backend-kind" />
          <label className="dialog-field">
            <span className="dialog-field__label">Backend ready</span>
            <select
              className="dialog-card__input"
              data-testid="pi-harness-backend-ready"
              onChange={(event) => onChange({ ...draft, backendReady: event.target.value as PiHarnessDraft["backendReady"] })}
              value={draft.backendReady}
            >
              <option value="">Auto</option>
              <option value="true">Ready</option>
              <option value="false">Blocked</option>
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );
}

function hasAdvancedPiConfig(draft: PiHarnessDraft): boolean {
  return Boolean(
    draft.label.trim()
    || draft.command.trim()
    || draft.repoPath.trim()
    || draft.args.trim()
    || draft.backendUrl.trim()
    || draft.backendCommand.trim()
    || draft.backendLabel.trim()
    || draft.backendKind.trim()
    || draft.backendReady,
  );
}

function PiTextField({
  draft,
  draftKey,
  label,
  onChange,
  testId,
}: {
  draft: PiHarnessDraft;
  draftKey: keyof Pick<PiHarnessDraft, "label" | "command" | "repoPath" | "args" | "backendUrl" | "backendCommand" | "backendLabel" | "backendKind">;
  label: string;
  onChange: (draft: PiHarnessDraft) => void;
  testId: string;
}) {
  return (
    <label className="dialog-field">
      <span className="dialog-field__label">{label}</span>
      <input
        className="dialog-card__input"
        data-testid={testId}
        onChange={(event) => onChange({ ...draft, [draftKey]: event.target.value })}
        value={draft[draftKey]}
      />
    </label>
  );
}

export function createPiHarnessDraft(settings?: PiHarnessSettings): PiHarnessDraft {
  return {
    enabled: settings?.enabled ?? true,
    label: settings?.label ?? "",
    command: settings?.command ?? "",
    repoPath: settings?.repoPath ?? "",
    args: settings?.args?.join(", ") ?? "",
    backendUrl: settings?.backendUrl ?? "",
    backendCommand: settings?.backendCommand ?? "",
    backendLabel: settings?.backendLabel ?? "",
    backendKind: settings?.backendKind ?? "",
    backendReady: typeof settings?.backendReady === "boolean" ? (settings.backendReady ? "true" : "false") : "",
  };
}

export function piHarnessSettingsFromDraft(draft: PiHarnessDraft): PiHarnessSettings | undefined {
  const settings: PiHarnessSettings = {};
  settings.enabled = draft.enabled;
  assignDraftString(settings, "label", draft.label);
  assignDraftString(settings, "command", draft.command);
  assignDraftString(settings, "repoPath", draft.repoPath);
  assignDraftString(settings, "backendUrl", draft.backendUrl);
  assignDraftString(settings, "backendCommand", draft.backendCommand);
  assignDraftString(settings, "backendLabel", draft.backendLabel);
  assignDraftString(settings, "backendKind", draft.backendKind);
  const args = draft.args.split(",").map((arg) => arg.trim()).filter(Boolean);
  if (args.length > 0) {
    settings.args = args;
  }
  if (draft.backendReady) {
    settings.backendReady = draft.backendReady === "true";
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

function assignDraftString(settings: PiHarnessSettings, key: keyof PiHarnessSettings, value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    (settings as Record<string, unknown>)[key] = trimmed;
  }
}

function AgentInstructionsPanel({ editor }: { editor: AgentInstructionEditor }) {
  const { state, selectedScope } = editor;

  return (
    <div className="agent-config-editor" data-testid="agent-context-manager-body">
      <div className="agent-config-editor__scope" data-testid="agent-context-scope-controls">
        <span className="dialog-field__label">Scope</span>
        <div className="agent-config-editor__scope-buttons" role="group" aria-label="Agent instruction scope">
          {state.config?.scopes.map((scope) => (
            <button
              className={`agent-config-editor__scope-button ${scope.id === selectedScope?.id ? "agent-config-editor__scope-button--active" : ""}`}
              data-testid={`agent-context-scope-${scope.id}`}
              key={scope.id}
              onClick={() => editor.selectScope(scope.id)}
              type="button"
            >
              <strong>{scope.label}</strong>
              <small>{scope.description}</small>
            </button>
          ))}
        </div>
      </div>

      {selectedScope ? (
        <>
          <div className="agent-config-editor__status" data-testid="agent-config-status">
            <div>
              <span className="dialog-field__label">{agentInstructionStatusLabel(selectedScope)}</span>
              <div className="agent-config-editor__path">{selectedScope.rootPath}</div>
            </div>
            <div className="agent-config-editor__files">
              <div>
                <strong>AGENTS.md</strong>
                <span>{selectedScope.files.agents.exists ? "Existing" : "Missing"}</span>
                <small>{selectedScope.files.agents.path}</small>
              </div>
              <div>
                <strong>CLAUDE.md</strong>
                <span>{selectedScope.files.claude.exists ? "Existing" : "Missing"}</span>
                <small>{selectedScope.files.claude.path}</small>
              </div>
            </div>
          </div>

          {selectedScope.status === "different" ? (
            <div className="dialog-card__status dialog-card__status--warning" data-testid="agent-config-divergence">
              <div>AGENTS.md and CLAUDE.md are different. Choose a source, or edit the text below before saving both files.</div>
              <div className="dialog-card__actions dialog-card__actions--split">
                <button className="toolbar-button" data-testid="agent-config-use-agents" onClick={() => editor.useProviderSource("agents")} type="button">
                  Use AGENTS.md
                </button>
                <button className="toolbar-button" data-testid="agent-config-use-claude" onClick={() => editor.useProviderSource("claude")} type="button">
                  Use CLAUDE.md
                </button>
              </div>
            </div>
          ) : null}

          {selectedScope.status === "missing-agents" || selectedScope.status === "missing-claude" ? (
            <div className="dialog-card__status" data-testid="agent-config-missing">
              Saving will create the missing provider file from the editor content.
            </div>
          ) : null}

          <label className="dialog-field agent-config-editor__editor-field">
            <span className="dialog-field__label">Agent instructions</span>
            <textarea
              className="dialog-card__input agent-config-editor__textarea"
              data-testid="agent-context-unified-editor"
              spellCheck={false}
              value={state.draftBody}
              onChange={(event) => editor.updateDraftBody(event.target.value)}
            />
          </label>

          <div className="dialog-card__actions dialog-card__actions--split">
            <button
              className="toolbar-button"
              data-testid="agent-config-load-template"
              onClick={editor.loadTemplate}
              type="button"
            >
              Load Exo starter template
            </button>
            <button
              className="toolbar-button"
              data-testid="agent-context-save-unified"
              disabled={state.saveStatus === "saving" || selectedScope.status === "error"}
              onClick={() => void editor.save()}
              type="button"
            >
              {state.saveStatus === "saving" ? "Saving..." : "Save both files"}
            </button>
          </div>

          {state.saveStatus === "saved" ? (
            <div className="dialog-card__status" data-testid="agent-context-unified-status">AGENTS.md and CLAUDE.md are aligned.</div>
          ) : null}
          {state.saveStatus === "error" && state.errorMessage ? (
            <div className="dialog-card__status dialog-card__status--error">{state.errorMessage}</div>
          ) : null}
        </>
      ) : (
        <div className="dialog-card__status dialog-card__status--error">No agent instruction scope is available.</div>
      )}
    </div>
  );
}

function AgentSkillsPanel() {
  const [inventory, setInventory] = useState<AgentSkillInventory | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedRelativePath, setSelectedRelativePath] = useState<string | null>(null);
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<string[]>([]);
  const [fileBody, setFileBody] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedSkill = useMemo(
    () => inventory?.skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [inventory, selectedSkillId],
  );
  const selectedFiles = useMemo(
    () => selectedSkill ? flattenSkillFiles(selectedSkill.files, new Set(expandedDirectoryPaths)) : [],
    [expandedDirectoryPaths, selectedSkill],
  );
  const selectedFile = selectedFiles.find((file) => file.kind === "file" && file.relativePath === selectedRelativePath) ?? null;

  useEffect(() => {
    void loadInventory();
  }, []);

  useEffect(() => {
    if (!inventory || selectedSkillId) {
      return;
    }
    const firstSkill = inventory.skills[0] ?? null;
    setSelectedSkillId(firstSkill?.id ?? null);
  }, [inventory, selectedSkillId]);

  useEffect(() => {
    if (!selectedSkill || selectedRelativePath) {
      return;
    }
    const defaultFile = findDefaultSkillFile(selectedSkill);
    setSelectedRelativePath(defaultFile?.relativePath ?? null);
  }, [selectedRelativePath, selectedSkill]);

  useEffect(() => {
    if (!selectedSkill) {
      setExpandedDirectoryPaths([]);
      return;
    }
    setExpandedDirectoryPaths(collectDirectoryPaths(selectedSkill.files));
  }, [selectedSkill?.id]);

  useEffect(() => {
    if (!selectedSkill || !selectedRelativePath) {
      setFileBody("");
      return;
    }
    void readSelectedFile(selectedSkill.id, selectedRelativePath);
  }, [selectedRelativePath, selectedSkill?.id]);

  async function loadInventory(nextSelectedSkillId?: string | null) {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const nextInventory = await window.exo.workspace.listAgentSkills();
      setInventory(nextInventory);
      setLoadState("idle");
      if (nextSelectedSkillId !== undefined) {
        setSelectedSkillId(nextSelectedSkillId);
        setSelectedRelativePath(null);
        setExpandedDirectoryPaths([]);
      }
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function readSelectedFile(skillId: string, relativePath: string) {
    setSaveState("idle");
    setErrorMessage(null);
    try {
      const content = await window.exo.workspace.readAgentSkillFile(skillId, relativePath);
      setFileBody(content.body);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSelectedFile() {
    if (!selectedSkill || !selectedFile) {
      return;
    }
    setSaveState("saving");
    setErrorMessage(null);
    try {
      await window.exo.workspace.saveAgentSkillFile(selectedSkill.id, selectedFile.relativePath, fileBody);
      setSaveState("saved");
      await loadInventory(selectedSkill.id);
      setSelectedRelativePath(selectedFile.relativePath);
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleSelectedSkillEnabled() {
    if (!selectedSkill) {
      return;
    }
    setErrorMessage(null);
    try {
      const nextInventory = await window.exo.workspace.setAgentSkillEnabled({
        skillId: selectedSkill.id,
        enabled: !selectedSkill.enabled,
      });
      setInventory(nextInventory);
      const movedSkill = nextInventory.skills.find((candidate) =>
        candidate.name === selectedSkill.name &&
        candidate.harness === selectedSkill.harness &&
        candidate.scope === selectedSkill.scope &&
        candidate.enabled !== selectedSkill.enabled,
      );
      setSelectedSkillId(movedSkill?.id ?? null);
      setSelectedRelativePath(null);
      setExpandedDirectoryPaths([]);
      setFileBody("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="agent-skills-panel" data-testid="agent-skills-manager">
      <div className="agent-skills">
        <div className="agent-skills__sidebar">
          <div className="dialog-field__label">Configured Skills</div>
          {loadState === "loading" && !inventory ? <div className="dialog-card__status">Loading skills...</div> : null}
          {inventory?.skills.length === 0 ? (
            <div className="dialog-card__status">No skills found in Claude or Codex skill folders.</div>
          ) : null}
          {inventory?.skills.map((skill) => (
            <button
              className={`agent-skills__skill shared-skill-row ${skill.id === selectedSkillId ? "agent-skills__skill--active" : ""}`}
              data-testid={`agent-skill-${skill.name}`}
              key={skill.id}
              onClick={() => {
                setSelectedSkillId(skill.id);
                setSelectedRelativePath(null);
                setExpandedDirectoryPaths([]);
              }}
              type="button"
            >
              <strong>{skill.label}</strong>
              <span>
                {skill.harness} · {skill.scope} · {skill.enabled ? "enabled" : "disabled"}
              </span>
              <small>{skill.rootPath}</small>
            </button>
          ))}
        </div>

        <div className="agent-skills__main">
          {selectedSkill ? (
            <>
              <div className="agent-skills__toolbar">
                <div>
                  <div className="dialog-field__label">{selectedSkill.label}</div>
                  <div className="agent-config-editor__path">{selectedSkill.locationLabel}</div>
                </div>
                <button className="toolbar-button" data-testid="agent-skill-toggle-enabled" onClick={() => void toggleSelectedSkillEnabled()} type="button">
                  {selectedSkill.enabled ? "Disable for harness" : "Enable for harness"}
                </button>
              </div>
              <div className="agent-skills__workspace">
                <div className="agent-skills__files" data-testid="agent-skill-files">
                  {selectedFiles.map((file) => (
                    <button
                      className={`agent-skills__file ${file.kind === "directory" ? "agent-skills__file--directory" : ""} ${file.relativePath === selectedRelativePath ? "agent-skills__file--active" : ""}`}
                      data-depth={file.depth}
                      data-testid={`agent-skill-file-${file.relativePath}`}
                      key={file.relativePath}
                      onClick={() => {
                        if (file.kind === "directory") {
                          setExpandedDirectoryPaths((current) =>
                            current.includes(file.relativePath)
                              ? current.filter((directoryPath) => directoryPath !== file.relativePath)
                              : [...current, file.relativePath],
                          );
                          return;
                        }
                        setSelectedRelativePath(file.relativePath);
                      }}
                      style={{ paddingLeft: `${8 + file.depth * 14}px` }}
                      type="button"
                    >
                      {file.kind === "directory" ? `${file.expanded ? "▾" : "▸"} ` : ""}
                      {file.label}
                    </button>
                  ))}
                </div>
                <div className="agent-skills__editor">
                  {selectedFile ? (
                    <>
                      <div className="agent-skills__editor-header">
                        <span>{selectedFile.relativePath}</span>
                        <button
                          className="toolbar-button"
                          data-testid="agent-skill-save-file"
                          disabled={saveState === "saving"}
                          onClick={() => void saveSelectedFile()}
                          type="button"
                        >
                          {saveState === "saving" ? "Saving..." : "Save"}
                        </button>
                      </div>
                      <textarea
                        className="dialog-card__input agent-skills__textarea"
                        data-testid="agent-skill-file-editor"
                        spellCheck={false}
                        value={fileBody}
                        onChange={(event) => {
                          setSaveState("idle");
                          setFileBody(event.target.value);
                        }}
                      />
                    </>
                  ) : (
                    <div className="dialog-card__status">Select a skill file to edit.</div>
                  )}
                </div>
              </div>
              {saveState === "saved" ? <div className="dialog-card__status">Saved.</div> : null}
            </>
          ) : (
            <div className="dialog-card__status">Select a skill to inspect its files.</div>
          )}
          {loadState === "error" || saveState === "error" || errorMessage ? (
            <div className="dialog-card__status dialog-card__status--error">{errorMessage}</div>
          ) : null}
        </div>
      </div>
      <AgentSkillSourcesPanel />
    </div>
  );
}

function AgentSkillSourcesPanel() {
  const [inventory, setInventory] = useState<AgentSkillInventory | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [skillsPath, setSkillsPath] = useState("skills");
  const [selectedLibrarySkillId, setSelectedLibrarySkillId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "syncing" | "installing" | "error" | "installed">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const installLocations = useMemo(
    () => inventory?.locations.filter((location) => location.enabled) ?? [],
    [inventory],
  );
  const selectedLibrarySkill = useMemo(
    () => inventory?.librarySkills.find((skill) => skill.id === selectedLibrarySkillId) ?? null,
    [inventory, selectedLibrarySkillId],
  );

  useEffect(() => {
    void loadInventory();
  }, []);

  useEffect(() => {
    if (!inventory) {
      return;
    }
    if (!selectedLibrarySkillId && inventory.librarySkills[0]) {
      setSelectedLibrarySkillId(inventory.librarySkills[0].id);
    }
    if (!selectedLocationId && installLocations[0]) {
      setSelectedLocationId(installLocations[0].id);
    }
  }, [installLocations, inventory, selectedLibrarySkillId, selectedLocationId]);

  async function loadInventory() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      setInventory(await window.exo.workspace.listAgentSkills());
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function addSource() {
    setStatus("syncing");
    setErrorMessage(null);
    try {
      const nextInventory = await window.exo.workspace.addAgentSkillSource({
        url: sourceUrl,
        skillsPath,
      });
      setInventory(nextInventory);
      setSourceUrl("");
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function syncSource(sourceId: string) {
    setStatus("syncing");
    setErrorMessage(null);
    try {
      setInventory(await window.exo.workspace.syncAgentSkillSource(sourceId));
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function installSkill(skill: AgentLibrarySkill) {
    if (!selectedLocationId) {
      setStatus("error");
      setErrorMessage("Choose an install target.");
      return;
    }
    setStatus("installing");
    setErrorMessage(null);
    try {
      setInventory(await window.exo.workspace.installAgentLibrarySkill({
        librarySkillId: skill.id,
        locationId: selectedLocationId,
      }));
      setStatus("installed");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="agent-sources" data-testid="agent-skill-sources">
      <div className="agent-sources__form">
        <label className="dialog-field">
          <span className="dialog-field__label">GitHub or git repo URL</span>
          <input
            className="dialog-card__input"
            data-testid="agent-skill-source-url"
            placeholder="https://github.com/org/repo.git"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-field__label">Skills folder</span>
          <input
            className="dialog-card__input"
            data-testid="agent-skill-source-path"
            value={skillsPath}
            onChange={(event) => setSkillsPath(event.target.value)}
          />
        </label>
        <button
          className="toolbar-button"
          data-testid="agent-skill-source-add"
          disabled={status === "syncing" || sourceUrl.trim().length === 0}
          onClick={() => void addSource()}
          type="button"
        >
          {status === "syncing" ? "Syncing..." : "Add source"}
        </button>
      </div>

      <div className="agent-sources__body">
        <div className="agent-sources__panel">
          <div className="dialog-field__label">Sources</div>
          {status === "loading" && !inventory ? <div className="dialog-card__status">Loading sources...</div> : null}
          {inventory?.sources.length === 0 ? <div className="dialog-card__status">No skill sources configured.</div> : null}
          {inventory?.sources.map((source) => (
            <div className="agent-sources__source" data-testid={`agent-skill-source-${source.id}`} key={source.id}>
              <div>
                <strong>{source.label}</strong>
                <span>{source.url}</span>
                <small>{source.skillsPath} · {source.lastSyncedAt ? `synced ${new Date(source.lastSyncedAt).toLocaleString()}` : "not synced"}</small>
                {source.lastErrorMessage ? <small className="agent-sources__error">{source.lastErrorMessage}</small> : null}
              </div>
              <button className="toolbar-button" onClick={() => void syncSource(source.id)} type="button">
                Sync
              </button>
            </div>
          ))}
        </div>

        <div className="agent-sources__panel">
          <div className="agent-sources__install-header">
            <div>
              <div className="dialog-field__label">Library skills</div>
              <div className="agent-config-editor__path">Installing copies a library skill into the selected harness folder. Existing skills are never overwritten.</div>
            </div>
            <select
              className="dialog-card__input agent-sources__target"
              data-testid="agent-skill-install-target"
              value={selectedLocationId}
              onChange={(event) => setSelectedLocationId(event.target.value)}
            >
              {installLocations.map((location) => (
                <option key={location.id} value={location.id}>{location.label}</option>
              ))}
            </select>
          </div>
          {inventory?.librarySkills.length === 0 ? <div className="dialog-card__status">No library skills found in synced sources.</div> : null}
          <div className="agent-sources__library">
            {inventory?.librarySkills.map((skill) => (
              <button
                className={`agent-sources__skill shared-skill-row ${skill.id === selectedLibrarySkillId ? "agent-sources__skill--active" : ""}`}
                data-testid={`agent-library-skill-${skill.name}`}
                key={skill.id}
                onClick={() => setSelectedLibrarySkillId(skill.id)}
                type="button"
              >
                <strong>{skill.label}</strong>
                <span>{skill.sourceLabel} · {skill.name}</span>
                <small>{skill.rootPath}</small>
              </button>
            ))}
          </div>
          {selectedLibrarySkill ? (
            <div className="agent-sources__actions">
              <button
                className="toolbar-button"
                data-testid="agent-library-skill-install"
                disabled={status === "installing"}
                onClick={() => void installSkill(selectedLibrarySkill)}
                type="button"
              >
                {status === "installing" ? "Installing..." : "Install copy"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {status === "installed" ? <div className="dialog-card__status">Skill installed.</div> : null}
      {status === "error" && errorMessage ? <div className="dialog-card__status dialog-card__status--error">{errorMessage}</div> : null}
    </div>
  );
}

interface FlatSkillFile {
  relativePath: string;
  kind: AgentSkillFile["kind"];
  label: string;
  depth: number;
  expanded?: boolean;
}

function flattenSkillFiles(files: AgentSkillFile[], expandedDirectories = new Set<string>(), depth = 0): FlatSkillFile[] {
  return sortSkillFiles(files).flatMap((file) => {
    const expanded = file.kind === "directory" && expandedDirectories.has(file.relativePath);
    return [
      {
        relativePath: file.relativePath,
        kind: file.kind,
        label: file.relativePath.split(/[\\/]/).at(-1) ?? file.relativePath,
        depth,
        expanded,
      },
      ...(file.children && expanded ? flattenSkillFiles(file.children, expandedDirectories, depth + 1) : []),
    ];
  });
}

function findDefaultSkillFile(skill: AgentSkillSummary): FlatSkillFile | null {
  const files = flattenSkillFiles(skill.files, new Set(collectDirectoryPaths(skill.files))).filter((file) => file.kind === "file");
  return files.find((file) => file.relativePath === "SKILL.md") ?? files[0] ?? null;
}

function collectDirectoryPaths(files: AgentSkillFile[]): string[] {
  return files.flatMap((file) => [
    ...(file.kind === "directory" ? [file.relativePath] : []),
    ...(file.children ? collectDirectoryPaths(file.children) : []),
  ]);
}

function sortSkillFiles(files: AgentSkillFile[]): AgentSkillFile[] {
  return [...files].sort((a, b) => {
    if (a.relativePath === "SKILL.md") return -1;
    if (b.relativePath === "SKILL.md") return 1;
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
}
