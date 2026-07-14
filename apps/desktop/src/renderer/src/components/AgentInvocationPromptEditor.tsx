import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { DEFAULT_AGENT_INVOCATION_PROMPT } from "@exo/core/agent-invocation-prompt";

interface AgentInvocationPromptEditorProps {
  value: string | undefined;
  onSave: (value: string) => void;
  testId: string;
}

/** Shared prompt surface used by onboarding and Settings → Agents. */
export function AgentInvocationPromptEditor({ value, onSave, testId }: AgentInvocationPromptEditorProps) {
  const effectiveValue = value?.trim() || DEFAULT_AGENT_INVOCATION_PROMPT;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(effectiveValue);

  useEffect(() => {
    if (!editing) setDraft(effectiveValue);
  }, [effectiveValue, editing]);

  const save = () => {
    const next = draft.trim();
    if (!next) return;
    onSave(next);
    setEditing(false);
  };

  return (
    <section className="agent-invocation-prompt" data-testid={testId}>
      <div className="agent-invocation-prompt__header">
        <div>
          <strong>Invocation prompt</strong>
          <span>Shared by every @ agent</span>
        </div>
        <div className="agent-invocation-prompt__actions">
          {editing ? (
            <>
              <button
                aria-label="Save invocation prompt"
                className="icon-button"
                data-testid={`${testId}-save`}
                onClick={save}
                title="Save prompt"
                type="button"
              >
                <Check size={15} />
              </button>
              <button
                aria-label="Cancel editing invocation prompt"
                className="icon-button"
                data-testid={`${testId}-cancel`}
                onClick={() => { setDraft(effectiveValue); setEditing(false); }}
                title="Cancel"
                type="button"
              >
                <X size={15} />
              </button>
            </>
          ) : (
            <button
              aria-label="Edit invocation prompt"
              className="icon-button"
              data-testid={`${testId}-edit`}
              onClick={() => setEditing(true)}
              title="Edit prompt"
              type="button"
            >
              <Pencil size={15} />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          aria-label="Invocation prompt"
          className="agent-invocation-prompt__input"
          data-testid={`${testId}-input`}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          value={draft}
        />
      ) : (
        <pre className="agent-invocation-prompt__preview">{effectiveValue}</pre>
      )}
      <div className="agent-invocation-prompt__hint">
        Keep <code>{"{{message}}"}</code>, <code>{"{{working_note}}"}</code>, and <code>{"{{protocol}}"}</code> for full Exo context and review.
      </div>
    </section>
  );
}
