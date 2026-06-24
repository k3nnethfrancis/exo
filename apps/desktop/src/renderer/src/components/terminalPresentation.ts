const CLAUDE_ACTION_MARKER = "\u23fa";
const TEXT_PRESENTATION_SELECTOR = "\ufe0e";
const EMOJI_PRESENTATION_SELECTOR = "\ufe0f";

export function normalizeTerminalPresentation(data: string): string {
  if (!data.includes(CLAUDE_ACTION_MARKER)) {
    return data;
  }

  let output = "";
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];
    output += char;
    if (char !== CLAUDE_ACTION_MARKER) {
      continue;
    }

    const next = data[index + 1];
    if (next !== TEXT_PRESENTATION_SELECTOR && next !== EMOJI_PRESENTATION_SELECTOR) {
      output += TEXT_PRESENTATION_SELECTOR;
    }
  }
  return output;
}
