import { describe, expect, it } from "vitest";

import {
  DEFAULT_UTILITY_SURFACE_STATE,
  isUtilityDestinationActive,
  reduceUtilitySurface,
} from "./utilitySurfaceModel";

describe("utility surface model", () => {
  it("opens directly on the selected destination", () => {
    const state = reduceUtilitySurface(DEFAULT_UTILITY_SURFACE_STATE, {
      type: "select",
      destination: "preview",
    });

    expect(state).toEqual({ open: true, destination: "preview" });
    expect(isUtilityDestinationActive(state, "preview")).toBe(true);
    expect(isUtilityDestinationActive(state, "terminal")).toBe(false);
  });

  it("switches destinations without representing two active surfaces", () => {
    const preview = reduceUtilitySurface(DEFAULT_UTILITY_SURFACE_STATE, {
      type: "select",
      destination: "preview",
    });
    const connections = reduceUtilitySurface(preview, {
      type: "select",
      destination: "connections",
    });

    expect(connections).toEqual({ open: true, destination: "connections" });
    expect(["terminal", "preview", "connections"].filter((destination) =>
      isUtilityDestinationActive(connections, destination as "terminal" | "preview" | "connections"),
    )).toEqual(["connections"]);
  });

  it("retains the selected destination while the whole surface is hidden", () => {
    const selected = reduceUtilitySurface(DEFAULT_UTILITY_SURFACE_STATE, {
      type: "select",
      destination: "connections",
    });
    const hidden = reduceUtilitySurface(selected, { type: "toggle" });
    const reopened = reduceUtilitySurface(hidden, { type: "toggle" });

    expect(hidden).toEqual({ open: false, destination: "connections" });
    expect(reopened).toEqual(selected);
  });
});
