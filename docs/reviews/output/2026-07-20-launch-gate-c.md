# Launch Gate C — Invocation Changeset

## Outcome

Gate C passes on source/package commit `cbe88cf`. Inline configured Commands now produce one
exact, restart-safe Changeset across authorized Note Roots. Every review action
operates on known bytes and file operations rather than guessed authorship.
The page-native review flow, native-process lifecycle, legacy migration, source
journeys, and exact packaged-app journeys all pass without weakening Gate B's
editor or navigation budgets.

No private Note paths, names, bodies, prompts, provider sessions, or artifact
hashes are included in this repository report.

## Exact review model

- Immutable launch and settled manifests derive created, modified, deleted,
  mode-only, and conservatively proven-renamed file operations.
- Clean base, manifests, decisions, and content-addressed before/after objects
  persist under `.exo/invocations/`; pending review survives relaunch or host
  crash.
- Per-file and batch Keep/Reject are serialized, idempotent, and hash-guarded.
  Reject restores exact clean-base state only when the current path still
  matches the settled proposal.
- Newer human bytes remain an explicit conflict. Exo never resolves the
  conflict by inferring who wrote them or silently overwriting them.
- Affected open editors drain pending autosaves and freeze before a decision,
  preventing a stale renderer buffer from reapplying rejected content.
- Settled invocations compact to only the objects referenced by the Changeset
  and History after validating every retained object.

Pre-Changeset single-note records migrate into the same exact model. Migration
validates legacy before/after hashes, materializes the clean base and manifests,
preserves pending/kept/rejected decisions, and fails closed when evidence is
missing or damaged.

## Native-process boundary

The configured Command is native code with the current operating-system user's
permissions; Exo does not call it sandboxed. Gate C makes the boundary explicit:

- authorization remains Workspace-scoped and bound to the executable's actual
  fingerprint;
- a pre-exec gate prevents the child from running before authorization;
- Exo owns the process group and Stop terminates the complete deterministic
  tree;
- recovery proves the group dead before settlement or root release;
- launch-root identity and mutation paths are revalidated and symlinked
  ancestors fail closed;
- activity exposes bounded lifecycle facts, never streamed hidden reasoning.

## Product dogfood

The real Electron journeys exercise the user-visible loop, not isolated route
handlers:

| Journey | Product result |
| --- | --- |
| `@agent` → Run → review → Keep | Compact authorization and activity yield an inline exact diff; Keep removes the proposal from the queue. |
| `@agent` → review → Reject | The tagged Note returns byte-for-byte to its clean base. |
| Create + modify + delete + rename | The file queue identifies each operation and supports independent decisions. |
| Batch Keep/Reject | One action resolves every still-compatible file; incompatible paths remain explicit conflicts. |
| Dirty affected tabs | Autosaves drain, every affected editor freezes, and the decision cannot race a stale buffer. |
| Drift after settlement | Reject preserves the newer bytes and asks the user to keep current, refresh, or inspect. |
| Stop and process failure | Stop kills the owned tree; failed-process changes remain reviewable. |
| No response or edit | A note invocation fails visibly instead of reporting a false success. |
| Resume | A real provider session exposes the compact Terminal handoff. |
| Relaunch and host crash | Pending exact review rehydrates with the same operations and snapshots. |

Frontmatter-only and Unix-permission changes are visible. Raw YAML is available
for complex property keys. Review controls track the changed text, restore
focus after decisions, and use one deterministic file position rather than a
detached modal or representative-file approximation.

## Verification

Final gates run from the clean integration branch:

- `pnpm ci:check`: 21 script/runtime smoke tests, 151 core tests, 406 desktop
  tests, and 27 CLI tests passed (605 total); all typechecks, builds, repository
  checks, and the installer dry-run passed.
- `pnpm test:e2e`: 101 passed and 2 explicit opt-in journeys skipped.
- `pnpm stable:smoke`: 9/9 bounded scenarios passed.
- `pnpm pack:mac`: the unsigned arm64 `Exo.app` built successfully.
- The packaged app passed all 12 invocation Changeset journeys and all nine
  editor/navigation latency journeys.

Gate B performance remained intact in the full source run: 1,200-Note derived
typing p90 12.0 ms, derived navigation p90 41.4 ms, warmed Search p90 10.3 ms,
Explorer p90 41.0 ms, CLI navigation p90 84.6 ms, filename Search p90 47.0 ms,
breadcrumbs p90 30.5 ms, backlinks p90 39.8 ms, trusted typing p90 14.5 ms,
rapid Backspace p90 11.5 ms, and active invocation typing p90 14.9 ms, with zero
renderer long tasks.

The exact package preserved those budgets: Explorer p90 41.5 ms, CLI total p90
85.0 ms, filename Search p90 46.8 ms, breadcrumbs p90 30.2 ms, backlinks p90
39.9 ms, trusted typing p90 14.9 ms, rapid Backspace p90 11.3 ms, and active
invocation typing p90 14.8 ms, with exact editor/disk bytes and zero long tasks.

The first combined packaged run exposed one test-only content assertion: the
deletion stress fixture appended `- item` directly to a digit line. The app
remained within every latency budget. Inspection found no serializer or preview
filter that changes those bytes; five consecutive packaged repetitions passed.
The fixture now starts on a valid Markdown line and asserts the editor bytes
immediately before autosave. Two source and two packaged repetitions then
passed with typing p90 14.4–15.3 ms, Backspace p90 10.9–11.5 ms, invocation
typing p90 14.4–15.0 ms, exact editor/disk content, and zero long tasks.

## Deliberate limits

- Exact review reports file state and operation evidence, not unverifiable
  human/AI authorship.
- Note Roots bound what Exo captures and can restore; they do not sandbox a
  separately authorized same-user process.
- Rename detection is conservative. Unproven move-like changes remain a delete
  plus create rather than a confident fiction.
- The public CLI invocation route returns a stable launch summary instead of
  exporting Exo's internal Changeset record.

`EXO-ISSUE-111`, the Node 26 CLI process-start floor, remains non-blocking. The
measured total CLI route still passes its product budget.

The final unsigned app is 467 MB. Executable SHA-256:
`51ea98f5b4ff5e5c079a6953a886a10999e5b355a76bcd92ff5dd59cb7167bd9`;
`app.asar` SHA-256:
`ccc7a4329ca596ac19864266fbd0584e0b3aa67a6a0d3610e1443b0ec4e58703`.

-- Exo | 2026-07-20
