import os from "node:os";
import path from "node:path";

/**
 * GUI-launched macOS apps receive a much smaller PATH than an interactive shell.
 * Preserve its order, then add user-owned command locations common package
 * managers use. Command configuration remains the source of truth and its
 * fingerprint still controls remembered trust.
 */
export function commandEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = environment.HOME || os.homedir();
  const directories = [
    ...(environment.PATH ?? "").split(path.delimiter),
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);

  return { ...environment, PATH: [...new Set(directories)].join(path.delimiter) };
}
