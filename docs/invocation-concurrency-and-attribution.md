# Invocation Concurrency And Attribution

Last updated: 2026-07-08

status: planning. Blocks diff banner implementation.

## Problem

V1 allows direct writes. Exo observes changed files during an invocation window and attributes those changes to the invocation when reasonable.

This is not line-perfect authorship. It is time-correlated change attribution.

## Attribution Levels

V1 supports two labels:

- `likely`: one active invocation plausibly caused the change and no conflicting writer was observed.
- `ambiguous`: attribution is uncertain because of overlapping invocations, user edits, missing pre-snapshot, app restart, or changes outside the observed scope.

No V1 UI should say "authored by" without qualification. Prefer "likely edited by" or "changed during".

## Observation Window

An invocation observes changes from:

- process start;
- until process exit;
- plus a short grace period after exit.

The grace period exists because file watchers and editor refresh can lag. Fable suggested roughly 10 seconds as a starting point, but this should be configurable in code/tests if timing proves brittle.

## Pre-Snapshot Scope

V1 should snapshot a bounded scope to avoid expensive full-vault hashing.

Initial scope:

- the tagged document;
- files in the same directory;
- optionally explicitly linked local files if easy and deterministic.

The watcher may still observe changes outside the snapshot scope. Those changes should be recorded with missing `beforeHash` and `attribution: "ambiguous"`.

## Concurrent Edits

Attribution becomes ambiguous when:

- two invocations overlap;
- a user edits the same file during an invocation;
- an external process edits the file;
- the app restarts before process exit;
- the file was not in the pre-snapshot;
- watcher events arrive without enough information to compute before/after diffs.

V1 policy:

- allow concurrency;
- label ambiguity honestly;
- do not serialize all invocations globally;
- consider per-file warnings later if ambiguity is common.

## Dirty Editor Buffers

The most dangerous direct-write case is an agent modifying a file while the user has unsaved edits open in Exo.

V1 policy:

- never refresh an open editor buffer in a way that silently overwrites unsaved local edits;
- if disk changes arrive for a dirty buffer, show a conflict/refresh choice instead of replacing editor state;
- mark invocation attribution ambiguous for the affected file until the conflict is resolved;
- preserve both the unsaved buffer and disk content long enough for manual recovery.

This is a trust boundary. A diff banner is not useful if refresh can lose the user's own edits.

## Restart And Orphans

If Exo exits or restarts while an invocation is running:

- mark the invocation `orphaned` unless the terminal/session can be reattached and exit status recovered;
- preserve the last known record;
- record later file changes as ambiguous unless a reliable run window can be reconstructed.

The UI should show "Attribution incomplete because Exo restarted during this invocation."

## Diff And Restore

Direct write requires a non-git restore story.

V1 should persist patch files under `.exo/invocations/{id}/diffs/`. The first UI can show diffs only. Restore can remain manual or git-backed, but the planning must not assume all note roots are git repos.

Future restore options:

- reverse patch from invocation diff;
- open changed file in git/source-control UI if repo-backed;
- stage a proposal-like revert batch;
- copy previous content from pre-snapshot if available.

V1 red line: do not ship a "Revert" button unless it is guarded by hashes and tested on non-git files.

## Diff Banner Requirements

The first diff banner should show:

- invocation label/handle;
- command label;
- status and exit code;
- changed file count;
- attribution confidence;
- toggle to show/hide diff;
- link/open terminal transcript if available.

## Red Lines

- No line-perfect authorship claims.
- No silent overwrite of unsaved editor state during refresh.
- No optimistic "revert" without hash guards.
- No hiding ambiguous attribution.
- No global concurrency lock unless real dogfooding shows ambiguity is unmanageable.

-- Exo | 2026-07-08
