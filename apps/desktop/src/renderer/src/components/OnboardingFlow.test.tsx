import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultWorkspaceContentPolicy } from "@exograph/core/workspace-content-policy";

import { OnboardingFlow } from "./OnboardingFlow";
import type { OnboardingState } from "../hooks/useWorkspaceBootstrap";

describe("OnboardingFlow", () => {
  it("renders the existing persisted setup model through a dedicated surface", () => {
    const state: OnboardingState = {
      mode: "first-run",
      step: "configure",
      workspaces: [],
      selectedWorkspaceId: null,
      notesFolder: "",
      defaultTerminalCwd: "",
      contentPolicy: defaultWorkspaceContentPolicy(),
      contentPolicyChoice: "recommended",
      contentInspection: null,
      indexMode: "lexical",
      searchEngine: "qmd",
      exploreIndexSearchOnEnter: false,
      indexUpdateStrategy: "on-save",
      agentCommands: [],
      agentInvocationPrompt: "",
      selectedMcpProviders: ["claude", "codex"],
      status: "idle",
      errorMessage: null,
    };

    const html = renderToStaticMarkup(
      <OnboardingFlow
        actions={{
          activateSelectedWorkspace: vi.fn(),
          completeOnboarding: vi.fn(),
          confirmOnboardingChange: vi.fn(),
          continueFromWorkspaceConfigure: vi.fn(),
          persistCurrentOnboardingState: vi.fn(),
          resetMalformedOnboardingProgress: vi.fn(),
          selectDefaultTerminalForOnboarding: vi.fn(),
          selectNotesFolderForOnboarding: vi.fn(),
          startNewWorkspaceSetup: vi.fn(),
        }}
        onDismiss={vi.fn()}
        onEditState={vi.fn()}
        state={state}
      />,
    );

    expect(html).toContain('data-testid="onboarding"');
    expect(html).toContain("Choose your main wiki");
    expect(html).toContain('data-testid="onboarding-choose-notes"');
  });
});
