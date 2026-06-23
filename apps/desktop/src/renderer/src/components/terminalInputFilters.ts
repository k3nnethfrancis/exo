export function isTerminalGeneratedResponse(data: string): boolean {
  // xterm can answer device/color queries through onData; those bytes are not
  // user keystrokes and must not be echoed back into tmux as prompt input.
  return /^(?:\x1b\[[?>]?\d*(?:;\d+)*(?:c|n|R)|[?>]?\d+(?:;\d+)*(?:c|n|R)|(?:(?:\x1b)?\](?:(?:10|11|12)|4;\d{1,3});rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}(?:\x07|\x1b\\|\\))+)$/.test(data);
}
