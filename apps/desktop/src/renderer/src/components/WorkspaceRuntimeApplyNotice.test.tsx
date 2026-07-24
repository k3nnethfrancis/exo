import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceRuntimeApplyNotice } from "./WorkspaceRuntimeApplyNotice";

describe("WorkspaceRuntimeApplyNotice", () => {
  it("renders degradation as a compact accessible status with one recovery action", () => {
    const html = renderToStaticMarkup(
      <WorkspaceRuntimeApplyNotice
        message="The workspace is active, but command discovery needs recovery."
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Workspace settings need attention"');
    expect(html).toContain("The workspace is active, but command discovery needs recovery.");
    expect(html).toContain('aria-label="Retry workspace settings"');
    expect(html).toContain("workspace-runtime-apply-notice");
  });
});
