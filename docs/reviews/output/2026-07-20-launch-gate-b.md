# Launch Gate B — Markdown critical path

## Outcome

Gate B passes on source commit `1bf105dbf387777bc46c330c61a444efe2a5c18d`.
The Markdown critical path remains responsive while graph and QMD work overlap,
automatic embedding converges with the real local model, and the packaged app
can read and deliberately edit a guarded copy of the real vault without
changing any non-control file.

The package was built from the same commit used for the final gates. Private
note names, paths, bodies, and hashes are not included in this repository.

## Canonical path

- Folder Overview opens unloaded children and explicit Folder Indexes through
  the same file-open transaction as Explorer, Search, backlinks, breadcrumbs,
  and the CLI.
- Reopening an already-open background tab through the external command path
  activates the correct document.
- ViewBox-only SVG attachments resolve and retain a nonzero rendered width.
- A tab switch commits the matching CodeMirror document before paint, so input
  cannot land in the previously active Note.

## Editor latency

The gate records input-to-frame-ready after a forced layout. This is a useful
user-visible readiness boundary; it is not described as literal compositor
paint timing.

Final source run:

- Explorer navigation: 40.0 / 40.8 / 41.2 ms p50/p90/p99
- CLI total navigation: 84.2 / 87.1 / 97.3 ms p50/p90/p99; measured Node 26
  process-start floor: 28.6 / 30.4 / 31.6 ms
- filename Search: 45.7 / 47.3 / 48.1 ms p50/p90/p99
- breadcrumb Folder contents: 29.8 / 30.6 / 31.3 ms p50/p90/p99
- backlink navigation: 39.5 / 40.0 / 53.0 ms p50/p90/p99
- 2,000 trusted typing samples: 9.7 / 14.9 / 17.4 ms p50/p90/p99,
  30.6 ms max, zero long tasks
- 208 trusted rapid-Backspace samples: 7.6 / 11.0 / 12.7 ms p50/p90/p99,
  13.9 ms max, zero long tasks
- 420 active-invocation samples: 8.9 / 14.8 / 17.8 ms p50/p90/p99,
  22.8 ms max, zero long tasks
- 400 table/fenced-code edits: 1.7 / 2.0 / 3.2 ms p50/p90/p99

The editor probe asserts the exact expected sample counts, the CodeMirror body,
the saved disk body, renderer liveness after every transaction, and the absence
of long tasks. Synthetic direct dispatch is retained only as a separate
synchronous transaction diagnostic, never presented as human typing.

## Derived-work isolation and convergence

QMD foreground queries, QMD maintenance, and WorkspaceGraph use three distinct
restartable utility clients. The 1,200-Note concurrent source gate overlapped
QMD refresh, cold graph construction, ten Search requests, cached status,
Terminal IO, 400 keystrokes, and 20 alternating Note navigations:

- typing: 6.9 / 12.1 / 14.2 ms p50/p90/p99
- navigation: 40.1 / 42.9 / 47.0 ms p50/p90/p99
- Search: 99.2 ms cold; 9.0 / 9.7 / 9.7 ms warmed p50/p90/p99
- graph context: 223.3 ms, independently available
- Terminal write: 1.3 ms
- renderer long tasks: 0

The exact packaged app also passed all ten latency journeys:

- derived typing: 6.8 / 12.1 / 14.1 ms p50/p90/p99; navigation:
  40.1 / 41.2 / 45.6 ms; zero long tasks
- trusted typing: 9.7 / 14.7 / 18.3 ms p50/p90/p99; rapid Backspace:
  7.7 / 10.9 / 12.7 ms; active invocation: 9.1 / 15.1 / 17.5 ms;
  zero long tasks
- packaged CLI total: 83.1 / 84.4 / 86.4 ms p50/p90/p99
- packaged Search: 35.6 / 47.3 / 48.3 ms; breadcrumbs:
  29.8 / 30.1 / 31.4 ms; backlinks: 39.5 / 40.2 / 49.8 ms

Source and the final packaged real-model journeys both established vector baselines,
observed a changed Note become pending, kept graph/Terminal/Search/status usable
during maintenance, and converged to zero pending embeddings. The packaged app
loaded `sqlite-vec` from its unpacked native path. Automatic retry exhaustion
is truthful for unchanged work and re-arms only for a genuinely newer save.

The full derived-work measurements and commands are recorded in
`docs/reviews/output/2026-07-19-derived-work-convergence.md`.

## Guarded real-vault package proof

The private dogfood used a temporary copy containing 1,553 source Markdown
files plus two controlled Gate B Notes. The script hashed every non-control
file before and after, then exercised the unsigned packaged app:

- all five Settings sections opened without persisting a read-side mutation;
- configured Commands, canvas layout, and opaque settings survived;
- direct command open: 5.7 ms;
- filename Search to open: 95.0 ms;
- a contained SVG loaded and rendered at nonzero width;
- Properties reflected the controlled frontmatter;
- an intentional controlled edit reached disk and survived app restart;
- every non-control file remained byte-for-byte unchanged.

The source vault was never opened or modified by this gate. Only aggregate
counts and timings are retained here.

## Final release gates

- `pnpm ci:check`: 21 script tests, 125 core tests, 260 desktop tests, and 27
  CLI tests passed; typechecks, builds, repository checks, and install dry-run
  passed.
- `pnpm stable:smoke`: 9/9 bounded scenarios passed.
- `pnpm test:e2e`: 96 passed; the three skipped journeys require explicit live
  Claude, real-model, or packaged-app opt-ins and passed separately where Gate B
  requires them.
- `pnpm pack:mac`: unsigned arm64 app built successfully.
- Packaged onboarding, Settings preservation, image, command-open, editor
  latency, derived-work latency, and real-model convergence journeys passed.
- Package size: 490 MB; executable SHA-256:
  `51ea98f5b4ff5e5c079a6953a886a10999e5b355a76bcd92ff5dd59cb7167bd9`;
  `app.asar` SHA-256:
  `476aa6da1280553e169c9d6f350b2de2502b9e385a6c09b76e1726fe9b0535ba`.

## Open, non-blocking investigations

- `EXO-ISSUE-111` remains the explicit Node-runtime CLI startup-floor
  investigation. The final total CLI p99 passed without weakening the in-app
  budget.
- `EXO-ISSUE-116` remains an evidence-first investigation of the historical,
  non-reproducible blank renderer. The expanded ordinary-input, Backspace, and
  invocation probes stayed mounted, visible, editable, and free of long tasks.

-- Exo | 2026-07-20
