# Exo Document-Agent Protocol

**Status:** V1 envelope grammar shipped; exact Changeset review is the active
launch gate.

Exo keeps Markdown as the canonical user document. It adds two inert, XML-like
envelopes so a human request and an agent's durable result can be identified
without turning the note into a proprietary chat object.

```md
<exo-invocation id="4f86cda4-0b11-4d83-873c-166ba38ab378" agent="claude" status="sent">
@claude Compare these alternatives and recommend one.
</exo-invocation>

<exo-agent-response invocation="4f86cda4-0b11-4d83-873c-166ba38ab378" agent="claude">
## Recommendation

Choose the first approach because it preserves ordinary Markdown portability.
</exo-agent-response>
```

## Grammar and rendering

- New invocation envelopes require a UUID `id`, a normalized configured-command
  `agent` handle, and `status="sent"`.
- A response names its parent invocation through `invocation` and repeats the
  responding `agent` handle.
- The live editor hides only the envelope lines and renders their contents as
  page-native tinted prose. Raw Markdown exposes the exact source.
- Pre-protocol invocation envelopes without an `id` retain live rendering but
  cannot be launched again as a new V1 protocol invocation.
- Malformed or unpaired markup is ordinary visible Markdown, never executable
  protocol state.

## Ownership and safety

The protocol is data, not authority.

- A human can authorize a run only through Exo's explicit invocation action;
  parsing an invocation tag never launches a command.
- Exo owns command trust, executable identity, lifecycle state, local invocation
  records, provider session provenance, and changed-file review.
- The configured agent may write one linked response envelope and ordinary
  Markdown/file edits. It cannot grant itself trust, claim a diff was accepted,
  or change invocation lifecycle state through a tag.
- Exo's filesystem observer and stored before/after snapshots remain the
  authority for reviewable changes. A response block is useful durable prose,
  not evidence that an edit happened.

## Agent instruction contract

For a V1 inline run, Exo sends the saved document snapshot and the exact
invocation UUID. The configured command is instructed to preserve the request
envelope, do the requested durable workspace work, and append exactly one
linked response envelope directly after the request. For direct-edit work the
response can be a short receipt; for analysis, research, and planning it holds
the durable result. Terminal stdout remains only a concise session summary.

## App lifecycle

The document shows one invocation surface at a time. First-run authorization is
a compact confirmation anchored beside the invocation and closes as soon as the
user chooses Run or Cancel. It is not a progress surface.

| State | Surface | Exit |
| --- | --- | --- |
| Checking | Same-frame cursor-adjacent acknowledgement while Exo verifies executable identity and trust | Run, authorize, or restore the draft |
| Running | Cursor glyph plus one bounded bottom-left activity state | Stop the full process tree |
| Review | Inline diff, anchored Keep/Reject, file position, and optional batch actions | Resolve every file or explicitly keep a drifted current file |
| Completed | Brief result that gets out of the way | Dismiss or resume session |
| Failed | Compact actionable failure; details only on request | Dismiss or resume session |

One invocation owns one exact Changeset across all authorized Note Roots.
Created, modified, deleted, and proven-renamed files are reviewed in a
deterministic queue. Review decisions and content-addressed snapshots survive a
restart. Reject is hash-guarded and never overwrites a path that drifted after
settlement; that file remains an explicit conflict until the user keeps the
current bytes.

Provider resume is an explicit handoff. Exo exposes a single outward-arrow
action, opens the configured resume command in Terminal, and otherwise keeps
the command and session identifier out of the ordinary surface. Invocation
history and document envelopes remain durable; the transient activity surface
does not.

For an inline note invocation, exiting successfully without a linked response
or any reviewable edit is a protocol failure rather than a silent success. A
non-note configured Command may complete with no filesystem change and needs no
review controls.

## Deliberate limits

- No automatic execution from document text.
- No generic tag language, nested workflow engine, or provider-specific markup.
- No claim that a response block is accepted or trustworthy without the normal
  diff-review path.
- No migration of users' legacy Markdown; raw source stays portable in every
  Markdown editor.

-- Exo | 2026-07-13
