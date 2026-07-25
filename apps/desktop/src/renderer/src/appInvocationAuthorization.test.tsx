import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AppInvocationAuthorizationGate, invocationAuthorizationForDecision } from "./appInvocationAuthorization";

describe("agent invocation review", () => {
  it("wires an untrusted invocation to the anchored page authorization choices", () => {
    const html = renderToStaticMarkup(
      <AppInvocationAuthorizationGate
        pending={{
          command: {
            id: "claude",
            handle: "claude",
            label: "Claude",
            command: "claude -p",
            adapter: "claude-code",
            continuityPolicy: "continuous",
            cwdPolicy: "workspace_root",
            promptDelivery: "stdin",
            version: 1,
            enabled: true,
          },
          cwd: "/workspace/notes",
          draft: {
            anchor: { left: 96, top: 144, origin: "top left" },
            message: "Review this note.",
          } as never,
          fingerprint: "sha256:test",
          reason: "This command has not been allowed here yet.",
        }}
        onAuthorize={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain("--invocation-popover-left:96px");
    expect(html).toContain("--invocation-popover-top:144px");
    expect(html).toContain("Run once");
    expect(html).toContain("Always allow here");
    expect(invocationAuthorizationForDecision("once")).toEqual({ kind: "run-once" });
    expect(invocationAuthorizationForDecision("workspace")).toEqual({ kind: "always-allow" });
  });
});
