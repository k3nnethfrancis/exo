# Public Contract Review Notes

This file is the lightweight annotation ledger for Exo's public agent/operator contract guard.

Boundary rule: command-server routes, CLI commands/flags, and shared protocol types require architect review before shipping unless a user-approved exception is explicitly documented.

`pnpm check:repo` verifies the protected contract slices below by SHA-256. The guard intentionally hashes route constants/types, command-server route matching lines, CLI command/usage/flag lines, and CLI command-server client route calls instead of whole files. Implementation-only body edits in these files should not require a review-ledger update unless they change one of those extracted slices.

External plugin contracts are not protected by this guard while they are marked `status: unstable`. When an exported core contract is reviewed as stable, has two real consumers, and can be version-gated by plugin manifests, add a focused protected slice for that exported type or schema here. This keeps trace, proposal/review, dataset, eval, graph, harness, and surface contracts cheap to change until their consumer evidence supports a compatibility promise.

If a protected slice changes, add a new entry under that slice with the new hash and one of these review note prefixes:

- `architect-review: YYYY-MM-DD <reviewer/ref and summary>`
- `user-approved-exception: YYYY-MM-DD <task/user approval and summary>`

Use `guard-baseline` only for the initial no-behavior-change snapshot that introduced this guard.

Exception discipline: a `user-approved-exception` must name the approving task or user decision, and it must receive a post-hoc architect review within the same work wave. That review can either approve the exception as intentionally bounded or require a follow-up contract cleanup before the next wave.

Escape hatch: if a repo check flags a change that is genuinely implementation-only noise, narrow the extractor in `scripts/check-repo.mjs` in the same change and explain why the public contract did not move. Do not silence the guard by adding a review note for unrelated implementation churn.

## Removal Approval Notes

- architect-review: 2026-07-12 `docs/reviews/2026-07-12-fable-loop-01-packet.md#fable-ruling--2026-07-12` confirms removal of the retired Project Root, MCP, routine, deep harness-manager, profile-apply, and plugin-manager product surfaces after caller audit. This approval covers removals only; new command-server routes, CLI commands/flags, or shared protocol types remain out of scope.
- architect-review: 2026-07-08 MCP removal audit deleted `packages/mcp`, `exo integrations`, MCP capability surfaces, MCP profile-template support, MCP public-contract guard slices, and Codex MCP launch injection. CLI remains the active local integration surface.
- user-approved-exception: 2026-07-13 user explicitly restored one bounded Exo MCP surface for first-run Claude/Codex setup. It is a CLI-owned stdio retrieval adapter (`workspace_status`, `search_notes`, `read_note`) over the existing Workspace scope, with no generic MCP manager, arbitrary-server setup, or mutation tools. This must receive focused architecture review before public stabilization.

## Protected Surfaces

### `packages/core/src/command-protocol.ts#routes-and-types`

- sha256: `c12a5694574feecbad1508d9e7b3f73d07be7c3c5798ae820faa469380d24373`
- review: guard-baseline: 2026-07-04 existing shared command route and payload type exports; guard cleanup does not change behavior.
- sha256: `6c6003ee69693121a8b9eb703840d72015b787625c613029cfff359bda1c5669`
- review: user-approved-exception: 2026-07-04 plugin architecture cleanup intentionally moved app/CLI agent-create payloads toward registered harness ids while preserving compatibility fields for terminal sessions and persisted backfill.
- sha256: `c1bf841f979298a4732c7f73e56d8d441e1de5eff617467b981709730a7e8ce0`
- review: architect-review: 2026-07-08 Fable Exograph completion review approved per-runtime command-server token auth on all routes with the token stored in `server.json`; this protocol update adds the shared token header constant and required discovery token field.
- sha256: `56dccdd401e9b9c59d90401c88b7c441fc56d0bfd625b675001b917f1e8eee1e`
- review: architect-review: 2026-07-08 Fable Exograph completion review approved `AgentCommand` as the V1 agent identity and `exo spawn @handle` as a CLI-only configured-command launch surface; protocol update adds the spawn route request/response and invocation payload types.
- sha256: `a61037495a1201d05172cf29d32abc5b25e28d775414580a45bad12137a49344`
- review: architect-review: 2026-07-08 MCP removal audit removed MCP from the capability/caller-surface vocabulary and retained the existing app/CLI command protocol routes.
- sha256: `0b02ba339dedc94bab35e89812a0360f313c62ea986797f3f8266f50ffe17183`
- review: user-approved-exception: 2026-07-11 User explicitly authorized Codex to settle the refactor contract without Fable; removes stale `/index/update` and `/index/embed` constants after a zero-caller audit. Explicit `index sync` remains the public maintenance action.

### `apps/desktop/src/main/command-server.ts#route-table`

- sha256: `44fa7ee1d2d59a8de978dbec49e4d0694e08ff897b98b92dabc4b75f4ed41c04`
- review: guard-baseline: 2026-07-04 existing command-server HTTP method and route match surface; guard cleanup does not change behavior.
- sha256: `60d347d59b9c6f3356472d6d67b33b006c90d52bc7265cda203b2b84af2b7bd8`
- review: architect-review: 2026-07-08 Fable Exograph completion review approved routing configured AgentCommand spawn through the authenticated local command server, with token auth already required on all routes and structured untrusted-command errors.
- sha256: `438da0c99da1136f4074bc4d1c6b3057e091c5be9e299d0a50243742b119ec5b`
- review: user-approved-exception: 2026-07-11 User explicitly authorized Codex to settle the refactor contract without Fable; removed zero-caller terminal diagnostics/transcript/semantic-answer and index update/embed routes. The retained authenticated loopback routes are the V1 operator contract.

### `packages/cli/src/index.ts#commands-and-flags`

- sha256: `27d3d18d302c398cb953c633a737bbd0e4f65dc47ac2ef50290dff9bc0a57b1e`
- review: guard-baseline: 2026-07-04 existing CLI command, usage, and flag parsing surface; guard cleanup does not change behavior.
- sha256: `481bad75527ab75ff8ab04cc5a4a5f7adabf6939dc81e8a7a4c122720cd58962`
- review: user-approved-exception: 2026-07-05 Wave 6 recovery/rollback task explicitly allowed CLI/app command surfaces and prohibited Fable/oracle; adds `exo profile-recovery list|show|restore` as a local operator-only recovery surface.
- review: architect-review: 2026-07-05 fable-exo-wave6-review.md — confirmed CLI recovery surface is acceptably narrow and intentionally operator-only.
- sha256: `2934f84385e13dea7f8f07b5feb2d95a24ef1795219ab733c74531423e016526`
- review: user-approved-exception: 2026-07-05 Wave 6 trace-retention task explicitly requested a CLI-first operator surface for listing and cleaning semantic traces before broad real-vault plugin dogfooding; post-hoc architect review should confirm the command shape before public stabilization.
- review: architect-review: 2026-07-05 fable-exo-wave6-review.md — confirmed CLI trace list/cleanup is sufficient for dogfooding and should remain explicit, with no hidden retention cap.
- sha256: `7d6378d2b14ae8ceacac28bb8513bcde3ffe9e1d06d30ef6d12c3d474596f9ee`
- review: user-approved-exception: 2026-07-05 Wave 6 merged CLI operator surface combines `exo profile-recovery list|show|restore` with `exo traces list|cleanup`; this is intentionally CLI-only and requires post-hoc Fable/oracle review before public stabilization.
- review: architect-review: 2026-07-05 fable-exo-wave6-review.md — confirmed merged Wave 6 CLI operator surface can ship after partial-restore reporting and ledger closure fixes.
- sha256: `3a2e29f9613087e887404e24f163e9ffd3e56d4d9abaa023a9a7fe007b4d29de`
- review: architect-review: 2026-07-08 Fable Exograph completion review approved `exo spawn @handle <task>` for already trusted AgentCommand configs, with no CLI self-trust flag and `note_dir` cwd rejected outside document context.
- sha256: `64f3436ebb49c0f475d85cc8c91ebbe1e7613679282b010835b78faff107df2e`
- review: architect-review: 2026-07-08 MCP removal audit deleted the legacy `exo integrations` command family and kept CLI search/read/status/terminal/AgentCommand surfaces as the active local integration path.
- sha256: `e09e9624ff2f59e1655c34cbf714b12cfe2dca60a3cd3f7d565d1296be588ccb`
- review: architect-review: 2026-07-09 Fable Exograph completion plan required deleting `profile-recovery` when no real recovery manifests exist; targeted manifest audit found none, so the CLI recovery command was removed with profile-apply proposal/recovery code.
- sha256: `41ee36a7ec85c40682cf773ee01505d39f1b66331ca40bde702dc6e46c038095`
- review: user-approved-exception: 2026-07-11 User explicitly authorized Codex to settle the refactor contract without Fable; restores `exo start` as the macOS packaged-app bootstrap and preserves app-off filesystem `status`, `search`, and `read`. Mutating/focus/terminal commands remain app-backed.
- sha256: `df34fa9c662c551dd0655155ecccd93ca030447c9d522bf8f3788c248d1b4dcd`
- review: user-approved-exception: 2026-07-13 User explicitly requested first-run installation of Exo MCP into Claude/Codex. Adds `exo mcp serve`, a stdio-only, read-only adapter that exposes the current Workspace status/search/read context and no mutation, terminal, or agent-launch tools.

### `packages/cli/src/app-client.ts#route-client-methods`

- sha256: `334f61251ac0ce1f32e8a6cdec3ca8268831a5fe4e345bf182216da684420a40`
- review: guard-baseline: 2026-07-04 existing CLI app-client route method surface; guard cleanup does not change behavior.
- sha256: `c6a887cffc9f911b5433a3ec4da69d262af03a35fc8cabfe36efaba6b24de421`
- review: user-approved-exception: 2026-07-04 plugin architecture cleanup intentionally updated CLI app-client agent-create route payloads to submit harness ids through the registered harness path.
- sha256: `27fbf0b328b454c9a3afe57fffc855ae1695dcbeac5eff074809b09046bcf3ec`
- review: architect-review: 2026-07-08 Fable Exograph completion review approved adding the CLI app-client method for authenticated AgentCommand spawn over the local command server.
- sha256: `28f5d85fd44f3636bc2fc7c2910f812e89ada29d363cef89c0b96171ac2769ac`
- review: user-approved-exception: 2026-07-11 User explicitly authorized Codex to settle the refactor contract without Fable; removed client methods for the same zero-caller diagnostic/transcript/index-maintenance routes removed from the command server.
