import { describe, expect, it } from "vitest";

import { markdownImageTarget, resolveMarkdownImageWithRetry } from "./widgets";

describe("markdown image targets", () => {
  it("keeps spaces in Markdown image filenames while removing an optional title", () => {
    expect(markdownImageTarget("attachments/chart one.png")).toBe("attachments/chart one.png");
    expect(markdownImageTarget('attachments/chart one.png "Quarterly chart"')).toBe("attachments/chart one.png");
    expect(markdownImageTarget("  attachments/chart%20one.png  ")).toBe("attachments/chart%20one.png");
  });

  it("retries a transient local image resolution failure", async () => {
    let attempts = 0;
    const result = await resolveMarkdownImageWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("workspace request was superseded");
        return { url: "file:///tmp/recovered.svg" };
      },
      "images/recovered.svg",
      undefined,
      { delayMs: 0 },
    );

    expect(result).toEqual({ url: "file:///tmp/recovered.svg" });
    expect(attempts).toBe(2);
  });
});
