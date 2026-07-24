import { describe, expect, it } from "vitest";

import { markdownImageTarget } from "./widgets";

describe("markdown image targets", () => {
  it("keeps spaces in Markdown image filenames while removing an optional title", () => {
    expect(markdownImageTarget("attachments/chart one.png")).toBe("attachments/chart one.png");
    expect(markdownImageTarget('attachments/chart one.png "Quarterly chart"')).toBe("attachments/chart one.png");
    expect(markdownImageTarget("  attachments/chart%20one.png  ")).toBe("attachments/chart%20one.png");
  });
});
