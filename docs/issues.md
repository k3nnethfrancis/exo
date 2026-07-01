# Exo Issues

Last updated: 2026-06-24

This is the canonical active bug/QA tracker for Exo implementation work. It captures user-observed issues that need investigation before the next push/release pass.

Related field notes may be captured in `/Users/kenneth/Desktop/lab/notes/shoshin-codex/exo-issues.md`, but actionable implementation items should be promoted here with an `EXO-ISSUE-*` id before assignment.

## Open

### EXO-ISSUE-072: Preview clipping and repeated Claude screen after preview/focus fix

- Status: fixed locally
- Severity: high
- Area: browser preview, terminal rendering, pane focus/layout
- Observed:
  - 2026-06-24: After the preview/focus fix in `65616a0`, opening `docs/artifacts/core-plugin-boundary.html` in preview can show only the top portion of the HTML artifact instead of filling the pane.
  - In the adjacent Claude terminal, the Claude Code header/splash appeared repeated three times in the same terminal surface.
  - The screenshot shows a preview pane on the left with clipped web content and a terminal pane on the right with repeated Claude header blocks.
- Expected:
  - The preview webview should fill the available pane body and render the full local HTML artifact.
  - Terminal focus/preview reconciliation must not duplicate visible terminal output, replay hydration snapshots, or append stale screen content over the live xterm state.
  - Fixes must preserve Terminal V4 invariants: xterm owns live screen, tmux owns durable session/history, React owns metadata only, and preview/focus changes cannot trigger terminal reset/replay.
- Investigation notes:
  - Preview clipping was caused by Electron `<webview>` keeping a 150px guest viewport even though the host element filled the pane when rendered as a block element in a split pane.
  - The webview now uses an inline-flex host display, and the preview layout e2e verifies both host size and guest `window.innerHeight`.
  - Repeated Claude headers were caused by rendered bootstrap output still being buffered into a pending hydration snapshot, then replayed after the TerminalView was reset.
  - Rendered bootstrap output is no longer buffered for hydration; reconnect remains the only rendered-session buffering path.
  - Terminal focus/preview paths now fit the xterm surface without issuing refresh/repaint reconciliation, and terminal focus stops bubbling to parent pane handlers.
- QA coverage:
  - E2E covers opening a local HTML artifact through both command-server preview open and address bar entry, asserting the webview fills the pane body and the guest viewport reaches the bottom marker.
  - E2E/fake-Claude coverage asserts one visible header/history section after preview open/focus and terminal interaction, with no duplicate splash/header blocks.

### EXO-ISSUE-071: Plugin architecture needs decision/fallback audit and plugin-development skill

- Status: fixed locally
- Severity: medium-high
- Area: plugin architecture, docs, developer workflow, future extensibility
- Observed:
  - We applied a productive architecture pass to terminals by steelmanning every design decision and fallback, deleting weak fallbacks, documenting justified ones, and adding skill-level rules for future terminal work.
  - The plugin architecture now needs the same treatment before it grows into more surfaces: agent harnesses, search providers, routines, profiles, analyzers, trace collectors, dashboards, and future plugin-owned settings/UI.
  - Current plugin docs describe the target split, but not every fallback/decision has a durable rationale or inline implementation commentary.
- Expected:
  - Core/plugin decisions should have explicit reasoning: why the seam exists, why a behavior is core or plugin-owned, which fallbacks are allowed, which are forbidden, and what risk the decision reduces.
  - Fallbacks should survive a steelman review: keep only fallbacks that solve a real product/reliability/security problem and document why they exist.
  - Plugin-system code should have concise inline comments at non-obvious decision points, especially trust/permission gates, metadata-only discovery, bundled-plugin handling, and disabled/untrusted behavior.
  - Add a concise plugin-development skill for future Exo work that tells agents how to build on the plugin system without hardcoding GA/Shoshin-specific behavior, bypassing trust, or expanding core unnecessarily.
- Investigation notes:
  - Audit `docs/plugin-system-architecture.md`, `docs/plugin-implementation-plan.md`, `packages/core/src/capabilities*`, `packages/core/src/plugin*`, `packages/core/src/search-provider*`, `packages/core/src/agent-harness*`, `packages/core/src/routine*`, and current plugin issues.
  - Apply the deep-module vocabulary: module, interface, seam, adapter, depth, leverage, and locality.
  - Distinguish core substrate from bundled plugins and from local/private plugin configuration.
- Acceptance:
  - A plugin architecture audit doc exists with decisions, steelmanned reasons, accepted fallbacks, rejected fallbacks, and next implementation slices.
  - Inline comments clarify non-obvious plugin fallback/trust/metadata decisions without narrating obvious code.
  - A plugin-development skill exists and is referenced from repo guidance.
  - Tests or docs are updated if any fallback behavior changes.
- Resolution:
  - Added `docs/plugin-architecture-audit.md` with core/plugin decisions, steelmanned reasons, accepted fallbacks, rejected fallbacks, inline-comment targets, and hardening backlog.
  - Added `.claude/skills/plugin-development/SKILL.md` and referenced it from `AGENTS.md`.
  - Added concise inline comments for metadata-only plugin discovery, disabled plugin capability handling, trusted dev plugin dirs, surface policy limits, QMD degraded search fallbacks, harness detection compatibility, and Pi backend readiness.

### EXO-ISSUE-070: Terminal code-review residuals from 2026-06-23

- Status: fixed in `main`
- Severity: high
- Area: terminal queueing, tmux bridge errors, live tails, transcript tails, health tests
- Source:
  - `docs/terminal-code-review-2026-06-23.md`
- Scope:
  - [x] Fix multiple queued `delayedSubmit` messages scheduling multiple Enter submits.
  - [x] Make queued-write flushing respect detached bridges and exited sessions.
  - [x] Make coalesced raw-input discard/flush behavior explicit around exit/kill.
  - [x] Prevent tmux `send-keys` / paste-buffer command failures from escaping the terminal runtime write path as unhandled IPC failures.
  - [x] Prefer fresh tmux captured live tails over stale cache after clear-screen/current-screen changes.
  - [x] Avoid U+FFFD when transcript tail reads start in the middle of UTF-8 bytes.
  - [x] Cache tmux availability inside the tmux runtime without reintroducing fallback transports.
  - [x] Expand terminal health tests for bridge-detached, idle, healthy, and exited paths.
- Assignment:
  - Feynman: `terminal-manager.ts` queue/flush/raw-input behavior.
  - Hegel: `terminal-tmux.ts` command failures and `terminal-transcripts.ts` UTF-8 tails.
  - Gibbs: `terminal-live-tail-policy.ts`, `terminal-runtime-tmux.ts`, and `terminal-health.test.ts`.
- Acceptance:
  - Focused tests cover each review finding.
    - 2026-06-24: `pnpm --filter @exo/desktop exec vitest run src/main/terminal-manager.test.ts src/main/terminal-tmux.test.ts src/main/terminal-transcripts.test.ts src/main/terminal-live-tail-policy.test.ts src/main/terminal-runtime-tmux.test.ts src/main/terminal-health.test.ts` passed.
    - 2026-06-24: `pnpm --filter @exo/desktop typecheck` and `pnpm --filter @exo/desktop exec vitest run src/renderer/src/App.test.tsx` passed.
  - `pnpm terminal:check`, `pnpm check:repo`, and desktop build pass after integration.
    - 2026-06-24: `pnpm check:repo`, `pnpm terminal:check`, and `pnpm --filter @exo/desktop build` passed.
  - Installed Exo is restarted after the integrated build.
    - 2026-06-24: `./scripts/install-mac-app --with-cli --with-mcp --app-dir /Users/kenneth/Applications` completed, installed Exo was relaunched, and `exo status` returned a healthy command server.

### EXO-ISSUE-068: Terminal launch-readiness finish line

- Status: fixed in `main`; field dogfooding follow-up tracked in `EXO-ISSUE-069`
- Severity: critical
- Area: terminal architecture, render stability, lifecycle/input, QA gates
- Canonical docs:
  - `docs/terminal-architecture-v4.md`
  - `docs/terminal-quality-standard.md`
  - `docs/terminal-runtime-decision.md`
  - `docs/terminal-fallback-audit.md`
- Goal:
  - Make Exo terminals reliable enough for daily Exo-on-Exo work with shell, Claude, Codex, Pi, and future harnesses embedded inside Exo.
  - Keep the V4 architecture decision: one tmux-backed durable runtime, xterm-owned live rendering, append-only normal streaming, and no direct-pty fallback.
- Finish-line checklist:
  - [x] Complete the current `TerminalManager` boundary split: runtime, session registry, harness readiness/queued-send policy, live-tail policy, diagnostics, transcripts, health, and recovery each have a named owner; lifecycle/write/reconnect orchestration intentionally remains in `TerminalManager` as the IPC/CLI/MCP compatibility facade until a concrete reliability bug justifies another extraction.
  - [x] Move Codex-specific startup prompt scanning, queued semantic sends, and MCP launch overrides out of `TerminalManager` into `terminal-harness-readiness`.
  - [x] Remove legacy `terminalHistoryMode`; terminal behavior is expressed as explicit numeric/settings fields for live scrollback, read tails, transcript retention, timing, and geometry.
  - [x] Replace preview-pane/global terminal refresh mitigations with scoped `TerminalView` visibility, focus, fit, and resize handling.
  - [x] Keep native tmux recovery/debug available through diagnostics/API attach fields; remove the visible terminal-header copy button to reduce chrome clutter.
  - [x] Establish a living render-stability fixture corpus for Claude/Codex corruption shapes, including `???`, `�`, tofu boxes, stale overlays, prompt wrapping drift, split UTF-8, emoji, Nerd Font/private-use glyphs, box drawing, carriage-return updates, and blank history gaps.
  - [x] Promote the focused terminal gate into the standard readiness path: terminal vitest subset, render-stability fixture, fake-agent e2e, stable smoke, installed-app restart, and manual Claude/Codex QA.
  - [x] Pass real app QA after each terminal slice: fresh shell, fresh Claude, fresh Codex, preview open, tab switch, hard refresh/app restart, and installed-app command-server recovery; long resumed private sessions and macOS sleep/wake continue under `EXO-ISSUE-069`.
- Notes:
  - 2026-06-24: Moved Codex startup prompt scanning, semantic-send queue policy, bracketed-paste formatting, and Codex MCP launch overrides out of `TerminalManager` into `terminal-harness-readiness`.
  - 2026-06-24: Extended the fake-Claude render-stability e2e to scroll visible xterm history after preview/reload, assert Claude-like/history anchors remain visible, and fail on replacement glyphs, `???`, tofu boxes, or blank/stale history gaps before continuing input.
  - 2026-06-24: Removed `BrowserPane` global terminal refresh scheduling. Mounted `TerminalView` instances now reconcile their own xterm fit/refresh on local focus, resize, pageshow, and visibility events; registry focus only refreshes the targeted terminal.
  - 2026-06-24: Added `pnpm terminal:check` as the focused terminal gate and wired `pnpm stable:check` to run it after the broad CI handoff gate.
  - 2026-06-24: Moved live-tail source selection into `terminal-live-tail-policy`; `TerminalManager` still performs tmux capture/cache mutation but no longer owns the captured-tail vs bounded-cache decision.
  - 2026-06-24 installed-app QA: created temporary shell `term-34`, sent deterministic Unicode-heavy output through the live Exo terminal path, confirmed `exo terminals read` preserved checkmark, box drawing, braille spinner, and gear glyphs, and visually inspected the installed app with no screen-wide smear.
  - 2026-06-24 installed-app QA: created temporary Claude `term-35`, confirmed fresh Claude header/status rendered cleanly in the installed app, clicked once into the terminal, typed `/status`, and verified Claude accepted input and rendered the status screen without model inference or replacement-glyph corruption. Temporary QA sessions were killed afterward.
  - 2026-06-24 gate: `pnpm terminal:check` passed with process privileges: 114 focused Vitest tests and 8 Playwright terminal/readiness tests. A sandboxed attempt failed earlier at Electron process launch/kill with `EPERM`, not a terminal assertion failure.
  - 2026-06-24 gate: `pnpm stable:check` passed: repo check, typecheck, package tests, desktop tests, CLI/MCP tests, builds, dry-run install, focused terminal Vitest subset, and stable Playwright smoke.
  - 2026-06-24 installed-app QA: created temporary Codex `term-36` and verified fresh Codex reached ready state and rendered without replacement-glyph corruption. This exposed a malformed global `terminal-stability` skill warning; fixed `/Users/kenneth/.codex/skills/terminal-stability/SKILL.md` frontmatter and verified fresh Codex `term-37` launched without the warning. Temporary QA sessions were killed afterward.
  - 2026-06-24 installed-app QA: opened a preview pane beside the editor and terminal; terminal remained visible and usable with the preview pane open.
  - 2026-06-24 residual: macOS sleep/wake and long real resumed Claude conversations remain field-dogfooding coverage because they require user-machine state and/or live provider session selection. Keep future regressions under `EXO-ISSUE-062`/`EXO-ISSUE-063` or a new field QA issue rather than reopening this launch-readiness implementation checklist.
- Existing issue links:
  - `EXO-ISSUE-062` tracks the replacement-glyph/render-corruption class.
  - `EXO-ISSUE-063` tracks residual tmux/hydration/read-tail/reconnect cleanup.
  - `EXO-ISSUE-067` tracks Claude launch/focus/input readiness.
- Acceptance:
  - Fresh and resumed Claude/Codex sessions render without `???`, `�`, tofu boxes, stale overlays, blank history gaps, or prompt wrapping drift in installed Exo.
  - Terminal input works on first focus after editor, explorer, preview, tab switch, pane move, hard refresh, and app relaunch.
  - Scrollback and transcript behavior match visible settings and no hidden caps drive user-visible behavior.
  - `pnpm check:repo`, focused terminal vitest, render-stability e2e, `pnpm stable:smoke`, installed-app restart, and documented manual app QA all pass.

### EXO-ISSUE-069: Terminal field dogfooding for sleep/wake and long resumed agent sessions

- Status: open
- Severity: high
- Area: terminal field QA, real agent sessions, macOS sleep/wake
- Context:
  - `EXO-ISSUE-068` completed the implementation/test/readiness gate for the tmux-backed terminal architecture.
  - Two important real-world paths should remain under active observation because they depend on user machine state and private live provider session selection:
    - macOS sleep/wake with active shell, Claude, Codex, and future harness panes
    - resuming long existing Claude/Codex conversations and scrolling/interacting through their restored TUI state
- Expected:
  - Existing tmux-backed sessions survive sleep/wake and app relaunch.
  - Fresh and resumed long agent sessions render without `???`, `�`, tofu boxes, stale overlays, blank history gaps, or prompt wrapping drift.
  - Input works on first focus after wake/relaunch/preview/tab/pane changes.
- QA notes:
  - Capture exact terminal id, harness, command, app version/commit, macOS state, and whether native tmux attach renders correctly if a field failure appears.
  - If a new deterministic corruption shape appears, add it to `apps/desktop/tests/fixtures/terminal-render-stability.json` and make `pnpm terminal:check` fail before fixing.

### EXO-ISSUE-067: Claude terminal launch requires hard refresh and input can stop reaching the pane

- Status: fixed in `main`; broader launch-readiness tracked in `EXO-ISSUE-068`
- Severity: critical
- Area: terminal launch, harness readiness, renderer hydration, focus/input
- Observed:
  - Launching a new Claude terminal can leave the pane in a non-usable state until the app is hard-refreshed.
  - After hard refresh, the Claude pane can render enough to appear present, but keyboard input may not reach the terminal pane.
  - This is distinct from pure glyph corruption: the failure includes launch readiness and input/focus delivery.
- Expected:
  - Creating a Claude terminal should attach and render without hard refresh.
  - After app refresh/relaunch, a tmux-backed Claude session should reattach and accept input on first terminal focus.
  - Terminal focus/input should not depend on tab switching, forced refresh, or renderer reset side effects.
- Investigation notes:
  - Use `.claude/skills/terminal-stability/SKILL.md` before changing terminal code.
  - Treat this as a terminal launch blocker, not a cosmetic issue.
  - Check whether Claude harness readiness, queued semantic sends, hydration state, and xterm focus/registration disagree after create and after hard refresh.
  - Verify `TerminalDock`/`useTerminalSessions` no longer skips the needed reconnect snapshot while also avoiding normal focus-triggered resets.
  - Inspect command-server and tmux session state for cases where a pane exists but renderer registration/input is stale.
- QA coverage needed:
  - Deterministic fake-Claude launch that waits for input and proves the renderer accepts typing without hard refresh.
  - Hard-refresh/reload test for a running fake-Claude session proving reattach plus first-click input.
  - Focus handoff test from editor/preview into a refreshed terminal pane.
- Resolution notes (2026-06-23):
  - Integrated a focused `TerminalDock` activation fix that focuses the active xterm after session hydration/activation.
  - Added fake-Claude reload/input e2e coverage proving a tmux-backed Claude session reattaches after renderer reload and accepts first focused input.
  - Verified in `pnpm stable:smoke` after the V4 terminal pass.
  - This does not close the broader render corruption class tracked in `EXO-ISSUE-062`.

### EXO-ISSUE-062: Claude terminal launch shows replacement-glyph corruption

- Status: open; render-stability gate in progress
- Severity: critical
- Area: terminal rendering, tmux control mode, xterm, Claude Code harness
- Observed:
  - Launching Claude Code in Exo terminals can render repeated replacement characters (`��`) around Claude's header, box-drawing/status lines, and prompt area.
  - The corruption is visible immediately on new Claude launches and can persist until hard refresh/restart or later terminal repaint.
  - The same class of corruption has appeared across machines and themes, including cases where the terminal remains interactive but visually untrustworthy.
- Expected:
  - Claude Code should render with the same fidelity as a normal terminal: no replacement glyphs, no corrupted box drawing, no stale/replayed prompt sections, and no need to refresh after launch.
  - Exo must support Claude/Codex-style Unicode, symbols, status bars, wrapped lines, alternate-screen behavior, and tmux status/prompt output without visible corruption.
- Investigation notes:
  - Treat this as a failed terminal release criterion, not a cosmetic issue.
  - Audit the whole path: Claude output -> tmux pane -> `tmux -C` control output -> Exo decoder -> IPC append events -> xterm write queue -> xterm font fallback/rendering.
  - Existing tests cover some split UTF-8 control output, so reproduce the exact failure shape with Claude-like glyphs/status lines, private-use or symbol glyphs, and split `%output` records.
  - Check whether the terminal font stack lacks required symbol fallback before assuming the bytes are corrupt.
  - Verify hydration/reset paths do not replay old output over a live Claude screen during launch, pane moves, tab switches, or preview-pane focus changes.
- Resolution:
  - Added deterministic Claude-shaped tmux control-mode coverage for ANSI SGR, box drawing, braille spinner symbols, emoji, and private-use/powerline-style glyph bytes split across `%output` records.
  - Added renderer chunking coverage for the same Claude-shaped output split into small xterm write chunks.
  - Those regressions show Exo's tmux byte decoder and renderer string chunker do not introduce U+FFFD for this output shape.
  - Updated xterm creation to use an explicit terminal font stack with symbol, emoji, and common Nerd Font fallbacks.
  - Explicitly enabled xterm custom glyph rendering so box drawing does not depend on the first available text font.
  - 2026-06-23: Added explicit `tmux -u` invocation, UTF-8 locale defaults for terminal launches, Unicode-safe pending hydration tails, stricter xterm-generated OSC response filtering, and fake-Claude render-stability e2e coverage while a preview pane is open.
  - 2026-06-24: Added `docs/terminal-render-cleanup-protocol.md` so future render glitches are handled as field evidence -> classification -> fixture -> narrow fix -> `pnpm terminal:check`, rather than one-off terminal patches.
  - 2026-06-24: Added Claude's `⏺` action marker to the render-stability corpus and applied a renderer-only text-presentation selector before xterm writes to improve marker sizing/spacing. Treat this separately from true `�` byte corruption.
- QA coverage needed:
  - Deterministic test for Claude-like Unicode/box-drawing/status output split across tmux control-mode records and renderer write chunks.
  - E2E render-quality test that fails on `U+FFFD`, `???`, missing Claude-like header/status text, or preview-open input/render loss.
  - Real-app QA: launch Claude from Exo, start/resume a conversation, scroll, switch tabs/panes, open preview beside it, and confirm no replacement-glyph corruption without hard refresh.
  - Compare Exo rendering against macOS Terminal/iTerm/VS Code terminal for the same Claude launch when possible.

### EXO-ISSUE-063: Terminal review residuals after tmux refactor

- Status: fixed in `main`; remaining launch-readiness work moved to `EXO-ISSUE-068`
- Severity: high
- Area: terminal architecture, hydration, read tails, reconnect, CI
- Observed:
  - Review found several still-open terminal risks after the latest tmux-backed refactor.
  - Bounded live reads can prefer stale `recentOutput` over a fresh bounded tmux capture when the captured tail is shorter than the buffered text.
  - Active pane moves still force hydration/reset of mounted xterm instances through `TerminalDock`, risking replay over live terminal state.
  - Reconnect does not force an explicit reconnect snapshot if the session was previously marked hydrated.
  - MCP live `maxLines` remains capped in code rather than surfaced as a settings/config value.
  - CI still does not gate enough terminal e2e/visual behavior to catch the field failures users are reporting.
- Expected:
  - Running-session live reads should use current tmux pane state as the authoritative bounded tail.
  - Mounted live terminals should receive append events only; tab/focus/pane metadata changes should not reset/replay xterm.
  - Reconnect should explicitly hydrate from the live pane when requested.
  - All user-impacting terminal caps should be configurable and visible in Settings.
  - Terminal quality checks should become a named fast gate and be included in readiness before push.
- QA coverage needed:
  - Stale-buffer versus fresh bounded-capture regression.
  - Pane move/tab switch regression proving no `terminals.read()`/xterm reset for mounted live terminals.
  - Reconnect snapshot regression.
  - Preview-adjacent terminal typing e2e with fake agent process.
- Resolution notes (2026-06-23):
  - Bounded running-session reads now treat a non-empty tmux capture as authoritative when `maxLines` is provided, instead of falling back to longer stale `recentOutput`.
  - `TerminalDock` no longer forces hydration on active terminal/pane changes; already-hydrated mounted terminals stay on live append unless reconnect explicitly requests a forced snapshot.
  - Reconnect now forces a hydration snapshot so a restored bridge can replay current live pane output after backend reconnect.
  - MCP `read_agent.maxLines` no longer advertises or enforces the hidden 1000-line schema cap; live line limits now flow to the app and are bounded by configured terminal history.
  - Added `.claude/skills/terminal-stability/SKILL.md` and linked it from repo guidance so future terminal changes start from the terminal ownership rules, invariants, focused checks, and app QA script.
  - 2026-06-24 consolidation: the remaining architectural cleanup, diagnostics hardening, named readiness gate, and app QA requirements are now owned by `EXO-ISSUE-068`.

### EXO-ISSUE-064: Routine template plugins need trust and policy enforcement before agent execution

- Status: fixed in `main`
- Severity: high
- Area: plugin architecture, routines, agent execution safety
- Observed:
  - Review found that untrusted workspace/user plugin manifests can contribute routine templates that are listed, instantiated, and then run through `exo routines run --agent`.
  - Routine template metadata is non-code, but it can become executable agent instructions once sent to a live harness.
  - `permissions`, `outputPolicy`, and `requiredSkills` are currently stored as metadata but not enforced before execution.
- Expected:
  - Untrusted, disabled, or non-CLI routine-template capabilities should not silently become executable agent prompts.
  - Running a routine through an agent should require explicit trust/policy checks.
  - Missing required skills, disallowed permissions, and unsupported output policies should fail clearly before launching a terminal agent.
- Investigation notes:
  - Tighten `RoutineService.listTemplates()` and template instantiation around trusted/active/surface-aware capability filters.
  - Decide whether bundled dev templates are trusted by default and how workspace/user templates become trusted.
  - Keep routine templates as plugin-contributed metadata, but treat prompt execution as a permissioned action.
  - 2026-06-23 implementation: default routine template listing/creation now uses trusted-only, active, CLI-surface filtering. Bundled/dev trusted templates remain visible; untrusted workspace/user templates require an explicit trust path before default listing/instantiation.
  - 2026-06-23 implementation: `exo routines run --agent` validates required harness skills, routine permissions, and output policy before app connection or terminal-agent launch. Dry-run remains allowed for saved routines because it records metadata/artifacts only and does not send prompts to a live harness.
- QA coverage needed:
  - Untrusted routine templates are hidden or blocked from `run --agent`.
  - Disabled routine templates are not listed by default.
  - `run --agent` fails on missing required skills and disallowed permissions/output policy.

### EXO-ISSUE-065: Harness plugin model is still partially hardcoded into terminal and public APIs

- Status: open; first implementation slice landed in `main`
- Severity: medium-high
- Area: plugin architecture, harness adapters, terminal boundary, CLI/MCP APIs
- Observed:
  - Review found the harness registry exists, but public agent surfaces are still closed over bundled ids such as `shell`, `claude`, `codex`, `pi`, and `hermes`.
  - `ManagedAgentKind`, runtime config records, CLI validation, MCP schemas, and persisted terminal-session validation still depend on fixed built-in harness ids.
  - Codex-specific behavior still leaks into `TerminalManager` through launch env overrides, readiness gates, prompt scanning, and queued message behavior.
  - Pi backend configuration can mark Pi launchable based on backend config presence rather than a probed/managed backend readiness state.
- Expected:
  - Terminal sessions should have substrate/session identity separate from registered harness ids.
  - Harness adapters should own harness-specific launch plans, readiness, semantic message handling, skill/config surfaces, and provenance hooks.
  - CLI/MCP should validate against policy-approved registered harnesses rather than a fixed union once the plugin model is ready.
  - Pi-compatible harnesses should show explicit inference-backend dependency status and should not imply Exo manages a backend unless it actually does.
- Investigation notes:
  - Move Codex readiness/MCP injection out of terminal core and into harness adapter metadata/hooks.
  - Split low-level terminal commands from agent harness commands in shared types.
  - Hide/remove Hermes from default user surfaces until it is explicitly configured and product-ready.
  - 2026-06-23 first safe slice:
    - Centralized the built-in `ManagedAgentKind` tuple, parser, and CLI usage formatter in `@exo/core`.
    - Derived the built-in harness registry and runtime launcher record from that core boundary instead of spelling every harness id again.
    - Pointed CLI validation/help and MCP `create_agent` schema/description at the shared core boundary.
    - Added focused core/CLI tests for the boundary and invalid-harness validation.
  - Remaining next patch:
    - Introduce harness-owned launch/readiness metadata for Codex startup gating, MCP launch overrides, prompt readiness scanning, and semantic message submit behavior.
    - Keep that next patch isolated to `agent-harness*` plus the narrow `TerminalManager` call sites that currently branch on `kind === "codex"`.
- QA coverage needed:
  - Agent creation derives from registered/launchable harness metadata.
  - Codex-specific startup behavior is covered by harness adapter tests, not terminal-manager-only tests.
  - Pi launch button remains disabled unless executable and backend dependency are actually satisfied.

### EXO-ISSUE-066: Stable workstation gate and architecture cleanup residuals

- Status: partially resolved in `main`; stable gate and fixture hygiene slice complete, architecture cleanup remains
- Severity: high
- Area: CI, architecture, command server, editor modules, docs hygiene
- Observed:
  - Review found `pnpm ci:check` still does not include enough Electron e2e/visual smoke coverage for daily-use surfaces such as hidden-window command server, terminal rendering, preview focus, pane behavior, and app relaunch/reattach.
  - Command-server contract sharing is incomplete: route constants exist in core, but the server still hand-matches dynamic routes and CLI/MCP duplicate discovery, liveness, timeout, fetch, and route-client logic.
  - `App.tsx` and `NoteEditor.tsx` remain accumulation points for top-level orchestration, editor setup, Markdown rendering, wikilink completion, hover preview, scroll restoration, and metadata UI.
  - Routine artifact storage has a safety smell: safe store writes can preserve host-supplied artifact paths that are later read directly.
  - Fixture hygiene is fragile because local ignored `.exo` runtime state under fixtures can be copied into test workspaces.
  - Some docs still contain private/local examples that should be rewritten or moved out of OSS-facing docs.
- Expected:
  - Add a named stable workstation check that includes focused Electron smoke for terminal, preview, command server, and relaunch behavior.
  - Share command-server route construction/discovery through one client module used by CLI and MCP.
  - Continue extracting editor surfaces and hooks so graph/editor extension work is modular.
  - Keep routine artifacts inside the run store unless an explicit trusted external artifact ref model is introduced.
  - Test fixtures should exclude runtime debris such as `.exo`, `.git`, `node_modules`, and build outputs.
- QA coverage needed:
  - `pnpm stable:check` or equivalent covers the daily-use smoke path before release/push readiness.
  - Fixture-copy tests prove ignored runtime state is not copied into mutable test workspaces.
  - Command-server route tests use shared route construction instead of duplicated strings/regex behavior.
- Resolution slice 2026-06-23:
  - Added `pnpm stable:check` as a named local daily-readiness gate. It runs the existing `pnpm ci:check` repo gate, then a focused Electron smoke set for mutable fixture hygiene, shell boot, pane-tree terminal input, tmux relaunch/reattach, hidden-window command server, hidden-window CLI/MCP control, and preview/terminal split resizing.
  - Left GitHub Actions on `pnpm ci:check` for this slice. The stable smoke adds several serial Electron launches and CLI/MCP work; it is appropriate as a local pre-push/daily-use gate first, then can move into CI after runtime is measured and the CI timeout budget is adjusted.
  - Added filtered mutable fixture copying so local ignored debris under `fixtures/test-workspace`, including `.exo`, `.git`, `node_modules`, `dist`, `release`, `.turbo`, `.vite`, and `coverage`, is not copied into temporary test workspaces.
  - Added focused Playwright helper coverage proving ignored runtime/build directories are excluded while normal fixture content is preserved.
- Remaining work:
  - Share command-server route construction/discovery through one client module used by CLI and MCP.
  - Continue editor/App decomposition and routine artifact storage hardening.
  - Decide whether and when `pnpm stable:check` should run in CI after local timing data is collected.

### EXO-ISSUE-061: Packaged mac build failed in electron-builder dependency collector

- Status: resolved 2026-06-22
- Severity: high
- Area: packaging, install readiness, electron-builder
- Observed:
  - A recent `pnpm pack:mac` run completed Vite/TypeScript build steps but failed in electron-builder's dependency collector with `ERR_SQLITE_ERROR`.
  - The failed run left a partial `release/mac-arm64/Electron.app`, which is misleading because it is not a usable Exo app bundle.
- Expected:
  - Packaging should complete cleanly or fail without leaving artifacts that look installable.
  - Install/readiness QA should be able to produce a clean unsigned `Exo.app` for local stable use.
- Resolution:
  - Reproduced from a clean release directory in the Codex sandbox: `pnpm pack:mac` completed Vite/TypeScript build steps, then electron-builder failed while asking pnpm to collect dependencies with `ERR_SQLITE_ERROR`, leaving `release/mac-arm64/Electron.app`.
  - `pnpm --dir apps/desktop why @tobilu/qmd better-sqlite3 sqlite-vec --prod` failed with the same SQLite error in the sandbox and succeeded with normal filesystem access, so the remaining root cause is environment-specific pnpm store/index SQLite access rather than malformed dependency metadata.
  - `pnpm pack:mac` also succeeded with normal filesystem access and produced `release/mac-arm64/Exo.app`.
  - Added `scripts/pack-mac.mjs` so mac packaging starts from clean `release/mac*` app-output directories and removes generated mac app-output directories on failure. When pnpm reports `ERR_SQLITE_ERROR`, the script prints an actionable electron-builder/pnpm diagnostic and a direct `pnpm why` verification command.
- QA coverage:
  - `node --test scripts/pack-mac.test.mjs` covers stale/partial app-output cleanup and the pnpm SQLite diagnostic.
  - Fresh `pnpm pack:mac` from this worktree succeeded with normal filesystem access.
  - `./scripts/install-mac-app --skip-build --dry-run` targets `~/Applications/Exo.app`.
  - Remaining install smoke not run in this chunk: actual copy into `~/Applications`, launch installed app, onboarding/workspace open, menu-bar icon, CLI, and MCP discovery.

### EXO-ISSUE-060: `exo terminals read --lines` can ignore bounded read limits

- Status: fixed in local branch
- Severity: high
- Area: terminal CLI, MCP read surfaces, bounded tails
- Observed:
  - `./bin/exo terminals read term-16 --lines 40` returned a very large ANSI transcript/tmux tail instead of a small bounded read.
  - Output included historical Claude terminal content and control sequences, enough to truncate Codex output.
- Expected:
  - `--lines N` should return a predictable bounded tail across shell, Claude, Codex, and restored tmux-backed sessions.
  - Bounded reads should not flood CLI/MCP callers or hide the terminal bug being diagnosed.
  - Full durable history should remain available through explicit transcript reads.
- Investigation notes:
  - Audit CLI argument parsing, command-server read payload, tmux `capture-pane` limits, and renderer hydration tail logic.
  - Confirm whether line count is being converted to character count or ignored by a fallback read path.
- QA coverage:
  - Regression test that long output plus `--lines 40` returns roughly 40 terminal lines, not the full transcript.
  - MCP `read_agent` bounded read test for large-output sessions.
- Resolution:
  - `exo terminals read <id> --lines N` is now parsed by the CLI and sent to the command server as a `lines` query parameter on the live tail endpoint.
  - The command server, preload IPC, app client, and terminal manager now carry an explicit `{ maxLines }` live-tail option.
  - Bounded live-tail reads request a bounded tmux `capture-pane` range and return a bounded view of buffered output without shrinking the manager's internal hydration/live-tail cache.
  - MCP `read_agent` now supports `maxLines` for predictable bounded live terminal reads while preserving the existing transcript `tailChars` path.
  - Added focused CLI, command-server, terminal-manager, and MCP client regression coverage for bounded read propagation and line limiting.

### EXO-ISSUE-059: Harness plugins need inference-engine configuration and Hermes should be hidden for now

- Status: open
- Severity: high
- Area: plugin architecture, harness adapters, Pi integration, agent config
- Observed:
  - Pi harness can appear configured but fail because it expects a `llama.cpp` backend that is not running.
  - Hermes is still too much surface area before the core harness/plugin model is stable.
  - Harness enablement is not yet clearly separated from required backend/inference-engine configuration.
- Expected:
  - Built-in harness plugins should expose required configuration and dependency status before launch controls appear.
  - Pi/GA-Pi should be represented as a generic Pi-compatible harness instance with local executable/repo/backend config, not GA-specific OSS defaults.
  - If an inference backend is required, Exo should show the missing dependency and link it to harness configuration.
  - Hermes should be removed or hidden from normal UI until explicitly reintroduced.
- Investigation notes:
  - Decide whether inference engines are plugin capabilities, harness sub-capabilities, or configured runtime dependencies.
  - Confirm which fields belong in public OSS defaults versus local machine config.
  - Preserve the principle that launch rails show only installed/enabled/launchable harnesses.
- QA coverage:
  - Agent Config Editor shows Pi with installed/enabled/launch availability plus required inference backend status.
  - Pi launch button is hidden/disabled until configured dependencies are satisfied.
  - Hermes does not appear as a dead launcher in the default app; explicitly configured Hermes instances remain supported.
- Resolution:
  - Added generic harness dependency status to `AgentHarnessDetection` and wired Pi to a required `inference-backend` dependency.
  - Pi is represented as a generic Pi-compatible harness with local executable/repo/backend env config (`EXO_PI_COMMAND`, `EXO_PI_REPO_PATH`, `EXO_PI_BACKEND_URL` or `EXO_PI_BACKEND_COMMAND`) and no GA-specific defaults.
  - Default Hermes detections are hidden from normal harness lists unless `EXO_HERMES_COMMAND` or `EXO_HERMES_ENABLED` explicitly configures it.
  - Added tests for missing Pi backend, configured custom Pi-compatible harnesses, hidden Hermes, explicit Hermes, and terminal launcher filtering.

### EXO-ISSUE-058: Explorer uses duplicate folder open/close affordances

- Status: fixed locally
- Severity: medium
- Area: explorer, navigation hierarchy, visual design
- Observed:
  - The explorer can show both disclosure arrows and folder icons as open/close affordances.
  - This makes folder rows visually busy and less modern than the target lightweight explorer style.
- Expected:
  - Use a single primary open/close affordance for folders.
  - Prefer folder icons carrying open/closed state, with accessible labels and keyboard behavior preserved.
  - Keep hierarchy scan-friendly without bold, noisy folder rows.
- QA coverage:
  - Nested folder tree with collapsed/expanded folders.
  - Keyboard expand/collapse still works.
  - Screen-reader/accessibility labels preserve expanded state.
- Resolution:
  - Folder rows now use the folder icon as the single open/closed affordance; the duplicate disclosure chevron was removed from folder nodes.
  - Folder buttons expose expanded/collapsed state through `aria-expanded` and accessible labels.
  - Existing tree click behavior and lazy expansion are preserved.

### EXO-ISSUE-057: Markdown files in project folders should render with the Markdown renderer

- Status: fixed locally
- Severity: medium
- Area: editor, project files, Markdown rendering
- Observed:
  - Markdown files opened from project roots do not consistently render with Exo's Markdown renderer.
  - Project Markdown can feel like a code file even when it is documentation or planning content.
- Expected:
  - `.md` files from notes and project folders should use the same rendered Markdown experience by default.
  - Users can still switch to raw/code mode explicitly.
  - Code files in project folders should continue to avoid soft wrapping and behave like code.
- Investigation notes:
  - Audit file classification logic for note-root versus project-root documents.
  - Ensure project Markdown save/index behavior does not incorrectly assume a note-root file.
- QA coverage:
  - Open README/docs/tasks Markdown from a project root and verify rendered mode.
  - Toggle raw mode and save.
  - Open code files from a project root and verify code-like no-wrap behavior remains.
- Resolution:
  - Markdown editor mode is now based on document kind rather than note-root membership, so project `.md` files open in rendered Markdown by default.
  - Note-only affordances such as properties, branches, and graph reference metadata remain scoped to attached notes.
  - Project code/text files continue to use the code editor surface with no wrapping.

### EXO-ISSUE-056: Terminal input can stop rendering while browser preview is open

- Status: fixed locally; manual app QA pending
- Severity: high
- Area: terminal rendering, browser preview, pane focus/resize
- Observed:
  - When a browser preview pane is open to a web page, terminal input can stop visually appearing in the terminal.
  - The terminal may still receive input, but typed characters do not render until the user hard-refreshes the app.
  - 2026-06-23: User also reported terminals not appearing at all while preview mode was open; closing preview and refreshing allowed terminals to open again.
  - 2026-06-24: User again reported losing the ability to type into terminal panes while preview mode is running with loaded content; terminal input does not recover until Cmd+R page refresh.
- Expected:
  - Terminal input echo and prompt rendering should remain immediate and visible while preview panes are open.
  - Preview webviews should not steal terminal focus, suppress xterm rendering, or block terminal resize/refresh.
  - Hard refresh should never be required to make typed terminal input visible.
- Investigation notes:
  - Audit focus handoff between editor, terminal, and browser preview webview panes.
  - Check whether preview pane resize/visibility changes leave xterm in a stale geometry or hidden-measurement state.
  - Verify terminal render/fit calls when preview panes mount, unmount, become active, or share a split with terminal panes.
- QA coverage:
  - App QA with browser preview open beside a shell/Claude/Codex terminal; type continuously while resizing and switching panes.
  - Regression coverage for terminal focus/input after preview pane activation.
- Resolution:
  - Preview panes now schedule terminal fit/refresh passes when the preview URL changes, the webview loads/focuses/blurs, and the app window focuses, blurs, resizes, pageshows, or changes visibility.
  - The mitigation only calls the existing xterm registry refresh path; it does not call `terminals.read()`, reset xterm, replay a full buffer, or alter active terminal hydration.
  - Added a focused renderer regression for the repeated preview-adjacent terminal refresh scheduler.
  - 2026-06-23: Added fake-Claude e2e coverage that opens a preview pane, launches Claude, verifies render quality, types into the terminal, reloads the renderer, and verifies the session remains visible and interactive.
  - 2026-06-24: Added scoped `TerminalView` visibility/focus/fit reconciliation and `shell:focus-window` handoff so terminal focus can reclaim keyboard input from a loaded `webview`.
  - Added deterministic `/bin/cat` e2e coverage for loaded preview focus handoff, resize, and visible terminal input.
  - Manual QA still required in the real Electron app because unit tests cannot reproduce Electron webview focus/compositing behavior: open a web preview beside a shell/Claude/Codex terminal, type continuously, focus/unfocus preview and terminal panes, resize the split, switch panes, and verify input echo remains visible without hard refresh.

### EXO-ISSUE-055: Explorer folder labels are too bold

- Status: fixed locally
- Severity: low
- Area: explorer, visual design
- Observed:
  - Folder names in the file/project explorer are bold enough to feel harsh.
- Expected:
  - Folder labels should be distinguishable from files without visually overpowering the explorer.
  - Try lighter bold or normal weight with icon/disclosure differentiation carrying more of the hierarchy signal.
- QA coverage:
  - Visual QA across notes and project trees with nested folders, selected rows, changed rows, and collapsed sections.
- Resolution:
  - Folder row labels now use normal weight, with file/folder distinction carried by icon state and file row color.
  - Changed descendant badges were reduced in size and moved to the warm `--state-changed` color.

### EXO-ISSUE-054: Exo MCP needs a tool to open preview window URLs or local HTML artifacts

- Status: fixed locally
- Severity: medium
- Area: MCP, browser preview, command server, Exo-on-Exo workflows
- Observed:
  - Exo MCP can coordinate agents and read workspace context, but does not expose a way for an agent to ask Exo to open a URL/path in the in-app browser preview.
  - This blocks agent workflows that generate local HTML artifacts or want the user to review a web page inside Exo.
  - 2026-06-24: Passing an absolute local HTML path such as `/Users/kenneth/Desktop/lab/projects/exo/docs/artifacts/core-plugin-boundary.html` still does not open correctly in preview mode.
- Expected:
  - MCP should expose a narrow, safe tool for opening a URL or local path/HTML artifact in Exo's browser preview surface.
  - The tool should validate inputs, avoid surprising navigation, and return structured success/error output.
  - If Exo is not running or the workspace cannot open preview panes, the MCP response should be actionable.
- Investigation notes:
  - Decide whether this belongs in the narrow MCP work plane now or behind a preview/browser capability.
  - Reuse existing command-server/browser-preview IPC where possible instead of creating a second navigation path.
  - Consider local file path rules and whether project/notes root attachment is required before opening a file URL.
- QA coverage:
  - MCP smoke that opens an HTTP URL in preview.
  - MCP smoke that opens a local generated HTML file in preview.
  - Negative tests for malformed URLs and disallowed local paths.
- Resolution:
  - Added MCP `open_preview`, backed by a new shared command-server `/preview/open` route and renderer `command:open-preview` event.
  - Preview accepts HTTP(S) URLs and existing local `.html`/`.htm` files under the active workspace, note roots, or project roots; `file://` URLs are normalized through the same local validation.
  - The renderer opens the validated target in the existing in-app browser preview pane path.
  - 2026-06-24: Moved preview target validation into a focused main-process module and fixed renderer-ready tracking so webview navigation no longer causes command-server preview IPC to be dropped.
  - Absolute local HTML paths are covered through command-server e2e, and the preview address bar now normalizes absolute local paths to `file://` URLs.

### EXO-ISSUE-053: Live wikilink search is missing while typing `[[...]]`

- Status: fixed locally
- Severity: medium
- Area: editor, backlinks, graph navigation
- Observed:
  - Typing `[[` creates the bracket pair and lets the user type inside it, but there is no live search popup for existing pages.
  - Example expectation: typing `[[go]]` should surface a small capped list such as `[[goals]]` when matching pages exist.
- Expected:
  - While the cursor is inside an active `[[...]]` wikilink token, show a small popup near the cursor with up to three matching pages.
  - Pressing Enter should accept the selected existing page suggestion when the popup is open.
  - No popup should show when there are no matches.
  - The interaction should preserve normal typing, bracket completion, and cursor movement behavior.
- Investigation notes:
  - Use indexed/known workspace page titles or current file tree data as the first candidate source.
  - Avoid adding a slow search call on every keystroke; debounce or use an in-memory title list where possible.
  - Define behavior for exact match, casing, spaces, aliases, and creating a new page when no match exists.
- QA coverage:
  - Editor tests for `[[` completion, live filtering, Enter selection, no-match behavior, and preserving typed new links.
  - App QA in a real notes vault with several similarly named pages.
- Resolution:
  - Added an active wikilink completion context detector and a small cursor-adjacent suggestion popup capped at three entries.
  - Suggestions are filtered from the renderer's in-memory note tree, avoiding per-keystroke note-root scans; pressing Enter accepts the first highlighted suggestion.
  - Added focused renderer tests for context detection, filtering/no-match behavior, and suggestion insertion.

### EXO-ISSUE-052: Inspect mode should be replaced by read-only backlinks/references below rendered pages

- Status: fixed locally
- Severity: medium
- Area: editor, backlinks, references, inspect mode
- Observed:
  - Inspect mode is not the desired surface for backlinks/references.
  - Backlinks and references should be visible as part of the reading surface, not hidden behind a separate inspect mode.
- Expected:
  - Remove or de-emphasize inspect mode for this workflow.
  - Render backlinks and references at the bottom of each rendered page under a faint divider.
  - This section should be read-only, not part of the editable document body, and should not appear in raw mode.
  - Items should be clickable and navigate to the referenced page.
- Investigation notes:
  - Define backlinks versus outgoing references and where their data comes from in the current index/model.
  - Ensure the bottom section does not interfere with save state, cursor placement, selection, or Markdown body content.
  - Consider empty state: likely hide the section when there are no backlinks/references.
- QA coverage:
  - Rendered note with backlinks shows bottom references section.
  - Raw mode hides the section.
  - Clicking a backlink opens the target page.
  - Editing/saving the document does not include generated backlinks text.
- Resolution:
  - Added a generated CodeMirror widget below live-rendered Markdown pages for backlinks and outgoing note references.
  - The generated section is read-only, hidden in raw Markdown mode, and uses existing link-click navigation data attributes.
  - Added focused renderer tests for raw-mode hiding and backlink target mapping.
  - Follow-up: removed the obsolete Inspector dock/button and routed backlink QA through the inline graph references section.

### EXO-ISSUE-051: Wikilink hover preview is missing

- Status: fixed locally
- Severity: medium
- Area: editor, backlinks, page preview
- Observed:
  - Hovering over a bracket item such as `[[goals]]` does not show a preview of the linked page content.
- Expected:
  - Hovering a rendered wikilink should show a small preview card/popover with a concise excerpt from the target page.
  - Preview should be fast, readable, and dismiss naturally on mouse leave/scroll.
  - Missing pages should either show no preview or a clear lightweight missing-page state.
- Investigation notes:
  - Reuse existing note read/cache paths where possible.
  - Avoid loading large files synchronously in the renderer on hover.
  - Coordinate styling and z-index with live wikilink search popups.
- QA coverage:
  - Hover over existing wikilink shows excerpt.
  - Hover over missing wikilink does not crash or block editing.
  - Popover positions correctly near viewport edges.
- Resolution:
  - Added a lightweight hover preview for rendered wikilinks using existing target resolution and note read paths.
  - Missing targets resolve to no preview instead of throwing into the editor surface; empty notes use a small fallback excerpt.
  - Added focused renderer tests for preview excerpt/fallback behavior.

### EXO-ISSUE-050: Agent rail shows dead harness launcher buttons for unavailable adapters

- Status: fixed locally
- Severity: medium
- Area: agent harnesses, terminal launcher rail, agent config editor
- Observed:
  - The terminal rail could expose agent launch buttons even when a harness executable was not installed or configured.
  - Open-source Exo needed first-class supported harness metadata for Codex, Claude Code, Pi, and Hermes without committing local product forks or machine-specific paths.
  - Custom local Pi builds should appear as configured Pi instances when provided by local configuration, while missing Hermes should be visible in configuration but not launchable.
- Expected:
  - The rail should only show enabled and launchable harnesses.
  - Supported but missing harnesses should remain visible in agent configuration/status UI with a clear Not found state.
  - Custom Pi builds should use generic local configuration fields and labels such as `custom Pi build`; no GA-specific adapter or source default should be committed.
- Resolution:
  - Added typed built-in harness metadata/status resolution for shell, Codex, Claude Code, Pi, and Hermes.
  - Added local executable/repo-path detection and generic custom Pi configuration support through environment/config-compatible fields.
  - Added a Harnesses tab to the Agent Config Editor and changed the terminal rail to render only launchable agent harnesses.
  - Added regression coverage for configured custom Pi, missing Hermes, and launcher filtering.

### EXO-ISSUE-049: Index settings show stale embeddings and misleading Apply copy

- Status: open; footer copy fixed locally
- Severity: medium
- Area: workspace settings, indexing UX, embeddings status
- Observed:
  - The bottom status bar can show `Embeddings needed` even after pressing `Sync now` from Workspace Settings > Index.
  - The Index tab shows recent sync activity and pending documents, but manual sync does not make it clear why embeddings remain pending or what action is still required.
  - Workspace Settings can show `Draft saved. Press Apply for workspace path or index changes.` while no Apply button is visible on the current tab/state.
- Expected:
  - Manual sync should either clear the `Embeddings needed` status when all required index work is complete, or explicitly say what remains pending and which control runs it.
  - If embeddings require `Build embeddings only` rather than `Sync now`, the UI should make that distinction obvious.
  - Settings footer copy should only mention Apply when an Apply button is visible and relevant; otherwise it should use tab-specific save/status copy.
- Investigation notes:
  - Check whether `Sync now` intentionally refreshes documents only while embeddings require the advanced `Build embeddings only` action.
  - Confirm whether `pending` in the index activity row refers to document refreshes, embeddings, or both.
  - Review `WorkspaceSettingsDialog` footer state because save status is global while Apply is conditional on `structuralDraftKey(settings) !== settings.appliedWorkspaceKey`.
- Partial resolution:
  - Footer save copy now only says to press Apply when structural workspace/index changes are pending and the Apply action is relevant.
  - Stale embeddings/status semantics remain open in this issue.

### EXO-ISSUE-048: Workspace Settings modal feels cramped after theme/settings updates

- Status: fixed locally
- Severity: low
- Area: settings, themes, modal layout
- Observed:
  - Workspace Settings still used a narrow modal width after the Appearance/theme controls grew.
  - The settings tab strip showed unused spacing after the Agents tab was removed.
  - The modal overlay blurred the workspace behind it, making the app feel visually smeared instead of using a standard quiet scrim.
- Expected:
  - Workspace Settings should have enough width for path-heavy controls and theme settings.
  - The tab strip should match the active four settings sections without an extra empty slot.
  - Settings should use a simple modal scrim without backdrop blur.
- Resolution:
  - Widened Workspace Settings to 720px within viewport constraints.
  - Updated the shared dialog tab grid to four columns, with the Agent Config Editor retaining its three-column override.
  - Removed backdrop blur from the shared dialog overlay and kept a plain theme-aware scrim.

### EXO-ISSUE-047: Workspace Settings still shows duplicate agent config surface

- Status: fixed locally
- Severity: low
- Area: settings, agent config editor, navigation
- Observed:
  - Agent config is now handled by the dedicated agent config icon/dialog, but Workspace Settings still exposes an `Agents` tab with a summary of the same feature.
  - This duplicates navigation and keeps agent instruction discovery coupled to Settings open.
- Expected:
  - Workspace Settings should only contain workspace/index/appearance/terminal settings.
  - Agent config discovery and errors should appear only in the dedicated Agent Config Editor.
- Resolution:
  - Removed the `Agents` tab from Workspace Settings and from the shared settings-section command type.
  - Stopped Workspace Settings from loading agent instruction config data on open.
  - Updated e2e coverage to assert Settings no longer has an Agents tab while the dedicated Agent Config Editor still reports partial discovery errors.

### EXO-ISSUE-046: MCP autostart and tool calls can stay pinned to stale command-server discovery

- Status: open
- Severity: high
- Area: MCP, command-server discovery, autostart, Exo-on-Exo reliability
- Observed:
  - NDE audit on 2026-06-20 verified MCP stdio initialize and `listTools` worked quickly and exposed only the intended narrow nine-tool surface.
  - The active runtime discovery file at `/Users/kenneth/Desktop/lab/.exo/server.json` pointed to dead pid `14108` on port `53794`.
  - Later on 2026-06-20, sandboxed `exo status` again reported pid `14108` / port `53794` as stale/dead, but escalated process inspection showed pid `14108` was alive and escalated `exo status` succeeded against `http://127.0.0.1:53794`.
  - This means sandboxed Exo-on-Exo diagnostics can falsely classify healthy command-server discovery as stale when sandbox policy blocks process or network checks.
  - Fresh 2026-06-20 user report: macOS showed another `unexpected quit` / `error launching app`; sandboxed `exo status` again reported stale discovery for pid `14108` / port `53794`, while unsandboxed `exo status` succeeded and process inspection showed the Exo main pid plus helper/renderer processes alive.
  - Follow-up 2026-06-20 report: user saw another unexpected quit after the above evidence was captured; quick DiagnosticReports listing did not show a newer obvious `Electron-*.ips` entry beyond the 08:42/08:47 reports, so the quit path may not always produce a fresh crash report.
  - Crash report review found the 08:42/08:47 reports were `com.github.Electron` dev/test Electron processes launched by `node` under `com.openai.codex`, not installed `Exo.app`; sandboxed stale pid reports should be treated as suspect unless confirmed outside the sandbox.
  - MCP app-backed calls such as `workspace_status` and `list_agents` returned `isError: true` stale-server text instead of useful structured runtime status.
  - With `EXO_MCP_AUTOSTART=1`, `EXO_MCP_CONNECT_TIMEOUT_MS=12000`, and `EXO_MCP_START_COMMAND=/Users/kenneth/Desktop/lab/projects/exo/bin/exo start`, MCP still waited against `http://127.0.0.1:53794` and timed out after about 12.1s.
  - During the 2026-06-20 terminal corruption restart pass, `/Users/kenneth/.local/bin/exo start` returned exit code 0 after a clean quit but did not leave an Exo process running or recreate `.exo/server.json`; directly opening `/Users/kenneth/Applications/Exo.app` did start Exo and published a healthy command server.
- Expected:
  - If MCP can initialize and list tools, the first app-backed call should either recover stale discovery through autostart or return a structured stale-runtime diagnostic.
  - Autostart should validate stale `server.json`, avoid staying pinned to a dead pid/port, and wait for a fresh reachable command server.
  - Diagnostics should distinguish sandbox, permission, and connectivity failures from a truly dead pid or stale discovery file, especially for MCP and CLI fallback paths.
  - Diagnostics should surface recent macOS crash reports and renderer/helper health separately from command-server stale-state checks.
  - New agents should not need to infer from plain text that the MCP control plane is unavailable.
- Investigation notes:
  - Review `ExoCommandClient.connect()` stale discovery handling: it reads `server.json`, checks reachability, starts Exo when autostart is enabled, then waits for a reachable client but appears to keep reporting the stale base URL when recovery fails.
  - Check whether `startExo()` succeeds but does not replace the stale discovery file, or whether the app start command is failing silently because it is detached with ignored stdio.
  - Audit the installed CLI `exo start` path separately from direct macOS `open Exo.app`; a zero exit code must mean the app process and command server became reachable, or the command should print an actionable launch failure.
  - Audit MCP error shaping so app-unreachable failures include runtime root, discovery file, stale pid/port, autostart state, timeout, and whether a start attempt was made.
  - Preserve `process.kill(pid, 0)` error details in CLI/MCP discovery checks so permission/sandbox failures are not collapsed into "pid is dead".
- QA coverage:
  - MCP unit/integration fixture with stale `server.json`, unreachable port, and autostart enabled.
  - Sandboxed diagnostic fixture where pid/port checks are blocked but unsandboxed checks would reach a healthy command server.
  - MCP fixture without autostart that verifies structured stale-runtime error output.
  - End-to-end smoke for configured Codex/Claude MCP startup after stale discovery, asserting `workspace_status` either succeeds or returns actionable structured diagnostics.

### EXO-ISSUE-045: Restart can leave stale command-server discovery with visible broken terminal UI

- Status: implemented in `exo/issue-045-restart-lifecycle`; pending review and full Electron restart QA
- Severity: critical
- Area: terminal lifecycle, control plane, command-server discovery, macOS app lifecycle
- Observed:
  - User report from 2026-06-20: after the agent said Exo had restarted, the Exo UI still showed old terminal tabs.
  - Typing in an existing Claude tab produced malformed prompt/input rendering instead of a normal reattached terminal input surface.
  - A subsequent `exo status` returned stale command server discovery: recorded pid `6377` was no longer running, runtime root `/Users/kenneth/Desktop/lab/.exo`, discovery file `/Users/kenneth/Desktop/lab/.exo/server.json`, cause `fetch failed`.
  - Fresh 2026-06-20 report: macOS showed another `unexpected quit` / `error launching app`, with crash reports at `/Users/kenneth/Library/Logs/DiagnosticReports/Electron-2026-06-20-084716.ips`, `/Users/kenneth/Library/Logs/DiagnosticReports/Electron-2026-06-20-084226.000.ips`, and `/Users/kenneth/Library/Logs/DiagnosticReports/Electron-2026-06-20-084226.ips`.
  - In that report, unsandboxed `exo status` succeeded and process inspection showed Exo main pid `14108` plus helper/renderer processes alive, so the visible failure may be a renderer/helper crash while the main/control plane remains reachable.
  - Follow-up 2026-06-20 report: another unexpected quit occurred, but a quick crash-report listing only showed the existing 08:42/08:47 reports. Exo should preserve enough app-level lifecycle logging to diagnose quits even when macOS does not produce a new report.
  - Crash report review found the 08:42/08:47 reports have `procName: Electron`, `bundleID: com.github.Electron`, `parentProc: node`, `responsibleProc: Codex`, and fault in main-process AppKit registration before renderer/helper involvement. No matching installed `Exo.app` crash report was found in that set.
- Expected:
  - App restart should leave a healthy command server or a clear unavailable state with stale discovery removed or quarantined.
  - Stale command-server discovery should not coexist with a visible-but-broken UI that appears attached to usable terminal sessions.
  - Reattached terminal input after restart should render normally in Claude/Codex/shell tabs, with prompt and typed input preserved or cleanly recovered.
  - App diagnostics should report recent Electron/macOS crash reports and renderer/helper process health distinctly from command-server discovery freshness.
- Investigation notes:
  - Audit macOS app/menu-bar lifecycle versus terminal tmux persistence: the menu-bar app, main/control-plane process, renderer windows, tmux sessions, and terminal tabs may not share the same restart boundary.
  - Review command server discovery lifecycle: creation, pid validation, fetch failure handling, stale `server.json` cleanup, and whether `exo status` can report a dead process while the UI remains visible.
  - The renderer may survive, be restored, or show stale UI after main/control-plane process failure; terminal tabs should detect backend/control-plane health loss and enter an explicit reconnect/degraded state instead of staying apparently live.
  - Reattach/input rendering may need a health recovery path that refreshes terminal geometry, tmux pane attachment, xterm state, and command-server connectivity before accepting user input.
  - Separate installed-app lifecycle diagnostics from dev/test Electron launch diagnostics; the current evidence points to dev Electron launch crashes plus sandbox false-stale reports, not a confirmed installed-app main-process crash.
- QA coverage:
  - Desktop restart/relaunch coverage that kills or replaces the command server, then asserts `exo status` reports a healthy new server or an explicit unavailable state with no stale pid.
  - E2E coverage for renderer-visible terminal tabs after main/control-plane restart: tabs should either reconnect cleanly or show an actionable recovery state.
  - Reattach coverage for Claude/Codex tabs after restart, asserting typed input and prompt rendering are not malformed.
  - Discovery-file regression coverage for stale pid, missing pid, dead pid, and fetch-failed server cases.
- Resolution notes:
  - CLI discovery now validates the recorded command-server pid with structured liveness diagnostics: only `ESRCH` is treated as definitely dead, while `EPERM` and other failures are treated as blocked/unknown because sandboxed probes can falsely reject healthy Exo processes.
  - `server.json` is quarantined to `server.json.stale-<timestamp>` only when the pid is definitely dead before `/status`, or after `/status` fails and a second process check returns definitely dead evidence.
  - Blocked/unknown process checks preserve `server.json` and return a distinct `server-liveness-unknown` diagnostic with the process-check code/message instead of deleting discovery.
  - Terminal panes now disable xterm input and show an explicit unavailable overlay when the session is unhealthy or exited, while unhealthy running sessions expose reconnect from the header/overlay.
  - Terminal view health transitions force a fit/resize refresh, so reattached bridges get current geometry before the user can resume typing.
  - Added focused CLI regression coverage for quarantining definitely stale `server.json` and preserving discovery on permission/sandbox-style process-check failures, plus renderer predicate coverage for blocking unhealthy terminal input while allowing reconnect.
  - Focused CLI app-client tests, renderer terminal predicate tests, and CLI/desktop package typechecks pass in this worktree; full Electron restart QA remains manual.

### EXO-ISSUE-044: Editor header chrome is too tall and daily notes repeat the title as an H1

- Status: fixed in local branch
- Severity: medium
- Area: editor chrome, document rendering, daily notes
- Observed:
  - User screenshot report from 2026-06-20 shows the editor header/action row containing properties, title, saved state, Save, Raw, and related actions feels too tall.
  - Daily note documents also render a large H1 that matches the filename/title already shown in the properties/header area.
  - The duplicate title consumes vertical space and differs from Obsidian's daily-note behavior, where the app chrome shows the note identity without inserting an extra document title.
- Expected:
  - The editor header/action row should be thinner and quieter without shrinking icon hit targets or making actions harder to scan.
  - Daily notes should not render an additional large title/H1 solely because it matches the filename or header title.
  - If a document contains an explicit user-authored H1, Exo should preserve it; only app-generated duplicate title rendering should be removed.
- Investigation notes:
  - The duplicate daily-note H1 came from the daily-note creation seed writing `# YYYY-MM-DD` into the Markdown body.
  - Existing generated daily notes can already contain that duplicate body line, so live-preview rendering suppresses only the first line when it is exactly `# YYYY-MM-DD` and the file title is a daily-note date.
  - Raw Markdown mode still exposes the body line for cleanup/editing, and non-duplicate explicit H1s in daily and normal notes continue to render.
- Resolution:
  - Reduced the editor header minimum height and visual weight through tighter spacing/title chrome while keeping icon action hit targets at 34px.
  - New daily notes are created empty instead of seeded with a duplicate H1.
  - Live preview hides legacy generated duplicate daily-note title lines while preserving explicit authored H1s that do not duplicate the daily filename.
- QA coverage:
  - Renderer unit coverage verifies the generated-title suppression predicate is exact and daily-title-scoped.
  - Playwright coverage asserts generated daily-note duplicate H1s are hidden, explicit daily/normal H1s render, and properties/save/status/raw actions remain visible.

### EXO-ISSUE-043: Explorer file and folder rows lack enough visual differentiation

- Status: fixed in local branch
- Severity: medium
- Area: project explorer, navigation hierarchy, visual design
- Observed:
  - User screenshot report from 2026-06-20 shows files and folders in the explorer are not visually distinct enough.
  - Folder hierarchy, file leaves, expanded/collapsed state, and document type are harder to scan than expected in daily navigation.
- Expected:
  - Folder rows should be immediately distinguishable from file rows through iconography, weight, spacing, disclosure state, or other restrained visual treatment.
  - File rows should remain compact and readable while preserving clear selected, hover, changed, and focused states.
  - The explorer should support fast scanning of nested projects without relying only on indentation.
- Investigation notes:
  - Review current row components for shared styling that makes files and folders read identically.
  - Check interaction states together: selected folder, selected file, changed file, collapsed folder with changed descendants, hover, keyboard focus.
  - Keep any new treatment consistent with the inline changed-state design from EXO-ISSUE-042.
- QA coverage:
  - Explorer visual regression coverage for nested folders, files, expanded/collapsed folders, and selected rows.
  - Interaction coverage that keyboard focus and selection remain visible after styling changes.
- Resolution notes:
  - Added restrained file/folder icons, folder disclosure treatment, heavier folder labels, lighter file labels, and explicit focus-visible outlines for explorer rows.
  - Kept dirty-state styling compatible with the inline changed-state model from EXO-ISSUE-042.

### EXO-ISSUE-042: Projects sidebar duplicates changed files in a separate Changes section

- Status: fixed in local branch
- Severity: medium
- Area: projects sidebar, file explorer, changed-file indicators
- Observed:
  - User screenshot report from 2026-06-20 shows a separate `CHANGES` section in the Projects sidebar that duplicates entries already present in the file list.
  - The duplicated list reads as a second navigation model instead of a state overlay on the actual project tree.
- Expected:
  - Changed state should appear inline on the actual file rows in the explorer.
  - If a changed file is inside a collapsed folder, the folder row should surface that descendant changed state.
  - The sidebar should avoid a separate duplicate changed-file section unless a future design explicitly adds a different workflow such as review/filter mode.
- Investigation notes:
  - Identify the source of the current `CHANGES` section and whether it is rendered from git/workspace dirty state or editor unsaved state.
  - Decide the changed-state model for files, folders with direct changes, and folders with changed descendants.
  - Preserve accessibility semantics so changed state is exposed beyond color alone.
- QA coverage:
  - Explorer coverage for changed file badges shown inline on file rows.
  - Coverage for collapsed folders surfacing descendant changed state and clearing when all descendants are clean.
  - Regression coverage that removing the duplicate `CHANGES` section does not remove dirty-state visibility.
- Resolution notes:
  - Removed the separate Projects `Changes` section from the sidebar.
  - Added inline changed-state derivation for project tree rows: changed files show a status badge and accessible changed/line text; ancestor folders show a descendant changed count.
  - Updated focused unit and Playwright coverage for inline file state and collapsed-folder descendant state.

### EXO-ISSUE-041: Terminal panes can blank, hydrate at stale width, or leak generated OSC responses

- Status: implemented locally; pending real-app QA
- Severity: critical
- Area: terminal renderer, xterm hydration, pane moves, refresh/reload recovery
- Observed:
  - After Cmd+Shift+R, terminal panes can render blank even though input still reaches the underlying session.
  - Switching tabs can make a blank terminal group repaint, but single-tab terminal groups have no tab switch recovery path.
  - Moving terminal tabs between panes can leave a half-blank terminal surface or hydrate scrollback at an older/narrower width.
  - Random text such as `]10;rgb:5858/6e6e/7575\]11;rgb:fdfd/f6f6/e3e3\` can appear in an agent prompt after tab/pane swapping.
  - 2026-06-20 QA after the first hydration fix: after app restart, a terminal can show blank while the underlying Claude/Codex/tmux session is still active.
  - In that state the user can type and press Enter and the input reaches the active session, but prior history is not visible until new output/input causes a partial repaint.
  - The restored terminal should not depend on tab switching, hard refresh, or sending new input to recover visible history.
  - 2026-06-20 QA after `a2ea42f`: newly opened Claude Code terminals can render heavy replacement-character corruption (`���`) across Claude's header, prompt/status separators, and shell prompt decorations.
  - The corruption can appear immediately when starting Claude Code from Exo, while the same terminal often recovers after a full Exo restart.
  - A plain new shell prompt can also show odd prompt glyph/tofu artifacts before Claude is launched, so this may involve tmux control-mode byte decoding, terminal font fallback, prompt/theme glyph handling, or a bad initial geometry/charset replay.
- Expected:
  - Visible active terminal panes should hydrate from the backend tail after reload or remount without requiring input or tab switching.
  - Hydration should happen after xterm has a measured viewport so replayed history fits the current pane.
  - xterm-generated device/color responses should never be forwarded to shell or agent processes as user input.
  - Claude Code and shell prompt Unicode/box drawing/status glyphs should render without replacement-character corruption in fresh terminals.
- Investigation notes:
  - The renderer used `terminalRegistry` registration as a proxy for hydration completion; after reload a blank xterm registered before any tail read and then blocked hydration.
  - `TerminalView` consumed empty version `0` snapshots as completed hydration even when no read had occurred yet.
  - Hydration could replay before the new pane geometry was fitted after pane moves.
  - The input filter covered CSI device responses but not OSC color reports for foreground/background/cursor/indexed colors.
- Resolution:
  - Terminal hydration state is now tracked separately from the imperative xterm registry.
  - Visible active `TerminalDock` instances request hydration on mount/active-session change, deduped by pending/hydrated state.
  - Empty initial snapshots no longer mark version `0` as consumed.
  - Hydration now fits the xterm viewport before replaying the snapshot.
  - Terminal-generated OSC 10/11/12 and indexed color responses are filtered before reaching the terminal process.
  - Tmux control-mode output now decodes octal-escaped bytes through a stateful UTF-8 decoder per pane, so split box-drawing glyphs and emoji are not finalized as replacement characters.
  - Renderer live terminal writes now carry a pending high surrogate across data events before chunking writes into xterm, so split Unicode output is not corrupted at the browser/xterm boundary.
- QA coverage:
  - Unit coverage for CSI and OSC terminal-generated response filtering.
  - Relaunch E2E now asserts prior terminal output is visible before sending new input.
  - Added deterministic tmux control-mode regressions for split escaped UTF-8 bytes, split stdout chunks, box-drawing glyphs, and emoji.
  - Added renderer chunking regressions for surrogate pairs split across terminal data events.
  - Focused Electron terminal rendering e2e passes for emoji-heavy output without replacement glyphs; manual Claude Code startup QA remains required.

### EXO-ISSUE-040: Agent-facing Exo orientation requires sandbox escalation and raw repo search

- Status: fixed in local branch
- Severity: high
- Area: CLI/MCP control plane, sandbox compatibility, Exo-on-Exo orientation
- Observed:
  - Multiple Codex sessions tried to follow the lab protocol by using Exo workspace/status/search surfaces before raw filesystem reads.
  - `./bin/exo --help`, `./bin/exo status`, and `./bin/exo search ...` can fail inside the sandbox with `listen EPERM` on a `tsx` IPC pipe under `/var/folders/...`.
  - Re-running with escalation works, but read-only orientation should not require broad escalation.
  - In a terminal review, `exo search terminal tmux transcript reconnect agent readiness` returned no useful context while raw `rg` found the relevant implementation and docs quickly.
- Expected:
  - Read-only Exo orientation should work in sandboxed agent sessions without GUI assumptions or tsx IPC startup failures.
  - Exo should clearly expose whether the active session has MCP available and whether CLI fallback is degraded.
  - If Exo search is degraded, the user/agent should see why and what fallback is being used.
- Source:
  - `/Users/kenneth/Desktop/lab/notes/shoshin-codex/exo-issues.md`, 2026-06-20, 2026-06-14, 2026-06-09, 2026-06-06.
- Resolution:
  - `bin/exo` now prefers compiled CLI JavaScript after `@exo/cli` build and only uses `tsx` when the compiled CLI is missing or `EXO_CLI_USE_TSX=1` is set.
  - CLI live-app discovery now reports distinct runtime-root, missing `server.json`, invalid `server.json`, stale pid, and unreachable command-server diagnostics with runtime root and discovery path.
  - Generated runtime instructions now tell agents to prefer Exo MCP tools when available and use the `exo` CLI as fallback/operator/debug surface.
  - `exo status` attaches local control-plane discovery metadata when the app is reachable.
  - Residual: compiled `exo search` can still visibly degrade to filesystem fallback when QMD is unavailable from the compiled package context; retrieval quality remains tracked under EXO-ISSUE-039.

### EXO-ISSUE-039: Exo search/read fallback is too low-recall for agent orientation

- Status: fixed in local branch
- Severity: high
- Area: search, note read, QMD fallback, lexical retrieval
- Observed:
  - QMD/hybrid search can degrade because native modules are built against a different Node ABI or because `vec0` is unavailable.
  - When degraded, lexical/filesystem fallback has missed exact or obvious note context including `Ashby`, `Sigmund Lab`, CEO-Bench terms, and broad research-orientation queries.
  - `exo notes read garden/research/artifacts/sigmund.md` failed when the absolute path worked, so relative note-root path resolution is brittle.
- Expected:
  - Exact title/body lexical matching over configured note roots should be reliable even when semantic/hybrid search is unavailable.
  - Degraded search should be visibly degraded but still useful enough for project orientation.
  - `exo notes read` should resolve paths relative to configured note roots before failing.
- Source:
  - `/Users/kenneth/Desktop/lab/notes/shoshin-codex/exo-issues.md`, 2026-06-19, 2026-06-09, 2026-06-07, 2026-05-31.
- Resolution:
  - Degraded filesystem search now scans configured note roots for Markdown title, first heading, body, tags, and path matches with bounded traversal and snippets.
  - QMD fallback warnings now distinguish native ABI mismatch and missing `vec0`/vector support from generic search failure.
  - `exo notes read <path>` resolves paths relative to configured note roots while preserving outside-root rejection.
  - Residual: QMD health/capability classification is still heuristic string matching and should become a structured provider diagnostic before a public release.

### EXO-ISSUE-038: Exo-managed Claude/Codex lifecycle can exit immediately and mix stale transcripts

- Status: fixed in local branch
- Severity: critical
- Area: agent lifecycle, terminal transcripts, Exo-on-Exo orchestration
- Observed:
  - During Exo-on-Exo smoke, existing Claude tabs never opened into usable sessions.
  - Creating a Codex agent returned a running/starting session, but `agents list` immediately reported it exited with code 1.
  - `agents read term-3 --raw` included old May Codex output before the fresh June transcript header, implying terminal ids/transcript files can be reused or read in a way that mixes historical and active sessions.
- Expected:
  - Creating Claude/Codex agents should reach ready or produce a clear launch failure with actionable diagnostics.
  - Agent transcripts and reads must be scoped to the current terminal session and never present stale output as active context.
  - Exo-on-Exo should support: create agent, wait ready, send message, read reply, interrupt/terminate, and inspect transcript without ambiguity.
- Source:
  - `/Users/kenneth/Desktop/lab/notes/shoshin-codex/exo-issues.md`, 2026-06-14.
- Resolution:
  - Fast-exiting Claude/Codex sessions remain visible as exited sessions with exit code, transcript path, cwd, command, readiness, and health details until explicit cleanup.
  - Terminal display ids now advance across app restarts via persisted terminal registry state instead of being reused after explicit close.
  - Tmux capture used for live-tail/UI hydration is no longer appended to durable transcripts during restore.
  - `exo agents read <id>` now defaults to a bounded transcript tail; `--full` is required for full transcript output.
  - Residual: provider-specific Claude/Codex readiness state machines are still a future hardening step.

### EXO-ISSUE-037: Terminal parity review found remaining VS Code/full-terminal gaps

- Status: partially fixed; follow-ups open
- Severity: high
- Area: terminal runtime, renderer, tmux attach bridge, QA
- Observed:
  - Multi-agent terminal review found several places where Exo still falls short of a normal terminal experience:
    - alternate-screen/TUI support had been intentionally disabled in tmux/session setup and renderer mount behavior;
    - first measured xterm size could lag behind the backend pty/tmux pane, causing startup or tab-switch geometry drift;
    - renderer hydration is still a bounded text tail, not a real terminal-state replay;
    - MCP `read_agent` has a hardcoded `200000` character maximum;
    - terminal quality e2e coverage is not yet a default CI gate.
- Expected:
  - Exo terminals should preserve normal terminal capabilities unless there is a clear product reason and user-visible setting.
  - TUI/alternate-screen tools, agent TUIs, scrollback, resize, tab switching, copy/paste, and long output should feel like a normal terminal in VS Code.
- Resolution so far:
  - Removed the artificial alternate-screen disable path from tmux session setup and renderer mount.
  - Stopped stripping alternate-screen escape sequences from terminal output while still stripping embedded tmux mouse tracking.
  - Replaced the renderer wheel-input guard with explicit viewport scrolling so mouse-wheel scrollback does not become process input and real Up/PageUp keypresses are not suppressed.
  - Sent the first measured terminal resize immediately so the backend does not keep the startup fallback geometry.
  - Routed `exo terminals send` through the semantic terminal-message path; `exo terminals write` remains the raw/debug path.
  - Writes to missing or exited sessions now report `ok: false` instead of pretending delivery succeeded.
  - Added bounded tmux `capture-pane` reads to terminal tail hydration so CLI/MCP/renderer reads can see history that the attach stream missed.
  - Replaced the nested `tmux attach-session` pty bridge with `tmux -C` control mode so Exo receives pane output directly instead of rendering a full tmux client viewport inside xterm.
  - Stored pane ids in terminal session state so restored sessions reattach to the correct tmux pane.
  - Removed Exo wheel interception and let xterm own visible scrollback, while preserving bounded tmux history reads for hydration/API tails.
  - Added a short raw-input coalescing window plus whitespace-safe tmux buffer paste for printable input so rapid typing and semantic agent messages preserve spaces/newlines.
- QA:
  - `pnpm --filter @exo/desktop exec vitest run src/main/terminal-manager.test.ts src/main/terminal-tmux.test.ts`
  - `pnpm --filter @exo/desktop typecheck`
  - `pnpm --filter @exo/desktop build`
  - `pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts -g "keeps large terminal bursts available above the visible viewport|keeps app terminal tail above the legacy 12k cap|accepts terminal keyboard input"`
- Remaining:
  - Reconcile and persist stale tmux session state during list/startup, not only diagnostics/reconnect.
  - Replace stale terminal history naming so settings map directly to live scrollback/transcript behavior.
  - Make MCP agent read limits configurable or clearly tied to workspace terminal settings.
  - Promote a deterministic terminal-quality e2e subset into CI.

### EXO-ISSUE-036: Tmux-backed terminals expose nested tmux viewport instead of normal app scrollback

- Status: partially fixed; needs real Claude resume QA and capture-pane hydration
- Severity: high
- Area: terminal runtime, tmux attach bridge, scrollback
- Observed:
  - Opening Claude through an Exo terminal, running `/resume`, and selecting a long existing conversation showed only a short pane-sized slice of the conversation.
  - The visible terminal included tmux status-line UI, making the embedded terminal behave like a nested tmux client rather than a normal terminal pane.
  - The configured Exo live scrollback was `1000000`, and tmux `history-limit` was also `1000000`, so the symptom was not caused by the numeric scrollback setting.
- Expected:
  - Exo can use tmux for persistence, but the visible terminal should behave like an Exo-owned terminal pane.
  - New sessions should not show nested tmux chrome or trap agent/TUI output outside normal scrollback.
- Resolution:
  - New/restored tmux sessions now apply Exo terminal pane policy: configured `history-limit`, `status off`, and `mouse off`.
  - Exo no longer disables alternate screen because that breaks normal terminal/TUI capability.
  - Added regression coverage that Exo applies the embedded tmux pane options when creating sessions.
  - If real Claude resume still does not expose old conversation history, the next fix is tmux `capture-pane` hydration or a control-mode bridge instead of relying only on live attach output.

### EXO-ISSUE-035: Active terminal viewport can replay stale scrollback over current agent output

- Status: fixed; watch in daily Claude/Codex use
- Severity: high
- Area: terminal renderer, xterm hydration, agent scrollback
- Observed:
  - In a Claude Code terminal, scrolling near the current bottom could show older conversation output pasted across the upper part of the active viewport.
  - The active conversation continued below, so the process was still alive but the rendered terminal state was corrupt/confusing.
- Expected:
  - Active terminals should receive live append events only.
  - Reading bounded terminal tails should be used for initial mount/restore, not for rehydrating and resetting an already rendered xterm instance.
- Resolution:
  - Removed the active-agent buffer refresh effect that could call `terminals.read()` and force xterm reset/replay while the terminal was already live.
  - Made renderer hydration a no-op when a terminal instance is already registered.
  - Added Electron/Playwright coverage that clicking an already rendered active terminal tab does not call `terminals.read()`.

### EXO-ISSUE-034: Live-preview bullet continuation traps cursor at stale indentation

- Status: fixed
- Severity: medium
- Area: markdown editor, live preview list editing
- Observed:
  - In live preview, pressing Enter after a bullet correctly creates the next bullet, but pressing Enter again can remove the bullet while leaving the cursor visually trapped at the previous indentation.
  - Blank continuation lines can keep list guide styling even after the user intends to exit the list.
  - The user cannot place the cursor back at the left edge where the surrounding parent text begins.
- Expected:
  - A blank whitespace-only list continuation line should not keep list-continuation guide styling.
  - Pressing Enter, Shift-Tab, or the outdent shortcut on that blank continuation line should clear the indentation and move the cursor to column zero.
- Resolution:
  - Added a high-priority CodeMirror keymap for blank list-continuation outdent behavior.
  - Stopped assigning list-continuation metadata to whitespace-only blank lines.
  - Added focused Electron/Playwright coverage for the trapped-indentation case.

### EXO-ISSUE-033: Exo MCP needs optional HTTP/SSE transport for remote-only MCP hosts

- Status: fixed; needs Glean-host QA
- Severity: medium
- Area: MCP server integration, external MCP hosts, Glean Assistant compatibility
- Observed:
  - Exo MCP previously exposed a stdio transport only.
  - Claude Code and other local MCP hosts can use stdio, but Glean Assistant as an MCP host requires Remote HTTP / SSE and does not support local stdio servers directly.
  - Configuring Exo's stdio MCP server in Glean can fail with `MCP error -32000: Connection closed`.
- Expected:
  - Stdio remains the default for local CLI-backed hosts such as Claude Code and Codex.
  - Exo should offer an explicit HTTP/SSE or Streamable HTTP mode that can serve the same narrow MCP tool plane over a local port.
  - The network transport must make exposure boundaries clear: default localhost binding, documented port/env configuration, and authentication or proxy guidance before non-localhost use.
- Scope:
  - Reuse the existing MCP tool registration and `ExoCommandClient`; do not fork the tool surface.
  - Add launcher/config docs for remote-only hosts, including Glean.
  - Add transport smoke tests that list the same 9 tools over stdio and HTTP/SSE.
- Resolution:
  - Added a shared MCP server factory so stdio and HTTP use the same 9-tool registration.
  - Added an opt-in Streamable HTTP launcher: `exo-mcp --transport http --host 127.0.0.1 --port 3333`.
  - Kept stdio as the default local transport and documented localhost/proxy guidance.
  - Added stdio and HTTP SDK handshake coverage that verifies the same 9 tools.

### EXO-ISSUE-031: Packaged app can silently exit on first launch after local install

- Status: open
- Severity: high
- Area: macOS packaging, first launch diagnostics, unsigned app UX
- Observed:
  - Fresh setup field report from 2026-06-02 found that a locally installed unsigned `Exo.app` briefly showed the menu bar icon but no window, then exited silently.
  - Running from source worked afterward, so this may involve packaged app initialization, unsigned app/Gatekeeper behavior, first-run settings, or missing diagnostics.
- Expected:
  - A packaged first launch should either open onboarding or show an actionable error.
  - Silent exit should leave an obvious diagnostic trail and recovery instruction.
- Next:
  - Reproduce from a clean user-data directory with `~/Applications/Exo.app`.
  - Add a first-launch diagnostics surface or clear log path in installer output.
  - Verify menu bar resident startup and onboarding window creation for unsigned local installs.

### EXO-ISSUE-030: Direct pty terminals can break after macOS sleep and need tmux-backed persistence

- Status: open
- Severity: critical
- Area: terminal runtime, macOS sleep/wake, process persistence, agent session reliability
- Observed:
  - Fresh setup field report from 2026-06-02 found Exo terminals becoming non-functional after macOS sleep/wake.
  - The user saw a security/violation-style error on resume and had to restart terminals.
  - This affects long-running Claude/Codex agent sessions and builds, where losing the live process after laptop sleep is a dealbreaker.
  - Transcript-based recovery is not equivalent because it preserves history but not the running build, CLI process, or agent session.
- Current context:
  - Exo intentionally simplified core terminals to direct `node-pty` on 2026-05-28 to remove stale mixed tmux/direct code.
  - Real-world sleep/wake behavior is now evidence that direct pty should not remain the durable terminal runtime.
  - The runtime decision is now tmux-backed core terminals with Exo's tmux control-mode bridge; see `docs/terminal-runtime-decision.md`.
- Next:
  - Implement `docs/terminal-refactor-plan.md`.
  - Add deterministic fake-agent terminal tests; do not use live Claude/Codex inference in automated QA.
  - Validate against `docs/terminal-quality-standard.md`, including latency, corruption, scrollback, reattach, sleep/wake, and recovery behavior.
- Progress:
  - Added tmux runtime primitives, structured missing-tmux errors, and Exo-owned tmux session naming.
  - Terminal creation now launches the durable command inside tmux and uses tmux control mode to attach Exo to the tmux session.
  - Terminal kill now explicitly terminates the tmux session.
  - Added `.exo/terminal-sessions.json` persistence and startup reattach for live tmux panes.
  - Added deterministic fake-agent Electron QA, p50/p90 shell input latency measurement, and app relaunch reattach coverage without live Claude/Codex inference.
  - Diagnostics now expose tmux runtime, tmux session name, and attach bridge status.
  - Diagnostics now distinguish tmux pane alive/dead/missing state from the Exo attach bridge state.
  - Added terminal reconnect APIs across IPC, command-server, and CLI.
  - Added resume-triggered reattachment for running terminals whose tmux panes are still alive.
  - Added a terminal-header Reconnect action for unhealthy active terminals.
  - Still open for manual macOS sleep/wake installed-app QA, broader rendering/scrollback stress, and final dogfooding with real Claude/Codex sessions.

### EXO-ISSUE-029: `pnpm dev` can spawn a stray default Electron app window

- Status: open
- Severity: high
- Area: dev runtime, Electron/Vite harness
- Observed:
  - Fresh setup field report from 2026-06-02 saw two Electron instances for `pnpm dev`: the Exo app and a default `default_app.asar` Electron welcome window.
  - The user sees two Electron dock icons and must distinguish the real Exo app from the stray one.
- Expected:
  - `pnpm dev` should launch exactly one Exo Electron app process.
- Next:
  - Reproduce from a clean shell with no installed Exo instance running.
  - Inspect `electron-vite dev`, package `main`, and any script/env interaction that can invoke Electron without an app path.
  - Add a dev-harness smoke check that fails if a default Electron app process is spawned.
- Local check:
  - On 2026-06-11, `pnpm dev:qa` on the main development machine launched one Electron app process plus normal helper processes; no `default_app.asar` process was observed.

### EXO-ISSUE-028: First-run onboarding still reads as developer/setup flow instead of open-notes flow

- Status: fixed; watch during fresh setup QA
- Severity: high
- Area: onboarding UX, first-run workspace setup
- Observed:
  - Fresh setup field report from 2026-06-02 found the first-run flow confusing for an end user who just wants to open an existing notes folder.
  - The user expected "install app, point at notes folder"; Exo labels implied "create new vault/workspace."
  - After notes folder selection, the app could appear blank or give no obvious next step.
  - Default terminal cwd could land in an auto-detected nested project folder rather than the workspace area above notes.
  - Workspace settings copy said "Saved automatically" while workspace path/index changes still required Apply.
- Fix in progress:
  - README now separates daily/user runtime from developer runtime.
  - First-run labels now use "Add notes folder", "Choose notes folder", and "Open workspace" instead of "New/Create workspace" for the existing-folder path.
  - Default terminal cwd for a selected notes folder now defaults to the notes folder's parent unless the user explicitly chooses another terminal folder.
  - Settings copy now distinguishes immediately saved preferences from workspace path/index changes that require Apply.
- Next:
  - Watch a true fresh laptop setup for any remaining blank shell or explorer sizing issue after selecting an existing notes folder.
- Verified:
  - Focused Electron e2e covers selecting an existing notes folder, deriving default terminal cwd from the notes folder parent, completing setup, and landing in the app shell.
  - Focused Electron e2e covers first-run setup visibility and workspace settings opening.

### EXO-ISSUE-027: Fresh setup install blockers from broad dependency override and system Applications default

- Status: fixed; needs fresh-clone confirmation
- Severity: high
- Area: setup, dependencies, macOS packaging
- Observed:
  - Fresh setup field report from 2026-06-02 found Socket Firewall blocking `fast-uri@3.1.0` via `@tobilu/qmd -> @modelcontextprotocol/sdk -> ajv`.
  - The existing broad `picomatch: 4.0.4` override forced all consumers to picomatch 4.x and broke electron-builder packaging for `micromatch` consumers expecting picomatch 2.x.
  - `scripts/install-mac-app` defaulted to `/Applications`, causing permission denied for non-admin user installs.
- Fixed:
  - Replaced the broad picomatch override with a targeted `fast-uri: 3.1.2` override.
  - Re-resolved the lockfile so picomatch 2.3.2 and 4.0.4 coexist where required.
  - `scripts/install-mac-app` now defaults to `~/Applications`, keeps `/Applications` behind `--system-app-dir`, and prints a clearer permission hint when system install copy fails.
  - README now documents the user-runtime versus developer-runtime setup paths.
- Verified:
  - `pnpm install` succeeds locally with pnpm 11.2.2.
  - `pnpm why fast-uri picomatch` shows `fast-uri@3.1.2`, `picomatch@2.3.2`, and `picomatch@4.0.4`.
  - `pnpm install --frozen-lockfile --offline` succeeds locally.
  - `pnpm pack:mac` succeeds and passes electron-builder's dependency traversal.
  - `./scripts/install-mac-app --skip-build --dry-run` targets `~/Applications/Exo.app`.
  - `./scripts/install-mac-app --skip-build` installs the packaged app to `~/Applications/Exo.app` without elevated permissions.
- Next:
  - Confirm `pnpm install --frozen-lockfile` and actual `./scripts/install-mac-app` on a clean clone.

### EXO-ISSUE-026: Installed app renderer can run away while the workspace is idle

- Status: mitigated; watch during installed-app QA
- Severity: critical
- Area: installed app, renderer performance, note/editor/layout runtime, renderer recovery
- Observed:
  - On 2026-05-31, the installed `/Applications/Exo.app` became extremely laggy during normal daily use.
  - Renderer PID `57653` was pegged near 99% CPU with roughly 5 GB RSS after about 11 hours of uptime.
  - The main process and command server were responsive: `exo status` returned quickly and `exo terminals diagnostics` showed only one idle shell terminal with a tiny live buffer.
  - The active workspace had `tasks.md`, `2026-05-31.md`, and `field-note-01.md` open, with `field-note-01.md` active; none of those files were large.
  - The UI status area showed index work pending (`Embeddings needed`), but no separate QMD/index process was hot.
  - A macOS renderer sample was captured at `/tmp/exo-renderer-lag.sample.txt`; UI screenshot captured at `/tmp/exo-lag-ui.png`.
- Recovery finding:
  - Killing the runaway renderer relieved CPU pressure, but the resident main process did not recreate a usable window when asked to show Exo.
  - A full app restart restored the UI, which means renderer recovery needs to handle killed or unresponsive renderer processes more aggressively.
- Suspected:
  - Renderer-side loop or leak in note/editor rendering, layout persistence, workspace/index status polling, or file-watch refresh paths.
  - Not caused by terminal scrollback or pty streaming in the observed session.
- Next:
  - Continue daily-use QA from the same persisted layout/open documents state and watch renderer CPU/RSS after long idle sessions.
  - Add deeper renderer performance diagnostics/watchdog coverage if the runaway recurs after watcher filtering.
  - Add app QA that idles the installed/dev app with the same workspace state and verifies renderer CPU/memory stay bounded.
- Mitigation:
  - Renderer recovery now reloads after Electron reports `killed`, `abnormal-exit`, or `launch-failed` renderer exits, not only `crashed`/`oom`.
  - Workspace watcher events now filter noisy generated/runtime/vendor folders such as `.git`, `.exo`, `.exo-dev`, `node_modules`, `dist`, `build`, and `coverage` before notifying the renderer.

### EXO-ISSUE-025: GitHub Actions JavaScript actions emit Node 20 deprecation warning

- Status: open
- Severity: low
- Area: CI, GitHub Actions, harness readiness
- Observed:
  - The push CI for `270c5ca` passed on 2026-05-31, but GitHub emitted a warning that `actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4` are running on Node.js 20.
  - The warning says GitHub Actions will force JavaScript actions to Node 24 by default starting 2026-06-16 and remove Node 20 from the runner on 2026-09-16.
- Expected:
  - CI should stay ahead of runner/runtime deprecations so the Exo harness does not break unexpectedly.
- Next:
  - Check whether newer action versions or `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` should be used in `.github/workflows/ci.yml` and `.github/workflows/package-macos.yml`.

### EXO-ISSUE-024: Installed Exo menu bar icon is not visible enough for daily resident use

- Status: fixed locally
- Severity: high
- Area: macOS packaging, resident runtime, menu bar control surface, Exo-on-Exo workflow
- Observed:
  - User did not see the expected Exo icon in the macOS top-right menu bar while trying to run Exo as a background/resident app.
  - The source/dev launch path made it unclear whether Exo should be treated as a deployed app, a repo dev process, or both.
  - Regression on 2026-06-20: after replacing the app icon, the menu bar icon was missing in the installed app because `tray-icon.png` was not packaged into `Exo.app/Contents/Resources` at the runtime path expected by `AppLifecycleController`.
- Expected:
  - The installed macOS app is the stable resident Exo runtime for daily notes, agent coordination, MCP, command server, transcripts, and hidden-window operation.
  - Source dev runs are isolated QA targets that do not overwrite the stable runtime's command-server discovery or settings.
  - The menu bar icon is visible and exposes Show Exo, Settings, runtime status, command-server recovery, and Quit.
- Fix:
  - Replaced the previous tiny tray asset with a higher-contrast monochrome Exo graph icon and kept it as a template image so macOS can tint it correctly.
  - Embedded the 18px tray icon as a data URL in `AppLifecycleController` so the resident menu bar icon no longer depends on a separate packaged `build/tray-icon.png` file.
  - Added `scripts/install-mac-app` and `pnpm install:mac-app` to build and install the local unsigned `Exo.app`.
  - Added `pnpm dev:qa` so source QA runs use `.exo-dev/` runtime and user-data paths instead of fighting the stable installed runtime.
- QA:
  - Installed the packaged app to `/Applications/Exo.app` on 2026-05-31.
  - Launched the installed app and confirmed the Exo menu bar icon is visible in the macOS system bar.
  - Verified `exo status` reaches the installed runtime while the workspace window is visible/hidden.
  - Verified `pnpm dev:qa` can run at the same time using `.exo-dev/server.json` while normal `exo status` still resolves to the stable installed runtime under `/Users/kenneth/Desktop/lab/.exo/server.json`.

## Live Bug-Bash Watchlist

These issues have fixes and coverage, but remain worth exercising during daily installed-app use because they affected core Exo-on-Exo workflows.

### EXO-ISSUE-021: Full shell e2e file can exhaust Electron launch reliability after many serial app launches

- Status: resolved; watch during broader e2e/app QA
- Severity: medium
- Area: test harness, Electron Playwright QA, terminal regression coverage
- Observed:
  - On 2026-05-28, `pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts` repeatedly passed the first 27 app-launching tests, then timed out waiting for an Electron window on the next test.
  - The same affected tests pass when run directly by grep.
  - No leftover Exo Electron or pty processes were visible afterward, which points to launch-harness exhaustion or Electron startup flakiness under many serial launches rather than a specific product workflow failure.
- Expected:
  - The full e2e suite should be runnable as one command without hitting an app-launch ceiling.
- Fix:
  - Configured the large shell e2e file to run its independent tests in parallel instead of one long serial Electron launch chain.
  - Capped desktop e2e workers so parallel launches reduce per-worker exhaustion without flooding Electron.
- Verified:
  - `pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts` passed on 2026-05-30 with 31 passing tests and 1 skipped test.

### EXO-ISSUE-017: Terminal tabs can become blank, show stale `[exited]`, or lag while typing

- Status: fixed; reopened watch item for tab-switch rendering corruption
- Severity: critical
- Area: terminal renderer, terminal session switching, xterm performance, terminal-agent runtime
- Observed:
  - New terminals sometimes do not fully load.
  - Switching between terminals can show a blank surface or stale `[exited]` message, then recover after switching again.
  - Typing into terminals can lag enough to become unusable.
  - A tmux-backed Claude agent launched from `lab` completed an organization-protocol run and asked follow-up questions, but the terminal then became unresponsive and the user could not type a reply.
  - Fresh setup field report from 2026-06-02 found terminal display corruption, garbled output, misaligned text, or blank regions after refreshing or switching terminal tabs. The terminal remained functional and often self-corrected after later output.
  - On 2026-06-17, while Claude Code was split beside the editor, prompt input sometimes reached the agent but the visible prompt did not wrap/newline correctly; the last visible character appeared to change in place. Terminal history also sometimes showed large blank gaps, odd formatting, or missing-looking chunks.
  - On 2026-06-19, emoji/unknown-character output could spread across the terminal viewport and leave the xterm surface corrupted until a full renderer reload.
- Suspected reliability risks:
  - Historical tmux-backed sessions added a second terminal layer that could hide dead, blocked, or detached panes behind a still-running attach process. The new tmux-backed runtime must avoid that old failure mode through one explicit runtime boundary, health diagnostics, and deterministic QA; see `terminal-runtime-decision.md`.
  - Historical terminal activation/switching forced full-output reads and xterm replay, which made the renderer busy exactly when the user tried to type.
  - Large live terminal tails and transcript handling can amplify long agent outputs into expensive string work if they are treated as full-history state.
  - Only-visible terminal streaming can leave inactive terminals stale, then require a tail hydration read when switching back.
  - Resize events are sent through the terminal path frequently during pane/layout changes and need coalescing.
  - Exo currently lacks enough terminal health and latency instrumentation, so unresponsive terminals are hard to distinguish from slow rendering, dropped input, blocked prompts, or exited agent processes.
- Next:
  - Reproduce terminal tab-switch/refresh rendering corruption and verify xterm `fit()`/refresh behavior when a terminal becomes visible.
  - Continue broader bug-bash QA with long-running real Claude/Codex sessions.
- Fixed:
  - Removed stale tmux runtime compatibility code, diagnostics, restore state, and transport UI/API fields from the core terminal path.
  - Reduced terminal typing/output lag by appending streamed chunks through an append-specific live stream path instead of trimming and comparing whole terminal output on every frame.
  - Explicit terminal reads now hydrate from bounded live tails so switching/restoring terminals still refreshes the xterm surface without pretending the live tail is durable history.
  - Claude and Codex terminals now use tmux-backed sessions with Exo's tmux control-mode bridge; `EXO-ISSUE-030` tracks the remaining persistence/recovery QA.
  - Added terminal health, latency, transcript, and live-tail diagnostics in app IPC, command server, and `exo terminals diagnostics`.
  - Replaced main-process live terminal storage with a bounded line tail and bounded renderer-side terminal tracking.
  - Live active terminal output now streams directly into xterm through the terminal registry, avoiding React-owned full-output state as the primary render path.
  - Debounced terminal resize events before they reach pty.
  - Reduced renderer-to-tmux resize handoff debounce from 75ms to one animation frame so split-pane xterm fitting and backend terminal dimensions converge faster during active typing.
  - Made renderer write chunking Unicode-safe for surrogate-pair emoji and skipped the initial empty hydration reset so live output is not disturbed by startup hydration.
  - Decoded tmux control-mode octal output as UTF-8 bytes so box-drawing glyphs, Claude UI borders, and emoji do not become replacement characters before reaching xterm.

## Resolved

### EXO-ISSUE-023: External file refresh can reset editor scroll

- Status: resolved
- Severity: medium
- Area: editor refresh, external file watcher, CodeMirror scroll restoration
- Observed:
  - Full e2e QA on 2026-05-30 found that a clean open document refreshed from disk could jump back near the top instead of preserving the user's scroll position.
- Resolution:
  - Explicit scroll restoration now retries through the CodeMirror refresh window instead of setting `scrollTop` only once.
- QA coverage:
  - `apps/desktop/tests/e2e/external-file-changes.spec.ts` preserves editor scroll when an open document refreshes from disk.

### EXO-ISSUE-022: Terminal pane headers can be taller than editor tab strips in shared pane graphs

- Status: resolved
- Severity: low
- Area: pane graph, terminal tab chrome, editor/terminal visual alignment
- Observed:
  - Full e2e QA on 2026-05-30 found a 4px height mismatch after dragging a terminal tab into the editor canvas.
- Resolution:
  - Editor tab strips and terminal headers now share an explicit 40px height.
- QA coverage:
  - `apps/desktop/tests/e2e/drag-zones.spec.ts` verifies a terminal pane created in the editor canvas aligns with editor tab chrome and survives layout persistence.

### EXO-ISSUE-010: Codex agent sessions report Exo MCP startup handshake failure

- Status: resolved
- Severity: medium
- Area: MCP server integration, Codex provider integration, Exo-on-Exo workflow
- Observed: newly launched Codex terminals showed `MCP client for exo failed to start: MCP startup failed: handshaking with MCP server failed: connection closed: initialize response`.
- Resolution: the repo-backed MCP launcher imports a bundled CommonJS runtime artifact and fails clearly if the built artifact is missing. It does not invoke `pnpm` during MCP startup. The previous bundled ESM artifact crashed on startup with `Dynamic require of "fs" is not supported` before it could answer MCP `initialize`.
- QA coverage added:
  - MCP stdio launcher regression that starts `packages/mcp/bin/exo-mcp.mjs`, performs a real SDK `initialize`, and verifies `tools/list` includes `workspace_status`.
  - Live Exo-launched Codex smoke verified the Exo MCP startup warning is absent when the desktop command server is reachable.

### EXO-ISSUE-019: Exo-launched Codex can still report Exo MCP startup handshake failure

- Status: resolved
- Severity: high
- Area: MCP server integration, Codex provider integration, Exo-on-Exo workflow
- Observed:
  - During an Exo-on-Exo staff-review stress test on 2026-05-28, a newly created Codex agent showed `MCP client for exo failed to start: MCP startup failed: handshaking with MCP server failed: connection closed: initialize response`.
  - The immediate cause was a stale global Codex MCP config pointing at an old Exo worktree.
- Resolution:
  - Exo-launched Codex sessions now append an explicit `mcp_servers.exo` override that points at the current Exo checkout's `packages/mcp/bin/exo-mcp.mjs` launcher.
  - This does not mutate the user's global Codex config; it only controls Exo-launched Codex sessions.
- QA coverage added:
  - Terminal manager regression verifies Codex spawn args include the current checkout MCP command, args, and env.
  - Live Exo-launched Codex smoke verified no fresh Exo MCP failure appears after the new transcript header.

### EXO-ISSUE-020: Exo agent terminal send can strip spaces from long Codex prompts

- Status: resolved
- Severity: critical
- Area: agent terminal write path, CLI `exo agents send`, terminal input transport, Codex provider integration
- Observed:
  - During an Exo-on-Exo staff-review stress test on 2026-05-28, `exo agents send term-3 "<long review prompt>"` reported successful delivery.
  - The Codex transcript showed the submitted prompt with spaces removed, e.g. `Pleaseperformaread-onlystaffsoftwareengineer...`, making the request effectively unusable.
- Resolution:
  - Added a semantic terminal-message path distinct from raw terminal writes.
  - CLI and MCP agent-message sends now use bracketed paste and delayed submit so spaces, punctuation, and multiline text survive provider terminal input handling.
  - Raw writes remain available for keystrokes and control characters.
- QA coverage added:
  - Terminal manager regression covers bracketed-paste semantic delivery, queued Codex startup sends, submit/no-submit behavior, and raw interstitial input.
  - CLI and MCP tests cover message delivery preserving long/multiline whitespace.
  - Live app QA verified shell input remains responsive and spaces survive a terminal command round trip.

### EXO-ISSUE-004: Codex agent launch in a new worktree can consume queued task text at the trust prompt

- Status: resolved
- Severity: high
- Area: agent terminal launch, Codex provider integration, worktree orchestration
- Observed: creating a Codex agent in a newly-created worktree shows Codex's directory trust prompt. If Exo sends the task brief before the prompt is cleared, the task text is typed into the trust prompt instead of the normal Codex chat input, and the agent can exit without doing the work.
- Resolution: Codex terminal sessions now start in a short `starting` readiness gate. Submitted chat messages are queued during that gate, remain queued if a Codex trust/startup prompt is detected, and flush only after normal Codex chat readiness appears. Raw non-submitted input still passes through so the user can answer interstitial prompts.
- QA coverage added:
  - Regression that submitted Codex task text is queued across a startup trust prompt and flushes on chat readiness.
  - Regression that queued text flushes after the startup grace when no prompt appears.
  - Regression that raw non-submitted input can still answer provider interstitials.

## Fixed

### EXO-ISSUE-018: Agent Config Editor remains cluttered after first UX pass

- Status: fixed
- Severity: medium
- Area: agent config editor UX, settings information architecture
- Observed:
  - Right-side provider/config/overlay lists consumed too much space.
  - Provider file selection felt detached from the provider file editor.
  - Managed history and generated overlay preview added density without supporting the primary edit path.
  - The provider editor needed more vertical space.
- Fixed:
  - Replaced the broad agent-context workbench with a minimal sync editor for two managed layers: global instructions and the selected notes/exocortex root.
  - Removed provider-output adapters, arbitrary project-scope writes, raw provider file editing, managed config editing, history UI, generated-overlay preview, and future-file placeholders from the primary feature.
  - The editor now writes only `AGENTS.md` and `CLAUDE.md` for the selected layer, detects divergence, lets the user choose either file as the source, and aligns both files on save.
  - Global writes now target provider-owned global paths: `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`.
  - Exocortex writes target the active notes root: `AGENTS.md` and `CLAUDE.md`.
- QA coverage:
  - Focused Electron QA covers partial-load states, narrow-error layout, global sync, exocortex divergence resolution, internal editor scrolling, and verifies `soul.md`/project files are not created.
  - Live app QA verified the simplified editor opens, scope switching works, divergence controls are visible, and the editor is scrollable.

### EXO-ISSUE-016: Project-file saves have no visible confirmation

- Status: fixed
- Severity: medium
- Area: editor save UX, project files
- Observed: editing project files did not visibly indicate unsaved, saving, saved, or failed state, making it unclear whether `README` and source-file edits persisted.
- Fixed:
  - Added explicit editor save control and save status text for unsaved/saving/saved/error states.
  - Save now reads the latest document state from the renderer ref before writing, avoiding stale state when invoking save immediately after edits.
  - Project markdown saves no longer try to refresh note-only knowledge/branch metadata when the file is outside an attached note root.
- QA coverage:
  - Focused Electron QA covers editing a project source file and project `README.md`, observing dirty state, saving, and confirming the files on disk changed.
  - Live app QA verified the editor save status/control is visible in the active editor toolbar.

### EXO-ISSUE-015: Browser preview launcher is on the terminal rail

- Status: fixed
- Severity: low
- Area: shell navigation, browser preview
- Observed: browser preview launch lived with terminal controls even though it opens a workspace/editor pane.
- Fixed:
  - Moved the preview launcher to the explorer rail directly under the explorer collapse/expand control.
- QA coverage:
  - Focused Electron QA verifies the launcher is absent from the terminal rail, present in the explorer rail, and opens a browser preview pane.
  - Live app QA verified the launcher placement and preview-pane creation in the running desktop app.

### EXO-ISSUE-013: Agent Config Editor sections can overlap near the bottom of the dialog

- Status: fixed
- Severity: medium
- Area: agent config editor layout, managed config editor
- Observed: the Managed config editor header and contents could visually overlap the provider file editor when the manager had constrained vertical space.
- Fixed:
  - Agent config editor blocks now size from their content and let the editor's main column scroll instead of using a flexible textarea row with an indefinite parent height.
- QA coverage:
  - Added Playwright layout regression that verifies the provider file editor and managed config editor do not overlap after selecting a managed `.mcp.json` config.

### EXO-ISSUE-012: Reattached long-running Codex sessions can crash the renderer with huge buffers

- Status: fixed
- Severity: high
- Area: terminal persistence, renderer stability, Exo-on-Exo stress
- Observed: after the multi-agent stress test, the dev app repeatedly logged renderer crashes while reattaching Codex sessions with very large terminal live-output tails.
- Fixed:
  - Live terminal tails now follow the user-configured live scrollback line count instead of a hidden character cap.
  - Transcript storage still receives complete terminal data; only the live interface tail is trimmed.
  - Renderer-side streaming tails apply the same line-based scrollback setting as chunks arrive, so active visible terminals match the settings model.
- QA coverage:
  - Added terminal-manager regression that live tails follow configured scrollback lines while transcript reads still include the full emitted content.
  - Added renderer utility regression for streamed terminal tail trimming from the same configured line count.

### EXO-ISSUE-011: Exo agent send can require an extra raw Enter before Codex starts work

- Status: fixed
- Severity: high
- Area: agent terminal write path, Codex provider integration, terminal input orchestration
- Observed: `exo agents send <id> <brief>` reported queued delivery and the brief appeared at the Codex prompt, but Codex did not start processing until `exo agents send <id> $'\r' --raw` was sent afterward.
- Fixed:
  - Queued Codex submitted messages now flush as message body followed by a short delayed Enter, so Codex has time to finish activating the prompt before submit.
- QA coverage:
  - Updated terminal-manager regressions to verify queued Codex task text writes body first and delayed Enter afterward.
  - Live Exo-launched Codex smoke verified a queued `exo agents send` message starts work and receives `OK` without a second raw Enter.

### EXO-ISSUE-009: Agent create subcommand treats `--help` as a cwd

- Status: fixed
- Severity: low
- Area: CLI ergonomics, agent orchestration
- Observed: running `exo agents create codex --help` created a Codex terminal with cwd `--help` instead of showing help for the create subcommand.
- Fixed:
  - `exo agents --help`, `exo agents create --help`, and `exo agents create <provider> --help` are handled before app connection/terminal creation.
  - Option-shaped create cwd values now fail with a clear invalid-cwd error instead of being passed to terminal creation.
- QA coverage:
  - Added CLI regressions for `exo agents create --help`, `exo agents create codex --help`, and non-help option-shaped cwd rejection.
  - Live app QA verified identical `exo agents list` output before and after both help commands.

### EXO-ISSUE-005: Dev app can exit after build without exposing the Exo CLI server

- Status: fixed
- Severity: high
- Area: desktop dev startup, command server, agent orchestration
- Observed: after the parallel-agent stress test, a live command server was still bound, but `${workspaceRoot}/.exo/server.json` was missing. CLI discovery therefore reported `Exo app is not running. Start it with: exo dev`, and a second `pnpm dev` exited because Electron's single-instance lock was held.
- Expected: `pnpm dev` should either keep the Electron app and command server alive, or print a clear startup failure explaining why the app exited. A running app should be able to restore command-server discovery if `.exo/server.json` disappears.
- Fixed:
  - Command server startup now exposes `ensureDiscoveryFile()` and periodically refreshes `.exo/server.json` while the server is listening.
  - Duplicate Electron launches now pass runtime metadata to the primary instance, print an actionable diagnostic before exiting, and ask the running app to refresh command-server discovery.
  - Command-server startup failures are logged to the main log instead of leaving stale in-memory server state.
- QA coverage:
  - Added a main-process unit regression that deletes `server.json` while the command server is live and verifies `ensureDiscoveryFile()` rewrites the correct port and pid.
  - Focused checks: `pnpm --filter @exo/desktop typecheck`; `pnpm --filter @exo/desktop test`.

### EXO-ISSUE-006: Agent Config Editor can show stale preload API errors after app crashes/restarts

- Status: fixed
- Severity: high
- Area: desktop preload bridge, workspace settings, agent config editor
- Observed: Workspace Settings and Agent Config Editor showed `managed agent config files: window.exo.workspace.listAgentManagedConfigFiles is not a function`.
- Fixed:
  - Renderer now treats managed-config preload APIs as optional and reports a clear restart/update message when they are unavailable.
  - Settings and Agent Config Editor still open with partial error state instead of failing the dialog.
- QA coverage:
  - Added Playwright regression that opens Agent Config Editor when the managed-config preload API is intentionally omitted.

### EXO-ISSUE-007: Agent Config Editor error and control layout can overlap in narrow or partially failed states

- Status: fixed
- Severity: medium
- Area: agent config editor layout, settings UI polish
- Observed: the partial-load error text overlapped the target selector and write action in the Agent Config Editor.
- Fixed:
  - Partial-load errors now render in their own bounded row, wrap long technical messages, and stay separate from the scope/action controls.
  - Narrow manager layouts have dedicated responsive spacing for overview, controls, and side panel content.
- QA coverage:
  - Added Playwright layout regression for long agent-context errors in a narrow manager.

### EXO-ISSUE-008: Agent Config Editor needs a clearer information architecture and explanatory UX

- Status: fixed
- Severity: medium
- Area: agent config editor UX, settings information architecture
- Observed: the manager mixed unified instructions, provider files, instruction outputs, runtime overlays, history, and managed configs without enough hierarchy or explanation.
- Fixed:
  - Reworked the manager into clearer sections for unified instructions, managed history, provider files, instruction outputs, runtime overlays, and managed config editing.
  - Replaced the single scope dropdown with explicit Global vs Selected scopes controls, including multi-select notes/project targets and a write-summary showing how many scopes will be touched.
  - Corrected provider global instruction paths: Codex writes `~/.codex/AGENTS.md`; Claude writes `~/.claude/CLAUDE.md`.
  - Removed the summary overview strip after QA showed it added visual clutter without a clear action.
  - Added concise tooltips/help affordances for scope, provider outputs, overlays, history, and managed configs.
- QA coverage:
  - Extended Playwright settings QA to verify the core sections, output controls, multi-scope writes, and absence of the removed overview strip.

### EXO-ISSUE-001: Workspace settings button does not open settings

- Status: fixed
- Severity: high
- Area: desktop shell, settings dialog, command routing
- Observed: clicking the settings button does not open Workspace Settings.
- Expected: the settings button should reliably open the Workspace Settings dialog from the sidebar.
- Investigation notes:
  - Verify whether the button handler is failing, the dialog is opening behind another overlay, or an exception is thrown while loading settings/agent context state.
  - Check recent Agent Config Editor changes because `openWorkspaceSettingsDialog` now eagerly loads agent context files, adapters, overlays, and managed configs.
  - If one load path fails or hangs, settings should still open with partial error state rather than failing the whole dialog.
- QA coverage to add:
  - E2E that clicks settings in a real configured workspace after agent manager/config files are present.
  - Regression for settings opening even if agent context/config discovery fails.
- Fixed in: `aeed5a5` / merged to `main`.

### EXO-ISSUE-002: Preview pane sizing and drag behavior is not consistent with editor/terminal panes

- Status: fixed
- Severity: high
- Area: pane graph, browser preview pane, split resizing, drag/drop tab behavior
- Observed:
  - It is difficult to resize vertical space when a preview is open, especially dragging to make bottom panes such as terminal/editor larger.
  - Preview does not appear to behave like a normal draggable/adjustable tab item alongside editor and terminal panes.
- Expected:
  - Browser preview panes should participate in the same split-pane graph as editor and terminal panes.
  - Users should be able to resize splits predictably in both vertical and horizontal directions.
  - Preview tabs should have the same drag/reorder/split affordances as editor and terminal tabs unless there is an explicit reason not to.
- Investigation notes:
  - Inspect browser pane leaf handling in pane tree state and drag/drop handlers.
  - Confirm browser pane tab chrome exposes the same drag payload/drop zones as editor and terminal leaves.
  - Confirm split resizer hit areas and persisted ratios work when a browser pane is one of the split children.
- QA coverage to add:
  - E2E for resizing a vertical split where one pane is browser preview and another is terminal/editor.
  - E2E for dragging browser preview tabs/panes using the same affordances as editor/terminal.
  - App QA screenshots for preview + terminal + editor layout before and after resize.
- Fixed in: `3733b9d` / merged to `main`.

### EXO-ISSUE-003: Changed-file badges inside terminal panes are not terminal-specific

- Status: fixed
- Severity: high
- Area: project review, terminal provenance, changed-files UI
- Observed: active file changes appear inside all terminal panes, not just the terminal that plausibly produced or owns the change.
- Expected:
  - Changed-file affordances shown inside a terminal should be specific to that terminal session when Exo can reliably link the file change to the session.
  - If Exo cannot reliably link a change to one terminal, it should avoid implying terminal-specific ownership.
- Candidate fixes:
  - Preferred if reliable: improve linking by session id, cwd, observed write event, timestamp, and controlled write path.
  - Safer fallback: move ambiguous changed-file indicators to a bottom/status bar near branch/directories/index status, with a click target that opens changed files.
  - If a changed file belongs to a project that is not imported/attached, clicking should prompt the user to import/attach that project before opening or reviewing it.
- Investigation notes:
  - Current broad cwd/root matching may be too permissive and causes every terminal in a project/root to show the same changes.
  - Provenance should not make AI-detector-style guesses. If the link is not observed or controlled, show it as workspace/project state rather than terminal state.
- QA coverage to add:
  - E2E with two terminals in the same project root where only one has an observed write candidate.
  - E2E with ambiguous changed files confirming they do not appear as terminal-specific.
  - E2E/status-bar QA for opening changed files and prompting to attach missing projects.
- Fixed in: `f7f886d` / merged to `main`.
