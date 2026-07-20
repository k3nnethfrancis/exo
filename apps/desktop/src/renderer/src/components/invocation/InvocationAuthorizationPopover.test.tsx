import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  InvocationAuthorizationPopover,
  nextAuthorizationFocusIndex,
} from "./InvocationAuthorizationPopover";

describe("InvocationAuthorizationPopover", () => {
  it("keeps the common trust decision compact and explicit", () => {
    const html = renderToStaticMarkup(
      <InvocationAuthorizationPopover
        commandHandle="claude"
        commandLabel="Claude"
        details={{
          command: "claude -p",
          cwd: "/workspace/notes",
          adapter: "claude-code",
          continuity: "continuous",
          fingerprint: "abc123",
          reason: "This Command has not been allowed here yet.",
        }}
        onAuthorize={() => {}}
        onCancel={() => {}}
        request="Review this note."
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Run once");
    expect(html).toContain("Always allow here");
    expect(html).toContain("Cancel");
    expect(html).toContain("Runs locally with this agent&#x27;s existing permissions.");
    expect(html).toContain("<details");
    expect(html).not.toContain("Don’t ask again");
  });

  it("wraps keyboard focus at both ends", () => {
    expect(nextAuthorizationFocusIndex(0, 4, true)).toBe(3);
    expect(nextAuthorizationFocusIndex(3, 4, false)).toBe(0);
    expect(nextAuthorizationFocusIndex(1, 4, false)).toBe(2);
    expect(nextAuthorizationFocusIndex(-1, 4, false)).toBe(0);
    expect(nextAuthorizationFocusIndex(-1, 0, false)).toBeNull();
  });
});
