ExitPlanMode isn't available in this session's toolset, so I'll close with the ruling directly. The full ruling is written to `/Users/kenneth/.claude/plans/fable-review-packet-compiled-pebble.md`.

## Ruling: **C, amended** — scene contract yes, WebGPU not yet, z stays 0

**The four amendments to the orchestrator's recommendation:**

1. **Don't build the WebGPU renderer now.** 235 nodes / 418 edges is ~two orders of magnitude below Canvas 2D limits, so building a second backend today is all of C's cost with none of its benefit. Gate it objectively: build the GPU path only when Canvas p95 frame time exceeds 8 ms during a scripted gesture sequence on a checked-in synthetic fixture at a density Exo actually targets (expect that somewhere above ~3–5k visible curved edges). If Canvas holds, skip WebGPU entirely. **GPU picking: no** — CPU spatial-index picking is fine to ~50k nodes; a pick buffer adds readback latency and a second semantics path.

2. **z = 0, but reserve it in the contract.** Define positions as `x,y,z` and a camera with reserved pitch so enabling depth later is a data change, not a contract change. If depth is ever trialed: z comes from a stable semantic signal fixed per data epoch (cluster band or link-distance relief), never from the force simulation, shallow range, 2D screen-space picking, and it must pass a relocate-a-node comparison task before staying on.

3. **The drafted gesture contract has a real flaw: primary drag should pan, not orbit.** In a 2D scene, "orbit" is just screen roll — a 3D-viewer convention that taxes the most common action. Other required corrections found in the code: selection fires on pointer-down and default drag *moves the node* (`kinetic.html:514–518`), violating the contract's own Alt-to-move rule; any wheel event zooms (`:587`) when trackpad scroll should pan and ctrl+wheel (pinch) should zoom; `dblclick` won't fire reliably on touch; and **Reset posts a randomized physics nudge (`:701`), scrambling the mental map** — reset must re-frame the camera only.

4. **The evidence chain is currently broken: there is no synthetic fixture.** `public/topology.json` is byte-identical to the private vault snapshot (I verified with `cmp`; both gitignored, and the lab isn't a git repo at all). Every stability/fps number so far was measured on private data and is unreproducible. A seeded synthetic generator is the prerequisite for all gates.

**Scene boundary (Q2):** split `kinetic.html`'s inline script into `scene` (topology, selection, path BFS, label *selection*, picking, transforms — pure state/math), the existing layout worker (add an epoch counter), `gestures` (events → intents), and a draw-only `renderer` interface `{resize, render(scene, camera, dt), destroy}`. Picking and label selection live in the scene so renderers can never diverge on graph meaning; labels remain a CPU overlay under either backend.

**Acceptance gates (Q6):** assert on scene state, not pixels — the current `getImageData` harness can't survive a WebGPU canvas, and despite the packet's claim it never actually asserts fps (it checks pixel deltas, console errors, and telemetry angle only). Ten gates are specified in the ruling: deterministic settle, p95 frame time, next-frame gesture latency, **zero redraws at rest** (the current unconditional rAF loop is unacceptable in an Electron pane), picking accuracy, zero label overlap, memory stability, bounded mental-map displacement, keyboard/reduced-motion access, and explicit low/high-density behavior.

**Privacy fixes needed regardless of direction:** `kinetic-stability.cjs` serves the private snapshot via `python3 -m http.server` bound to all interfaces during every test run (bind 127.0.0.1); `persistLayout()` writes full absolute note paths to localStorage with a fixture-agnostic key.

No production contract, CLI, IPC, or workspace-data change is approved; the decision records required before any lab result becomes an Exo proposal are listed in the plan file.
