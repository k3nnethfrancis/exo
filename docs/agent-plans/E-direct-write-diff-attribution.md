# Agent E Plan: Direct-Write Observation And Diff Attribution

Last updated: 2026-07-09

status: historical Fable-reviewed planning packet. Its likely/ambiguous
attribution, single-file review, and patch-reference model was not shipped and
must not be used as current guidance. The exact Changeset contract in
`docs/document-agent-protocol.md` supersedes this plan.

## Fable Amendments

- Approved: tagged-document-only pre-snapshot for V1.
- Approved: out-of-scope paths are ambiguous refs without diffs.
- Approved: orphan-on-restart is always ambiguous.
- Approved: UI copy is `Changed during @handle` with likely/ambiguous badges, not authorship language.
- CLI spawn invocations are lifecycle records only in V1; direct-write observation is note-context only because it needs a tagged document anchor.
- Renderer-local conflict state is acceptable for V1, but autosave suspension during conflict is a tested invariant.
- Whole-file patch is acceptable for V1 if line-diff implementation is not already available.
- Use an injectable observation settle/grace period with a tested default around 2 seconds.
- Agent E must not edit `useOpenDocuments.ts` / `NoteEditor.tsx` in parallel with Agent B's graph renderer migration unless assigned to the same implementation worker.
- Add or verify watcher root coverage before claiming observed out-of-scope files across project roots.
- Confirm invocation id collision safety and atomic record/patch finalization.
- Document invocation retention/privacy as V2-deferred.

## Slice

Agent E owns the review layer for direct writes made during an `AgentCommand` invocation:

- tagged-document pre-snapshot;
- watcher observation window;
- changed-file refs and patch refs;
- `likely` / `ambiguous` attribution labels;
- dirty-buffer preservation;
- invocation diff/attribution banner;
- restart/orphan behavior;
- interaction with `InvocationRecord` lifecycle.

This plan assumes the product decision is already made: Exograph allows direct file writes, then shows what changed. It does not reintroduce proposal staging as the default path.

## Scope

Build or harden:

- main-process observation service for invocation windows;
- pre-snapshot of the tagged document before launch;
- watcher event capture for all workspace events during the invocation window;
- diff generation for tagged-document changes;
- ambiguous records for observed out-of-scope files;
- persisted refs under `.exo/invocations/{id}/diffs/`;
- renderer banner and diff toggle for the tagged document;
- dirty open-buffer conflict UI;
- restart recovery that marks running invocations orphaned;
- tests proving `.exo/invocations/` remains gitignored.

## Non-Goals

- No line-perfect authorship.
- No "authored by" or "edited by" claims in UI copy.
- No proposal/review accept-reject workflow as the default direct-write path.
- No V1 revert button.
- No full-vault pre-snapshot.
- No watcher-owned auto-run of mentions.
- No MCP, Routine, feed, or Plugin Manager integration.
- No global lock that serializes all invocations unless dogfooding proves ambiguity is unmanageable.

## Evidence Checked

Planning docs:

- `docs/exograph-refactor-completion-plan.md`
- `docs/exograph-completion-orchestration-plan.md`
- `docs/exograph-detailed-implementation-plans.md`
- `docs/extension-architecture.md`
- `docs/document-agent-protocol.md` (canonical replacement)
- `tasks.md`
- `issues.md`

Relevant code:

- `apps/desktop/src/main/invocation-observation-service.ts`
- `apps/desktop/src/main/invocation-observation-service.test.ts`
- `apps/desktop/src/main/agent-command-invocation-service.ts`
- `apps/desktop/src/main/workspace-watchers.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/shared/desktop-ipc.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/hooks/useOpenDocuments.ts`
- `apps/desktop/src/renderer/src/invocationReviewState.ts`
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/components/NoteEditor.tsx`
- `apps/desktop/tests/e2e/agent-invocation.spec.ts`
- `packages/core/src/agent-invocation.ts`
- `packages/core/src/invocation-store.ts`
- `packages/core/src/__tests__/agent-invocation.test.ts`
- `packages/core/src/__tests__/invocation-store.test.ts`

Current branch facts:

- `InvocationObservationService` already snapshots the tagged document, subscribes to `WorkspaceWatcherService`, finalizes on terminal exit or explicit user end, writes a whole-file unified patch, emits updated records, and marks running records orphaned on startup.
- `WorkspaceWatcherService.subscribe()` exists and ignores `.exo`, `.git`, `node_modules`, build outputs, and similar runtime/cache trees.
- The renderer already listens for invocation updates, schedules tagged-document refreshes, and shows a banner with "Running @handle" / "Changed during @handle".
- Dirty conflict handling currently derives from `record.changedFileRefs` plus local document `dirty` state; "Keep buffer" and "Reload disk" are renderer-local choices.
- `readInvocationDiff(ref)` resolves refs under the workspace root and rejects paths outside `.exo/invocations`.
- E2E coverage already exists for fake command append/diff, dirty-buffer conflict, and orphaned restart.

## Add / Delete / Modify List

### Add

- Add a core/main `ObservedChange` shape, or extend `InvocationChangedFileRef`, with enough reason metadata for review:
  - `path`;
  - `kind`;
  - `observedAt`;
  - `attribution`;
  - `attributionReasons`;
  - optional `beforeHash`;
  - optional `afterHash`;
  - optional `diffRefId`.
- Add explicit out-of-scope observed-file handling:
  - if watcher sees a file other than the tagged document during the window, record it as `ambiguous`;
  - do not diff it in V1 unless it was in the pre-snapshot scope.
- Add unreadable/binary handling:
  - record `ambiguous`;
  - do not attempt UTF-8 patch generation;
  - include a terse reason.
- Add path traversal and allowed-root tests for invocation diff reads.
- Add tests for overlapping invocations on the same tagged document.
- Add tests for observed watcher event without matching tagged-document change.
- Add tests for tagged-document delete and create cases.
- Add tests for dirty-buffer conflict not being cleared by autosave.
- Add a small retention/privacy note in docs if Agent F does not own it elsewhere.

### Modify

- Modify `InvocationObservationService` to treat the observation window as lifecycle-driven:
  - start after the pre-snapshot and before prompt delivery;
  - end on `process-exited`, `user-ended`, or `timeout-ended`;
  - apply a short grace period after terminal exit/user end before final read;
  - never depend only on process exit because interactive terminals may keep running.
- Modify finalization to include all observed files:
  - tagged document gets a diff if before/after UTF-8 snapshots are available;
  - out-of-scope paths become ambiguous changed-file refs without diffs.
- Modify attribution reasoning:
  - `likely` only when there is exactly one relevant invocation, the tagged document was pre-snapshotted, a watcher event was observed during the window, Exo did not restart, and no dirty/local conflict is known;
  - `ambiguous` for overlaps, out-of-scope files, dirty open buffers, missing watcher event, unreadable files, restart/orphan, or missing before/after hashes;
  - `unattributed` only when no relevant change exists.
- Modify patch generation:
  - keep `.exo/invocations/{id}/diffs/{diffId}.patch`;
  - use stable diff ids per changed file, not a permanent `diff-1` assumption once more than one path can be recorded;
  - prefer a real line diff if already available in dependencies; otherwise keep a clearly scoped whole-file patch for V1 and note the limitation.
- Modify renderer banner copy to preserve the approved language:
  - "Changed during @handle";
  - badges/details for `likely` and `ambiguous`;
  - no "likely edited by" or authorship phrasing.
- Modify dirty-buffer handling so autosave cannot overwrite the disk version after a conflict is detected:
  - either suspend autosave for that document while the conflict is active, or make autosave fail closed with visible conflict state;
  - keep both local buffer and disk content recoverable until the user chooses.
- Modify invocation record display to include transcript/open-terminal affordance if Agent D exposes it cleanly.

### Delete

- Delete any UI copy that implies authorship rather than time-correlated attribution.
- Delete any old proposal/review accept-reject affordance if it is accidentally reused in the invocation diff surface.
- Delete any watcher callback path that bypasses the shared `WorkspaceWatcherService.subscribe()` API.
- Delete assumptions that all note roots are git repos or that restore can be git-backed.

## Data Model Plan

V1 should keep `InvocationRecord` as the persisted source of truth and avoid a separate database.

Recommended additions to `InvocationChangedFileRef`:

```ts
interface InvocationChangedFileRef {
  path: string;
  kind: "created" | "modified" | "deleted" | "unknown";
  observedAt?: string;
  attribution: "pending" | "likely" | "ambiguous" | "unattributed";
  diffRefId?: string;
  beforeHash?: string;
  afterHash?: string;
  attributionReasons?: string[];
}
```

If the orchestrator wants a cleaner boundary, introduce `ObservedChange` in main and serialize it into `InvocationChangedFileRef` at finalize time. Do not create a second persisted record family unless Fable asks for it.

## Observation Window

Sequence:

1. Agent D saves the tagged document or refuses launch if dirty save fails.
2. Agent E snapshots the tagged document from disk.
3. Agent D creates the invocation record and terminal session.
4. Agent E begins observing before prompt delivery.
5. Agent D sends the pointer prompt into the terminal.
6. `WorkspaceWatcherService` emits settled workspace events into the observer.
7. Observation ends by lifecycle event:
   - `process-exited`;
   - explicit user `End`;
   - `timeout-ended` if configured later;
   - `orphaned` on app restart.
8. Agent E waits a short grace period, reads after-state, writes patch refs, updates record, emits renderer update.

The current `500ms` grace period is too test-optimized for the product default. Implementation should isolate timing as a named injected option and use a tested default around 2 seconds.

## Attribution Rules

`likely` requires all of:

- invocation did not orphan;
- target file is the tagged document;
- tagged document had a valid pre-snapshot;
- watcher observed that file during the active window;
- no overlapping invocation targeted that file;
- no known dirty editor buffer conflict for that file;
- after-state was readable as text;
- diff was written successfully.

`ambiguous` applies when any of these are true:

- overlapping invocation windows touch the same file;
- changed file is outside the pre-snapshot scope;
- tagged document changed but no watcher event was captured;
- file was unreadable, deleted unexpectedly, binary, or hashless;
- app restarted during the invocation;
- renderer reports a dirty-buffer conflict;
- user saved the same file during the window;
- observation ended by timeout rather than process exit or explicit user end.

`unattributed` applies only when no changed file refs are produced.

## Dirty Buffer Preservation

Red line: never replace a dirty editor buffer with disk contents because an invocation changed the file.

Implementation approach:

- Keep `useOpenDocuments.scheduleRefresh()` as the normal clean-buffer refresh path.
- When the renderer receives an invocation update for an open dirty document, mark a conflict key.
- While conflict key is active:
  - do not auto-refresh;
  - do not autosave or flush the local buffer to disk silently;
  - show banner actions: view diff, keep buffer, reload disk.
- `Keep buffer` keeps the local unsaved editor text and dismisses only that conflict warning.
- `Reload disk` requires confirmation and discards local unsaved edits.
- If the user later saves a kept dirty buffer, treat that as a new user write outside the invocation attribution claim.
- Any autosave/save path that writes while the conflict is active is a stop condition.

Open design detail: the current conflict state is renderer-local. That is sufficient for V1 data-loss prevention if autosave is suspended correctly. If Fable wants persisted conflict evidence, add a `dirty-buffer-conflict` attribution reason in the record after renderer notification, but do not block V1 on a bidirectional conflict writeback unless required.

## Patch Refs

Patch storage:

- `.exo/invocations/{safeInvocationId}/diffs/{safeDiffId}.patch`
- refs in records remain workspace-relative, for example `.exo/invocations/invocation-1/diffs/diff-1.patch`

Rules:

- patch refs must never point outside `.exo/invocations`;
- patch writes should be atomic enough that the record does not point at a missing patch;
- if patch write fails, finalization should still update the record as `ambiguous` with a failure reason;
- do not store patches for out-of-scope files in V1;
- `.exo/invocations/` must stay gitignored.

## Orphan And Restart Behavior

On app startup:

- read invocation records under `.exo/invocations`;
- any `pending` or `running` record becomes `orphaned`;
- attribution summary becomes `ambiguous`;
- no attempt is made to continue observing after restart in V1;
- UI copy should say attribution is incomplete because Exo restarted during the invocation.

Do not infer completion from terminal/tmux state after restart for V1. Reattachment can become a later terminal-monitor feature, but attribution windows are not reconstructable enough to be honest.

## UI Plan

Banner:

- show on the tagged document only;
- while running: `Running @handle`;
- after finalization: `Changed during @handle`;
- summary includes changed-file count and ambiguous qualifier;
- actions:
  - `End` while running;
  - `Show diff` / `Hide diff` after patch refs exist;
  - `Keep buffer` / `Reload disk` during dirty conflict.

Diff detail:

- read only via internal preload/IPC;
- no accept/reject buttons;
- no revert button in V1;
- show text patch for tagged document;
- show ambiguous out-of-scope paths as a list if present, even without diffs.

Trust copy:

- use "changed during" as the base phrase;
- use `likely` and `ambiguous` as confidence badges;
- never say "authored by", "proved", or "agent edited" without qualification.

## Sequencing And Dependencies

Must land before Agent E implementation:

1. Agent A shared `WorkspaceWatcherService.subscribe()` API.
2. Agent D final `InvocationRecord` lifecycle shape.
3. Agent D explicit invocation end mechanism for interactive sessions.
4. Agent D dirty tagged-document launch gate: save or refuse before pre-snapshot.
5. Agent D terminal/session id wiring so observation can finalize on terminal exit when available.
6. Agent B graph renderer migration through `useOpenDocuments.ts` and `NoteEditor.tsx`, unless the same worker owns both renderer edits.

Agent E implementation sequence:

1. Lock the data model: changed-file reason fields or a local `ObservedChange` mapper.
2. Harden `InvocationObservationService` snapshot/finalize rules.
3. Add out-of-scope observed file refs.
4. Add overlap detection for active invocations at finalize time, not only at start.
5. Add binary/unreadable/delete/create handling.
6. Add stable multi-diff patch ids and patch read path tests.
7. Add renderer dirty-conflict autosave suspension.
8. Polish banner/detail view copy and ambiguous path display.
9. Run focused unit tests, renderer tests, and E2E.
10. Hand off to Agent F for 10 real pointer-prompt dogfooding.

## Tests And QA

Core/main unit tests:

- tagged document modified -> patch ref and `likely`;
- tagged document changed without watcher event -> `ambiguous`;
- observed out-of-scope file -> `ambiguous`, no diff;
- overlapping invocation same tagged document -> both ambiguous or affected file ambiguous;
- deleted tagged document -> changed ref kind `deleted`;
- created tagged document from missing pre-snapshot -> changed ref kind `created`, likely only if watcher event and no overlap;
- unreadable/binary file -> ambiguous, no patch;
- patch write failure -> ambiguous record with no dangling diff ref;
- terminal exit finalizes after grace period;
- explicit user end finalizes a never-exiting invocation;
- startup marks pending/running records orphaned;
- `.exo/invocations/` is gitignored;
- `readInvocationDiff` rejects traversal and outside-root refs.

Renderer tests:

- dirty changed document shows conflict banner;
- autosave is suspended or blocked while conflict is active;
- `Keep buffer` preserves local text;
- `Reload disk` requires confirmation and replaces editor state;
- banner copy uses `Changed during @handle`;
- ambiguous changed files are visible.

E2E:

- fake command appends to the tagged note, refreshes clean open note, shows diff;
- fake command changes tagged note while user has dirty edits, keeps dirty buffer;
- overlapping fake invocations mark ambiguity;
- app restart during running invocation marks orphan;
- optional: fake command changes a linked/out-of-scope file and banner shows ambiguous path without diff.

Manual QA:

- run in a scratch workspace, not the real vault first;
- open note, invoke fake command, inspect `.exo/invocations/{id}/record.json` and patch;
- repeat with dirty open buffer;
- repeat with app restart;
- verify no `.exo/invocations` file is listed by `git status`.

## Data-Loss And Trust Implications

Primary data-loss risk is overwriting unsaved editor state after an agent writes to disk. The implementation must fail closed: preserve the dirty buffer, show conflict, and require a user choice.

Secondary trust risk is overstating attribution. V1 attribution is time-correlated, not authorship. The UI must make ambiguity visible and must not hide out-of-scope writes.

Privacy risk: `.exo/invocations` may contain note content and diffs. It must remain gitignored, and docs should tell users this is local runtime evidence with a future retention/cleanup story.

Security risk: diff refs are file reads. Keep them internal to preload/IPC and locked to `.exo/invocations`; do not expose them through command-server, CLI, or web content unless separately reviewed.

## Open Unknowns

1. Settled by Fable: dirty-buffer conflict state may stay renderer-local in V1 if autosave suspension is tested.
2. Settled by Fable: use an injectable grace period with a tested default around 2 seconds.
3. Settled by Fable: whole-file unified patch is acceptable for V1 if line diff is not already available.
4. How should user saves during an active invocation be detected reliably: renderer IPC signal, watcher plus dirty-state inference, or explicit save event subscription?
5. Settled by Fable: only note-context invocations observe file writes in V1; CLI spawn records lifecycle only.
6. Do we need a V1 retention setting, or is gitignore plus local runtime storage enough until dogfooding?
7. Should observed out-of-scope paths include project roots as well as note roots, or only the watcher roots Agent A configured?

## Fable Review Packet

Fable decision:

Proceed with tagged-document-only pre-snapshot and watcher-observed ambiguous refs for out-of-scope files. Keep dirty conflict state renderer-local for the first implementation if autosave is suspended correctly. Do not persist full-vault snapshots, do not add revert, and do not expose diff reads outside internal IPC.

Questions routed to Fable and answered on 2026-07-09:

1. Renderer-local dirty conflict state is acceptable for V1 if autosave suspension is covered by tests.
2. CLI `exo spawn` does not observe file writes in V1; Agent E stays note-invocation-only.
3. Whole-file patch is acceptable for V1 dogfooding if a line diff is not already available.
4. Grace period is injectable with a tested default around 2 seconds.
5. Out-of-scope observed-file UI remains an implementation detail, but paths must be visible somewhere in the diff/detail surface.
6. Attribution reason fields are internal additive record metadata unless exposed through CLI/command-server public surfaces.
7. Gitignore coverage is enough for V1 privacy; retention/cleanup is documented as V2-deferred.

## Stop Conditions

Stop implementation and return to the orchestrator if:

- any path can overwrite a dirty editor buffer without confirmation;
- a diff ref can read outside `.exo/invocations`;
- UI copy implies authorship rather than time-correlated change observation;
- observation requires MCP, Routine, Plugin Manager, or proposal staging to work;
- Agent D lifecycle cannot produce a reliable end event or explicit user end action;
- Agent A watcher fan-out is not available and implementation would add a second watcher ownership path;
- `.exo/invocations/` is not gitignored;
- tests require writing to the real vault instead of scratch fixtures;
- adding record fields is deemed a public contract change without review.

-- Exo | 2026-07-09
