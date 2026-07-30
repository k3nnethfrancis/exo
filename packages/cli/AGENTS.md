# CLI map

`@exograph/cli` is the operator client for Exograph. It discovers a running desktop
command server and speaks its reviewed protocol; it is not a duplicate
workspace implementation.

## Start with the owner

- Command parsing, help, exit behavior, and app-off fallbacks: `src/index.ts`.
  Test `src/index.test.ts`.
- Server discovery, HTTP transport, timeouts, and response decoding:
  `src/app-client.ts`. Test `src/app-client.test.ts`.
- MCP presentation over the same app-client contract: `src/mcp-server.ts`.
  Test `src/mcp-server.test.ts`.
- Result shaping for agent-readable search output: `src/search-response.ts`.
- Installed launcher behavior: `src/launcher.test.ts` and the root install
  scripts; do not bury launcher policy in command parsing.

The shared route and wire types are `../core/src/command-protocol.ts`. Follow
that source before changing a request or response.

## Non-ownership and invariants

- The CLI may use filesystem fallback only where its documented app-off mode
  allows it. It must not invent a second active Workspace runtime.
- Preserve timeout, non-2xx, discovery, and malformed-response distinctions;
  callers use those to decide whether to retry, start Exograph, or operate app-off.
- Keep response decoding private to the transport. Do not expose decoder
  internals as an accidental API.
- Command-server routes, CLI command/flag behavior, and shared protocol shapes
  are protected public contracts: stop for lead approval if a change is needed.

## Focused gates

```bash
pnpm --filter @exograph/cli exec vitest run src/app-client.test.ts src/index.test.ts src/mcp-server.test.ts
pnpm --filter @exograph/cli typecheck
pnpm --filter @exograph/cli check:unused
pnpm --filter @exograph/cli build
```
