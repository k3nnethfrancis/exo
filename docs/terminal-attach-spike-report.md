# WP-T9 Plain-Attach Spike Report

Date: 2026-07-03

## Summary

Recommendation: **kill plain attach as a product runtime path**.

A spike-only `PtyAttachTerminalRuntime` was implemented in a detached worktree at:

```text
/Users/kenneth/Desktop/lab/projects/exo-pty-attach-spike
```

The spike used `node-pty` to run:

```bash
tmux -u attach -t {session}
```

It was selected only by:

```bash
EXO_TERMINAL_RUNTIME=pty-attach-spike
```

No spike runtime code or `node-pty` dependency was added to this main checkout. The only intended durable artifact is this report.

Plain attach did not clear Fable's promote threshold. It required native-module package/build changes, failed the selected render-stability e2e test, and lost useful xterm live scrollback in a direct buffer probe where control-mode preserved all generated lines exactly once across resize and reconnect.

## Methodology

Read before editing:

- `/Users/kenneth/.codex/skills/terminal-stability/SKILL.md`
- `fable-exo-preflight-spec.md` section 5 and section 9
- `docs/terminal-quality-standard.md`
- `docs/terminal-architecture-v4.md`

Spike implementation shape:

- Added spike-only `apps/desktop/src/main/terminal-runtime-pty-attach-spike.ts`.
- Added spike-only `node-pty` dev dependency under `apps/desktop`.
- Added env-only runtime selection in spike `apps/desktop/src/main/index.ts`.
- Added `node-pty` to spike `electron.vite.config.ts` externals after the first packaged Electron launch failed to load the native module.
- Added temporary spike-only renderer instrumentation exposing xterm buffers to measure scrollback behavior.
- Did not vendor or adapt GPL code. External architectures such as cmux were not imported.

The spike intentionally reused the existing tmux session creation, pane lookup, capture, and termination helpers. The comparison isolated the live attach transport: tmux control-mode bridge versus node-pty plain attach client.

## Commands And Results

### Dependency and packaging

Command:

```bash
pnpm --filter @exo/desktop add -D node-pty
```

Result:

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: node-pty@1.1.0
```

Fix needed in spike worktree:

```bash
pnpm rebuild node-pty
pnpm --filter @exo/desktop exec electron-rebuild -f -w node-pty
```

The first built Electron app still failed under Playwright until `node-pty` was externalized from the main-process bundle:

```text
Error: Failed to load native module: pty.node ... Could not dynamically require "./prebuilds/darwin-arm64//pty.node".
```

This confirms Fable's stated node-pty risk: native build approval, Electron ABI rebuild, and packaging/bundling work are real costs before behavior is considered.

### Spike unit/build checks

Command:

```bash
pnpm --filter @exo/desktop exec vitest run \
  src/main/terminal-runtime-pty-attach-spike.test.ts \
  src/main/terminal-runtime-tmux.test.ts \
  src/main/terminal-tmux.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       24 passed (24)
```

Command:

```bash
pnpm --filter @exo/desktop build
```

Result:

```text
electron-vite build ... built successfully
```

### E2E slice, pty attach

Command:

```bash
EXO_TERMINAL_RUNTIME=pty-attach-spike pnpm exec playwright test \
  -c apps/desktop/playwright.config.ts \
  apps/desktop/tests/e2e/shell.spec.ts \
  --grep "measures terminal input echo latency|keeps terminal input latency within targets|keeps fake Claude render stable|keeps /bin/cat terminal input visible while a loaded preview is focused and resized|reattaches a tmux-backed shell after app relaunch"
```

Result after externalizing `node-pty`:

```text
4 passed, 1 failed

Failed:
keeps fake Claude render stable and interactive while preview is open

Failure:
Timeout waiting for FAKE_AGENT_INPUT preview render input ... in .xterm-rows
```

Interpretation: pty attach did not pass the selected render-stability corpus. The failure occurred after the fake Claude fixture was initially visible and after the terminal surface was clicked and typed into. The analogous control-mode run passed all five selected tests.

### E2E slice, control-mode comparison

Command:

```bash
pnpm exec playwright test \
  -c apps/desktop/playwright.config.ts \
  apps/desktop/tests/e2e/shell.spec.ts \
  --grep "measures terminal input echo latency|keeps terminal input latency within targets|keeps fake Claude render stable|keeps /bin/cat terminal input visible while a loaded preview is focused and resized|reattaches a tmux-backed shell after app relaunch"
```

Result:

```text
5 passed
```

### Input latency

A custom Playwright probe launched the built app against `/bin/cat`, typed 20 markers, and waited for each marker to appear in xterm.

Control-mode:

```text
p50 25.31 ms
p90 37.85 ms
max 46.92 ms
```

Pty attach:

```text
p50 26.74 ms
p90 40.09 ms
max 40.10 ms
```

Interpretation: pty attach was not meaningfully faster. It was slightly slower at p50/p90 in this run but still within the product latency target. Latency is not a reason to promote it.

### Scrollback, resize, and reconnect

A custom Playwright probe generated 220 numbered lines in `/bin/sh`, then read xterm's buffer before resize, after resize, and after explicit reconnect.

Control-mode preserved useful live scrollback:

```json
{
  "before": {
    "bufferLength": 224,
    "baseY": 163,
    "counts": {
      "pollute-line-001": 1,
      "pollute-line-050": 1,
      "pollute-line-100": 1,
      "pollute-line-150": 1,
      "pollute-line-200": 1,
      "pollute-line-220": 1
    },
    "repeatedLineCount": 220
  },
  "afterResize": {
    "bufferLength": 224,
    "baseY": 183,
    "counts": {
      "pollute-line-001": 1,
      "pollute-line-050": 1,
      "pollute-line-100": 1,
      "pollute-line-150": 1,
      "pollute-line-200": 1,
      "pollute-line-220": 1
    },
    "repeatedLineCount": 220
  },
  "afterReconnect": {
    "bufferLength": 224,
    "baseY": 183,
    "counts": {
      "pollute-line-001": 1,
      "pollute-line-050": 1,
      "pollute-line-100": 1,
      "pollute-line-150": 1,
      "pollute-line-200": 1,
      "pollute-line-220": 1
    },
    "repeatedLineCount": 220
  }
}
```

Pty attach did not preserve useful live scrollback:

```json
{
  "before": {
    "bufferLength": 61,
    "baseY": 0,
    "counts": {
      "pollute-line-001": 0,
      "pollute-line-050": 0,
      "pollute-line-100": 0,
      "pollute-line-150": 0,
      "pollute-line-200": 1,
      "pollute-line-220": 1
    },
    "repeatedLineCount": 60
  },
  "afterResize": {
    "bufferLength": 61,
    "baseY": 20,
    "counts": {
      "pollute-line-001": 0,
      "pollute-line-050": 0,
      "pollute-line-100": 0,
      "pollute-line-150": 0,
      "pollute-line-200": 1,
      "pollute-line-220": 1
    },
    "repeatedLineCount": 60
  },
  "afterReconnect": {
    "bufferLength": 41,
    "baseY": 0,
    "counts": {
      "pollute-line-001": 0,
      "pollute-line-050": 0,
      "pollute-line-100": 0,
      "pollute-line-150": 0,
      "pollute-line-200": 1,
      "pollute-line-220": 1
    },
    "repeatedLineCount": 31
  }
}
```

Interpretation: the expected disqualifier in Fable section 5 was repaint-artifact blocks per resize, but this spike showed a more fundamental problem. Plain attach makes tmux's client viewport the stream source. In this probe, xterm did not receive the full live output history and could not own useful scrollback. Reconnect further reduced the live buffer. That contradicts the terminal quality requirement that xterm own predictable live scrollback.

## Findings

1. **Plain attach does not simplify the live ownership model.**

   It inserts a second terminal client viewport between tmux and xterm. xterm no longer receives the same append stream that control-mode provides; it receives tmux client repaint behavior.

2. **Useful xterm scrollback regressed.**

   Control-mode preserved all 220 generated lines exactly once through resize and reconnect. Pty attach preserved only the tail of the burst in xterm's buffer before resize and fewer rows after reconnect.

3. **Render-stability did not pass.**

   The selected fake Claude render-stability e2e test failed under pty attach and passed under control-mode.

4. **Latency was acceptable but not better.**

   Pty attach p50/p90 was close to control-mode, but not meaningfully better in the `/bin/cat` probe.

5. **Packaging cost is non-trivial.**

   `node-pty` required explicit build approval, Electron rebuild work, and Vite externalization before the built Electron app launched under Playwright.

6. **A second product transport would add architecture risk.**

   Keeping pty attach as a selectable product path would violate the current V4 direction unless backed by a deliberate ADR. The spike evidence does not justify that.

## Recommendation

Kill WP-T9 as a product runtime path.

Keep the existing architecture direction:

```text
xterm.js live surface
  -> Exo renderer terminal bridge
  -> TerminalManager facade
  -> tmux control-mode runtime
  -> tmux pane
```

Document plain `tmux attach` in an external terminal as the manual debug/recovery path. Do not merge `node-pty`, `PtyAttachTerminalRuntime`, env selection, or renderer test instrumentation into main.

## Evidence Limitations

- This was a local spike, not two weeks of dogfooding.
- The full render-stability corpus plus both Fable geometry e2e tests were not all present as named landed tests on this branch. I ran the closest existing render, preview resize, relaunch, and latency e2e slice.
- Scrollback measurement used temporary spike-only renderer instrumentation to read xterm's buffer directly. This instrumentation must not be merged.
- The pty attach implementation was intentionally minimal and branch-confined. It did not attempt to compensate for tmux client repaint semantics with extra buffering, because doing so would start creating a second product transport path and would violate the spike stop conditions.
- Diagnostics still reported runtime `"tmux"` because product diagnostics were not expanded for the spike-only runtime. The env guard and test behavior confirmed the pty attach path was active.

## Spike-Only Code Left Outside Main

The detached worktree contains spike-only changes:

- `apps/desktop/src/main/terminal-runtime-pty-attach-spike.ts`
- `apps/desktop/src/main/terminal-runtime-pty-attach-spike.test.ts`
- `apps/desktop/src/main/index.ts` env guard
- `apps/desktop/src/main/terminal-runtime.ts` widened kind type
- `apps/desktop/electron.vite.config.ts` externalized `node-pty`
- `apps/desktop/src/renderer/src/components/TerminalView.tsx` temporary buffer probe hook
- `apps/desktop/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` spike-only `node-pty` dependency/build approval

Do not merge those changes to main.
