import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { terminalRenderStabilityIssues } from "./terminalRenderStability";

export interface LatencySummary {
  max: number;
  p50: number;
  p90: number;
  samples: number[];
}

export function latencySummary(samples: number[]): LatencySummary {
  if (samples.length === 0) {
    throw new Error("Cannot summarize empty latency samples.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    samples,
  };
}

export async function waitForTerminalText(page: Page, text: string, timeout = 5_000): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      Array.from(document.querySelectorAll(".xterm-rows")).some((rows) => rows.textContent?.includes(expected) ?? false),
    text,
    { timeout, polling: 10 },
  );
}

export async function visibleTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => Array.from(document.querySelectorAll(".xterm-rows")).map((rows) => rows.textContent ?? "").join("\n"));
}

export async function expectTerminalRenderStable(page: Page): Promise<void> {
  const visibleText = await visibleTerminalText(page);
  const sessionText = await page.evaluate(async () => {
    const sessions = await window.exo.terminals.list();
    const claude = sessions.find((session) => session.kind === "claude");
    return claude ? await window.exo.terminals.read(claude.id) : "";
  });

  expect(
    terminalRenderStabilityIssues(sessionText, {
      requireExpectedFragments: true,
    }),
    `terminal render stability session text failed:\n${sessionText}`,
  ).toEqual([]);
  expect(
    terminalRenderStabilityIssues(visibleText, {
      requireVisibleFragments: true,
    }),
    `terminal render stability visible text failed:\n${visibleText}`,
  ).toEqual([]);
}

function percentile(sortedSamples: number[], percentileValue: number): number {
  const index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * percentileValue) - 1);
  return sortedSamples[Math.max(0, index)];
}
