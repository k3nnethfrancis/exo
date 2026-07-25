# Exo documentation

This directory contains current product and architecture contracts. Historical
planning, reviews, agent coordination, and launch evidence stay out of the
source repository.

Maintainers may use an ignored `docs/internal/` directory for active plans,
ledgers, roadmaps, and scratch notes. Its contents are local-only and never
define the public product contract.

## Start here

1. [../README.md](../README.md) — product overview, setup, and CLI.
2. [../CONTRIBUTING.md](../CONTRIBUTING.md) — local development and validation.
3. [architecture.md](architecture.md) — package boundaries and runtime ownership.
4. [../CONTEXT.md](../CONTEXT.md) — product glossary.

## Product contracts

- [document-agent-protocol.md](document-agent-protocol.md) — durable invocation and response envelopes.
- [note-root-formats.md](note-root-formats.md) — Generic Markdown and OKF compatibility.
- [workspace-ontology.md](workspace-ontology.md) — reviewed, user-owned `ontology.yaml`.
- [provider-mcp-onboarding.md](provider-mcp-onboarding.md) — bounded MCP and CLI access.
- [terminal-runtime-decision.md](terminal-runtime-decision.md) — direct-PTY runtime contract.

## Maintainer references

- [durable-state.md](durable-state.md) — persisted state ownership and recovery.
- [performance-contracts.md](performance-contracts.md) — measurable interaction budgets.
- [adr/](adr/) — current architecture decisions.
- [../skills/README.md](../skills/README.md) — reusable contributor and coding-agent Skills.
