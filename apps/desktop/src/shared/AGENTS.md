# Desktop shared-contract map

This directory owns the typed desktop bridge shared by Electron main, preload,
and renderer code. It describes cross-process shapes; it does not implement
filesystem authority, runtime behavior, or core domain policy.

## Start with the owner

- `api.ts` is the renderer's aggregate `DesktopApi` seam.
- `api/` groups the domain-facing method and payload types composed by that
  aggregate. Reuse canonical `@exograph/core` types instead of redefining them here.
- `desktop-ipc.ts` maps invoke channels and renderer events back to the
  aggregate API. Keep channel arguments, return values, and event payloads in
  parity with main handlers and the preload bridge.
- `../preload/index.ts` implements `DesktopApi`; `../preload/typed-ipc.ts` and
  `../main/typed-ipc.ts` enforce the invoke-channel mapping at compile time.

## Invariants

- Keep serialized channel payloads process-safe and provider-neutral.
- A type declaration does not grant filesystem or process authority. Main
  handlers must still enforce the owning core and runtime policies.
- Do not add a second aggregate API, untyped preload escape hatch, or duplicate
  event payload alongside `desktop-ipc.ts`.
- Treat a channel or shared protocol change as cross-process work: update every
  participant and its focused owner tests together.

## Focused gates

```bash
pnpm --filter @exograph/desktop check:unused
pnpm --filter @exograph/desktop typecheck
```

For behavior changes, also run the closest main/renderer tests and the real
Electron path; type agreement alone does not prove runtime parity.
