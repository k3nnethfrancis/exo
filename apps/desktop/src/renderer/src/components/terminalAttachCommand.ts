import type { TerminalDiagnostics } from "../../../shared/api";

export async function copyTerminalAttachCommand(
  terminalId: string,
  options: {
    getDiagnostics?: () => Promise<TerminalDiagnostics[]>;
    writeText?: (text: string) => Promise<void>;
  } = {},
): Promise<boolean> {
  const getDiagnostics = options.getDiagnostics ?? (() => window.exo.terminals.diagnostics());
  const writeText = options.writeText ?? ((text: string) => navigator.clipboard.writeText(text));
  const diagnostic = (await getDiagnostics()).find((entry) => entry.id === terminalId);
  if (!diagnostic?.safeAttachCommand) {
    return false;
  }
  await writeText(diagnostic.safeAttachCommand);
  return true;
}
