# Fable review packet: context-aware invocation, inline review, and session continuity

Date: 2026-07-13
Status: Fable approved with conditions; implementation in progress

## Context

Exo is a local Markdown exocortex. Inline `@command` invocation is explicit,
headless, Workspace-scoped, and observed through before/after snapshots. The
working note contains an inert UUID-addressed `<exo-invocation>` envelope. The
Command is instructed to add one linked `<exo-agent-response>` envelope; Exo
renders that response in the Command's color. Other edits are normal Markdown
and are currently shown only as an uncolored whole-file unified patch in the
invocation status surface.

Current dogfood exposed four connected problems:

1. The Command receives the note snapshot but too little Exo-specific context
   about Workspace scope, wikilinks, Search, and following referenced notes.
2. The protocol does not clearly distinguish a colored response/receipt from
   other observed edits, so users cannot tell why only one region is colored.
3. Review is difficult to read and spatially detached from the document.
4. Every invocation starts a fresh provider session. Exo invocation UUIDs are
   event identities, not Claude/Codex provider session identities.

New completion selections already persist durable link targets with readable
aliases, e.g. `[[garden/blog/example|Example]]`, while live view renders the
alias. Existing bare stem links remain valid legacy Markdown.

## Decisions needed

1. What is the smallest provider-neutral Exo base prompt that makes Commands
   context-aware without recreating a harness or injecting an entire vault?
2. Should V1 define the response envelope as a durable answer/receipt while
   treating all other edits solely as observed diff attribution?
3. Can V1 inline review decorate the editor's current after-state against the
   saved before snapshot with invocation-level Keep/Reject, deferring a true
   proxy filesystem and per-hunk application?
4. How should per-Command provider-session continuity be represented and
   persisted, especially with concurrent invocations, reset, failure, and
   provider-specific resume commands?

## Options

### Base prompt

- **A — compact Workspace contract (recommended):** include Workspace root,
  working note, current snapshot, wikilink semantics, and instructions to use
  native filesystem tools or Exo Search to resolve referenced notes. Act on the
  request: direct edits only when requested/useful; otherwise place the durable
  answer in the response envelope.
- **B — generated AGENTS/CLAUDE context:** inject a larger managed instruction
  block. More complete, but duplicates ambient provider instructions and risks
  stale/private context.
- **C — snapshot only:** retain current behavior. Dogfood shows the Command can
  misunderstand referenced-note requests.

### Review

- **A — inline editor decoration (recommended):** use the already retained
  before/after snapshots to mark additions/deletions in the active CodeMirror
  editor; Keep/Reject remains invocation-wide initially. The canonical file is
  still changed by the Command before review, as today.
- **B — compact colored patch panel:** improve the existing patch rendering but
  keep it detached from the prose. Low risk, weaker spatial comprehension.
- **C — proxy document/filesystem:** execute against a staged copy and write
  canonical Markdown only on acceptance. Strong semantics, but materially
  changes cwd, link resolution, multi-file behavior, command trust, and
  observation; too large for this slice unless required.

### Session continuity

- **A — per-Command policy plus Workspace-local derived session head
  (recommended):** `continue` (default) or `new` lives on the configured
  Command. The latest valid provider session id is derived/persisted under
  `.exo`, never conflated with invocation UUID. Same-Command continued runs are
  serialized or fail visibly; reset clears only the derived head. Provider
  adapters construct resume commands.
- **B — explicit session id in settings:** simple but exposes volatile provider
  state as user configuration and invites stale/cross-Workspace reuse.
- **C — always new:** current behavior; loses intentional conversational
  continuity.

## Orchestrator recommendation

Adopt the compact Workspace prompt contract and explicitly document response
versus edit semantics. Ship inline invocation-level review using the existing
snapshots without introducing a proxy filesystem. Add a provider-neutral
continuity policy to Command configuration, but keep provider session ids in
Workspace-local derived state/provenance. Default to continued context within
one Workspace and Command; reject or queue concurrent continued invocations.
Never reuse a session across Workspaces.

## Proposed work packages

1. **Prompt + link contract:** strengthen `formatNoteInvocationPrompt`; prove
   referenced-note resolution, response-only requests, edit requests, aliased
   wikilinks, and bounded prompt content.
2. **Response/edit semantics:** document and test the response envelope as the
   colored answer/receipt; ensure ordinary edits remain review-only and make the
   distinction visible in UI copy.
3. **Inline review:** replace the raw patch block with editor diff decorations
   sourced from the retained before snapshot; invocation-wide Keep/Reject,
   dirty-buffer/drift protection, and raw Markdown remain intact.
4. **Continuity foundation:** after architecture approval, add normalized
   Command policy, migration/defaults, Workspace-local session head, provider
   resume launch, concurrency/reset/failure handling, Settings/onboarding UI,
   and end-to-end evidence.

## Protected boundaries

Work package 4 changes the shared persisted `AgentCommand` contract and
provider launch behavior. Work package 3 changes the review interaction but not
WorkspaceFiles authorization. A proxy document/filesystem would change the
trust/execution boundary and is not authorized by this packet.

## Please review

- Correct the proposed semantics or vocabulary where needed.
- Identify missing trust, privacy, persistence, concurrency, or recovery risks.
- Rule on the recommended V1 review boundary versus proxy execution.
- Rule on default session continuity and the proper owner of session state.
- Give sequencing and ship criteria for the four packages.

## Fable ruling — 2026-07-13

Full response: `output/2026-07-13-invocation-context-session-fable.md`.

Fable approved all four recommendations with these binding conditions:

1. **Prompt and response semantics ship together.** State Workspace and Note
   Root read/write/observation boundaries; explain aliased durable links and
   legacy bare stems; prefer durable paths when writing; permit native
   filesystem or Exo CLI/Search resolution; bound the snapshot with an explicit
   truncation/read-from-disk marker. Answer-shaped requests use the response
   envelope as the deliverable. Edit-shaped requests use it as the receipt.
2. **Inline review uses existing snapshots.** Diff `before` against the current
   editor buffer rather than rendering the stored whole-file patch. Drift keeps
   decorations and Keep available, disables Reject, and is explained visibly.
   Reject restores the whole invocation snapshot. Raw Markdown remains normal.
   Proxy execution and per-hunk acceptance are not authorized in this slice.
3. **Continuity is Workspace-local derived state.** A configured Command owns a
   `continue`/`new` policy, but the volatile provider session head lives under
   the Workspace `.exo`, never in settings. Continued context must have visible
   provenance. Stale resume falls back to fresh visibly. Concurrent continued
   runs fail visibly rather than queue. Reset clears only the head. Sessions
   never cross Workspaces.
4. **Provider behavior cannot key off the editable handle.** The protected
   Command contract must gain an explicit provider/adapter discriminator with
   migration before continuity launch behavior ships.

Approved sequence: WP1+WP2, WP3, then WP4. WP4 is architecturally approved only
when its contract brief includes the explicit adapter discriminator and the
continuity provenance, fallback, concurrency, migration, reset, and
cross-Workspace tests named above.
