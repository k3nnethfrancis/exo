import type { Page } from "@playwright/test";

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
    (expected) => document.querySelector(".xterm-rows")?.textContent?.includes(expected) ?? false,
    text,
    { timeout, polling: 10 },
  );
}

function percentile(sortedSamples: number[], percentileValue: number): number {
  const index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * percentileValue) - 1);
  return sortedSamples[Math.max(0, index)];
}
