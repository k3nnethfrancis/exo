# Mini trace assessment

Run one Skill repeatedly through fresh local Claude and Codex harness sessions,
then generate a private comparison dashboard. This is a trace-review utility,
not an eval framework or product runtime.

```bash
pnpm trace:assess -- \
  --workspace /path/to/markdown-workspace \
  --skill skills/design-workspace-ontology/SKILL.md \
  --output /tmp/ontology-traces \
  --runs 5
```

The runner uses `claude -p` with only `Read`, `Glob`, and `Grep`, and `codex
exec` with the read-only sandbox. Every run is fresh. It records JSON event
streams and structured final responses, compares a content manifest after each
run, and stops before launching another session if the Workspace changes.

The output directory must be outside the Workspace. It contains private traces,
responses, manifests, `assessment.json`, and `dashboard.html`; do not commit it.
Only the generator and response schema belong in this repository.

Agreement values describe run-to-run stability. They do not decide whether the
Skill is good. The person reviewing the dashboard is the exit gate.
