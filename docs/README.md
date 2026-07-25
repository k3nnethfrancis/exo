# Exo documentation map

This is the public progressive-disclosure index. Start with the **current**
documents, then follow the source/test owner map. A proposal, dated review, or
historical packet is evidence—not a current architecture contract.

## Current product and operating contract

1. [`../README.md`](../README.md) — product surface, supported setup, and commands.
2. [`../AGENTS.md`](../AGENTS.md) — contributor invariants and validation routes.
3. [`../CONTEXT.md`](../CONTEXT.md) — canonical product vocabulary.
4. [`architecture.md`](architecture.md) — current conceptual architecture and deep-module boundaries.
5. [`launch-surface-ledger.md`](launch-surface-ledger.md) — code/test-grounded public surface classification.
6. [`durable-state.md`](durable-state.md) — persisted artifacts, authority, migration, recovery, and deletion gates.
7. [`performance-contracts.md`](performance-contracts.md) — latency gates and explicitly unmeasured actions.
8. [`harness.md`](harness.md) and [`usability-readiness.md`](usability-readiness.md) — validation and installed-app evidence.

`../tasks.md`, `../issues.md`, `../roadmap.md`, and `../ledger.md` are the
canonical tracker/history files; they are not substitutes for the current
architecture contract.

## Source and test owner map

| Concern | Current authority | Focused tests |
| --- | --- | --- |
| Workspace scope and filesystem containment | [`WorkspaceFiles`](../packages/core/src/workspace-files.ts) | [`workspace-files.test.ts`](../packages/core/src/__tests__/workspace-files.test.ts) |
| Settings, registry, and onboarding | [`WorkspaceConfigStore`](../apps/desktop/src/main/workspace/workspace-config-store.ts) and [`workspace-settings.ts`](../packages/core/src/workspace-settings.ts) | [`workspace-config-store.test.ts`](../apps/desktop/src/main/workspace/workspace-config-store.test.ts), [`onboarding.spec.ts`](../apps/desktop/tests/e2e/onboarding.spec.ts) |
| Search/index lifecycle | [`WorkspaceIndex`](../packages/core/src/workspace-index.ts), [`IndexingService`](../apps/desktop/src/main/indexing/indexing-service.ts) | [`workspace-index.test.ts`](../packages/core/src/__tests__/workspace-index.test.ts), [`derived-work-latency.spec.ts`](../apps/desktop/tests/e2e/derived-work-latency.spec.ts) |
| Knowledge graph and Ontology review | [`WorkspaceGraph`](../packages/core/src/workspace-graph.ts) | [`workspace-graph.test.ts`](../packages/core/src/__tests__/workspace-graph.test.ts), [`ontology-review.test.ts`](../packages/core/src/__tests__/ontology-review.test.ts) |
| Invocation and review | [`InvocationRunner`](../apps/desktop/src/main/invocation/invocation-runner.ts) | [`invocation-runner.test.ts`](../apps/desktop/src/main/invocation/invocation-runner.test.ts), [`invocation-review.test.ts`](../apps/desktop/src/main/invocation/invocation-review.test.ts) |
| Terminal lifecycle | [`TerminalManager`](../apps/desktop/src/main/terminal/terminal-manager.ts) | [`shell.spec.ts`](../apps/desktop/tests/e2e/shell.spec.ts) |
| Command server and CLI | [`CommandServerLifecycle`](../apps/desktop/src/main/command/command-server-lifecycle.ts), [`packages/cli/src/index.ts`](../packages/cli/src/index.ts) | [`command-server-lifecycle.test.ts`](../apps/desktop/src/main/command/command-server-lifecycle.test.ts), [`packages/cli/src/index.test.ts`](../packages/cli/src/index.test.ts) |
| Workspace watcher lifecycle | [`WorkspaceWatcherService`](../apps/desktop/src/main/workspace/workspace-watchers.ts) | [`workspace-watchers.test.ts`](../apps/desktop/src/main/workspace/workspace-watchers.test.ts) |
| Atomic Workspace activation | [`WorkspaceRuntimeCoordinator`](../apps/desktop/src/main/runtime/workspace-runtime-coordinator.ts) | [`workspace-runtime-coordinator.test.ts`](../apps/desktop/src/main/runtime/workspace-runtime-coordinator.test.ts) |
| Canvas document navigation and focus | [`useCanvasDocumentNavigation`](../apps/desktop/src/renderer/src/hooks/useCanvasDocumentNavigation.ts) | [`useCanvasDocumentNavigation.test.ts`](../apps/desktop/src/renderer/src/hooks/useCanvasDocumentNavigation.test.ts), [`latestPaneNavigation.test.ts`](../apps/desktop/src/renderer/src/latestPaneNavigation.test.ts) |
| Renderer invocation review lifecycle | [`useInvocationReviewController`](../apps/desktop/src/renderer/src/hooks/useInvocationReviewController.ts) | [`useInvocationReviewController.test.ts`](../apps/desktop/src/renderer/src/hooks/useInvocationReviewController.test.ts), [`invocationReviewQueue.test.ts`](../apps/desktop/src/renderer/src/invocationReviewQueue.test.ts) |
| Markdown live-preview feature | [`markdownLivePreview.ts`](../apps/desktop/src/renderer/src/components/markdownLivePreview.ts) adapter and private [`markdown-live-preview/`](../apps/desktop/src/renderer/src/components/markdown-live-preview/) owners | [`index.test.ts`](../apps/desktop/src/renderer/src/components/markdown-live-preview/index.test.ts), [`markdown-rules.spec.ts`](../apps/desktop/tests/e2e/markdown-rules.spec.ts) |
| Desktop shared API aggregate | [`shared/api.ts`](../apps/desktop/src/shared/api.ts) | [`preload/index.ts`](../apps/desktop/src/preload/index.ts), [`workspace-ipc.ts`](../apps/desktop/src/main/workspace/workspace-ipc.ts), [`vite-env.d.ts`](../apps/desktop/src/renderer/src/vite-env.d.ts) compile against the aggregate |
| Command route and client transport | [`command-protocol.ts`](../packages/core/src/command-protocol.ts), [`AppClient`](../packages/cli/src/app-client.ts) | [`command-server.test.ts`](../apps/desktop/src/main/command/command-server.test.ts), [`app-client.test.ts`](../packages/cli/src/app-client.test.ts) |

## Decisions, proposals, and evidence

- [`adr/`](adr/) contains durable decisions. ADR identities are unique; ADR 0008
  is the derived-work performance decision, while ADR 0003 reserves Plugin for
  future distribution bundles.
- Current supporting contracts are [`note-root-formats.md`](note-root-formats.md),
  [`workspace-ontology.md`](workspace-ontology.md),
  [`terminal-runtime-decision.md`](terminal-runtime-decision.md),
  [`extension-architecture.md`](extension-architecture.md),
  [`provider-mcp-onboarding.md`](provider-mcp-onboarding.md), and
  [`public-contract-reviews.md`](public-contract-reviews.md).
- `agent-plans/`, `*plan*.md`, `feature-ideas.md`, and the graph/ontology/QMD
  planning documents are proposals unless their own status says otherwise.
  Consult their current owner before implementation; they do not override the
  source map above.
- [`reviews/`](reviews/) and [`history/`](history/) are dated historical
  evidence. `public-surface-ledger.md`, `exograph-simplification-plan.md`, and
  `graph-system-implementation-plan.md` are retained historical records, not
  current route maps.
- `benchmarks/graphbench/` and `packages/core/src/__tests__/fixtures/` are
  supported benchmark/fixture material, not product architecture documents.
