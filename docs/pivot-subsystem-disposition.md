# Pivot Subsystem Disposition

Last updated: 2026-07-09

status: planning. This document names what the note-native invocation pivot keeps, defers, demotes, or cuts. The 2026-07-09 terminal/harness reset amends the original tmux/transcript dispositions below.

## Disposition Terms

- **Keep:** still central to V1.
- **Promote:** more important after the pivot.
- **Defer:** stop expanding until the replacement architecture explicitly reopens the surface.
- **Demote:** no longer a product spine; keep only the slice needed by V1.
- **Cut later:** likely removable after migration and QA.

## Matrix

| Subsystem | Disposition | Reason | Immediate Action |
| --- | --- | --- | --- |
| Markdown editor/explorer | Keep | Primary work surface. | Prioritize refresh correctness and mention affordance. |
| Direct-pty xterm terminals | Keep | Invocations and shells run as normal commands; Exo should pass terminal bytes through instead of translating them through tmux. | Replace tmux control-mode runtime with direct pty and keep xterm as the live surface. |
| Exo-owned tmux sessions | Cut | Durability is no longer a V1 Exo responsibility; users can run tmux inside a terminal and agents can resume through their own session stores. | Delete tmux control-mode bridge, restore snapshots, session registry, geometry convergence, and recovery services. |
| Terminal transcripts | Cut from core V1 | Invocation records, file diffs, agent resume ids, and future hooks/traces are the provenance path. | Remove transcript persistence from terminal runtime; keep only bounded live tails where a current UI/CLI read needs them. |
| Agent harness adapters | Cut; legacy CLI island remains | Deep lifecycle/readiness management is no longer the product. App product UI/detection/capability rows are removed; old CLI/runtime launch-plan code still exists until `exo launch` is replaced or deleted. | Do not extend registry/readiness/detection. Seed common launch templates as user-owned `AgentCommand` config instead, then delete the legacy CLI/runtime island. |
| Agent Config | Promote and reframe | Context files and commands become core setup. | Reframe as Instruction Files + Agent Commands. |
| Harness skill management | Demote | Pulls Exo back into provider internals. | Do not expand skill install/inventory UI. |
| Exo skills / ontology rules | Future design | Could become graph policy, but not V1. | Use separate planning; do not overload harness skills. |
| Profiles | Defer | Current profile/apply path is too platform-heavy. | Keep inspection/state only where current callers require it; stop profile apply expansion. |
| Plugin Manager | Defer | Plugin architecture is no longer near-term spine. | Keep read-only/diagnostic value only where current callers require it; do not expand. |
| Routines | Cut as product, keep activity slice | Invocation record replaces first routine need. | Stop routine CLI/UI/docs expansion; keep only reusable activity concepts. |
| Activity substrate | Demote | Needed only as invocation/activity record. | Define invocation records before generic run records. |
| Proposal/review | Defer substrate | V1 uses direct write + diff review. | Reuse read-only diff rendering if clean; keep staging for future high-risk writes. |
| Semantic traces | Defer | V1 provenance is time-correlated. | Preserve sidecar path; no new work. |
| MCP search/read/status | Cut from active product | CLI is the durable local integration surface. | Remove from active roadmap; keep code only until callers are audited. |
| MCP agent lifecycle | Cut | Agent cockpit story is being removed. | Delete after caller and public-contract review. |
| CLI | Keep/promote | CLI remains the core exocortex and operator surface. | Make CLI reliable and complete enough to replace MCP for local automation. |
| Command server | Keep, restrict routes | Runtime plumbing. | No new V1 route without review. |
| Search/QMD/custom providers | Promote | Pointer prompt and LM wiki use both depend on context discovery. | Treat degraded search as high-priority product friction; preserve provider-neutral seams. |
| Project review/changed files | Promote | Becomes direct-write review substrate. | Reuse changed-file and diff surfaces. |
| Feed/event stream | Demote | Diff banner is the V1 feed. | Do not build generic feed first. |
| Onboarding | Reframe | Start with workspace + first agent command. | De-emphasize plugin/routine review. |
| Graph/exograph | Keep/promote | Exo remains an exocortex and LM wiki substrate. | Keep graph/ontology in roadmap; defer enforcement until invocation works. |
| Backlinks/properties/graph viewer | Build/promote | Exograph framing makes graph read surfaces table stakes. | Add link extraction, backlink index, properties surface, and basic graph view to active plan. |
| User-defined LM wiki ontology | Keep as planned core | Users must be able to define their own graph semantics. | Plan profiles/ontology as mappings and policies, not Shoshin/OKF hardcoding. |

## Hidden Dependencies To Audit

Before deleting code, audit:

- harness id usage in terminal launch descriptors, CLI, persisted sessions, renderer state, and invocation records;
- tmux session/restore/transcript dependencies in command-server, CLI reads, renderer hydration, tests, docs, and packaged-app setup;
- routine/run model usage in CLI, plugin manifests, docs, and proposal/review code;
- profile apply hooks in onboarding, settings, plugin manager, and proposal recovery;
- skill inventory assumptions in Agent Config and profile preview;
- public-contract tests that hash CLI/MCP/command-server surfaces;
- MCP configuration/install docs and app integration helpers;
- documentation and instructions that still tell agents to build the plugin/routine roadmap.

## User-Visible Surfaces To Reframe

- **Agent Config:** "Instruction Files and Agent Commands", not harness skill manager.
- **Plugin Manager:** diagnostics/advanced capabilities, not the main setup path.
- **Profile Settings:** context/ontology templates later, not plugin/skill/routine installer.
- **Routine CLI/UI:** superseded experimental surface until invocation records prove the activity model.
- **Projects drawer changed files:** potential home for invocation-attributed diffs.

## Deletion Preconditions

Do not delete a subsystem until:

1. its post-pivot disposition is accepted;
2. current callers are identified;
3. user-visible replacement or removal copy is specified;
4. focused tests cover the removal;
5. roadmap/tasks no longer point agents back at the old subsystem.

Deletion posture for this branch is intentionally heavy-handed. Prefer deleting stale MCP, routine, harness-manager, tmux-persistence, transcript, profile-apply, and plugin-manager product paths once callers are understood. This branch is a fork; code can be recovered from git if a later slice proves a deleted path was valuable.

-- Exo | 2026-07-08
