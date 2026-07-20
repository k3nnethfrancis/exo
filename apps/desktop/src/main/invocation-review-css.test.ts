import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("invocation review motion", () => {
  it("removes review-control motion when reduced motion is requested", () => {
    const css = readFileSync(
      new URL("../renderer/src/components/invocation/invocation-ui.css", import.meta.url),
      "utf8",
    );
    const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedMotion).toContain(".invocation-review-controls__bulk summary svg");
    expect(reducedMotion).toContain(".invocation-review-decision { transition: opacity 100ms ease; }");
    expect(reducedMotion).toContain(".invocation-review-decision:active { transform: none; }");
  });
});
