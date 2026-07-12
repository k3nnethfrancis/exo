import { useEffect, useState } from "react";
import { Bot, Play } from "lucide-react";

import type { AgentCommand } from "@exo/core";
import type { AgentCommandLaunchFacts } from "../../../shared/api";

interface TerminalCommandBarViewProps {
  commands: AgentCommand[];
  selectedId: string;
  facts: AgentCommandLaunchFacts | null;
  status: string;
  testing: boolean;
  onSelect: (commandId: string) => void;
  onTest: () => void;
}

export function TerminalCommandBar() {
  const [commands, setCommands] = useState<AgentCommand[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [facts, setFacts] = useState<AgentCommandLaunchFacts | null>(null);
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.exo.workspace.getSettings().then(({ settings }) => {
      if (cancelled) return;
      const enabled = (settings.agentCommands ?? []).filter((command) => command.enabled);
      setCommands(enabled);
      setSelectedId((current) => enabled.some((command) => command.id === current) ? current : enabled[0]?.id ?? "");
    }).catch((error) => {
      if (!cancelled) setStatus(errorMessage(error));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFacts(null);
    if (!selectedId) return () => { cancelled = true; };
    void window.exo.workspace.getAgentCommandLaunchFacts(selectedId).then((next) => {
      if (!cancelled) {
        setFacts(next);
        setStatus(next.detail);
      }
    }).catch((error) => {
      if (!cancelled) setStatus(errorMessage(error));
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  async function testCommand() {
    if (!facts?.launchable || testing) return;
    setTesting(true);
    try {
      const outcome = await runConfirmedCommandTest(facts, {
        confirm: (message) => window.confirm(message),
        test: (input) => window.exo.workspace.testAgentCommand(input),
      });
      setStatus(outcome === "declined" ? "Test declined. Nothing was launched." : `${facts.label} launched in a visible terminal.`);
    } catch (error) {
      setStatus(errorMessage(error));
      const current = await window.exo.workspace.getAgentCommandLaunchFacts(facts.commandId).catch(() => null);
      if (current) setFacts(current);
    } finally {
      setTesting(false);
    }
  }

  return (
    <TerminalCommandBarView
      commands={commands}
      selectedId={selectedId}
      facts={facts}
      status={status}
      testing={testing}
      onSelect={setSelectedId}
      onTest={() => void testCommand()}
    />
  );
}

export async function runConfirmedCommandTest(
  facts: AgentCommandLaunchFacts,
  dependencies: {
    confirm: (message: string) => boolean;
    test: (input: { commandId: string; expectedFingerprint: string }) => Promise<unknown>;
  },
): Promise<"declined" | "launched"> {
  const confirmed = dependencies.confirm([
    `Run ${facts.label} once in a visible terminal?`,
    "",
    `Executable: ${facts.executablePath ?? facts.executable}`,
    `Working folder: ${facts.cwd}`,
    `Fingerprint: ${facts.fingerprint}`,
    "",
    "This runs native code on your machine. Exo will not save trust from this test.",
  ].join("\n"));
  if (!confirmed) return "declined";
  await dependencies.test({ commandId: facts.commandId, expectedFingerprint: facts.fingerprint });
  return "launched";
}

export function TerminalCommandBarView(props: TerminalCommandBarViewProps) {
  const { commands, selectedId, facts, status, testing, onSelect, onTest } = props;
  return (
    <div className="terminal-command" data-testid="terminal-command">
      <Bot aria-hidden="true" size={13} />
      <label className="terminal-command__picker">
        <span className="sr-only">Command</span>
        <select
          aria-label="Command"
          disabled={commands.length === 0}
          onChange={(event) => onSelect(event.currentTarget.value)}
          value={selectedId}
        >
          {commands.length === 0 ? <option value="">No saved Commands</option> : null}
          {commands.map((command) => <option key={command.id} value={command.id}>{command.label}</option>)}
        </select>
      </label>
      <span className={`terminal-command__facts ${facts?.launchable ? "terminal-command__facts--ready" : ""}`} title={status}>
        {facts ? `${facts.executablePath ?? facts.executable} · ${facts.cwd ?? "No working folder"}` : status || "Choose an enabled Command"}
      </span>
      <button
        className="terminal-command__test"
        data-testid="test-agent-command"
        disabled={!facts?.launchable || testing}
        onClick={onTest}
        title={facts?.launchable ? "Test once in a visible terminal" : facts?.detail ?? "Command is not ready"}
        type="button"
      >
        <Play aria-hidden="true" size={12} />
        {testing ? "Starting…" : "Test"}
      </button>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
