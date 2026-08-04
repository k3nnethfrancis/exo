import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_ZOOM_FACTOR,
  MAX_APP_ZOOM_FACTOR,
  MIN_APP_ZOOM_FACTOR,
  nextAppZoomFactor,
  normalizeAppZoomFactor,
} from "./app-zoom";

describe("app zoom", () => {
  it("steps around the current whole-app scale and resets to the baseline", () => {
    expect(nextAppZoomFactor(1, 1)).toBe(1.1);
    expect(nextAppZoomFactor(1.1, -1)).toBe(1);
    expect(nextAppZoomFactor(1.4, 0)).toBe(DEFAULT_APP_ZOOM_FACTOR);
  });

  it("keeps persisted and requested zoom factors within the supported range", () => {
    expect(normalizeAppZoomFactor(Number.NaN)).toBe(DEFAULT_APP_ZOOM_FACTOR);
    expect(nextAppZoomFactor(MAX_APP_ZOOM_FACTOR, 1)).toBe(MAX_APP_ZOOM_FACTOR);
    expect(nextAppZoomFactor(MIN_APP_ZOOM_FACTOR, -1)).toBe(MIN_APP_ZOOM_FACTOR);
  });
});
