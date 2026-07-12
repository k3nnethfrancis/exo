import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import {
  agentCommandExecutableFingerprint,
  deriveAgentCommandLaunch,
  type AgentCommand,
  type AgentCommandLaunchContext,
} from "@exo/core";

import type { AgentCommandLaunchFacts } from "../shared/api";
import { commandEnvironment } from "./command-environment";

export async function inspectAgentCommandLaunchFacts(
  command: AgentCommand,
  context: AgentCommandLaunchContext,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<AgentCommandLaunchFacts> {
  const derived = deriveAgentCommandLaunch(command, context);
  const fingerprint = agentCommandExecutableFingerprint(command);
  if (!derived.launchable) {
    return {
      commandId: command.id,
      handle: command.handle,
      label: command.label,
      fingerprint,
      cwd: derived.cwd,
      cwdReady: false,
      executable: executableToken(command.command),
      executablePath: null,
      executableReady: false,
      launchable: false,
      block: derived.block,
      detail: derived.detail,
    };
  }

  const [cwdReady, executablePath] = await Promise.all([
    directoryExists(derived.cwd),
    resolveExecutable(executableToken(command.command), derived.cwd, commandEnvironment(environment).PATH),
  ]);
  const executable = executableToken(command.command);
  const executableReady = executablePath !== null;
  const detail = !cwdReady
    ? `Working folder does not exist: ${derived.cwd}`
    : !executableReady
      ? `Executable was not found: ${executable || command.command}`
      : "Ready to test in a visible terminal.";

  return {
    commandId: command.id,
    handle: command.handle,
    label: command.label,
    fingerprint,
    cwd: derived.cwd,
    cwdReady,
    executable,
    executablePath,
    executableReady,
    launchable: cwdReady && executableReady,
    ...(!cwdReady ? { block: "cwd-missing" as const } : !executableReady ? { block: "executable-missing" as const } : {}),
    detail,
  };
}

export function executableToken(command: string): string {
  const input = command.trimStart();
  if (!input) return "";
  const quote = input[0] === "\"" || input[0] === "'" ? input[0] : null;
  let token = "";
  for (let index = quote ? 1 : 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote && character === quote) break;
    if (!quote && /\s/.test(character)) break;
    if (character === "\\" && quote !== "'") {
      index += 1;
      token += input[index] ?? "";
    } else {
      token += character;
    }
  }
  return token;
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveExecutable(executable: string, cwd: string, pathValue: string | undefined): Promise<string | null> {
  if (!executable) return null;
  if (executable.includes(path.sep)) {
    const candidate = path.isAbsolute(executable) ? executable : path.resolve(cwd, executable);
    return await executableFile(candidate) ? candidate : null;
  }
  for (const directory of (pathValue ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, executable);
    if (await executableFile(candidate)) return candidate;
  }
  return null;
}

async function executableFile(target: string): Promise<boolean> {
  try {
    await access(target, constants.X_OK);
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}
