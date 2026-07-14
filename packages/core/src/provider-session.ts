/** Build the provider-native Claude handoff shown to the user and executed by
 * Exo. Keeping this shared prevents the renderer label and terminal command
 * from drifting apart. */
export function commandForClaudeResume(command: { command: string }, sessionId: string): string {
  const executable = command.command
    .replace(/(?:^|\s)-p(?:\s|$)/g, " ")
    .replace(/(?:^|\s)--print(?:\s|$)/g, " ")
    .replace(/(?:^|\s)--output-format(?:\s+\S+|=\S+)?/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `${executable} --resume ${shellArgument(sessionId)}`;
}

function shellArgument(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
