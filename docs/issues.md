# Exo Issues

Last updated: 2026-06-20

This is the active bug/QA tracker. It captures user-observed issues that need investigation before the next push/release pass.

## Open

### EXO-ISSUE-045: Restart can leave stale command-server discovery with visible broken terminal UI

- Status: implemented in `exo/issue-045-restart-lifecycle`; pending review and full Electron restart QA
- Severity: critical
- Area: terminal lifecycle, control plane, command-server discovery, macOS app lifecycle
- Observed:
  - User report from 2026-06-20: after the agent said Exo had restarted, the Exo UI still showed old terminal tabs.
  - Typing in an existing Claude tab produced malformed prompt/input rendering instead of a normal reattached terminal input surface.
  - A subsequent `exo status` returned stale command server discovery: recorded pid `6377` was no longer running, runtime root `/Users/kenneth/Desktop/lab/.exo`, discovery file `/Users/kenneth/Desktop/lab/.exo/server.json`, cause `fetch failed`.
- Expected:
  - App restart should leave a healthy command server or a clear unavailable state with stale discovery removed or quarantined.
  - Stale command-server discovery should not coexist with a visible-but-broken UI that appears attached to usable terminal sessions.
  - Reattached terminal input after restart should render normally in Claude/Codex/shell tabs, with prompt and typed input preserved or cleanly recovered.
- Investigation notes:
  - Audit macOS app/menu-bar lifecycle versus terminal tmux persistence: the menu-bar app, main/control-plane process, renderer windows, tmux sessions, and terminal tabs may not share the same restart boundary.
  - Review command server discovery lifecycle: creation, pid validation, fetch failure handling, stale `server.json` cleanup, and whether `exo status` can report a dead process while the UI remains visible.
  - The renderer may survive, be restored, or show stale UI after main/control-plane process failure; terminal tabs should detect backend/control-plane health loss and enter an explicit reconnect/degraded state instead of staying apparently live.
  - Reattach/input rendering may need a health recovery path that refreshes terminal geometry, tmux pane attachment, xterm state, and command-server connectivity before accepting user input.
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

- Status: open
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
  - Audit which parts of the header are fixed-height versus content-driven: properties affordance, title field, saved state, and editor mode/actions.
  - Identify whether the daily-note H1 is generated by note-template/rendering code or is literal markdown content in the file.
  - Compare normal markdown notes, daily notes, and raw mode so title suppression does not hide real content.
- QA coverage:
  - Visual regression or Playwright coverage for compact header height with unchanged action/icon usability.
  - Daily-note render test asserting no generated duplicate filename/title H1 appears.
  - Regression coverage that explicit markdown H1 content still renders.

### EXO-ISSUE-043: Explorer file and folder rows lack enough visual differentiation

- Status: open
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

### EXO-ISSUE-042: Projects sidebar duplicates changed files in a separate Changes section

- Status: open
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

### EXO-ISSUE-041: Terminal panes can blank, hydrate at stale width, or leak generated OSC responses

- Status: fixed in local branch
- Severity: critical
- Area: terminal renderer, xterm hydration, pane moves, refresh/reload recovery
- Observed:
  - After Cmd+Shift+R, terminal panes can render blank even though input still reaches the underlying session.
  - Switching tabs can make a blank terminal group repaint, but single-tab terminal groups have no tab switch recovery path.
  - Moving terminal tabs between panes can leave a half-blank terminal surface or hydrate scrollback at an older/narrower width.
  - Random text such as `]10;rgb:5858/6e6e/7575\]11;rgb:fdfd/f6f6/e3e3\` can appear in an agent prompt after tab/pane swapping.
- Expected:
  - Visible active terminal panes should hydrate from the backend tail after reload or remount without requiring input or tab switching.
  - Hydration should happen after xterm has a measured viewport so replayed history fits the current pane.
  - xterm-generated device/color responses should never be forwarded to shell or agent processes as user input.
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
- QA coverage:
  - Unit coverage for CSI and OSC terminal-generated response filtering.
  - Relaunch E2E now asserts prior terminal output is visible before sending new input.

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
  - Replace or remove stale `terminalHistoryMode` naming so settings map directly to live scrollback/transcript behavior.
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

- Status: resolved
- Severity: high
- Area: macOS packaging, resident runtime, menu bar control surface, Exo-on-Exo workflow
- Observed:
  - User did not see the expected Exo icon in the macOS top-right menu bar while trying to run Exo as a background/resident app.
  - The source/dev launch path made it unclear whether Exo should be treated as a deployed app, a repo dev process, or both.
- Expected:
  - The installed macOS app is the stable resident Exo runtime for daily notes, agent coordination, MCP, command server, transcripts, and hidden-window operation.
  - Source dev runs are isolated QA targets that do not overwrite the stable runtime's command-server discovery or settings.
  - The menu bar icon is visible and exposes Show Exo, Settings, runtime status, command-server recovery, and Quit.
- Fix:
  - Replaced the previous tiny tray asset with a higher-contrast monochrome Exo graph icon and kept it as a template image so macOS can tint it correctly.
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
