# Agent A Plan: Deletion, Contracts, And Trust Audit

Last updated: 2026-07-09

Status: Fable-reviewed planning packet. No implementation is authorized from this file unless it follows the Fable amendments below.

## Fable Amendments

- Delete Plugin Manager UI/model/CSS/tests and mutable plugin lifecycle APIs now. Do not retain a read-only diagnostic Plugin Manager or Plugin Inventory surface.
- Keep manifest/discovery internals only while a live import requires them, and record the removal condition for each survivor.
- Delete plugin/capability metadata/state/settings as soon as graph/search/profile callers are decoupled. Do not preserve V2 scaffolding in active code.
- Before deleting `profile-recovery`, audit real user/workspace data for existing recovery manifests. If none exist, delete it now. If manifests exist, keep only operator recovery until the 10-run pointer-prompt gate passes, then delete it.
- Command-server token must never appear in URLs, query strings, logs, or BrowserPane-reachable context.
- Keep BrowserPane sandbox without `allow-same-origin` for V1.

## Scope

Agent A owns the deletion and boundary work that keeps `refactor/note-native-exo` from drifting back into the old product regime:

- Remove old product surfaces for MCP, Routines, Plugin Manager, profile apply/setup, harness setup, and skill inventory after caller audit.
- Keep only named internals that are required by the Exograph V1 path: Markdown notes, graph/read/search, CLI, terminal runtime, web viewer, `AgentCommand`, invocation records, and diff review.
- Maintain the public-contract guard for command-server routes, CLI commands/flags, shared command protocol types, and CLI command-server client methods.
- Audit BrowserPane and command-server trust boundaries before web viewer content is treated as extension-hosted or untrusted.
- Justify every surviving command-server route and deletion-blocked route family.
- Own the shared watcher subscription/fan-out boundary if additional graph/invocation consumers still need a single watcher API.

## Non-Goals

- Do not implement AgentCommand, graph UI, search fallback, invocation observation, or QA dogfooding. Those are Agent B-F slices.
- Do not delete terminal runtime/session durability, terminal transcripts, monitor mode, or low-level terminal diagnostics.
- Do not delete CLI search/read/status/spawn, custom search provider seams, QMD provider code, filesystem fallback provider code, or graph core.
- Do not add new public routes, CLI flags, protocol fields, or plugin contracts. If implementation discovers one is necessary, stop for Fable/orchestrator review.
- Do not contact Fable directly. This plan includes a Fable review packet for the orchestrator.

## Evidence Checked

Read:

- `docs/exograph-refactor-completion-plan.md`
- `docs/exograph-completion-orchestration-plan.md`
- `docs/exograph-detailed-implementation-plans.md`
- `docs/extension-architecture.md`
- `docs/plugin-system-architecture.md`
- `docs/plugin-implementation-plan.md`
- `docs/plugins.md`
- `docs/activity-plugin-contract.md`
- `docs/agent-harness-plugin-contract.md`
- `docs/plugin-surface-contract.md`
- `docs/public-contract-reviews.md`
- `tasks.md`
- `issues.md`

Code/doc inventory checked:

- `packages/core/src/command-protocol.ts`
- `apps/desktop/src/main/command-server.ts`
- `apps/desktop/src/main/command-server.test.ts`
- `apps/desktop/src/main/preview-target.ts`
- `apps/desktop/src/main/preview-target.test.ts`
- `apps/desktop/src/renderer/src/components/BrowserPane.tsx`
- `scripts/check-repo.mjs`
- `packages/core/src/index.ts`
- `packages/core/src/plugin*.ts`, `capabilities.ts`, `profile*.ts`, `proposal*.ts`, `agent-harness*.ts`, `runtime.ts`, `search-provider*.ts`, `graph*.ts`
- `apps/desktop/src/shared/api.ts`, `preload/index.ts`, `workspace-ipc.ts`, `main/index.ts`
- `apps/desktop/src/renderer/src/pluginManagerModel.ts`, `ProfileSettingsSection.tsx`, `OnboardingCapabilityReview.tsx`, `App.test.tsx`, `styles.css`
- `packages/cli/src/index.ts`, `app-client.ts`, and related tests

Current branch evidence:

- MCP package and `packages/mcp/**` are deleted in the worktree.
- Routine core modules and tests are deleted in the worktree.
- Agent Skills desktop service/API/IPC is deleted in the worktree.
- `PluginManagerDialog.tsx` is deleted, but `pluginManagerModel.ts`, Plugin Manager tests, Plugin Manager CSS, read-only inventory IPC, and plugin mutation/storage modules still exist.
- Command server already generates a per-runtime token, writes it to `server.json`, checks loopback, and requires the token before route dispatch.
- `readBody` already enforces JSON content-type and a 1 MB body cap.
- BrowserPane already uses `sandbox="allow-forms allow-scripts"` and `referrerPolicy="no-referrer"`.
- Main-process preview target validation already limits V1 preview to localhost HTTP(S) or `.html/.htm` files inside workspace/note/project roots and rejects `javascript:`/`data:` URLs.
- Public-contract reviews already include Fable-approved MCP removal and command-server token-auth notes.

## Add, Delete, Modify

### Delete

Delete these remaining old product surfaces if caller audit confirms no current Exograph dependency:

- Renderer Plugin Manager product surface:
  - `apps/desktop/src/renderer/src/pluginManagerModel.ts`
  - remaining Plugin Manager tests in `apps/desktop/src/renderer/src/App.test.tsx`
  - Plugin Manager CSS blocks in `apps/desktop/src/renderer/src/styles.css`
  - Plugin Manager E2E slices in `apps/desktop/tests/e2e/shell.spec.ts`
  - stale `pluginManager.open`, `open-plugin-manager`, and plugin-panel reroute expectations in surface/tool-dock tests.
- Mutable plugin lifecycle APIs:
  - enable/disable/trust/add/remove/replace local plugin API, preload, IPC, main handler, and tests if any remain.
  - `packages/core/src/plugin-local-management.ts` and its tests unless a non-Plugin-Manager caller exists.
- General plugin-management mutation module:
  - delete or split `packages/core/src/plugin-management.ts`; keep only manifest discovery if `profile-copy.ts` still requires it.
- Profile apply/setup product paths:
  - desktop "create profile apply proposal" flows and setup copy.
  - `profile-copy` and workspace-local profile plugin copying if it only exists for Plugin Manager/Profile setup.
  - `profile-apply-proposal` and `profile-recovery` CLI after auditing whether any recovery manifests exist. If manifests exist, retain only operator recovery until the 10-run pointer-prompt gate passes.
- Old graph visualization plugin metadata:
  - `exo.graph:visualization` parsing/surface descriptors if still coupled to Plugin Manager, per Agent B amended brief.
- Stale docs/copy:
  - Plugin Manager as active lifecycle surface in `docs/onboarding-settings-boundaries.md`, historical docs, `CHANGELOG.md`, `README.md`, `tasks.md`, and `issues.md`.
  - MCP/Routine/skill/harness-manager references that are not clearly marked historical or superseded.

### Modify

Modify these surfaces to match V1 Exograph:

- `packages/core/src/index.ts`: stop exporting deleted plugin/profile/routine product modules. Keep exports for active core contracts only.
- `packages/core/src/plugin-inventory.ts`: either delete or reduce to a private/read-only provider/profile diagnostic helper. It must not imply lifecycle management.
- `packages/core/src/capabilities.ts` and `capability-registry.ts`: reduce to the minimum needed by search provider metadata and terminal compatibility, or decouple search/graph from capability metadata first.
- `apps/desktop/src/shared/api.ts`, `preload/index.ts`, `workspace-ipc.ts`, `main/index.ts`: keep `listPluginInventory` only if a named active caller remains; otherwise delete it.
- `ProfileSettingsSection.tsx` and `OnboardingCapabilityReview.tsx`: remove direct dependency on plugin inventory if it exists only to show old capability review/setup. Retain QMD/search health through Agent C provider status instead.
- `scripts/check-repo.mjs`: update protected slices when routes/CLI/protocol fields are deleted; do not weaken the guard.
- `docs/public-contract-reviews.md`: add review notes for any public contract deletion or intentional survival.
- `docs/plugin-surface-contract.md` and `docs/extension-architecture.md`: state that BrowserPane is a trusted local/localhost core primitive, not an untrusted plugin host.
- `apps/desktop/tests/e2e/preview-pane-layout.spec.ts`: audit direct fetches to `/preview/open`; token must be supplied now that all command-server routes require auth.

### Add

Add only planning/QA artifacts, not product features:

- A command-server route survival table in docs or issues, with each route marked `keep`, `delete`, or `blocked`, and a one-line current consumer.
- Focused test assertions if implementation later touches trust boundaries:
  - every route rejects missing token;
  - token-bearing preview requests still work;
  - remote, `javascript:`, `data:`, outside-root, non-HTML, and missing local preview targets are rejected;
  - BrowserPane iframe remains sandboxed and no preload APIs are exposed to framed content.

## Route Survival Map

Keep these command-server routes as current Exograph V1 surfaces:

| Route family | Keep reason |
| --- | --- |
| `/status`, `/config` | CLI/app orientation and local runtime discovery. |
| `/search`, `/read`, `/index/status` | CLI is the durable local integration surface replacing MCP. |
| `/index/roots`, `/index/update`, `/index/sync`, `/index/embed` | App/CLI provider administration; should stay only if Agent C confirms current provider contract needs app-owned indexing mutations. |
| `/open` | CLI/app file opening. Keep with token auth. |
| `/preview/open`, `/preview/focus`, `/preview/close` | Core web-viewer primitive for local trusted HTML and localhost apps. Not a plugin host. |
| `/agent-commands/spawn` | Reviewed CLI `exo spawn @handle` surface for trusted `AgentCommand` configs. |
| `/terminals*` | Low-level terminal/admin/debug and monitor surfaces. Keep until AgentCommand fully replaces user-facing harness launch, but do not expand harness-manager product. |
| `/project-roots*` | Workspace configuration used by current app/search/read/project review flows. |
| `/proposals*` | Keep only if proposal review still backs current changed-file/profile recovery flows; otherwise re-evaluate after Agent E direct-write review is complete. |

Delete or re-evaluate:

- Any route that exists only for MCP agent lifecycle, Routine execution, Plugin Manager mutation, plugin-owned CLI/MCP tools, profile apply setup, or skill install/sync.
- Terminal `POST /terminals` harness creation should remain a compatibility/admin route only. User-facing agent identity is `AgentCommand`, not provider harness selection.

## Sequencing And Dependencies

1. Finish remaining caller audit before deleting modules.
   - Search for each target export/API, including tests and docs.
   - Classify each caller as active Exograph, historical, or old product.
2. Remove stale renderer/product affordances first.
   - Plugin Manager dialog is already deleted; finish model/tests/CSS/tool-descriptor cleanup.
   - Remove onboarding/profile links and copy that imply Plugin Manager, profile apply, Routine, MCP, or skill setup are current.
3. Remove mutable plugin lifecycle APIs.
   - Delete desktop API/preload/IPC/main handlers for plugin mutation.
   - Delete local plugin add/remove/replace implementation unless a current non-UI caller exists.
4. Decouple active systems from plugin/capability metadata before deleting internals.
   - Agent C owns search metadata decoupling.
   - Agent B owns graph visualization metadata deletion.
   - Agent A should not delete `capabilities.ts` until those slices confirm no import dependency remains.
5. Audit profile apply/recovery disposition.
   - Search real workspace/app data for recovery manifests.
   - If none exist, remove CLI `profile-recovery`, profile apply proposal generation, recovery fixtures/tests, and profile setup docs.
   - If manifests exist, retain only operator recovery until Agent F's 10-run pointer-prompt gate passes, with no setup/product copy.
6. Update public-contract guard and docs with every deletion.
   - Run `pnpm check:repo` after public slices move.
   - Add removal/survival notes to `docs/public-contract-reviews.md`.
7. Run focused tests first, then full gates.

Dependency blockers:

- Do not delete terminal harness registry/readiness internals until Agent D proves generic configured-command launch covers current terminal launch needs.
- Do not delete proposal/review apply host until Agent E confirms direct-write invocation review has its own patch/ref/dirty-buffer path and no profile recovery safety dependency remains.
- Do not delete capability metadata if Agent C search provider metadata or Agent B graph code still imports it.
- Do not treat BrowserPane as untrusted extension content in V1, even after sandboxing. It is trusted local/localhost preview only.

## Public-Contract And Trust Implications

Public contract rules:

- Any change to command-server route constants/types, route table, CLI commands/flags, or CLI app-client route methods must update `docs/public-contract-reviews.md` and pass `pnpm check:repo`.
- Removal approval exists for MCP/routine/deep-harness/profile/plugin-manager product surfaces, but it covers removals only. It does not authorize new public routes or flags.
- If implementation narrows or deletes `profile-recovery`, proposal routes, terminal harness creation, or preview routes, that is a public operator contract change and needs an explicit review note.

Trust boundaries:

- Plugin manifests remain metadata only. No manifest should execute code, self-trust, self-enable, grant permissions, register CLI/MCP tools, mount renderer panels, or launch terminals.
- Plugin permission records are not enforcement unless tied to an actual guarded operation. Do not keep permission UI that suggests stronger security than exists.
- `AgentCommand` execution trust is separate from plugin trust and must live outside the workspace.
- BrowserPane V1 trust stance is: local files inside configured roots and localhost URLs only, framed in a sandbox, with no preload bridge and main-process validation.
- Command-server token auth is required for all routes. Loopback is not sufficient authorization.
- Existing CLI/app clients must read token from `server.json`. Tests that bypass this are stale and should be updated, not used as a reason to weaken auth.

## Tests And QA Gates

Focused gates:

- `pnpm --filter @exo/core test -- plugin capability profile proposal surface`
- `pnpm --filter @exo/core test -- search-provider graph`
- `pnpm --filter @exo/desktop test -- command-server preview-target workspace-ipc`
- `pnpm --filter @exo/desktop test -- App`
- `pnpm --filter @exo/cli test`
- focused Electron E2E for preview pane, settings/onboarding, shell/terminal, and agent invocation.

Full gates before Agent A exits:

- `pnpm --filter @exo/core typecheck`
- `pnpm --filter @exo/cli typecheck`
- `pnpm --filter @exo/desktop typecheck`
- `pnpm --filter @exo/core test`
- `pnpm --filter @exo/cli test`
- `pnpm --filter @exo/desktop test`
- `pnpm check:repo`
- `pnpm --filter @exo/desktop build`
- relevant Playwright E2E:
  - `apps/desktop/tests/e2e/preview-pane-layout.spec.ts`
  - `apps/desktop/tests/e2e/shell.spec.ts` focused settings/shell subset
  - `apps/desktop/tests/e2e/agent-invocation.spec.ts`

QA evidence to record:

- Public-contract guard hash updates and review note references.
- BrowserPane/preview trust test results.
- Command-server missing-token rejection and token-bearing route success.
- No active docs instruct users or agents to use MCP, Routine Manager, Plugin Manager setup, profile apply, or skill inventory as V1 product paths.
- No Plugin Manager UI/model/CSS/tests remain unless Fable explicitly chooses a read-only diagnostic surface.

## Open Unknowns

1. Do profile recovery manifests exist on this machine or in real workspaces? This audit decides deletion versus temporary operator-only retention.
2. Which live imports still require manifest/discovery internals after Agent B/C decoupling?
3. Can `capabilities.ts` be reduced to `CapabilitySurface` plus active terminal/search metadata, or does too much current code still rely on `CapabilityMetadata`?
4. Should `POST /terminals` remain a CLI/admin route after `exo spawn @handle`, or should all user-facing agent launch move through AgentCommand and leave terminal creation shell-only?
5. Are proposal routes still part of the Exograph V1 review substrate, or should Agent E's invocation diff review become the only write-review path?
6. Do preview routes need stricter Origin/Fetch Metadata checks in addition to token auth, given localhost web content can attempt loopback requests but should not know the token?
7. Settled by Fable: keep the stricter BrowserPane sandbox without `allow-same-origin` for V1. Local dashboards needing storage are V2.
8. Should `CHANGELOG.md` be rewritten aggressively now, or should historical entries stay if superseded sections are clear?

## Fable Review Packet

### Decision 1: Plugin Manager final disposition

Options:

- A. Delete all renderer Plugin Manager product UI/model/CSS/tests and all mutable plugin lifecycle APIs now. Keep only private manifest discovery if a live caller remains.
- B. Keep a read-only Plugin Inventory diagnostic surface in Settings while deleting lifecycle actions. Fable rejected this for V1.
- C. Keep Plugin Manager as a dormant hidden surface.

Recommendation: A. The user explicitly asked for deletion, not hiding, and `extension-architecture.md` says Plugin Manager is not V1. If diagnostics are needed, surface them through provider/search/profile status with Exograph language.

### Decision 2: Plugin internals disposition

Options:

- A. Delete all plugin/capability internals after Agent B/C decouple graph/search/profile callers.
- B. Keep `plugin.ts`/manifest parsing and state/settings/permissions as metadata-only internals for future V2.
- C. Keep all internals because they may be useful later.

Recommendation: A with a narrow temporary blocker list. Keep code only when a current import proves it is required; otherwise rely on git history.

### Decision 3: Profile apply/recovery

Options:

- A. Delete profile apply proposal/recovery and CLI `profile-recovery` now if no recovery manifests exist.
- B. Retain profile recovery as operator-only migration safety only if manifests exist, with expiry after the 10-run pointer-prompt gate, and delete setup/product copy.
- C. Keep profile apply/recovery as a first-class setup path.

Fable decision: audit first. Choose A if no manifests exist. Choose B only if manifests exist. C conflicts with the pivot.

### Decision 4: Command-server terminal creation

Options:

- A. Keep `POST /terminals` as low-level terminal/admin compatibility, but remove all user-facing harness setup/product copy.
- B. Delete agent harness creation from command-server and use only `AgentCommand` spawn for agents.
- C. Keep harness creation and setup UI.

Recommendation: A for this branch. It avoids breaking terminal/admin/monitor workflows while making `AgentCommand` the user-facing agent identity. Revisit B after Agent D/E QA.

### Decision 5: BrowserPane trust posture

Options:

- A. Keep trusted-only local/localhost preview with sandbox/main validation/tokenized command server.
- B. Allow arbitrary remote URLs with warning/confirmation.
- C. Treat BrowserPane as a general untrusted extension host.

Recommendation: A. This matches the Fable-amended brief and current implementation. B/C require a separate browser/webview security design.

### Decision 6: Preview command-server extra hardening

Options:

- A. Token auth plus loopback and content-type/body caps are enough for V1.
- B. Add Origin/Fetch Metadata rejection for browser-originated requests lacking same-origin evidence.
- C. Remove preview command-server routes and keep preview only inside app UI.

Recommendation: A for V1 if all clients correctly use token auth. Consider B only if QA finds realistic token exposure or browser-origin misuse. Do not remove preview routes; the web viewer is a core primitive.

## Stop Conditions

Stop and report options before implementing if any of these occur:

- A deletion would remove CLI search/read/status/spawn, terminal durability, graph core, provider fallback, or invocation diff review.
- A planned deletion requires a new public route, CLI flag, shared protocol field, or command-server behavior not covered by existing review notes.
- BrowserPane needs to support arbitrary remote URLs or untrusted extension content.
- A plugin manifest would gain execution authority, renderer code loading, CLI/MCP registration, terminal launch rights, or self-granted permissions.
- A profile apply/recovery deletion risks leaving real-vault users without a way to inspect or restore already-created recovery manifests.
- Agent B/C/D/E depend on a module slated for deletion and no decoupling owner is assigned.
- Tests reveal command-server token auth is bypassed or stale tests require unauthenticated route access.
- Command-server token appears in a URL, query string, log, or any BrowserPane-reachable context.
- The implementation agent is tempted to hide, gate, or freeze an old product surface instead of deleting it without an explicit Fable/user decision.

-- Exo | 2026-07-09
