# Private-vault Graph gate

This opt-in Gate D journey verifies the real Graph Pane against a disposable
copy of a configured private Markdown root. It never launches Exo against the
configured source.

```bash
EXO_PRIVATE_GRAPH_GATE=copy-only \
EXO_PRIVATE_GRAPH_VAULT_ROOT=/absolute/private/root \
pnpm graph:private-vault:gate
```

The default command builds source Electron, runs the journey, builds the exact
unsigned macOS package from the same checkout, and repeats the journey against
that package. `pnpm graph:private-vault:source` is the focused source-only loop;
it is not packaged-app evidence.

The guardrails are mechanical:

- an explicit confirmation token and absolute source are required;
- the copy target must be a fresh OS-temporary directory outside the source;
- `.git`, `.exo`, `node_modules`, symlinks, and special files do not enter the
  copy, so no copied path can point back into private source data;
- a pre/post content fingerprint fails the gate if the configured source
  changes;
- settings, runtime, home, Playwright output, and the copied Workspace are
  isolated beneath OS-temporary directories and removed after the run;
- traces, screenshots, and video are disabled; and
- output contains only aggregate counts, renderer kinds, timings, repetition
  counts, and a redacted pass/fail phase. Note names, relative paths, bodies,
  topology identities, and source checksums never enter the report.

The journey opens the Graph Pane, pans, zooms, selects a pickable connected
pair, explains a route, opens the selected Note, checks Connections/Graph/Note
identity, repeatedly closes and reopens the Pane, and observes one synthetic
Note mutation made only in the copy. On a WebGPU-enabled tree it exercises the
WebGPU path first and then the product's forced Canvas recovery hook. Until that
runtime is present, the same harness truthfully reports Canvas-only coverage.

This file defines the harness. A source or packaged acceptance claim still
requires a successful aggregate from the exact checkout under review.

-- Exo | 2026-07-20
