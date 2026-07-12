# Fable review: editor-only canvas migration and Command readiness

Date: 2026-07-11

## Decision

Ship the editor-only canvas migration after real packaged-app QA. Do not integrate the current Command readiness card as written.

## Approved migration model

- The editor canvas owns only editor leaves.
- Persisted layout version 2 reduces current and legacy layouts to sanitized editor leaves; terminal/browser placement is intentionally discarded.
- Preview rail selection is non-creating. An empty Preview destination stays Preview when its final tab closes.
- Non-note-root breadcrumbs render a single file segment without a fabricated, unauthorized folder path.

## Required gates

1. Complete real packaged-app visual QA once the Mac is unlocked: legacy-layout restore, empty Preview/final-tab close, Note Root and attached-folder breadcrumbs, and a dock terminal smoke pass.
2. Keep `EXO-ISSUE-105` as the explicit record of the user-approved breadcrumb create/open exception; revisit it after real-vault dogfooding if it feels surprising.
3. Resolve the separate protected CLI/command-server contract-review failures before claiming the branch mergeable.

## Command readiness reframe

Do not use a separate “Make Exo ready” wizard or local renderer launchability rules.

1. Extract one pure launchability/cwd derivation from `InvocationRunner` into core and make `prepare()` consume it.
2. Add one read-only desktop query for facts that only main can inspect, such as executable resolution.
3. Render a compact Command affordance inside Terminal: choose a saved Command, show factual launchability, and offer Test.
4. Test delegates to the existing explicit-confirmation `InvocationRunner` path and a visible terminal, creating an ordinary invocation record.

Defer readiness persistence, polling, repair automation, a new rail/destination, and hidden test sessions.

Source: headless `claude -p --model fable` review of commit `2578f93` and the preserved untracked Command readiness draft.
