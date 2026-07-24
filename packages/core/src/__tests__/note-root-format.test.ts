import { describe, expect, it } from "vitest";

import { noteRootFormat } from "../note-root-format";

describe("Note Root Format selection", () => {
  it("rejects an unknown Format before it can select Generic Markdown", () => {
    expect(() => noteRootFormat("unknown-format")).toThrow("Unknown Note Root Format: unknown-format");
  });
});
