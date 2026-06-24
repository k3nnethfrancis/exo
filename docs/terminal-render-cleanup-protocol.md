# Terminal Render Cleanup Protocol

Last updated: 2026-06-24

Terminal rendering is a moving compatibility target because Claude, Codex, Pi, shells, tmux, fonts, Chromium, and xterm can all change their output or rendering behavior. Treat every new render glitch as corpus maintenance plus a focused fix, not as an isolated patch.

## Scope

This protocol covers terminal visual/render issues:

- Unicode replacement characters: `�` / `U+FFFD`
- literal fallback strings such as `???`
- tofu boxes or missing glyph placeholders
- screen-wide glyph smear
- stale history pasted over live output
- broken box drawing, braille spinners, status bars, prompt wraps, or alternate-screen output
- symbol presentation issues, such as Claude's `⏺` action marker rendering as a colorful emoji

It does not replace `docs/terminal-quality-standard.md`; it is the operational loop for keeping that standard true as harnesses evolve.

## Triage Loop

1. Capture the exact field evidence:
   - screenshot or short video
   - terminal id and harness
   - Exo commit/app version
   - whether preview/pane movement/reload/sleep happened
   - transcript path when available
2. Classify the failure:
   - byte corruption: transcript or `exo terminals read` contains `�`, `???`, or missing expected characters
   - render-only corruption: transcript is correct but xterm/Chromium renders the wrong glyphs or smears stale cells
   - lifecycle corruption: stale output appears after tab switch, pane move, preview focus, reload, or reconnect
3. Add or update the deterministic fixture:
   - `apps/desktop/tests/fixtures/terminal-render-stability.json`
   - `apps/desktop/tests/terminalRenderStability.ts`
   - focused tmux decoder tests in `apps/desktop/src/main/terminal-tmux.test.ts`
   - renderer chunking/font tests in `apps/desktop/src/renderer/src/App.test.tsx`
   - fake-agent e2e in `apps/desktop/tests/e2e/shell.spec.ts`
4. Make the fixture fail before or with the fix.
5. Fix the narrowest owner:
   - tmux control-mode byte parsing for byte corruption
   - renderer chunking/xterm options/CSS for render-only corruption
   - hydration/focus/fit lifecycle for stale replay or blank panes
   - settings only when the issue is caused by a user-visible cap or timing value
6. Run `pnpm terminal:check`, then installed-app QA when the fix affects visible behavior.

## Rules

- Do not sanitize terminal bytes to hide corruption. If the stream contains `�`, find the boundary that introduced it or prove the harness emitted it.
- Do not special-case Claude/Codex strings in the terminal runtime. Provider-shaped output belongs in fixtures; runtime fixes should be terminal-general.
- Do not reintroduce transcript replay or full xterm reset as a visual cleanup path.
- Keep true emoji support. Prefer text presentation for terminal UI symbols only when it can be expressed as a renderer/font hint rather than data mutation.
- Keep `terminal:check` deterministic. Use fake harnesses, not live Claude/Codex inference.

## Current Field Cases

- `⏺` rendering as a blue emoji-style marker is a symbol-presentation issue. The stream is valid; prefer a terminal text presentation where Chromium supports it.
- Residual `�` in Claude transcripts is a byte/data issue until proven otherwise. It remains tracked under `EXO-ISSUE-062` and should produce a fixture before any fix is considered complete.

-- Shoshin | 2026-06-24
