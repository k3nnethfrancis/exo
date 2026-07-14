# EXO-ISSUE-115 — Invocation session continuity analysis

**Status:** design only; no production changes in this worktree  
**Local CLI evidence:** Claude Code 2.1.208; Codex CLI 0.142.5  
**Decision:** default new workspaces to continuous context, but keep Exo Invocations distinct from provider conversations and make every fresh/resumed/fallback outcome visible.

## Identity model

Three IDs currently participate in an inline run and must never be conflated:

| Identity | Owner | Meaning |
| --- | --- | --- |
| `InvocationRecord.id` | Exo | One authorized process run and its observation/review lifecycle. Generated in `InvocationRunner.prepare()`. |
| `protocolInvocationId` | Markdown document | One inert `<exo-invocation>` request envelope. It links a durable request and response in source. |
| `providerSessionId` | Claude/Codex | One provider-owned resumable conversation. It may span many Exo Invocations. |

All three may happen to be UUIDs. Equality is neither required nor meaningful. In particular, the Exo invocation UUID is **not** a Claude or Codex session ID. `providerSessionId` is currently captured only from Claude's structured stdout and is optional provenance on one Invocation record.

Provider-neutral vocabulary:

- **continuity policy:** `continuous` or `fresh`;
- **continuity lane:** one Workspace + configured Command + canonical resolved cwd;
- **conversation head:** the opaque provider conversation reference Exo will try on the next Invocation in that lane;
- **continuity outcome:** `fresh`, `resumed`, or `resume-failed-fresh`;
- **reset context:** clear the derived conversation head only;
- **resume handoff:** explicitly open a provider conversation in a visible Terminal; this remains separate from automatic headless continuity.

The UI can say **Keep context between invocations** and **Reset context**. It should not call an Exo Invocation a session.

## Current implementation findings

### Models and migration

- `AgentCommand` has no runtime/provider adapter discriminator. Provider behavior is currently keyed off the editable `handle === "claude"` in `commandForHeadlessInvocation`, `applyProviderSessionProvenance`, failure parsing, and `resumeInTerminal`.
- `normalizeAgentCommand` safely migrates only known historical Claude defaults, but it cannot declare which provider protocol a customized Command supports.
- `InvocationRecord.providerSessionId` is UUID-validated. Older records normalize without it. No record says whether a run was fresh or resumed.
- `normalizeWorkspaceSettings` preserves unknown keys and normalizes configured Commands, so an additive setting can migrate safely. Existing history must not be used to infer a current conversation head.

### Runner and process lifecycle

- Inline note Invocations are headless child processes. One prompt is sent through stdin and then EOF.
- `DirectInvocationProcess` retains bounded stdout but discards stderr and does not expose spawn errors or structured failure categories. Safe stale-session recovery therefore cannot be implemented yet.
- A Claude `session_id` is extracted only after process close. The stored Invocation is first written as pending/running and later rewritten during settlement.
- The active map is keyed by Exo Invocation ID, not by a continuity lane. Two processes can currently overlap for the same Command/document.
- The runner calls `getWorkspaceSettings()` repeatedly in `authorizeAndStart`, `settle`, `get`, review, and orphan recovery. A run prepared in Workspace A can be finalized against Workspace B after an active-workspace switch. Continuity must not build on this behavior.
- Startup marks all pending/running records in the current Workspace orphaned. No provider conversation head exists today.

### Persistence

- Each Invocation lives at `.exo/invocations/{safe Exo invocation id}/record.json`; snapshots and patches are children of that same directory.
- `.exo/` is derived, local, ignored state. It is the correct location for conversation heads, but Invocation history is the wrong owner: a head spans multiple records and must be reset without deleting history.
- Trust decisions are already Workspace-scoped. Conversation heads must have the same or narrower scope and must never live in global application settings.

### Settings and onboarding

- Agent setup currently configures enabled state, label, handle, command, and cwd policy.
- Neither onboarding nor Agent settings has a continuity choice or reset action.
- The requested default is continuous context. The first Invocation in an empty lane is necessarily fresh; subsequent Invocations may resume.

## Recommended architecture

### 1. Make adapter identity explicit

Add an explicit, normalized adapter discriminator to the persisted Command contract:

```ts
type AgentCommandAdapter = "generic" | "claude-code" | "codex-cli";

interface AgentCommand {
  // existing fields
  adapter: AgentCommandAdapter;
}
```

`handle` remains user-facing addressability only. It must never select output parsing, resume syntax, or provider capabilities.

Migration:

1. Built-in Claude and Codex defaults write `claude-code` and `codex-cli` respectively.
2. Migrate only exact known historical built-in identities/command forms. Do not classify an arbitrary customized Command from an editable handle.
3. Unknown or customized legacy Commands become `generic`, retain their command unchanged, and report continuity unavailable until the user deliberately selects a supported adapter.
4. Changing a Command's adapter or executable fingerprint invalidates its conversation head.

Two real implementations earn a small internal `InvocationAdapter` interface owned by desktop main. It should build fresh/resume commands, request structured output, extract an opaque conversation ID, classify a pre-turn stale-resume failure, and build a visible Terminal handoff. It is not a plugin API or public extension registry.

### 2. Keep policy in Workspace settings; keep head in derived state

Add a Workspace-scoped policy with a simple default:

```ts
type InvocationContinuityPolicy = "continuous" | "fresh";

interface WorkspaceSettings {
  invocationContinuityPolicy: InvocationContinuityPolicy;
}
```

This is one workspace-level choice for V1. A future per-Command override is unnecessary until dogfood proves a need. Missing settings normalize to `continuous`; old Invocation records remain historical `fresh` runs and do not seed a head.

Add an `InvocationContinuityStore` under the captured Workspace runtime root, for example:

```text
.exo/invocation-continuity/v1/{hashed-lane-key}.json
```

Each atomically written head contains only local derived provenance:

```ts
interface InvocationConversationHead {
  version: 1;
  workspaceId: string;
  commandId: string;
  commandFingerprint: string;
  adapter: "claude-code" | "codex-cli";
  cwd: string;
  providerSessionId: string;
  sourceInvocationId: string;
  updatedAt: string;
}
```

The lane key is Workspace identity + stable Command ID + canonical resolved cwd. Default Commands use `workspace_root`, producing one lane per agent per Workspace. `note_dir` Commands naturally receive separate context per note directory rather than silently carrying one directory's assumptions into another.

Reset deletes only this head. It does not delete Invocation history, Markdown envelopes, provider-owned session files, diffs, or trust. Disable Reset while that lane is active.

### 3. Pin the Workspace for the complete run

`PreparedInvocation` must capture immutable Workspace identity, runtime root, Note Roots authorization, Command snapshot, policy, lane key, and continuity head generation. Every store/read/review/settle operation for that run must use the captured scope, never `getWorkspaceSettings()` after preparation.

On Workspace switch:

- existing runs may finish into their captured Workspace;
- renderer updates must retain their Workspace identity and must not appear as current-Workspace activity;
- a new Workspace resolves an entirely separate continuity store and lane;
- no fallback to a similarly named Command or provider session in another Workspace is allowed.

This pinning is a prerequisite, not an optional continuity improvement.

### 4. Record visible continuity provenance per Invocation

Extend `InvocationRecord` additively:

```ts
type InvocationContinuityOutcome =
  | "fresh"
  | "resumed"
  | "resume-failed-fresh";

interface InvocationContinuitySummary {
  policy: "continuous" | "fresh";
  outcome: InvocationContinuityOutcome;
  resumedFromInvocationId?: string;
}

interface InvocationRecord {
  // existing fields
  continuity: InvocationContinuitySummary;
}
```

Keep `providerSessionId` as separate provider provenance. On a resumed run it is the provider ID actually observed from that run; never copy an unverified head into the field. `resumedFromInvocationId` links Exo history without exposing the opaque provider ID as Exo identity.

Normalization of old records supplies `{ policy: "fresh", outcome: "fresh" }`. That is historically honest: those versions never attempted automatic continuity.

User-visible status must distinguish:

- **Fresh context** — no head, policy is fresh, unsupported adapter, or reset;
- **Continued context** — provider confirmed the resumed conversation;
- **Context expired · started fresh** — a positively classified stale resume failed before a turn and Exo retried fresh;
- **Could not continue context** — failure could not be proven safe to retry.

### 5. Fail concurrent same-lane work visibly

Do not queue in V1. A queued invocation can launch later against a drifted document and makes explicit authorization temporally ambiguous.

- Acquire a race-free in-memory lane lock immediately before launch.
- If occupied, reject visibly with `continuity-busy`: “Claude is already working in this context.”
- Do not globally serialize Invocations. Different lanes and explicit `fresh` policy runs may proceed concurrently, subject to the existing attribution rules.
- Do not fork automatically. Claude supports `--fork-session`, but Codex exposes no equivalent in current local help and forking changes the user's continuity model.
- Release the lock after process close/finalization, launch failure, cancellation, or classified fallback completion.

### 6. Recover stale heads without duplicating work

The process boundary must capture bounded stdout **and stderr**, child spawn errors, and an adapter-classified result. A stale resume may fall back fresh exactly once only when the adapter can prove the provider rejected the session before beginning the agent turn and no Workspace change was observed.

Recovery sequence:

1. Read and validate the head against Workspace, Command fingerprint, adapter, and cwd.
2. Attempt resume while holding the lane lock.
3. If provider confirms resume, record `resumed` and advance the head to the structured ID it emits.
4. If the adapter positively classifies a pre-turn stale/missing session, clear the stale head, launch fresh once, record `resume-failed-fresh`, and visibly report the fallback.
5. For timeout, signal, malformed output, permission denial, unknown stderr, or any observed file write, do **not** retry automatically. Fail visibly and retain review evidence.
6. Advance the head only from a validated structured provider ID. A successful run with no ID does not silently preserve an assumed head; report continuity unavailable/stale.

An Invocation that failed after creating a valid provider conversation may still expose **Resume in Terminal**, but automatic head advancement should occur only for adapter-defined trustworthy completion/failure states. These rules must be explicit per adapter.

## Local provider semantics and gaps

### Claude Code 2.1.208

Local help establishes:

- `-p/--print` is non-interactive and persists sessions unless `--no-session-persistence` is set;
- `--resume <session-id>` resumes a provider conversation;
- `--session-id <uuid>` can select a new conversation ID;
- `--fork-session` deliberately creates a new ID while resuming;
- `--output-format json`/`stream-json` provides structured print output;
- current Exo already extracts a UUID `session_id` from structured stdout.

Required adapter work:

- build a headless resume command that preserves `-p`, permissions/model/user flags, structured output, and stdin delivery while adding `--resume` safely;
- keep the existing interactive handoff builder separate because it intentionally strips print-only flags;
- capture stderr and prove stale-session signatures with fixtures from the installed CLI;
- never infer Claude behavior from `@claude`.

### Codex CLI 0.142.5

Local help establishes:

- `codex exec` persists non-ephemeral runs and supports JSONL with `--json`;
- `codex exec resume [SESSION_ID] [PROMPT]` resumes non-interactively;
- `-` reads the resumed prompt from stdin;
- `--ephemeral` disables persistence;
- interactive `codex resume` and headless `codex exec resume` are distinct commands.

Support is not ready in current Exo:

- Exo does not request Codex JSONL or extract its conversation/thread ID.
- The local help does not document the JSON event schema; fixtures/live smoke must establish the exact ID event before parsing it.
- `codex exec resume --help` does not expose the same `--sandbox` flag shown by `codex exec --help`. The current default `codex exec --sandbox workspace-write -` therefore cannot be transformed by naïvely appending `resume`. The adapter must preserve the intended safety policy through resume-supported configuration and prove it in an integration test.
- No Codex equivalent of Claude's `--fork-session` appears in current local help. V1 should not promise fork semantics.
- Until these gaps close, Codex runs fresh and the UI must say continuity is unavailable rather than implying it continued.

## Protected contract changes

These changes require the lead/orchestrator's reviewed public-contract approval before implementation/finalization:

1. **Persisted/shared `AgentCommand`:** add required normalized `adapter`; add `AgentCommandAdapter`; update snapshots and executable fingerprints; migrate only known built-ins, generic otherwise.
2. **Persisted/shared `WorkspaceSettings`:** add `invocationContinuityPolicy`, defaulting missing values to `continuous`; update onboarding/settings save and registry transaction fixtures.
3. **Persisted/shared `InvocationRecord`:** add normalized `continuity` summary with outcome and optional `resumedFromInvocationId`; retain `providerSessionId` as distinct opaque provenance.
4. **Desktop IPC/preload:** add a reset-continuity operation and expose continuity capability/status needed by Settings. It must be Workspace/Command scoped and must not accept an arbitrary filesystem path or provider session ID.
5. **Internal runtime seam:** add two earned main-process adapters (`claude-code`, `codex-cli`) plus `generic`; no plugin registry, dynamic extension, or provider behavior based on handle.
6. **Invocation process result:** extend internal process events with bounded stderr/spawn failure/signal information required for safe classification.

No CLI route is required for the first UI slice. If reset/status is later exposed through the command server or CLI, that is a separate public operator-contract review.

## Test matrix

### Core normalization and stores

- known Claude/Codex defaults migrate to explicit adapters; arbitrary `handle: "claude"` remains generic;
- Command fingerprint changes when adapter changes;
- missing Workspace policy normalizes to `continuous`;
- old Invocation records normalize to fresh provenance and never become a head;
- head writes are atomic, lane-key paths are contained, malformed files fail closed, reset deletes only the head;
- Workspace A can never read, reset, or advance Workspace B's head;
- cwd and Command fingerprint mismatch invalidate a head.

### Adapter command/parsing fixtures

- Claude fresh and headless-resume commands preserve executable, user flags, permissions, model, print mode, structured output, and quoted UUID;
- Claude interactive handoff remains separate;
- Claude structured success extracts the actual emitted session ID; malformed/plain output does not;
- Claude stale-resume fixture is positively classified; unknown error is not;
- Codex fresh/resume builders preserve stdin and safety configuration accepted by 0.142.5;
- Codex JSONL fixture extracts only the documented/proven event ID; malformed output fails closed;
- generic adapter never parses IDs or claims continuity.

### Runner lifecycle

- first continuous run is `fresh`, stores a validated head, and links it to its Exo Invocation ID;
- second same-lane run passes the provider head, records `resumed`, and sets `resumedFromInvocationId`;
- fresh policy never reads/writes a head;
- classified stale resume retries once fresh, records `resume-failed-fresh`, advances the new head, and emits visible status;
- unknown resume failure does not retry or advance;
- same-lane overlap fails visibly with `continuity-busy`; different lanes still run;
- cancellation, send failure, spawn failure, and close always release the lock;
- switching Workspace mid-run writes/finalizes only in the captured Workspace and sends scoped renderer activity;
- reset is rejected/disabled while active and succeeds after settlement;
- restart orphans only captured Workspace records and does not invent a provider result.

### Electron/app QA

- onboarding defaults **Keep context** on and explains it in one short line;
- Agents settings shows the same choice plus Reset only when a head exists;
- fresh, continued, fallback-fresh, unavailable, and busy states are visually distinct and truthful;
- reset leaves Invocation history/diffs intact and next call is visibly fresh;
- Claude two-turn dogfood proves second-turn memory and exact record provenance;
- Codex two-turn dogfood is required before enabling its continuity capability;
- Workspace switch during a running invocation proves zero cross-workspace history, state, trust, or UI leakage.

## Rollout

1. **Scope safety first:** pin Prepared/active Invocations to their originating Workspace and add cross-Workspace lifecycle tests.
2. **Contracts and store:** land reviewed adapter/policy/provenance types, conservative migrations, continuity store, reset semantics, and lane lock.
3. **Claude vertical slice:** fresh → continued → classified stale fallback, with visible provenance and real two-turn app dogfood.
4. **Settings/onboarding:** default continuous, compact reset UI, unsupported capability messaging.
5. **Codex behind capability:** implement only after JSONL ID and resume safety semantics are fixture- and app-proven. Until then it remains visibly fresh-only.
6. **Re-gate:** run focused core/main/Electron tests, full `pnpm ci:check`, packaged-app QA, and update canonical task/issue/architecture docs through the lead worktree.

## Recommendation

Ship **continuous context by default per Workspace + Command + cwd lane**, with a derived, resettable conversation head and explicit per-Invocation provenance. Reject concurrent work in the same lane rather than queueing or forking. Pin every run to its originating Workspace before adding continuity. Support Claude first; do not claim Codex continuity until its JSONL ID and resume safety configuration are proven. Most importantly, introduce an explicit Command adapter discriminator—editable handles must never control provider behavior.

-- Exo | 2026-07-13
