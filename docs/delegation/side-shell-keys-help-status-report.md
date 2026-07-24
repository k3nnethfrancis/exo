# side-shell-keys-help status

## 2026-07-21 — ready for review
**State:** ready-for-review
**Goal:** Add fast shell panel keybindings and a compact lower-left Help surface without changing Exo's CLI contract.
**Done:** Added `Mod+B` for Explorer and `Mod+Alt+B` for Utility, using physical `KeyboardEvent.code` so macOS Option-key character composition cannot break the secondary-panel shortcut. Added one icon-only Help affordance beside Settings; its anchored, backdrop-free surface lists current app keybindings and CLI commands. Centralized the non-executable CLI help catalog under the private `@exo/core/operator-help` subpath, and made both `exo --help` and the renderer consume it.
**Evidence:** Focused App tests pass (82/82); CLI tests pass (5/5); `pnpm ci:check` passes (177 core, 518 desktop, 28 CLI, repository checks, typechecks, builds, and install dry-run); the real Electron Playwright journey passes and proves both shortcuts, compact Help rendering, Escape dismissal, and clean menu re-entry.
**Next:** Orchestrator review and integrate the scoped branch into the selected launch tree.
**Needs orchestrator:** Confirm the shortcut pair and integrate the commit; no architecture decision is blocked.
**Risk / scope note:** Public CLI behavior, routes, flags, and shared protocols are unchanged; only the existing help string's static source moved to an internal catalog. `App.tsx` changes by two callback wires at the existing `useAppKeybindings` call, so integration collision risk is small and localized. `WorkspaceMenu.tsx`, `shell.css`, and `CHANGELOG.md` are more likely merge-collision points if parallel UI slices touch the same lower-left menu.
