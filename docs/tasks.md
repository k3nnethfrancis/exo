# Exo Tasks

## P0 — Repo and shell bootstrap
- [x] Create Electron workspace shell
- [x] Add shared core package
- [x] Add CLI package
- [x] Add fixture workspace
- [x] Add Playwright interaction and screenshot harnesses

## P1 — UI/editor/terminal shell
- [x] Sidebar with workspace, note, and project roots
- [x] Search input and fast sidebar-oriented note/project/tag search
- [x] Tabbed markdown notebook editor
- [x] Frontmatter/properties projection
- [x] Backlinks, tags, and link surfaces
- [x] Right/bottom terminal dock
- [x] Default shell tab rooted at `workspace_root`
- [x] `Claude` button launches `claude` in a new terminal tab
- [x] `Codex` button launches `codex` in a new terminal tab
- [x] Per-tab cwd override support
- [x] Project files open in a non-notebook editor path
- [x] Scrollable explorer with file/folder context actions
- [x] In-app create/rename/delete modal instead of blocking browser prompts
- [x] Collapsed bottom knowledge drawer by default
- [x] Note wrapping with vertical-scroll editor behavior
- [x] Incremental xterm rendering instead of full-buffer resets
- [x] Shared workspace knowledge footer spanning editor + terminal region
- [x] Resizable terminal dock

## P2 — Knowledge/editor parity
- [x] Branch-aware note flows
- [ ] Notebook execution surfaces
- [x] Search parity and richer navigation
- [ ] Search ranking / keyboard navigation / preview parity
- [ ] Branch family affordances in the sidebar/file tree
- [x] Initial file/tab drag splitting into a second editor pane
- [ ] Consistent collapsed-bar model for terminal, inspector, and project roots
- [ ] True arbitrary IDE pane graph and dockable note/terminal surfaces beyond the current two-pane model

## P3 — Agent runtime control layer
- [x] Exo workspace/runtime config model for launch defaults, roots, QMD config, and communication transport
- [x] `exo launch shell|claude|codex`
- [x] Exo-generated `AGENTS.md` as the primary generic runtime contract
- [x] Exo-generated `CLAUDE.md` as the Claude-specific overlay
- [x] CLI commands for runtime context inspection and active workspace state
- [ ] Broaden CLI-first agent operations beyond launch/context so they can later be surfaced through MCP

## P4 — Retrieval and memory
- [ ] QMD adapter for search/query/rerank from the Exo CLI
- [ ] Durable memory layer
- [ ] Trace archive layer
- [ ] Retrieval/index layer
- [ ] Working-memory assembly
- [ ] CLI-first memory commands
- [ ] Reviewed quirks and working-memory shaping

## P5 — Multi-agent and communication
- [x] Initial manual agent observability/steering view over terminal sessions
- [x] Manual run kickoff and child-agent spawning from the Agents view
- [ ] Multiple terminal panes
- [ ] Grid layout
- [ ] File-backed append-only message transport
- [ ] SQLite index for agent communication reads and replay
- [ ] Operator surfaces for agent communication state
- [ ] Chat wrapper experiments over terminal agents

## P6 — Research harness
- [ ] Workcell model
- [ ] Bounded run supervision
- [ ] `autoresearch-macos` integration
- [ ] CLI-first operator commands for workcells, agents, datasets, and evals
- [ ] Exo-memory/QMD system research workcell

## P7 — Training flywheel
- [ ] Objective definitions
- [ ] Dataset selectors
- [ ] Eval suites
- [ ] Operator decisions as labels
- [ ] Retrieval/ranking/quirk helper-model training
