import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { AgentSkillFile, AgentSkillInventory, AgentSkillSummary } from "../../../shared/api";
import { agentInstructionStatusLabel, type useAgentInstructionEditor } from "../hooks/useAgentInstructionEditor";

type AgentInstructionEditor = ReturnType<typeof useAgentInstructionEditor>;
type AgentConfigTab = "instructions" | "skills";

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
        </div>

        {activeTab === "instructions" ? <AgentInstructionsPanel editor={editor} /> : <AgentSkillsPanel />}
      </div>
    </div>
  );
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
    <div className="agent-skills" data-testid="agent-skills-manager">
      <div className="agent-skills__sidebar">
        <div className="dialog-field__label">Configured Skills</div>
        {loadState === "loading" && !inventory ? <div className="dialog-card__status">Loading skills...</div> : null}
        {inventory?.skills.length === 0 ? (
          <div className="dialog-card__status">No skills found in Claude or Codex skill folders.</div>
        ) : null}
        {inventory?.skills.map((skill) => (
          <button
            className={`agent-skills__skill ${skill.id === selectedSkillId ? "agent-skills__skill--active" : ""}`}
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
