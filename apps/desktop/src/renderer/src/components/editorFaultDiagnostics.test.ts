import { describe, expect, it } from "vitest";

import { createEditorFaultDiagnostic } from "./editorFaultDiagnostics";

describe("editor fault diagnostics", () => {
  it("records only structural editor state and a content-free error signature", () => {
    const documentText = "private note body must not enter application logs";
    const diagnostic = createEditorFaultDiagnostic(
      {
        notePath: "/notes/daily.md",
        mode: "markdown-live",
        selection: { anchor: 12, head: 12 },
        agentHandle: "claude",
      },
      new Error(documentText),
      "2026-07-22T00:00:00.000Z",
    );

    expect(diagnostic).toEqual({
      kind: "editor-render-fault",
      occurredAt: "2026-07-22T00:00:00.000Z",
      notePath: "/notes/daily.md",
      mode: "markdown-live",
      selection: { anchor: 12, head: 12 },
      agentHandle: "claude",
      errorSignature: expect.stringMatching(/^Error:[a-f0-9]{8}$/),
    });
    expect(JSON.stringify(diagnostic)).not.toContain(documentText);
  });
});
