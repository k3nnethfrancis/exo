# Launch Gate D — source and packaged WebGPU proof

Date: 2026-07-20  
Integration base: `d6a5141`  
Probe commit: `9c6e381`

## Outcome

Gate D now has executable proof that the source Electron app and the exact
packaged macOS app can acquire a real WebGPU adapter and device, compile Exo's
production graph shaders and pipelines, submit a bounded production-renderer
draw, and observe queue completion. Neither run uses a GPU-enabling command-line
flag or Chromium feature override.

This is hardware-specific evidence, not a universal compatibility claim. The
measured host was an arm64 Mac14,13 running Darwin 25.5.0. Both runs used
Electron 41.0.2 and Chromium 146.0.7680.72 with an Apple `metal-3` adapter.

## Production policy

Exo previously disabled Electron hardware acceleration and added
`disable-gpu`, `disable-gpu-compositing`, and `disable-zero-copy` on ordinary
startup. That policy made default WebGPU impossible even when the host supported
it. Exo now accepts Electron's normal hardware policy by default.

`EXO_DISABLE_GPU=1` remains a diagnostic-only escape hatch. It calls Electron's
supported `disableHardwareAcceleration()` API without persisting a user setting
or adding unsafe WebGPU flags. Unsupported, failed, or lost WebGPU paths still
fall back to the state-preserving Canvas renderer.

## Probe boundary

The proof is a hidden second renderer entry that is reachable only when the
internal `EXO_GPU_PROBE_OUTPUT` environment variable is present. It has no
product route or visible control. A direct Node launcher starts either the
source Electron executable or the packaged `Exo.app` executable; Playwright and
remote-debugging flags are not involved.

The renderer probe imports and instantiates the exact production
`GraphWebGpuRenderer`. It supplies a 64 x 64 graph with two nodes and one edge,
captures the actual device requested by the production renderer, compiles the
production node and edge shaders and pipelines, renders through the production
path, waits for submitted work, and destroys the renderer and device.

Failures remain distinguishable rather than collapsing into “WebGPU missing”:

- `navigator-gpu-absent`
- `runtime-incomplete`
- `adapter-unavailable` / `adapter-request-failure`
- `device-failure`
- `shader-compilation-failure`
- `validation-failure`
- `context-failure`
- `draw-failure`

The report records Electron, Chromium, Node, OS, architecture, package state,
adapter capabilities, device capabilities, Electron's GPU feature status,
relevant command-line switches, and bounded draw completion.

## Bug found by the proof

The first unflagged source and package runs both reached the Apple adapter and
device but failed truthfully during production shader compilation:

> edge shader failed to compile: 21:7 'target' is a reserved keyword

The production WGSL was corrected in the integrated resilient WebGPU runtime.
The final source and package runs then passed through the same probe unchanged.
This is why Gate D requires shader compilation and a submitted draw rather than
stopping at `navigator.gpu` or adapter availability.

## Final source and package evidence

| Evidence | Source Electron | Packaged `Exo.app` |
| --- | --- | --- |
| Result | `success` | `success` |
| Electron / Chromium | 41.0.2 / 146.0.7680.72 | 41.0.2 / 146.0.7680.72 |
| Adapter | Apple, `metal-3` | Apple, `metal-3` |
| WebGPU feature status | enabled | enabled |
| Exo GPU feature overrides | none | none |
| Nodes / edges | 2 / 1 | 2 / 1 |
| Production draw calls | 2 | 2 |
| Submitted work completed | yes | yes |

The exact unsigned package was built at `release/mac-arm64/Exo.app`.

- executable SHA-256:
  `51ea98f5b4ff5e5c079a6953a886a10999e5b355a76bcd92ff5dd59cb7167bd9`
- `app.asar` SHA-256:
  `4d0b3d549d2e7fff0f340aee4fc242420b03dd98e65c8f4dd5ba71b3f2a6ac54`

Machine-local JSON reports remain in the ignored `artifacts/` directory:

- `gate-d-webgpu-source-direct.json` and
  `gate-d-webgpu-packaged-direct.json` preserve the initial shader failure;
- `gate-d-webgpu-source-success.json` and
  `gate-d-webgpu-packaged-success.json` preserve the final successful runs.

## Terminal stability

Default hardware acceleration also changes xterm's rendering environment, so a
permanent source/package Electron journey exercises the direct PTY and xterm
path under that policy. It covers rapid typing, multiline input, Enter,
Backspace, history, Escape, Ctrl-C recovery, terminal geometry after pane
resize, 300-line scrollback, Preview-to-Terminal reveal, and editor coexistence.

The journey passed against both source Electron and the exact packaged app.
`pnpm terminal:check` also passed 78 focused tests and all 9 stable-smoke
scenarios.

## Verification

- focused startup, probe, production WebGPU renderer, and recovery-host tests:
  32 passed;
- complete desktop suite: 507 passed;
- desktop typecheck and production build: passed;
- exact macOS package build: passed;
- source and packaged production WebGPU probe: passed;
- source and packaged hardware-accelerated terminal journey: passed;
- terminal stability check: 78 tests and 9/9 stable-smoke scenarios passed.

The repository checker currently reports one integration-owned hygiene failure:
`graphWebGpuRenderer.test.ts` imports `node:fs` and `node:os`. The production
source, Gate D probe, and package are unaffected; this report does not silently
claim that unrelated checker green.

## Deliberate limits

- The direct proof covers one Apple Silicon host and one Electron/Chromium
  runtime. Other adapters, operating systems, and driver stacks still require
  their own execution evidence.
- Device-loss recovery and synchronous draw-failure fallback are deterministic
  host tests. This pass did not physically reset the Apple GPU.
- The probe proves production shader/pipeline creation and bounded submission;
  it is not a visual pixel-golden test.

-- Exo | 2026-07-20
