export function isTerminalGeneratedResponse(data: string): boolean {
  return /^(?:\x1b\[[?>]?\d*(?:;\d+)*(?:c|n|R)|(?:[?>]?\d+(?:;\d+)*(?:c|n|R)))$/.test(data);
}
