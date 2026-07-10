# Agent F Plan: QA, Docs Closure, Dogfooding, And Integration Readiness

Last updated: 2026-07-09

Status: Fable-reviewed planning packet. This document does not implement code, change tests, or contact Fable directly.

## Fable Amendments

- The 10 real pointer-prompt invocations are a hard branch-completion gate.
- All ten runs must use the real Exo invocation path: mention, confirmation, terminal launch, pointer prompt, invocation record, and diff/review path.
- At least one run must use a live interactive Claude/Fable-style harness and demonstrate that the agent can locate/read the pointed document, preferably via `exo read` or `exo search`.
- The other runs may use bounded local configured commands; deterministic local commands are preferred for dirty-buffer and orphan cases.
- Add final public-contract review evidence for `exo spawn @handle` after the final request/response/error shape settles.
- Add BrowserPane/command-server QA that the command-server token never appears in URLs, query strings, logs, or BrowserPane-framed content.
- Add negative QA that command trust is app-local and not importable from workspace `.exo`.
- Record invocation retention/privacy as V2-deferred.

## Scope

Agent F owns the final evidence gate for `refactor/note-native-exo`:

- automated validation matrix across core, CLI, desktop renderer/main, Electron E2E, public-contract checks, build, and install dry run;
- app QA for graph context, AgentCommand launch, invocation records, direct-write review, dirty-buffer behavior, BrowserPane trust, and command-server token auth;
- CLI QA for `exo status`, `exo search`, `exo read`, `exo index status`, and `exo spawn @handle`;
- docs truthfulness after deletion and implementation fan-out;
- 10 real pointer-prompt invocation dogfooding protocol;
- negative QA that removed MCP, Routine, Plugin Manager setup, profile-apply setup, and skill/harness-manager product surfaces are actually gone;
- integration readiness checklist and stop conditions before the branch is called complete.

## Non-Goals

- Do not implement feature code.
- Do not edit or delete stale tests as part of this planning pass.
- Do not contact Fable directly. The Fable packet below is for the orchestrator.
- Do not broaden V1 into a plugin platform, MCP compatibility layer, Routine replacement, or general chat module.
- Do not perform live dogfooding against the real vault until fake-command app QA and destructive-write protections pass.

## Evidence Checked

Primary planning sources:

- `docs/exograph-refactor-completion-plan.md`
- `docs/exograph-completion-orchestration-plan.md`
- `docs/exograph-detailed-implementation-plans.md`
- `docs/extension-architecture.md`
- `docs/note-native-invocation-prototype-evidence.md`
- `tasks.md`
- `issues.md`

Scripts checked:

- root `package.json`
  - `pnpm check:repo`
  - `pnpm check`
  - `pnpm ci:check`
  - `pnpm terminal:check`
  - `pnpm test:e2e`
  - `pnpm dev:qa`
  - `pnpm pack:mac`
- package scripts in `apps/desktop/package.json`, `packages/core/package.json`, and `packages/cli/package.json`.

Relevant tests and surfaces checked:

- `apps/desktop/tests/e2e/agent-invocation.spec.ts`
  - fake configured-command append plus visible diff;
  - dirty-buffer conflict choice;
  - orphaned running invocation after relaunch.
- `apps/desktop/tests/e2e/external-file-changes.spec.ts`
  - clean open-document refresh;
  - scroll/cursor preservation;
  - dirty open-document preservation.
- `apps/desktop/tests/e2e/shell.spec.ts`
  - broad shell/settings/terminal coverage;
  - currently still contains Plugin Manager E2E tests that should be deleted or rewritten with the removed product code.
- `packages/core/src/__tests__/graph-query.test.ts`
  - snapshot-derived context, backlinks, neighborhoods.
- `packages/core/src/__tests__/agent-invocation.test.ts`
  - command normalization, trust fingerprint inputs, mention parsing, note/CLI invocation records.
- `packages/core/src/__tests__/search-provider-registry.test.ts`
  - filesystem and QMD providers behind a provider registry without capability metadata.
- `apps/desktop/src/main/command-server.test.ts`
  - token-required routes;
  - `AgentCommand` spawn route and untrusted structured errors.
- `apps/desktop/src/main/invocation-observation-service.test.ts`
  - user-ended never-exiting invocation;
  - orphaned startup recovery.
- `packages/cli/src/index.test.ts` and `packages/cli/src/app-client.test.ts`
  - `exo spawn @handle`, command-server auth, app-unavailable diagnostics, search calls.
- `apps/desktop/src/renderer/src/App.test.tsx`
  - renderer coverage, but currently still includes Plugin Manager expectations and plugin-manager model tests.

Observed planning risk:

- The current tree still has stale Plugin Manager assertions and copy in tests/UI sources. QA must include explicit negative checks for this because the product direction is deletion, not hiding.

## Validation Matrix

Run the matrix in this order. Do not advance to dogfooding until all required automated gates pass or the orchestrator records an explicit accepted-risk exception.

| Area | Required command or check | Evidence to record | Blocks completion if |
| --- | --- | --- | --- |
| Repo contracts | `pnpm check:repo` | pass/fail, public-contract slice names changed | public-contract hashes are stale, removed MCP/package paths remain required, or new CLI/command-server routes lack review notes |
| Core typecheck | `pnpm --filter @exo/core typecheck` | pass/fail | any core API/type drift remains |
| CLI typecheck | `pnpm --filter @exo/cli typecheck` | pass/fail | CLI cannot compile without MCP/routine surfaces |
| Desktop typecheck | `pnpm --filter @exo/desktop typecheck` | pass/fail | renderer/main/preload API drift remains |
| Core unit tests | `pnpm --dir packages/core test` | test count and failures | graph/search/AgentCommand/invocation/plugin-deletion regressions fail |
| CLI unit tests | `pnpm --dir packages/cli test` | test count and failures | `status/search/read/spawn` or app-unavailable paths fail |
| Desktop unit tests | `pnpm --dir apps/desktop test` | test count and failures | renderer/main tests still assert deleted product behavior or invocation/trust behavior fails |
| Full package check | `pnpm check` | pass/fail | typecheck, test, or build fails |
| Install dry run | `./scripts/install-local --dry-run --skip-install --skip-build` or `pnpm ci:check` | pass/fail | install path still references deleted MCP setup or package paths |
| Desktop build | `pnpm --filter @exo/desktop build` | pass/fail | app cannot build after deletion/refactor |
| CLI build | `pnpm --filter @exo/cli build` | pass/fail | CLI bundle cannot build |
| Invocation E2E | `pnpm --filter @exo/desktop build && playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/agent-invocation.spec.ts` | pass/fail, invocation records inspected | fake command append, diff banner, dirty-buffer conflict, or orphan behavior fails |
| Dirty external writes | focused `external-file-changes.spec.ts` | pass/fail | disk refresh clobbers dirty buffers or loses cursor/scroll state |
| Shell/settings/browser trust | focused `shell.spec.ts` slices after Plugin Manager tests are removed | pass/fail and screenshots where visual | command-server token auth, BrowserPane trusted-only policy, settings, terminal launch, or search flows regress |
| Full E2E | `pnpm test:e2e` when focused gates pass | pass/fail and flaky rerun notes | core app loop is unstable or deleted-surface tests are still present |
| Terminal gate | `pnpm terminal:check` | pass/fail | AgentCommand launch reused terminal paths break terminal stability |
| Packaged app smoke | `pnpm pack:mac` when app-support/runtime/packaging touched | pass/fail | packaging/install paths still reference deleted MCP or runtime paths |

Minimum final gate:

```bash
pnpm ci:check
pnpm terminal:check
pnpm test:e2e
```

If `pnpm test:e2e` is too broad for the final local run, the orchestrator may accept a focused equivalent only if the skipped specs are listed with a reason and no skipped spec covers a touched surface.

## Feature QA Matrix

Graph:

- Open a note with frontmatter, body tags, wikilinks, Markdown links, unresolved links, and duplicate basename ambiguity.
- Confirm the editor/inspector shows outgoing links, backlinks, tags, properties, and graph neighborhood from the snapshot-derived path.
- Confirm property add/edit/delete persists correctly and graph context refreshes after save.
- Confirm graph view opens for the active note and does not depend on plugin/capability metadata.

CLI/search:

- With app unavailable, run local read/search/status paths where supported.
- With app available, run command-server backed `exo search`, `exo read`, `exo index status`, and `exo status`.
- Validate QMD enabled, QMD degraded/unavailable, and filesystem fallback modes.
- Confirm result identity uses Exo document identity semantics and does not make provider-native paths the shared truth.

AgentCommand/invocation:

- Configure at least one scratch command with a strict handle.
- Verify changed executable command fields require re-trust before launch.
- Verify unsupported prompt-delivery modes fail clearly if exposed.
- Verify editor-owned line-start mentions show an invocation affordance only for configured handles, not code fences, frontmatter, list items, blockquotes, prose mentions, CSS at-rules, or unknown handles.
- Verify confirmation shows document path, literal command, cwd, prompt delivery, and direct-write warning.
- Verify dirty tagged documents are saved before launch or launch is refused.
- Verify `exo spawn @handle "<task>"` creates a CLI-context invocation and rejects untrusted/changed commands.

Direct-write review:

- Fake append command creates `.exo/invocations/{id}/record.json`.
- Tagged-document diff ref is written under `.exo/invocations/{id}/diffs/`.
- Diff banner is visible, toggleable, and uses `Changed during @handle` copy with likely/ambiguous qualifiers.
- Concurrent user edit plus invocation write is ambiguous.
- Dirty editor buffer is not clobbered and offers keep/reload choice.
- App restart marks running invocation orphaned with ambiguous attribution.
- `.exo/invocations/` is ignored by git.

Deletion/product-shape QA:

- `rg` confirms no active user-facing Plugin Manager entry point, Plugin Manager dialog, plugin-owned settings UI, routine CLI, MCP setup, MCP package scripts, Agent Skills service/API, or profile-apply setup spine remains outside superseded docs/history.
- Tests for deleted Plugin Manager behavior are deleted with the product code, not left failing or skipped.
- README, tasks, roadmap, AGENTS, and CLAUDE point workers at Exograph, CLI, graph, AgentCommand, and invocation review.
- Any remaining harness internals are justified as terminal/runtime dependencies only, not product identity.
- Any remaining plugin internals are justified as current search/provider/app boot dependencies only, not a V1 Plugin Manager.

Security/trust:

- Command server requires token on every route.
- BrowserPane rejects `javascript:` and `data:` targets and remains trusted local/localhost only in V1.
- Web viewer content is not described as an untrusted extension host.
- Command-bearing config trust lives outside the workspace and invalidates on executable behavior changes.
- Workspace `.exo` cannot create, import, or modify command trust.
- Command-server token never appears in URLs, query strings, logs, or BrowserPane-framed content.
- Agent-authored Markdown cannot auto-chain into a new invocation.

## 10 Real Pointer-Prompt Dogfooding Protocol

Purpose: close the WP0.5 gap with real Exo note invocation behavior, not only fake subprocess evidence.

Prerequisites:

1. Automated fake-command invocation E2E passes.
2. Dirty-buffer and external-write E2E passes.
3. Plugin Manager deletion QA has no active stale UI/test blockers.
4. Scratch workspace is prepared from copied representative notes. Do not mutate the real vault during first dogfooding.
5. At least one live interactive command is configured and trusted in Exo, preferably `@fable` or `@claude`, with `terminalInputAfterLaunch`.
6. The command is configured to produce bounded, low-risk note edits. Preferred first run command prompt asks the agent to append a short `## Agent note` section, not rewrite large files.

Scratch workspace setup:

- Create a temp workspace outside the repo, for example `/tmp/exo-pointer-dogfood-YYYYMMDD`.
- Copy representative Markdown files into a `notes/` root.
- Use project-local settings with QMD disabled first, then repeat one search/read smoke with QMD if available.
- Ensure `.exo/invocations/` is ignored.
- Ensure command trust is stored app-locally, not in the scratch workspace `.exo`.
- Save screenshots or short screen recordings to `/tmp/exo-pointer-dogfood-*`, not into the repo unless the orchestrator requests committed evidence.

The 10 runs:

| Run | Note shape | Required behavior |
| --- | --- | --- |
| 1 | simple planning note | mention affordance, confirmation, terminal launch, pointer prompt received, append diff visible |
| 2 | wikilink-heavy note | graph context remains intact, invocation diff does not corrupt wikilinks |
| 3 | frontmatter/properties note | frontmatter preserved byte-safely unless intentionally edited |
| 4 | task/list note | mention parser ignores list-item pseudo-mentions and launches only strict paragraph mention |
| 5 | daily/log note | append behavior works in longer prose with existing headings |
| 6 | README/docs-style note | command handles fenced code examples without false invocation |
| 7 | code-adjacent project note | CLI `exo read`/`search` can orient the command before or after invocation |
| 8 | graph-heavy note with backlinks | graph/neighborhood view remains useful after direct write |
| 9 | dirty-buffer case | launch saves dirty tagged document first or refuses; no clobber |
| 10 | restart/orphan case | running invocation is marked orphaned after relaunch; attribution ambiguous |

At least one of the ten runs must be a live Claude/Fable-style interactive command that reads the target document through the pointer context and proves it was not merely appending blind. Runs 9 and 10 should use deterministic local commands unless the orchestrator explicitly wants slower live-harness coverage there.

For each run record:

- command handle and command label;
- note path relative to scratch workspace;
- prompt shown/sent;
- terminal/session id if visible;
- invocation id;
- final invocation status;
- changed files and attribution labels;
- diff ref path;
- whether editor refreshed or offered conflict controls;
- screenshot path for confirmation/diff/conflict when applicable;
- pass/fail and notes.
- whether the run used live harness or bounded local command.

Release blockers discovered during dogfooding:

- data loss or dirty buffer clobber;
- untrusted or changed command launches;
- trust imported from workspace-controlled files;
- auto-run without human confirmation;
- agent-authored note can trigger another invocation without user action;
- pointer prompt not received or sent to wrong terminal/session;
- direct write occurs but no visible diff/review appears;
- attribution claims more than Exo can prove;
- invocation records are missing or written outside `.exo/invocations/`;
- CLI/search/read/status requires MCP;
- app crash or terminal runtime corruption during the core loop.

## Docs Update List

Update after implementation and validation, in this order:

1. `README.md`
   - Exograph product copy;
   - CLI as local integration;
   - MCP removed;
   - no Plugin Manager/Routine/setup-spine language except historical notes.
2. `docs/strategy.md`
   - current ship strategy, if present.
3. `docs/usability-readiness.md`
   - actual QA evidence and remaining daily-use risks.
4. `docs/README.md`
   - docs map separating active docs from superseded historical docs.
5. `ledger.md`
   - implementation and QA evidence summary.
6. `docs/public-contract-reviews.md`
   - command-server token routes, `exo spawn`, removed MCP slices, shared protocol changes.
7. `docs/note-native-invocation-prototype-evidence.md`
   - append dogfooding results for the 10 real pointer-prompt invocations or link to a dedicated evidence doc.
8. `tasks.md`
   - mark WP0.5 dogfooding only after the 10-run evidence exists;
   - mark plugin-manager deletion only after active UI/API/tests are gone or the remaining internals are named.
9. `issues.md`
   - close or update `EXO-ISSUE-100` acceptance bullets with deletion chunks and validation evidence.
10. Superseded docs
   - add or tighten banners on plugin/Routine/MCP/harness/profile-apply docs that remain as history.
11. `AGENTS.md` and `CLAUDE.md`
   - remove stale instructions that send agents toward deleted architecture.

Docs truthfulness grep set:

```bash
rg -n "Plugin Manager|plugin manager|MCP|routine|Routine|profile apply|Agent Skills|skill manager|harness manager|open-plugin-manager|plugin-manager" README.md docs tasks.md issues.md AGENTS.md CLAUDE.md
```

Acceptable matches:

- superseded historical sections clearly labeled as historical;
- deletion audit records;
- runtime/terminal harness internals explicitly described as non-product substrate;
- extension-architecture discussion that says no Plugin Manager/product plugin platform in V1.

Unacceptable matches:

- active setup instructions for MCP, Routine, Plugin Manager, profile apply, skill install, or harness-manager product flows;
- tests or UI copy telling users to open Plugin Manager;
- docs claiming a capability is complete when its QA gate has not run.

## Sequencing And Dependencies

1. Agent A deletion/contracts/trust must land first enough that stale product paths do not shape QA.
   - Agent F validates removed surfaces and public-contract paperwork.
   - Current dependency to watch: stale Plugin Manager tests/copy in `App.test.tsx`, `shell.spec.ts`, CSS, and model files.
2. Agents B and C can validate in parallel after deletion decouples graph/search from plugin metadata.
   - Agent F waits for graph/search tests and CLI fallback evidence before dogfooding.
3. Agent D must finish AgentCommand, trust, mention parsing, confirmation, launch, and CLI spawn before real pointer-prompt runs.
   - Agent F validates trust and confirmation before any real command dogfooding.
4. Agent E must finish observation, diff refs, attribution, dirty-buffer UI, and orphan recovery before real pointer-prompt runs.
   - Agent F validates fake-command append/concurrency/orphan first.
5. Agent F performs final integrated QA, dogfooding, docs closure, and completion checklist.

Parallel-safe Agent F work before implementation finishes:

- maintain validation matrix;
- prepare scratch dogfooding workspace plan;
- identify stale docs/test claims;
- define screenshots/evidence naming;
- prepare final checklist.

Not parallel-safe:

- marking WP0.5 dogfooding complete;
- marking plugin-manager deletion complete;
- rewriting docs to claim completion before tests/dogfooding evidence exists.

## Open Unknowns

- Whether the final intended state deletes all `plugin-management`/`plugin-local-management` internals or leaves read-only inventory for QMD/profile diagnostics. QA can accept either only if active product UI/mutation APIs are gone and the remaining dependency is named.
- Whether `exo agents` legacy harness wrappers remain for this branch or are deleted after `AgentCommand` launch. If they remain, docs must call them legacy terminal wrappers, not the V1 agent identity.
- Settled by Fable: `exo spawn` requires a fresh `docs/public-contract-reviews.md` entry after final shape settles.
- Settled by Fable: all 10 pointer-prompt runs must use the real Exo invocation path; at least one must use a live interactive Claude/Fable-style harness, while the rest may use bounded local commands.
- Whether full `pnpm test:e2e` is stable enough for the final gate. If not, the accepted focused equivalent must be explicit and justified.
- Whether packaged-app QA is required for this branch if no packaging/runtime path changes occur after the last packaged app pass. Recommendation: run `pnpm pack:mac` if deletion touched install/runtime paths or command-server discovery.

## Fable Review Packet

Questions routed to Fable and answered on 2026-07-09:

1. Validation matrix is sufficient after the Fable amendments are included.
2. 10 real pointer-prompt dogfooding runs are a hard branch completion gate.
3. One live Claude/Fable-style command plus bounded local commands is enough if all use the real Exo invocation path.
4. Retained read-only Plugin Manager diagnostics are not acceptable; retained plugin internals need live imports and named removal conditions.
5. `exo spawn @handle` receives separate public-contract review after final implementation.
6. Legacy `exo agents` terminal wrappers can remain only as debug/substrate commands if docs do not make them V1 agent identity.
7. BrowserPane trusted-only local/localhost plus token-auth command server satisfies V1 with token-exposure QA.

Fable decision:

- Treat the 10 real pointer-prompt invocations as a hard branch completion gate, but run them in a copied scratch workspace first.
- Require at least one live interactive configured command in the 10-run set after fake-command QA passes. The other runs may use bounded local commands if they exercise the real Exo invocation path, terminal launch, prompt delivery, records, diffs, and dirty-buffer behavior.
- Do not accept retained read-only Plugin Manager diagnostics. Retain plugin internals only if a current import requires them and the removal condition is named.
- Require public-contract review notes for `exo spawn`, command-server token/auth shape, and removed MCP slices before final.

## Stop Conditions

Stop implementation or release closure and return to the orchestrator if any of these occur:

- Any command-bearing config launches without local trust.
- A changed command, cwd policy, prompt delivery field, env/template execution field, or command version does not invalidate trust.
- A mention auto-runs from watcher-observed Markdown or agent-authored Markdown without human confirmation.
- Dirty tagged document launch does not save first or refuse.
- Dirty editor buffer is overwritten by disk changes.
- Pointer prompt is delivered to the wrong terminal/session or not delivered without clear failure state.
- Invocation writes happen without visible diff/review evidence.
- Attribution says or implies line-perfect authorship or `likely edited by` instead of bounded `changed during` semantics.
- `.exo/invocations/` records or diffs are missing, outside the invocation store, or not gitignored.
- CLI search/read/status requires MCP.
- MCP setup, Routine, Plugin Manager setup, profile apply setup, or Agent Skills product flows remain active.
- Plugin Manager UI/tests are merely skipped or hidden instead of removed with product code.
- Command-server routes are reachable without token.
- Command-server token appears in URLs, query strings, logs, or BrowserPane-framed content.
- Command trust can be imported from workspace `.exo` or any workspace-controlled file.
- BrowserPane is treated as an untrusted extension host before the security boundary exists.
- Public contract changes are made without review/update.
- Automated validation cannot pass and no explicit accepted-risk exception exists.

## Final Completion Checklist

- [x] `pnpm ci:check` passes or focused equivalent is explicitly approved.
- [x] `pnpm terminal:check` passes.
- [x] `pnpm test:e2e` or approved focused E2E suite passes.
- [x] Graph UI/manual QA evidence exists.
- [x] CLI search/read/status/spawn QA evidence exists.
- [x] AgentCommand trust/confirmation/manual QA evidence exists.
- [x] Direct-write diff/dirty-buffer/orphan QA evidence exists.
- [x] BrowserPane/command-server trust QA evidence exists.
- [x] Plugin Manager/product deletion negative QA passes.
- [x] 10 real pointer-prompt dogfooding runs are recorded.
- [x] Docs truthfulness grep has no active stale product claims.
- [x] `tasks.md` and `issues.md` reflect only completed work as complete.
- [x] Remaining follow-ups are V2/deferred and not hidden branch blockers.

Final evidence, 2026-07-09:

- `pnpm ci:check` passed: repo checks, core/CLI/desktop typechecks, core 238/238, CLI 62/62, desktop 272/272, desktop/CLI builds, and install-local dry run.
- `pnpm terminal:check` passed after the AgentCommand and preview/test updates.
- `pnpm test:e2e` passed 100/102; skips are the existing markdown-decoration skip and the opt-in live Claude gate. The opt-in live Claude gate passed separately with `EXO_LIVE_CLAUDE_E2E=1`.
- CLI QA: `exo status` works without the app, `exo read` returns filesystem note content, `exo search` degrades to filesystem when QMD has a local native Node ABI mismatch, and `exo spawn @handle <task>` is tested and listed in help.
- Graph UI QA: shell E2E asserts backlinks/tags plus the graph-neighborhood panel for the active note.
- Docs truthfulness grep leaves only explicit deletion, superseded-history, or non-product-substrate references.

-- Exo | 2026-07-09
