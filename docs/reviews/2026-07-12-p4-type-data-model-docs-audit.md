# P4 type, data-model, and documentation audit

Date: 2026-07-12
Scope: pre-implementation audit for Loop 01 P4. This is an evidence record, not a replacement for the active plan and does not modify the active P2 Note-Root migration.

## Decision boundary

P4 starts only after P1 settles Settings preservation and P2 settles the retained Note-Root-only model. The current dirty source changes already remove much of `projectRoots`, but tests, fixtures, and some runtime callers still mention it. Do not use this audit to prematurely delete compatibility/migration evidence or to polish old documents in place.

The authoritative current-product sources are:

| Topic | Canonical source | Supporting implementation / evidence |
| --- | --- | --- |
| Shared vision and product boundary | `../../notes/shoshin-codex/ashby.md`, `CONTEXT.md` | `AGENTS.md` product rules |
| Active sequence and ship gates | `docs/exograph-simplification-plan.md`, `tasks.md` | `issues.md` acceptance criteria |
| Current public product and setup | `README.md` | desktop/CLI behavior and E2E |
| Architecture and ownership | `docs/architecture.md` | `packages/core/src/index.ts`, desktop deep modules |
| Extension boundary | `docs/extension-architecture.md`, ADR 0003 | caller evidence and `AGENTS.md` |
| Durable architectural decisions | `docs/adr/0002-folder-indexes-as-ontology.md`, `docs/adr/0003-plugins-are-distribution-bundles.md` | future work remains tracked in `tasks.md` |
| Bugs and dogfood evidence | `issues.md` | focused tests and packaged-app evidence |
| Protected operator contracts | `docs/public-contract-reviews.md` | `packages/core/src/command-protocol.ts`, CLI, `scripts/check-repo.mjs` |
| Shipped history / review decisions | `ledger.md`, `docs/reviews/` | Git history |

`tasks.md` wins when a document calls a feature "current" but the ledger says it is future work. Code and tests win for actual shipped behavior.

## Retained feature and data-model coverage index

| Retained domain | Durable data / boundary and owner | Main public adapters | Verification gate | Product/document source | P4 action |
| --- | --- | --- | --- | --- | --- |
| Workspace authorization | `WorkspaceModel`, `NoteRoot`, `WorkspaceFiles` in `packages/core/src/types.ts` and `workspace-files.ts`; canonical path containment is the current boundary | Desktop `workspace:*` IPC, command-server document reader, CLI | `workspace*.test.ts`, desktop containment tests, guarded real-vault-copy dogfood | `CONTEXT.md`, `AGENTS.md`, `issues.md#EXO-ISSUE-103` | Retain; remove all P2-only Project Root references after migration proof. Do not claim root-relative IDs are shipped: Fable deferred them as an interface-quality follow-up. |
| Persisted workspace configuration | `WorkspaceSettings`, snapshots/revisions, transaction and registry in `workspace-settings.ts`; serialized by `WorkspaceConfigStore` | Settings IPC, onboarding, app-off config/status | core settings transaction/migration tests; Electron settings-preservation journeys | `issues.md#EXO-ISSUE-102`, architecture | Retain unknown-key preservation and named removal migration. Document each owned setting only once; decide stale terminal compatibility keys separately with terminal review. |
| Markdown Notes and properties | `NoteDocument`, `notes.ts`, `WorkspaceFiles`, frontmatter/body on disk | editor, editor properties, read/search | core notes/workspace tests; Markdown E2E | `CONTEXT.md` | Retain. Ensure docs say Markdown/frontmatter, not a hidden schema, are canonical. |
| Explorer and tree | `TreeNode`, `listRootTree`, renderer `FileTree` | tree/list/create/rename/delete IPC | workspace tree/mutation tests and Electron QA | README/architecture | Retain. Folder Index hiding is only an Explorer presentation rule once the vertical slice lands. |
| Search and indexing | `IndexedRoot`, `IndexingConfig`, `WorkspaceIndex`, `SearchProvider`, filesystem/QMD adapters | search/index IPC, CLI and command server | core search/index/QMD tests; E2E search; latency suite | README, architecture, `qmd-integration-notes.md` | Retain providers as implementation seam; ensure `indexedRoots` never becomes a second editable/read authorization class. |
| Graph read model | graph snapshot/query/context types, `WorkspaceGraph` | Connections and command context | graph/query/snapshot tests | architecture, `CONTEXT.md` | Retain current links/backlinks/tags/properties. Folder-containment and relevant-context claims remain target work until tests/UI exist. |
| Canvas / panes | `WorkspaceCanvasLayoutSettings`, pane tree and renderer pane helpers | layout persistence and pane controls | pane/layout tests and Electron QA | architecture, settings issue | Retain v2 canvas. Preserve legacy layout only as a load migration until a validated rewrite/removal decision. |
| Terminal | terminal settings, `TerminalManager`, direct `node-pty`, xterm | terminal IPC and CLI | terminal focused suite, `pnpm terminal:check`, real Electron QA | `docs/terminal-runtime-decision.md`, terminal skill | Retain direct-PTY + bounded replay. `terminalTranscriptRetention*` is a suspect persisted compatibility field, not proof of a current transcript feature. Trace all reads before removal. |
| Configured Commands and invocation | `AgentCommand`, `InvocationRecord`, `InvocationRunner`, trust store and `.exo/invocations/` | inline composer, invocation IPC, `exo spawn` | core prompt/trust/invocation tests; Electron invocation E2E; real-work dogfood | `CONTEXT.md`, `issues.md#EXO-ISSUE-106` | Retain. Current composer behavior is shipped; full user dogfood/diff accept-reject evidence remains open. |
| Preview and command server | `command-protocol.ts`, target validation, lifecycle | `exo open`, preview routes, resident app | command-server and preview E2E | public-contract ledger | Retain only reviewed routes. Any P2 status/payload deletion must update the protected-contract ledger. |
| Derived runtime state | `.exo/qmd/`, `.exo/invocations/`, artifacts/provenance references | core stores / runtime services | store/index/invocation tests | README, architecture, `CONTEXT.md` | Retain as derived state. Never describe it as canonical knowledge or durable terminal transcript history. |

## Findings that P4 must resolve

1. **Target versus shipped product is blurred.** `README.md`, `CONTEXT.md`, `docs/architecture.md`, and `docs/extension-architecture.md` describe Folder Overview, Folder Index authoring, graph-management Skills, and expanded relevant-context behavior as present-tense baseline/V1. `tasks.md` explicitly schedules Folder Overview and the first Skill *after* the trust gates. Keep the concepts, but label them as the next vertical slice until implementation, tests, and app QA land.
2. **Identity wording is ahead of the retained code decision.** `docs/architecture.md` says `WorkspaceFiles` owns root-relative operations; `docs/extension-architecture.md` calls `rootId + rootRelativePath` V1 canonical identity. Current shared data types and IPC paths still use canonical absolute paths, and Fable ruled root-relative IDs are not required for EXO-ISSUE-103 closure. Describe canonical-path authorization as current; retain root-relative identity only as a later interface-quality item.
3. **The legacy P2 vocabulary is still visible in active documents.** `issues.md#EXO-ISSUE-105` says "Attached folders," `docs/usability-readiness.md` promises project-file editing and CLI/MCP, and older documents call `projectRoots` an active model. The P2 migration must finish before these are corrected or deleted; do not introduce a compatibility alias.
4. **The type model has three independently auditable leftovers.** `WorkspaceModel.attachedWorkcells` is always initialized to `[]`; `SearchResult.kind` still includes `project-file`; and `WorkspaceSettings.terminalTranscriptRetention*` remains persisted despite the direct-PTY decision rejecting product transcript history. They need live-caller proof and an explicit retain/migrate/delete decision, not cosmetic renaming.
5. **ADR 0001 contradicts the active vocabulary.** `docs/adr/0001-plugins-and-profiles.md` still declares plugins as replaceable capabilities and profiles as bundles. It should remain historical only if labelled `Superseded by ADR 0003`; it cannot appear in the durable-decision list as an active decision.
6. **The Fable packet has stale leading status.** `docs/reviews/2026-07-12-fable-loop-01-packet.md` begins "prepared ... no implementation fan-out authorized" but contains a received ruling. Change the header to received/implemented-asynchronously when P4 accepts the current review record.
7. **The docs map still preserves stale plans as discoverable material.** `docs/README.md` correctly calls them historical but leaves a large active-looking corpus. P4 should delete obsolete contracts/plans rather than refresh them, retaining only dated reviews and `ledger.md` for archaeology.

## Exact disposition list

### Preserve and refresh only after P1/P2

- Root: `AGENTS.md`, `CONTEXT.md`, `README.md`, `roadmap.md`, `tasks.md`, `issues.md`, `ledger.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`.
- Current architecture and operations: `docs/README.md`, `docs/architecture.md`, `docs/extension-architecture.md`, `docs/terminal-runtime-decision.md`, `docs/qmd-integration-notes.md`, `docs/public-contract-reviews.md`, `docs/public-surface-ledger.md`, `docs/harness.md`, `docs/usability-readiness.md`.
- Durable decisions/review evidence: `docs/adr/0002-folder-indexes-as-ontology.md`, `docs/adr/0003-plugins-are-distribution-bundles.md`, every file under `docs/reviews/`, and the `fable-exo-*.md` files at repository root.
- Keep `docs/adr/0001-plugins-and-profiles.md` only as a clearly marked **superseded historical ADR**; do not delete or rewrite its decision as current.
- Keep `docs/invocation-context-and-safety.md`, `docs/invocation-concurrency-and-attribution.md`, and `docs/agent-output-conventions.md` only if P3 adopts their still-true invariants into current invocation docs/tests. Otherwise replace their useful decisions in one current invocation document and delete them.
- Keep `docs/feature-ideas.md`, `docs/github-issue-fix-loop.md`, `docs/open-source.md`, and `docs/qmd-integration-plan.md` only after each receives a one-line current/superseded disposition. The QMD plan in particular must lose MCP claims if retained.

### Delete after their few historical decisions are captured in `ledger.md` or `docs/reviews/`

- Plugin/profile contracts: `docs/activity-plugin-contract.md`, `docs/agent-harness-plugin-contract.md`, `docs/graph-visualization-plugin-contract.md`, `docs/plugin-architecture-audit.md`, `docs/plugin-implementation-plan.md`, `docs/plugin-manager-foundation.md`, `docs/plugin-surface-contract.md`, `docs/plugin-system-architecture.md`, `docs/plugins.md`, `docs/profile-plugin-management-plan.md`.
- Old product plans/pivots: `docs/agent-identity-reconciliation.md`, `docs/control-plane-catalog.md`, `docs/exograph-completion-master-plan.md`, `docs/exograph-completion-orchestration-plan.md`, `docs/exograph-detailed-implementation-plans.md`, `docs/exograph-refactor-completion-plan.md`, `docs/note-native-agent-invocation-pivot.md`, `docs/note-native-invocation-prototype-evidence.md`, `docs/onboarding-settings-boundaries.md`, `docs/pivot-product-definition.md`, `docs/pivot-roadmap-rewrite-notes.md`, `docs/pivot-subsystem-disposition.md`, `docs/strategy.md`.
- Tmux/transcript-era plans/audits: `docs/terminal-architecture-v4.md`, `docs/terminal-attach-spike-report.md`, `docs/terminal-code-review-2026-06-23.md`, `docs/terminal-fallback-audit.md`, `docs/terminal-quality-standard.md`, `docs/terminal-refactor-plan.md`, `docs/terminal-render-cleanup-protocol.md`, `docs/wp-078-pi-answer-visibility-diagnostic.md`.
- Superseded MCP/staff artifacts: `docs/mcp-nde-test-2026-06-20.md`, `docs/staff-code-review-2026-05-27.md`.

This is a deletion candidate list, not authorization to remove files before the P2 migration and public-contract verification complete. If Git history is sufficient for archaeology, delete rather than move them to a second in-repo archive.

## Safe P4 order

1. **Freeze the retained model.** Accept P1 section-preservation evidence and P2 caller/removal evidence first. Record the final Project Root contract deletion in `docs/public-contract-reviews.md` with the required hash/review note.
2. **Decide current dirty work, do not intermingle it.** Separate the uncalled Command-readiness draft from the intentional dirty docs. Discard or park the draft; review the intentional docs against this audit before staging them.
3. **Perform the source/type sweep before prose.** Search every exported shared type, persisted key, IPC method, command-server payload, CLI status payload, environment variable, and `.exo/` path. For each, record owner, normalizer/validator, and user meaning. Delete dead fields/callers and their tests in the same vertical change.
4. **Reconcile active canonical docs in one pass.** Update the preserved roots/current docs to distinguish current behavior from next-slice design; eliminate Attached Folder/Project Root/MCP/tmux/transcript claims; establish the doc order from `docs/README.md`.
5. **Retire obsolete plans in a separate deletion commit.** First update inbound links and docs map; then delete the exact candidates above. Preserve dated Fable review evidence and ADR history rather than copying large obsolete plans forward.
6. **Write the coverage index.** Promote the retained-domain table above into a compact maintained location (prefer a short `docs/architecture.md` section or `docs/README.md` linked index, not another parallel planning document). It must point to code, tests, user behavior, and canonical docs.
7. **Close history cleanly.** Update `tasks.md`, resolved `issues.md` entries, `ledger.md`, and `CHANGELOG.md` only with shipped facts and evidence.

## P4 verification gates

- **Type/API sweep:** `rg` finds no active `projectRoots`, `AttachedRoot`, `RootKind.projects`, `EXO_PROJECT_ROOTS`, or attached-folder UI after P2, except named migration tests/history explicitly documenting removal.
- **Persistence:** legacy settings/registry/transaction fixtures lose only `projectRoots`; commands, layout, indexed roots, unknown future keys, and migration metadata survive. Run core settings tests plus the Electron section-by-section Settings journey.
- **Trust:** containment tests cover duplicate Note Roots, traversal, symlink file/directory, missing ancestors, rename/delete, in-root wikilinks, and former Project Root paths failing closed; complete guarded real-vault-copy QA.
- **Contract:** when status/env/shared payloads move, update `docs/public-contract-reviews.md` and run `pnpm check:repo`; inspect CLI help/status and command-server behavior, not only types.
- **Terminal:** run the terminal-stability review before removing transcript compatibility keys; keep direct-PTY input, bounded replay, and operator-tail coverage.
- **Docs:** automated stale-vocabulary scan plus manual link check: active docs must not claim MCP, Project Roots/Attached Folders, Exo-owned transcripts, Plugin Manager, harness registry, or Folder Overview/Skill implementation before it exists. Historical reviews may use those words only with an explicit historical/superseded label.
- **Release evidence:** `pnpm ci:check`, focused Electron/E2E tests for changed surfaces, and installed packaged-app QA. Do not claim a feature from a plan; require executable or manual evidence.

-- Codex P4 audit | 2026-07-12
