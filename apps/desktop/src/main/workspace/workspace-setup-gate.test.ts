import { describe, expect, it } from "vitest";

import { hasOperatorWorkspaceSetup } from "./workspace-setup-gate";

describe("workspace setup gate", () => {
  it("does not let an inherited note-root environment bypass a real user's onboarding", () => {
    expect(hasOperatorWorkspaceSetup({ EXO_NOTE_ROOTS: "/Users/example/notes" })).toBe(false);
  });

  it("permits explicit isolated test fixtures", () => {
    expect(hasOperatorWorkspaceSetup({ EXO_TEST: "1", EXO_NOTE_ROOTS: "/tmp/fixture/notes" })).toBe(true);
  });

  it("does not bypass setup for an empty test root", () => {
    expect(hasOperatorWorkspaceSetup({ EXO_TEST: "1", EXO_NOTE_ROOTS: "  " })).toBe(false);
  });
});
