import { describe, expect, it } from "vitest";

import { stringifyFrontmatterValue } from "./documentDisplay";

describe("stringifyFrontmatterValue", () => {
  it("keeps YAML dates in their calendar form", () => {
    expect(stringifyFrontmatterValue(new Date("2026-07-11T00:00:00.000Z"))).toBe("2026-07-11");
  });
});
