# Exograph code-quality rubric

Use this rubric per logical cluster. Report only findings whose mechanism you
have traced far enough to defend.

## 1. Correctness and invariants

- Does behavior match the public, persisted, and product contracts?
- Are validation, error, cancellation, retry, and cleanup paths complete?
- Can partial failure leave durable or user-visible state half-applied?
- Do fallbacks preserve an intentional contract, or conceal a broken invariant?

## 2. Structural simplicity

- Can a reframing delete branches, modes, helpers, wrappers, or layers?
- Is complexity reduced, or merely redistributed into more files?
- Are special cases accumulating in a shared flow?
- Is direct, boring code clearer than the current generic mechanism?

## 3. Modules, interfaces, and seams

- Does each module hide substantial behavior behind a small interface?
- What must a caller know beyond the type signature?
- Does a seam have real adapters, or only hypothetical flexibility?
- Would deleting a wrapper spread useful complexity across callers, or simply
  remove indirection?
- Does ownership produce locality, or require synchronized edits across layers?

## 4. Types and data

- Are finite contracts closed and decoded at runtime?
- Do optionality, casts, aliases, or structural lookalikes blur an invariant?
- Is there one canonical model, or multiple almost-equivalent shapes?
- Are migrations bounded and scheduled for deletion?

## 5. Lifecycle and concurrency

- Who creates, owns, invalidates, cancels, and disposes each resource?
- Are independent operations serialized without reason?
- Can late async results overwrite newer state?
- Are watchers, workers, processes, timers, and animation frames quiescent when
  idle and guaranteed to stop?

## 6. Performance

- Is derived work off typing, Note-open, and gesture-critical paths?
- Does work scale with the changed unit or the whole Workspace?
- Are caches snapshot-qualified, bounded, invalidated, and worth their burden?
- Are performance claims tied to a fixture, hardware, metric, and gate?

## 7. Trust and containment

- Can any path, symlink, environment variable, IPC payload, command, or preview
  widen authority?
- Are executable identity and user authorization checked at the owning seam?
- Can renderer or agent-controlled data reach a privileged operation without
  validation?

## 8. Tests and verification

- Do tests exercise the owning interface and observable behavior?
- Would tests survive an internal refactor?
- Is a fake masking the production adapter or lifecycle?
- Are redundant implementation-detail tests creating refactor tax?
- Does the smallest focused test distinguish the proposed fix from the current
  behavior?

## 9. Navigation and documentation

- Can a contributor find the owner through progressive disclosure?
- Do names match product vocabulary and actual behavior?
- Are comments explaining non-obvious constraints rather than narrating code?
- Are docs, help, schemas, and tests synchronized with public behavior?

## 10. Deletion and repository truth

- Is code reachable and still part of a supported path?
- Are compatibility paths attached to an explicit deletion gate?
- Are generated output, scratchpads, reviews, local state, and private evidence
  excluded from the public repository?
- Does every file earn its ongoing maintenance cost?

## Finding format

Record:

1. priority and confidence;
2. file and tight line range;
3. mechanism;
4. user or maintainer consequence;
5. traced relationships;
6. verification evidence;
7. structural remedy; and
8. concepts, branches, or files the remedy deletes.

Prefer no finding over an unverified suspicion.
