# Exograph Note-Native Agent Invocation Pivot

Last updated: 2026-07-08

status: planning. This document captures the Fable-backed framing for a possible Exo pivot before implementation. It is not yet an accepted roadmap or deletion plan.

## Companion Planning Docs

- `docs/pivot-product-definition.md` defines the post-pivot product in plain terms.
- `docs/pivot-subsystem-disposition.md` names what is kept, deferred, demoted, or cut later.
- `docs/agent-identity-reconciliation.md` reconciles `AgentCommand` with existing harness identity.
- `docs/invocation-context-and-safety.md` covers cwd, context scope, confirmation copy, and prompt-injection risks.
- `docs/invocation-concurrency-and-attribution.md` covers likely/ambiguous attribution, concurrent edits, refresh, restart, and restore.
- `docs/agent-output-conventions.md` defines the pointer prompt and command-template conventions.

## Current Product Decision

V1 should use **direct write + diff review**.

When a tagged agent finishes, it may edit the note or related files directly. Exo should refresh the document from disk and show a toggleable diff/attribution view so the user can see what appeared or changed.

This means V1 does not require proposal staging before an agent can write. The review experience is after-the-fact: detect the changed files, associate them with the invocation/harness/program where possible, and make those edits visible and reversible through normal file/git/diff workflows.

## Thesis

Exograph product frame:

> Build your local exocortex from Markdown.

Exo should stop trying to become an agent cockpit or universal harness manager. It should remain an exocortex: a local Markdown-first exograph, CLI, graph/search substrate, customizable search/indexing system, terminal/split-pane/web-viewer workspace, and LM wiki workbench. The refactor should be deletion-first: stale MCP, routine, harness-manager, profile-apply, and plugin-manager surfaces should be removed aggressively once callers are audited. This branch can recover deleted code from git if the new product proves it needs a piece back. The simpler agent product center is:

> Exo is a local exocortex where documents can invoke configured agents.

In this model, the document is the session boundary. A user writes an agent mention in a note, confirms the invocation, and Exo runs the configured command with a small notification prompt:

```text
You have been tagged in the following document:
<path>

Message:
<mention text>

Open the document to see its full contents.
```

The user owns the command. Exo may provide templates for common harnesses such as Claude Code, Codex, or local agents, but the durable Exo interface is "run this configured command with this document pointer and request," not a deep harness integration.

## Architectural Ruling From Fable

Fable's initial ruling: the pivot is coherent if Exo accepts that the document, not the terminal session, becomes the primary unit of agent work.

The coherent core is:

- Markdown-first exocortex and exograph workspace.
- CLI and provider-neutral search.
- User-defined graph/LM wiki ontology as a planned core direction.
- Plain terminal runtime.
- Agent context composition through `AGENTS.md`, `CLAUDE.md`, overlays, and scoped context templates.
- User-owned agent command configuration.
- Thin invocation records tied to documents, commands, transcripts, and changed files.

The danger is the return path. Sending the notification is easy. Deciding where the agent's answer lands, how it is reviewed, and how provenance is tracked determines which existing Exo subsystems survive.

## Known Knowns

- Plain terminals remain core. The terminal runtime is still useful even if Exo stops managing promptable harness lifecycle deeply.
- CLI search/read survive the pivot because agents need a way to open and inspect the document/exograph context named in the notification.
- Context management rises in importance. Local/global instruction files and overlays become the main way Exo teaches arbitrary commands how to work with the exograph.
- The invocation primitive should be small and stable: mention, confirmation, configured command, cwd, prompt, transcript/ref, status.
- The current harness/plugin/routine architecture should stop expanding before more work lands, then be deleted or redesigned after caller audit.

## Known Unknowns

### 1. Return Path

Possible return paths considered:

- **Direct write + diff review:** the agent edits notes/files directly; Exo observes file changes and shows diffs after the fact.
- **Convention-based reply:** the agent writes to an inline block, sidecar reply file, feed item, or artifact path that Exo can render.
- **Proposal staging:** the agent writes a proposal batch; the user accepts or rejects changes before canonical Markdown changes.

Decision: start with direct write + diff review. Proposal staging remains useful later for high-risk writes, ontology-enforced changes, or multi-file transformations, but it is not the V1 return path.

### 2. Mention Detection

Exo must decide whether mentions are:

- an editor feature inside Exo only, or
- a vault-watcher feature that can notice invocations written by any editor.

The watcher model better fits local-first Markdown and external editor use, but it needs stricter syntax to avoid false positives.

### 3. Context Scope

The invocation prompt is thin, but the read surface is not. A tagged agent may be able to read private notes, project roots, and global context depending on cwd and available tools.

Open questions:

- Does Exo enforce private zones mechanically, or only warn?
- Does cwd default to workspace root, note root, project root, or note directory?
- Can an invocation choose allowed note/project roots?
- How does global Exo context avoid contaminating narrow subagents?

### 4. Skills Identity

The word "skill" currently points at several different things:

- harness-specific skills, such as Claude or Codex skills;
- governed prompts;
- ontology rules;
- graph-maintenance behaviors;
- validation policies for proposals or note structure.

The clean split may be:

- Exo stores or links governed prompts, ontology rules, and graph-maintenance policies.
- Harness-specific skills are referenced as opaque external capabilities unless a user explicitly links a skill root.
- Machine-wide skill discovery is opt-in or plugin-owned, not automatic.

### 5. Ontology Enforcement

If Exo manages an LM wiki/exograph, users need a way to define graph ontology without hardcoding Shoshin, OKF, or Guardian assumptions into OSS core.

Possible levels:

- **Prompt-only:** ontology lives in context templates and skills; agents voluntarily follow it.
- **Schema-visible:** Exo reads ontology/profile files and uses them for search, UI hints, and maintenance prompts.
- **Enforced:** Exo validates proposals against ontology rules before apply.

Enforcement is a real product subsystem and should not be smuggled in as "skills."

### 6. Minimal Provenance

Without deep harness traces, the minimum viable provenance is:

- invocation id;
- actor and agent command id;
- source document path;
- mention text or selected range;
- cwd and command template version;
- timestamps and exit status;
- terminal transcript/log ref;
- changed files during the run window;
- optional diff/proposal/artifact refs.

This may be enough for a first version, but it is time-correlated provenance, not proof that a specific agent wrote a specific line.

## Decision Tree

1. **Are direct vault writes allowed, or must agent output be staged?**
   Answered for V1: direct writes are allowed, with after-the-fact diff review and attribution. Proposal/review is demoted from the default mention return path.

2. **Is mention detection editor-owned or watcher-owned?**
   This decides whether invocation is native only to Exo's editor or can work from any Markdown editor.

3. **Is context scope enforced or advisory?**
   This decides whether privacy zones and root scoping are first-class product controls or warning copy.

4. **Is the invocation prompt pointer-only or a richer prompt contract?**
   Convention-based replies, scoped context warnings, and skill fragments all require a richer prompt contract.

5. **What is the minimal invocation/activity record?**
   This decides which slice of the activity/routine substrate survives and what can be deleted.

## Do Not Delete Yet

Do not delete these until the decision tree is resolved:

- proposal/review substrate and golden fixtures;
- terminal transcript retention;
- CLI search/read/workspace-status surfaces;
- command-server routes consumed by CLI;
- context composer and overlay machinery;
- semantic trace ingestion sidecar path;
- harness adapter code that is still shared by terminal launch paths.

Defer rather than extend:

- deep promptable harness lifecycle management;
- harness readiness/send queue features beyond current maintenance;
- first-class Routine UI/product work;
- Plugin Manager expansion aimed at harness/routine setup rather than context, search, profile, or future plugin capabilities.

## Answered User Question

Fable's recommended first question:

> When an agent you tagged finishes, does it get to edit your notes directly, with you reviewing a diff after the fact, or does everything it writes land somewhere you approve first?

Answer: start with direct edits to the file, refresh the document, and provide a toggleable diff that shows what changed and which harness/program invocation likely authored it.

## Authorship Model For V1

V1 authorship should be invocation-scoped, not line-perfect.

Exo should record:

- invocation id;
- mention/document path;
- configured agent command id;
- harness/program label;
- cwd;
- process start/end timestamps;
- transcript/log ref;
- file snapshots or hashes before invocation;
- observed file changes during and shortly after the invocation;
- diff refs for changed files.

The UI can then label changed files and diff hunks as likely produced by a specific invocation, for example "edited by @claude via Claude Code command at 10:42." This is reliable enough for direct-write review when one invocation is active, but ambiguous if the user or another agent edits the same file concurrently.

Line-perfect or block-perfect authorship requires a stricter write path, agent cooperation, or proposal staging. That is not required for V1.

## Minimal V1 Data Shapes

The first implementation should define a small core model, likely in `packages/core/src/agent-invocation.ts`.

```ts
interface AgentCommand {
  id: string;
  label: string;
  handle: string;
  command: string;
  cwdPolicy: "workspace_root" | "note_dir" | "fixed";
  fixedCwd?: string;
  version: number;
}

interface InvocationRecord {
  id: string;
  commandId: string;
  commandVersion: number;
  documentPath: string;
  mentionText: string;
  cwd: string;
  status: "running" | "exited" | "failed" | "orphaned";
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  terminalSessionId?: string;
  transcriptRef?: string;
  preSnapshot: FileSnapshot[];
  observedChanges: ObservedChange[];
}

interface FileSnapshot {
  path: string;
  hash: string;
  mtimeMs: number;
}

interface ObservedChange {
  path: string;
  kind: "created" | "modified" | "deleted";
  observedAt: string;
  beforeHash?: string;
  afterHash?: string;
  diffRef?: string;
  attribution: "likely" | "ambiguous";
}
```

Persist invocation records under `.exo/invocations/{id}.json` and store patch files beside them, for example `.exo/invocations/{id}/diffs/{n}.patch`.

Do not write invocation metadata into Markdown frontmatter for V1.

## Tracer Bullet

Fable's recommended first slice:

1. **Config:** support one hand-edited `AgentCommand` in workspace settings. Do not build the settings UI yet.
2. **Mention detection:** start editor-owned only. Detect strict line-start syntax such as `@claude ...` and show a confirm affordance. Watcher-owned detection for external editors is deferred until false-positive evidence is gathered.
3. **Invoke:** on confirm, hash a bounded pre-snapshot, write an `InvocationRecord`, and launch the command in a normal tmux-backed terminal tab with the pointer prompt.
4. **Observe:** subscribe to workspace file-change events during the invocation and a short grace period after process exit. Hash changed files, write patches, and append `ObservedChange` records.
5. **Review:** refresh the open document and show a toggleable diff banner: changed file list, per-file diff, and an attribution label such as "edited by @claude via Claude command at 10:42."

The true tracer bullet is step 3: mention to terminal running with the pointer prompt. Steps 4 and 5 complete the review loop.

## Reused Subsystems

Reuse:

- tmux-backed terminal runtime and terminal manager;
- terminal transcript retention;
- workspace file watcher;
- workspace settings store;
- read-only diff rendering from proposal review if it extracts cleanly.

Do not add new command-server, CLI, or MCP surfaces in V1. MCP is pending deletion/audit rather than new design.

## V1 Red Lines

- No proposal staging or accept/reject flow in the default mention path.
- No line-perfect authorship claims.
- No new command-server, CLI, or MCP contract.
- No watcher-owned mention detection until false-positive counts justify the syntax.
- No context-scope enforcement beyond cwd policy in the first slice.
- No harness readiness probes, send queues, or per-harness lifecycle adapters.
- No invocation dashboard, feed integration, or Routine integration.
- No durable writes outside `.exo/` other than the agent's own file edits.

## Tests And QA For First Slice

Required evidence:

- mention parser unit tests, including false-positive cases from the vault;
- prompt rendering tests;
- snapshot/diff/attribution tests, including ambiguous attribution;
- invocation lifecycle tests for `running` to `exited` and app restart/orphaning;
- desktop integration test with a fake command that appends to a temp note and produces a closed record plus patch;
- manual app QA with one real note invocation and one concurrent-edit ambiguity case.

## Next Evidence

Before implementation, run a prototype with real notes:

1. Pick 10 real invocation examples from the vault.
2. Use the exact pointer prompt and a configured command.
3. Record whether the agent understood the task, found the right context, and produced output in the expected place.
4. Count false-positive mention cases in the vault with a literal search for likely mention syntax.
5. Test one concurrent invocation case to expose file-change/provenance ambiguity.

Only then write the final deletion plan.

-- Exo | 2026-07-08
