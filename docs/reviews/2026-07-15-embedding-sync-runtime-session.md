# Fable session: automatic embedding catch-up runtime

- Session ID: `957b141d-edbd-4719-b517-d4b2d314f025`
- Packet: `docs/reviews/2026-07-15-embedding-sync-runtime-packet.md`
- Response: `docs/reviews/2026-07-15-embedding-sync-runtime-response.md`
- Error log: `docs/reviews/2026-07-15-embedding-sync-runtime-stderr.log`
- Review status: failed 2026-07-15; Claude CLI returned `Not logged in · Please run /login`
- Exit status: `1`
- Verification: response contains only the authentication failure; stderr is empty
- Ruling: none

## User-approved exception

On 2026-07-15, after the authentication failure was reported, Kenneth explicitly
directed: "skip that then let’s just do it ourselves." This authorizes the Codex
orchestrator to proceed without a Fable ruling for `EXO-ISSUE-117`. The failed
review remains recorded and must not be represented as architect approval.

## Implementation outcome

The user-approved exception was exercised. Exo now uses separate foreground and
maintenance derived-index workers, deterministic quiet/idle scheduling, bounded
automatic embedding slices, lexical fallback during maintenance, and a narrow
QMD 2.5.3 patch for work budgets and atomic vector publication.

Verification completed on 2026-07-15:

- `pnpm check`: core 114 tests, desktop 236 tests, CLI 27 tests, all typechecks,
  and both production builds passed.
- Real Electron hybrid-update latency gate with 1,200 notes: typing paint p90
  12 ms and p99 14.5 ms; navigation p90 42.1 ms and p99 47.9 ms; no long tasks.
- Remaining gate: deterministic packaged-app convergence with the real embedding
  model while Terminal, graph context, and hybrid search are exercised.
