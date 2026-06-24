import { readFileSync } from "node:fs";

interface TerminalRenderStabilityFixture {
  headerLines: string[];
  spinnerUpdates: string[];
  wrappedPrompt: string;
  expectedFragments: string[];
  visibleFragments: string[];
}

const renderFixture = JSON.parse(readFileSync(new URL("./fixtures/terminal-render-stability.json", import.meta.url), "utf8")) as TerminalRenderStabilityFixture;

export const TERMINAL_RENDER_STABILITY_EXPECTED_FRAGMENTS = renderFixture.expectedFragments;
export const TERMINAL_RENDER_STABILITY_VISIBLE_FRAGMENTS = renderFixture.visibleFragments;

export function terminalRenderStabilityBody(): string {
  return [...renderFixture.headerLines.map((line) => `${line}\r\n`), ...renderFixture.spinnerUpdates, `${renderFixture.wrappedPrompt}\r\n`].join("");
}

export function terminalRenderStabilityIssues(
  text: string,
  options: { requireExpectedFragments?: boolean; requireVisibleFragments?: boolean } = {},
): string[] {
  const issues: string[] = [];

  if (text.includes("\uFFFD")) {
    issues.push("contains Unicode replacement character U+FFFD");
  }
  if (/\?{3,}/.test(text)) {
    issues.push("contains three or more consecutive question marks");
  }
  if (/[\u25a1\u25af]/.test(text)) {
    issues.push("contains common tofu placeholder square glyphs");
  }

  if (options.requireExpectedFragments) {
    for (const fragment of TERMINAL_RENDER_STABILITY_EXPECTED_FRAGMENTS) {
      if (!text.includes(fragment)) {
        issues.push(`missing expected render fragment ${JSON.stringify(fragment)}`);
      }
    }
  }

  if (options.requireVisibleFragments) {
    for (const fragment of TERMINAL_RENDER_STABILITY_VISIBLE_FRAGMENTS) {
      if (!text.includes(fragment)) {
        issues.push(`missing expected visible fragment ${JSON.stringify(fragment)}`);
      }
    }
  }

  return issues;
}
