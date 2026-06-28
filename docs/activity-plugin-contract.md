# Activity Plugin Contract

Last updated: 2026-06-27

This document defines the minimum core substrate that plugin workloads can rely on. It is intentionally smaller than a workflow, eval, trace, or export product.

## Core Contract

Core activity records answer:

- what activity ran: `id`, optional `activityType`, status, and timestamps
- who launched or owns it: actor, selected harness, routine/template reference, and scope reference
- what policy constrained it: routine permissions and output policy before execution
- where outputs are: artifact refs, transcript ref, log ref, provenance refs, and optional review ref
- what the operator must decide: review state plus accepted/rejected/corrected references when Exo mediates review
- what failed: small structured errors

Core stores references, not domain meaning. Artifact refs may point at Markdown reports, JSONL traces, datasets, evaluation outputs, diffs, transcripts, local HTML dashboards, or export bundles, but core does not interpret those schemas.

## Plugin-Owned Workloads

Plugins own workload semantics, including:

- routine prompts, schedules, domain labels, and workflow-specific state
- trace packet schema beyond the generic JSONL helper
- eval metrics, rubrics, judge outputs, and scoring results
- dataset/export formats
- dashboard-specific data models
- proposed file-change detail, diff packaging, and review labels beyond core accept/reject/corrected state
- OKF, Shoshin, LM Wiki, Guardian Angel, or project-specific schemas

Plugins should write those details as artifacts under `.exo/artifacts/{activityId}/` or plugin state under `.exo/`, then link them from the activity record with artifact/provenance refs.

## Minimal Run Compatibility

`RunRecord` remains a compatibility projection for the current Routine CLI/store MVP. It should stay thin:

- routine id
- harness id
- status and review state
- timestamps
- transcript/log path compatibility fields
- artifact references
- proposed file-change path hints
- errors

Do not add rich trace, eval, export, dashboard, or domain-specific fields to `RunRecord`. Add an artifact reference and let the plugin own the file schema.

## External Workload Requirements

Reference workloads such as elicitation, trace collection, evaluation runs, training export, graph health, or Exo-on-Exo maintenance must be expressible as:

1. a plugin-declared routine template or plugin-owned command
2. a concrete activity/run with explicit scope, permissions, harness, and output policy
3. artifact refs for reports, trace JSONL, datasets, eval outputs, dashboards, and exports
4. provenance refs for source files, terminal transcripts, harness sessions, external URLs, or upstream artifacts
5. optional review state when user acceptance matters

If a workload cannot fit this model, first add a small missing reference or policy primitive. Do not add the workload's schema to core by default.

## Storage Guidance

Canonical first-pass paths:

- `.exo/routines/{routineId}.json`
- `.exo/runs/{runId}/run.json`
- `.exo/runs/{runId}/transcript.ansi.log`
- `.exo/runs/{runId}/run.log`
- `.exo/artifacts/{runId}/{artifactFileName}`

Trace JSONL is a plugin-owned artifact. Core may provide append/read helpers for convenience, but the run record should reference the trace artifact rather than embedding packets.

-- Exo | 2026-06-27
