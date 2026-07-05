# Public Contract Review Notes

This file is the lightweight annotation ledger for Exo's public agent/operator contract guard.

Boundary rule: command-server routes, CLI commands/flags, MCP tool parameters, and shared protocol types require architect review before shipping unless a user-approved exception is explicitly documented.

`pnpm check:repo` verifies the protected contract slices below by SHA-256. The guard intentionally hashes route constants/types, command-server route matching lines, CLI command/usage/flag lines, MCP tool schema declarations, and CLI/MCP command-server client route calls instead of whole files. Implementation-only body edits in these files should not require a review-ledger update unless they change one of those extracted slices.

External plugin contracts are not protected by this guard while they are marked `status: unstable`. When an exported core contract is reviewed as stable, has two real consumers, and can be version-gated by plugin manifests, add a focused protected slice for that exported type or schema here. This keeps trace, proposal/review, dataset, eval, graph, harness, and surface contracts cheap to change until their consumer evidence supports a compatibility promise.

If a protected slice changes, add a new entry under that slice with the new hash and one of these review note prefixes:

- `architect-review: YYYY-MM-DD <reviewer/ref and summary>`
- `user-approved-exception: YYYY-MM-DD <task/user approval and summary>`

Use `guard-baseline` only for the initial no-behavior-change snapshot that introduced this guard.

Exception discipline: a `user-approved-exception` must name the approving task or user decision, and it must receive a post-hoc architect review within the same work wave. That review can either approve the exception as intentionally bounded or require a follow-up contract cleanup before the next wave.

Escape hatch: if a repo check flags a change that is genuinely implementation-only noise, narrow the extractor in `scripts/check-repo.mjs` in the same change and explain why the public contract did not move. Do not silence the guard by adding a review note for unrelated implementation churn.

## Protected Surfaces

### `packages/core/src/command-protocol.ts#routes-and-types`

- sha256: `c12a5694574feecbad1508d9e7b3f73d07be7c3c5798ae820faa469380d24373`
- review: guard-baseline: 2026-07-04 existing shared command route and payload type exports; guard cleanup does not change behavior.
- sha256: `6c6003ee69693121a8b9eb703840d72015b787625c613029cfff359bda1c5669`
- review: user-approved-exception: 2026-07-04 plugin architecture cleanup intentionally moved app/CLI/MCP agent-create payloads toward registered harness ids while preserving compatibility fields for terminal sessions and persisted backfill.

### `apps/desktop/src/main/command-server.ts#route-table`

- sha256: `44fa7ee1d2d59a8de978dbec49e4d0694e08ff897b98b92dabc4b75f4ed41c04`
- review: guard-baseline: 2026-07-04 existing command-server HTTP method and route match surface; guard cleanup does not change behavior.

### `packages/cli/src/index.ts#commands-and-flags`

- sha256: `27d3d18d302c398cb953c633a737bbd0e4f65dc47ac2ef50290dff9bc0a57b1e`
- review: guard-baseline: 2026-07-04 existing CLI command, usage, and flag parsing surface; guard cleanup does not change behavior.

### `packages/cli/src/app-client.ts#route-client-methods`

- sha256: `334f61251ac0ce1f32e8a6cdec3ca8268831a5fe4e345bf182216da684420a40`
- review: guard-baseline: 2026-07-04 existing CLI app-client route method surface; guard cleanup does not change behavior.
- sha256: `c6a887cffc9f911b5433a3ec4da69d262af03a35fc8cabfe36efaba6b24de421`
- review: user-approved-exception: 2026-07-04 plugin architecture cleanup intentionally updated CLI app-client agent-create route payloads to submit harness ids through the registered harness path.

### `packages/mcp/src/index.ts#tool-schemas`

- sha256: `949ef6196644ed7eec3b21fb5eeb285da7d804e8e50ce260b33e69df7dbe5f4b`
- review: guard-baseline: 2026-07-04 existing MCP tool schema and parameter declaration surface; guard cleanup does not change behavior.

### `packages/mcp/src/exo-client.ts#route-client-methods`

- sha256: `f86f86f28193c3189fe3fde4188572480839281325afd20bddd7e0b8fe39291a`
- review: guard-baseline: 2026-07-04 existing MCP app-client route method surface; guard cleanup does not change behavior.
- sha256: `f02f1bf341ae2d05ffbeb844e233bd33a36daaef9d7e34612b69d57a50b6b384`
- review: user-approved-exception: 2026-07-04 plugin architecture cleanup intentionally updated MCP app-client agent-create route payloads to submit harness ids through the registered harness path.
