# Launch Surface Ledger

Last verified: 2026-07-20 at `cbe88cf`

This is the code-grounded launch inventory for Exo. It records surfaces a user,
installer, or external agent can actually reach. Preload and main-process IPC are
implementation plumbing, so they appear as ownership evidence rather than as a
separate list of supposed product features.

## Classification

- **shipped** — reachable, supported by current tests, and part of the launch product.
- **experimental** — reachable and useful, but not yet a launch promise.
- **planned** — an accepted direction with no complete user-reachable implementation.
- **migration-only** — retained for developer/local upgrade or compatibility work, not
  a product concept.
- **stale** — visible or documented residue with no truthful current behavior.

## App shell, onboarding, and settings

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| First-run workspace and main Note Root setup | shipped | `apps/desktop/src/renderer/src/App.tsx`; `packages/core/src/onboarding-state.ts`; desktop workspace setup/store | `workspace-setup-gate.test.ts`; `workspace-config-store.test.ts`; `shell.spec.ts` first-run flows | `README.md`; `docs/provider-mcp-onboarding.md` | Required | Preserve the one-workspace/one-main-root launch path; do not imply attached projects or a machine-wide scan. |
| Agent access setup (CLI plus optional MCP for Claude/Codex) | shipped | onboarding in `App.tsx`; `provider-mcp-setup.ts`; `cli-installation.ts` | `provider-mcp-setup.test.ts`; `cli-installation.test.ts`; CLI/MCP tests | `docs/provider-mcp-onboarding.md`; `README.md` | Required | Keep MCP copy explicit: two read-only tools. CLI and MCP are separate access modes. |
| Invocation Command setup | shipped | onboarding in `App.tsx`; `WorkspaceSettingsDialog.tsx`; `agent-invocation.ts` | `agent-invocation.spec.ts`; core invocation tests | `README.md`; `docs/document-agent-protocol.md` | Required | Keep recommended defaults editable; keep prompt editing advanced rather than primary. |
| Workspace switching | shipped | `App.tsx`; workspace setup/config store | `shell.spec.ts` workspace-switch journey | `README.md` | Required | No global merged workspace is promised. |
| App shell, explorer, breadcrumbs, tabs, and utility rail | shipped | `App.tsx`; `ShellLayout.tsx`; `ExplorerSections.tsx`; layout hooks | `shell.spec.ts`; visual shell tests; renderer model tests | `README.md` | Required | Continue launch bug fixing; do not reintroduce parallel side panes. |
| Settings: Workspace, Search, Appearance, Terminal, Agents | shipped | `WorkspaceSettingsDialog.tsx`; settings controller/store | `settings-preservation.spec.ts`; settings controller/core tests | `README.md`; `docs/architecture.md` | Required | Settings must describe adapters as choices, not product identities. |

## Editor, files, folders, and properties

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown editor with live document rendering | shipped | `NoteEditor.tsx`; `EditorPane.tsx`; document display/parser modules | markdown rule/code/list tests; editor latency e2e | `README.md`; `docs/architecture.md` | Required | Maintain typing and open latency gates. |
| Note create, open, rename, delete, and external refresh | shipped | `ExplorerSections.tsx`; workspace notes/files services | `shell.spec.ts`; `external-file-changes.spec.ts`; workspace file tests | `README.md` | Required | Mutations remain contained to the selected Note Root. |
| Folder navigation and optional `index.md` Folder Overview | shipped | folder index core; explorer/editor navigation | `folder-index.test.ts`; `shell.spec.ts` | `CONTEXT.md`; ADR 0002 | Required | `index.md` is hidden as an implementation filename; no automatic content generation. |
| Standard note properties and open frontmatter | shipped | editor properties UI; Markdown parsing in core graph | `note-properties.spec.ts`; graph/workspace graph tests | `README.md`; graph system report | Required | Unknown properties remain preserved even when no ontology interprets them. |
| Wikilink completion, backlinks, references, and target resolution | shipped | editor completion/display; workspace graph resolver | `markdown-rules.spec.ts`; `shell.spec.ts`; graph tests | `README.md`; `docs/architecture.md` | Required | Ambiguous and unresolved targets must remain explicit rather than guessed. |
| Local Markdown images | shipped | `NoteEditor.tsx`; note image resolver in desktop services | `markdown-images.spec.ts` | `README.md` | Required | Keep file containment and missing-image fallback covered. |

## Search and indexing

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Title-bar workspace search and direct-open results | shipped | workspace search field in `App.tsx`; `WorkspaceIndex`/workspace search | `search-journey.spec.ts`; editor latency search journey | `README.md` | Required | Keep results bounded and keyboard navigable. |
| Filesystem search provider | shipped | `packages/core/src/workspace-index.ts`; desktop indexing service | workspace/index/search tests | `README.md`; `docs/architecture.md` | Required | This is the always-available baseline. |
| QMD lexical/semantic/hybrid provider | shipped | core QMD provider; derived index process/scheduler | `qmd.test.ts`; indexing process/scheduler tests; derived latency e2e | `README.md`; graph system report | Required but optional adapter | Index work must remain derived/asynchronous and never block typing or note open. |
| Index status and manual sync | shipped | Settings, command server `/index/*`, CLI `exo index` | command-server tests; CLI tests; indexing tests | `README.md`; CLI help | Supporting | Do not expose removed update/embed route families as public commands. |

## Connections and graph

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Connections properties, Outline, and Links tabs | shipped | `InspectorDock.tsx`; workspace graph context/detail | `InspectorDock.test.tsx`; `shell.spec.ts` | `README.md`; `docs/architecture.md` | Required | Links should continue to distinguish backlinks, note links, external links, and tags. |
| Connections Activity tab | stale | removed from `InspectorDock.tsx` by this audit | The former test asserted a permanently empty tab; `App.tsx` supplied no invocation history | none | Removed before launch | Restore only after a real, bounded activity stream exists. |
| Note-local graph neighborhood | shipped | `GraphNeighborhoodView`; graph context/query | neighborhood, graph query, shell tests | graph system report | Important | Keep this as the lightweight Connections projection. |
| Full spatial graph canvas | experimental | `GraphPane.tsx`; `SpatialGraphView.tsx`; graph scene/projection | spatial/scene tests; packed interaction e2e inside `shell.spec.ts`; GraphBench | graph system report | V1 blocker | Resolve EXO-ISSUE-119 transport at 10k scale and EXO-ISSUE-121 interaction polish before calling it launch-ready. |
| Typed knowledge-graph contract, evidence, and relation origins | experimental | `knowledge-graph.ts`; `workspace-graph.ts` | graph integrity/projection/query/snapshot/workspace tests | graph system report; ADR 0005 | Required foundation | Current names still use legacy `authority`/profile vocabulary; migrate only with a compatibility plan. |
| Internal generic and OKF interpreters | experimental | `knowledge-profile.ts`; workspace graph | workspace graph/profile tests | graph system report; ADR 0005 | Foundation only | Renderer currently selects `generic-markdown`; users cannot choose or edit an ontology. Do not market OKF support as configured product behavior. |
| GraphBench rendering/layout harness | experimental | `packages/graphbench`; graphbench scripts | repository graphbench suites | graph system report | Engineering quality gate | Keep described as Exo's internal graph-system measurement harness, not a universal AI benchmark. |

## Terminal, Preview, and pane canvas

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Direct PTY terminal tabs | shipped | `TerminalDock.tsx`; `TerminalView.tsx`; desktop `TerminalManager` | terminal manager/geometry tests; shell and geometry e2e | `docs/terminal-runtime-decision.md`; `README.md` | Required | Direct `node-pty` is canonical; delete tmux claims from current docs. |
| Local/localhost web Preview tabs | shipped | `BrowserPane.tsx`; preview target validation | `preview-pane-layout.spec.ts`; preview target tests | `README.md` | Supporting | Preserve the local/localhost boundary and isolated tab state. |
| Utility rail switches among Terminal, Preview, and Connections | shipped | `ShellLayout.tsx`; utility-surface model | utility model; preview/shell e2e | `README.md` | Required | These are destinations in one pane, not additive sidebars. |
| Drag Terminal or Preview into the editor canvas | shipped | drag manager/layout model; terminal/browser panes | `drag-zones.spec.ts`; shell e2e | `README.md` | Supporting | Editor canvas accepts either type; utility destinations accept only their own tab type. |

## Commands, invocation, and review

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Configured provider-neutral Commands | shipped | `agent-invocation.ts`; invocation adapters; Settings/onboarding | invocation adapter/launch facts/core tests | `README.md`; `docs/document-agent-protocol.md` | Required | Claude and Codex are defaults, not hard-coded product boundaries. |
| Inline `@agent` compose and Cmd+Enter invocation | shipped | `NoteEditor.tsx`; inline composer; desktop invocation runner | composer unit tests; `agent-invocation.spec.ts` | `README.md`; `docs/document-agent-protocol.md` | Required | Preserve editor responsiveness and explicit user invocation only. |
| Executable trust, process ownership, workspace scope, and continuity | shipped | trust/continuity stores; invocation runner | trust, process-tree Stop, continuity, and invocation e2e | `docs/document-agent-protocol.md` | Required | Trust is bound to the executable fingerprint; Stop and recovery prove the owned process group dead before settlement. |
| Exact multi-file Changeset review | shipped | invocation store/runner; inline review model and queue | inline review tests; 12 source and packaged `agent-invocation.spec.ts` journeys | `README.md`; `docs/document-agent-protocol.md`; roadmap WP5 | Required | Created, modified, deleted, mode-only, and proven-renamed files support serialized, hash-guarded per-file or batch Keep/Reject. Drift remains an explicit conflict. |
| Failure/orphan recovery, History, and resume in Terminal | shipped | invocation runner/store; activity and inline status UI | failure, relaunch, host-crash, recovery, and terminal-handoff e2e | `docs/document-agent-protocol.md` | Required | Pending review survives restart; normal success stays compact and errors may carry diagnostic detail. |
| Pre-Changeset single-note review migration | migration-only | invocation store migration | legacy pending/kept/rejected migration tests | changelog | Upgrade safety | Validate legacy before/after hashes, materialize the exact one-file Changeset, and fail closed on damaged evidence. |
| CLI `exo invoke` visible-terminal task | shipped | CLI `index.ts`; command route `/agent-commands/spawn` | CLI and command-server tests | CLI help; `README.md` | Supporting | This is deliberately distinct from inline note invocation and does not create a reviewed note diff. |

## CLI

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| `exo` / `exo start` app bootstrap | shipped | `packages/cli/src/index.ts`; `bin/exo` | CLI launcher/index tests | `README.md`; CLI help | Required | macOS launch behavior is the current supported target. |
| App-off `exo status` and `exo search` | shipped | CLI filesystem fallback | CLI index tests | `README.md`; CLI help | Required for agents | Search returns paths and bounded metadata so agents can use native file tools. There is no public `exo read`. |
| App-backed `exo show`, `exo index`, and `exo open` | shipped | CLI `AppClient`; protected command server | app-client, CLI, command-server tests | `README.md`; CLI help | Supporting | Fail clearly when no matching resident workspace exists. |
| `exo invoke` | shipped | CLI plus protected spawn route | CLI/command-server tests | `README.md`; CLI help | Supporting | Keep the name `invoke`; removed `spawn` and `agents` families are not aliases. |
| CLI installer/status UI | shipped | `cli-installation.ts`; onboarding | CLI installation tests | `README.md`; onboarding copy | Required for optional CLI path | Reinstall must replace stale repo-backed launchers and report the actual resolved binary. |

## MCP

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| `workspace_status` | shipped | `packages/cli/src/mcp-server.ts` | MCP server tests | `docs/provider-mcp-onboarding.md`; onboarding | Optional agent access | Read-only; reports resolved workspace and retrieval health. |
| `search_notes` | shipped | `packages/cli/src/mcp-server.ts` | MCP server tests | provider MCP doc; onboarding | Optional agent access | Returns bounded path/metadata results; agents read with native filesystem tools. |
| Generic MCP manager or note-write tools | stale | no implementation | CLI tests reject deleted families | historical docs only | Must not appear | Do not restore a generic manager, `read_note`, or write surface without a new protected-contract decision. |

## Packaging and installation

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| macOS source build and unsigned app bundle | shipped | root scripts; Electron builder config; `pack:mac` | `ci:check`; pack test; stable smoke; Electron e2e | `docs/open-source.md`; `README.md` | Required for current testers | Current support is macOS-first and unsigned. |
| Local app installer to `~/Applications` | shipped | `scripts/install-mac-app` | packaging/smoke coverage | open-source doc | Required for current testers | Keep install location and unsigned warning explicit. |
| Repo-backed `install-local` CLI symlink | migration-only | `scripts/install-local` | CI dry run / CLI launcher tests | contributor setup | Developer convenience | Not a public binary distribution strategy. |
| Signed, notarized, multi-architecture public release | planned | package workflow is manual and unsigned | none | open-source doc | Launch blocker for broad public binary distribution | Add signing/notarization and clean-machine artifact validation before promising it. |

## Skills, ontology, formats, and Plugins

| Surface | Class | Implementation owner | Test evidence | Public docs | Launch relevance | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown as canonical user-owned format | shipped | workspace files/notes/graph parsers | markdown, workspace, graph tests | `README.md`; `CONTEXT.md` | Core promise | Exo must continue to augment ordinary filesystem access. |
| Open properties and relations preserved by graph parsing | shipped | workspace graph and knowledge graph | graph/workspace graph tests | graph system report | Required foundation | Interpretation must not erase unknown user data. |
| User-owned `ontology.yaml` and type-conformance UX | planned | no current loader/editor | none | product cleanup specs / roadmap | Launch Gate E blocker | Specify versioning, validation, migration, and profile compatibility before implementation. |
| Ontology discovery/design and graph-maintenance Skills | planned | no user-reachable implementation; repo `skills/` are contributor workflows | none | roadmap/specs | Optional and eval-gated | Skills must remain inspectable instructions/data and route writes through normal review. |
| Note Root Format compatibility rules | planned | legacy Knowledge Profile code contains partial interpretation only | profile/graph tests | product cleanup specs | Needed for portable ontologies | Separate format compatibility from ontology meaning without destructive namespace churn. |
| Legacy plugin manifests | stale | no loader or product caller | no test evidence | superseded ADR 0001 | Removed before launch | The static manifests and packaging copy were deleted after CLI source detection stopped depending on them. |
| Future Plugin distribution bundle | planned | no runtime implementation | none | ADR 0003; extension architecture | Post-launch | A Plugin may package proven components later; it is not a runtime seam or capability system. |

## Protected public contract

The following are protected and were inspected, not changed by this audit:

- Command routes: `/status`, `/show`, `/search`, `/index/status`, `/index/sync`,
  `/open`, `/agent-commands/spawn`.
- MCP tools: `workspace_status`, `search_notes`.
- CLI families listed above.
- Shared command/invocation protocol types.

Any change to those surfaces requires the repository's public-contract review process.

## High-confidence mismatches and disposition

| Finding | Disposition |
| --- | --- |
| Current docs advertised removed `exo agents`, `exo spawn`, and `exo read` behavior | Corrected to the current compact CLI without changing its protected shape. |
| Open-source guidance called the direct-PTY terminal tmux-backed | Corrected to direct `node-pty`. Historical records remain historical. |
| Connections exposed Activity without a producer | Removed the tab, helper, prop, styles, and false test. |
| `plugins/` manifests had no loader but were packaged and used as a source-root sentinel | Removed after CLI source detection was changed to require the real launcher and installer. |
| The old public-surface ledger reads like a current contract despite describing Wave 1 | Marked prominently as historical and linked here. |
| The full graph is reachable while the renderer selects only `generic-markdown`, and 10k transport plus interaction issues remain | Remains a V1 blocker; keep the surface experimental until those gates pass. |
| Current base docs/code use `KnowledgeProfile` and `authority` while accepted product vocabulary is moving toward Ontology, Format, and Origin | Requires a deliberate compatibility migration, not search-and-replace. |
| `ontology.yaml` is planned; ontology discovery and graph-maintenance Skills are not user-reachable | Keep ontology as Launch Gate E; keep discovery optional and eval-gated. |

## Deletion candidates and call-site evidence

| Candidate | Evidence | Audit action |
| --- | --- | --- |
| Connections Activity tab | `invocationHistory` is optional in `InspectorDock`, but the sole app composition does not pass it; no other producer exists | Remove the tab and dead rendering helper now; restore only with a real event model. |
| `plugins/` legacy manifests | No loader or product caller remained; packaging and CLI source detection were the final accidental consumers | Removed with the packaging copy and dead discovery environment helper. |
| Preview workspace-command event triplet | `command:open-preview`, `command:focus-preview`, and `command:close-preview` had preload listeners and renderer handlers but no emitter or public route | Removed end-to-end by this audit; Preview's actual UI and pane model remain. |
| `workspace:search-notes` IPC method | No renderer caller; current title search uses workspace search and indexed search uses the index surface | Safe follow-up cleanup after confirming no packaged preload consumer. |
| `terminals:ensure-default` IPC method | No renderer caller; startup intentionally opens no terminal | Candidate only. Terminal contract changes require the terminal-stability process. |
| Private `AppClient.delete()` | No caller and no DELETE route in the protected command protocol | Removed by this audit; no public contract effect. |
| Exported `ExoIndexRootRequest` / `ExoReadDocumentRequest` | Zero current callers, but live in the protected shared protocol module | Report only; do not remove without public-contract review. |

-- Shoshin | 2026-07-19
