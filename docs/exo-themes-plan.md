# Exo Themes Plan

Date: 2026-06-20

## Goal

Add a named theme system to Exo that makes the app feel deliberate across notes, code, terminals, agents, drawers, dialogs, review, search, and future graph/provenance views.

The implementation should not be "more colors in CSS." It should introduce a small theme model that every rendered surface consumes in the same way, with automated contrast checks and visual QA before new themes are accepted.

## Product Thesis

Exo is a quiet local-first operations workspace for humans and terminal agents. Themes should support long work sessions, dense scanning, and state awareness. The editor and terminal are the primary work surfaces; color should clarify hierarchy, state, source, and risk without making the app feel like a dashboard.

Design principles:

- Content first: notes, code, terminals, and review diffs get the calmest readable surfaces.
- Chrome recedes: rails, tabs, sidebars, drawers, and status bars sit one step behind content.
- Accent is scarce: one accent per theme for focus, selection, active controls, and primary affordances.
- State colors are semantic: success, warning, danger, info, changed, running, idle, agent, human, and provenance should not borrow arbitrary accent colors.
- Color never carries meaning alone: every state needs shape, text, icon, position, or contrast in addition to hue.
- Themes are named product choices, not arbitrary user palettes at first.

## Current Scan

Primary files:

- `apps/desktop/src/renderer/src/styles.css`: global CSS variables, editor/live-preview styling, dialogs, onboarding, agent config, path lists, settings.
- `apps/desktop/src/renderer/src/shell.css`: shell frame, topbar, statusbar, sidebar, search panel, explorer, project changes, tabs, split panes.
- `apps/desktop/src/renderer/src/terminal.css`: terminal dock, terminal rail, xterm host, browser pane, subagent drawer/cards.
- `apps/desktop/src/renderer/src/drawers.css`: side/footer drawers and floating panels.
- `apps/desktop/src/renderer/src/appearance.ts`: currently only `system | light | dark` and resolved `light | dark`.
- `apps/desktop/src/renderer/src/App.tsx`: owns `appearanceMode`, sets `html[data-theme]`, applies settings, passes resolved appearance to editor/terminal.
- `apps/desktop/src/renderer/src/components/NoteEditor.tsx`: CodeMirror theme uses CSS vars, but syntax colors are hardcoded per light/dark.
- `apps/desktop/src/renderer/src/components/TerminalView.tsx`: xterm theme is hardcoded per light/dark.
- `apps/desktop/src/renderer/src/components/WorkspaceSettingsDialog.tsx`: appearance selector exists, but no named theme selector.
- `packages/core/src/types.ts` and `packages/core/src/workspace-settings.ts`: persisted settings schema currently contains `appearanceMode` only.

Important current findings:

- CSS already has a useful first token layer: `--bg`, `--chrome-bg`, `--sidebar-bg`, `--editor-bg`, `--terminal-bg`, `--panel`, `--surface-*`, `--text-*`, `--accent`, `--danger-*`.
- The light theme is Solarized-like and warm. This works as a direction, but should become one named theme rather than the default shape of all light themes.
- Statusbar index states hardcode green/amber/blue/red in `shell.css`.
- CodeMirror syntax colors are hardcoded in `NoteEditor.tsx`.
- xterm foreground/background/cursor/selection are hardcoded in `TerminalView.tsx`.
- `--danger` is referenced as a fallback in CSS but the root token set defines `--danger-text`, `--danger-strong`, `--danger-soft`, and `--danger-border`, not `--danger`.
- The renderer uses `data-theme="light|dark"`. Named themes need a second attribute such as `data-color-theme="exo-neutral"` or resolved generated CSS vars.

## Theme Model

Keep mode and theme separate.

- `appearanceMode`: existing OS integration control: `system | light | dark`.
- `resolvedAppearance`: existing runtime result: `light | dark`.
- `colorThemeId`: new named theme family setting, for example `exo-neutral`, `exo-solar`, `exo-graphite`, `exo-high-contrast`.
- `resolvedTheme`: `themeRegistry[colorThemeId].variants[resolvedAppearance]`, falling back to the default theme family if a variant is missing.

Electron `nativeTheme.themeSource` should continue to use `appearanceMode`. Named themes are renderer-level colors; they should not fight OS light/dark integration.

Recommended settings UX:

- Rename current dropdown label from `Appearance` to `Mode`.
- Add `Color theme` select below it.
- Show options as theme families, not individual light/dark variants.
- Keep the appearance cycle button cycling only `system -> light -> dark`; the settings dialog controls the named theme.

## Theme Object Shape

Implement a typed theme registry in the renderer, for example:

```ts
export type ColorThemeId = "exo-neutral" | "exo-solar" | "exo-graphite" | "exo-high-contrast";

export interface ExoThemeFamily {
  id: ColorThemeId;
  label: string;
  description: string;
  variants: Partial<Record<ResolvedAppearance, ExoThemeVariant>>;
}

export interface ExoThemeVariant {
  id: string;
  appearance: ResolvedAppearance;
  colorScheme: "light" | "dark";
  css: Record<ThemeCssVariable, string>;
  syntax: ExoSyntaxTheme;
  terminal: ExoTerminalTheme;
}
```

Do not scatter theme constants through components. Components should receive a resolved theme object or consume CSS variables.

Suggested file layout:

- `apps/desktop/src/renderer/src/theme/types.ts`
- `apps/desktop/src/renderer/src/theme/registry.ts`
- `apps/desktop/src/renderer/src/theme/applyTheme.ts`
- `apps/desktop/src/renderer/src/theme/contrast.ts`
- `apps/desktop/src/renderer/src/theme/codemirror.ts`
- `apps/desktop/src/renderer/src/theme/xterm.ts`

## Token Contract

Theme tokens should be semantic. Avoid component-specific tokens unless a component has genuinely unique material needs.

### Base Material

- `--app-bg`: full-window background.
- `--workspace-bg`: split-pane canvas behind editor/terminal leaves.
- `--chrome-bg`: topbar/statusbar/rigid app chrome.
- `--sidebar-bg`: explorer and rails.
- `--editor-bg`: notes/code canvas.
- `--terminal-bg`: xterm canvas.
- `--panel-bg`: drawers, search panels, floating panels.
- `--panel-bg-strong`: modals/popovers and stronger raised surfaces.

Map existing aliases during migration:

- `--bg`, `--bg-top`, `--bg-bottom` should derive from `--app-bg`.
- `--bg-elevated` should derive from `--editor-bg` or be retired.
- Existing `--panel`, `--panel-strong`, `--panel-muted` can remain as compatibility aliases until all CSS is migrated.

### Text

- `--text-primary`: main readable text.
- `--text-secondary`: normal metadata and secondary labels.
- `--text-muted`: quiet metadata, paths, disabled-adjacent text.
- `--text-faint`: separators-as-text, empty hints, ultra-low priority text.
- `--text-inverse`: text on filled accent/state buttons.

Compatibility aliases:

- `--text -> --text-primary`
- `--text-soft -> --text-secondary`
- `--muted -> --text-muted`

### Borders And Surfaces

- `--border-subtle`
- `--border-strong`
- `--surface-1` through `--surface-5`
- `--surface-hover`
- `--surface-active`
- `--surface-selected`
- `--surface-focus`
- `--shadow-raised`

Keep `--surface-*` because the app already uses these heavily.

### Accent And Links

- `--accent`
- `--accent-strong`
- `--accent-soft`
- `--accent-text`
- `--link`
- `--link-hover`
- `--selection-bg`
- `--focus-ring`

Rule: use `--accent` for active/focused/primary action. Use `--link` for navigational text. Do not use either for warnings, errors, provenance, or agent identity.

### State

- `--state-info`
- `--state-info-soft`
- `--state-success`
- `--state-success-soft`
- `--state-warning`
- `--state-warning-soft`
- `--state-danger`
- `--state-danger-soft`
- `--state-idle`
- `--state-running`
- `--state-changed`
- `--state-agent`
- `--state-human`
- `--state-provenance`

Compatibility aliases:

- `--danger-text`, `--danger-strong`, `--danger-soft`, `--danger-border` should derive from danger state tokens.
- Add explicit `--danger` or remove the fallback reference that expects it.
- `--status-idle` should derive from `--state-idle`.

### Editor Markdown

- `--md-heading`
- `--md-link`
- `--md-tag-bg`
- `--md-tag-text`
- `--md-quote-border`
- `--md-code-bg`
- `--md-code-text`
- `--md-table-border`
- `--md-list-guide`
- `--md-list-bullet`
- `--md-task-checked`

Migrate current `--tag`, `--tag-text`, `--exo-list-guide`, and `--exo-list-bullet` to these names with compatibility aliases.

### Syntax

Keep syntax colors in the theme registry, not CSS only, because CodeMirror `HighlightStyle` wants values in JS.

Required syntax slots:

- `keyword`
- `atom`
- `string`
- `number`
- `variable`
- `functionName`
- `definition`
- `property`
- `operator`
- `comment`
- `punctuation`
- `invalid`
- `meta`

Each syntax color must pass at least WCAG 2.2 AA normal text contrast against `--editor-bg` unless the token is decorative punctuation. Comments should still pass 4.5:1; they are read during code review.

### Terminal

The xterm theme needs typed values, not CSS var strings.

Required terminal slots:

- `background`
- `foreground`
- `cursor`
- `cursorAccent`
- `selectionBackground`
- ANSI normal: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`
- ANSI bright: `brightBlack`, `brightRed`, `brightGreen`, `brightYellow`, `brightBlue`, `brightMagenta`, `brightCyan`, `brightWhite`

Keep `minimumContrastRatio: 4.5` in xterm, but do not rely on it as the only quality gate. Tune the palette directly.

## Accessibility Gates

Use WCAG 2.2 as the implementation target. W3C currently recommends WCAG 2.2 for future applicability, and its contrast/focus criteria are the right baseline for this Electron renderer.

References:

- WCAG 2.2 latest: https://www.w3.org/TR/WCAG22/
- Contrast minimum: https://www.w3.org/TR/WCAG22/#contrast-minimum
- Non-text contrast: https://www.w3.org/TR/WCAG22/#non-text-contrast
- Focus visible and focus appearance: https://www.w3.org/TR/WCAG22/#focus-visible and https://www.w3.org/TR/WCAG22/#focus-appearance
- Use of color: https://www.w3.org/TR/WCAG22/#use-of-color

Acceptance thresholds:

- Normal text: contrast ratio >= 4.5:1 against its actual background.
- Large text: contrast ratio >= 3:1, but do not use this exemption for normal app labels.
- UI component boundaries and meaningful icons: >= 3:1 against adjacent colors.
- Focus indicators: visible for every keyboard-operable control; target >= 3:1 against the unfocused state and surrounding surface.
- State indicators: hue must be paired with text, icon, shape, position, or explicit label.
- Selection text: selected foreground/background must stay readable in editor and terminal.

Implementation:

- Add a theme contrast test that reads every theme variant from the registry and checks declared foreground/background pairs.
- Include explicit pairs, for example text on editor, text on sidebar, muted text on sidebar, text on panel, accent text on panel, danger text on panel, warning text on panel, link on editor, focus ring on editor/sidebar/panel, syntax on editor, terminal foreground on terminal background, and ANSI colors on terminal background.
- Add a small whitelist for deliberately decorative separators only. Do not whitelist body text, comments, paths, status labels, or buttons.
- Optionally add APCA as an advisory report later, but do not make it the blocking gate until the product chooses that standard. WCAG 2.2 contrast is the release gate.

## Implementation Phases

### Phase 1: Theme Registry And Settings

1. Add `colorThemeId` to `WorkspaceSettings`.
2. Add a default such as `DEFAULT_COLOR_THEME_ID = "exo-neutral"`.
3. Normalize unknown theme IDs to the default.
4. Update settings persistence tests in `packages/core/src/__tests__/workspace-settings.test.ts`, `apps/desktop/src/main/settings-store.test.ts`, and renderer settings tests.
5. Add a `Color theme` select in `WorkspaceSettingsDialog`.
6. Keep `appearanceMode` behavior unchanged and continue using it for Electron `nativeTheme.themeSource`.
7. In `App.tsx`, derive `resolvedTheme` from `appearanceMode`, system preference, and `colorThemeId`.
8. Set `html[data-color-theme]` and apply CSS variables from the resolved theme.

### Phase 2: CSS Token Migration

1. Replace root-level hardcoded theme blocks with generated/applied CSS variables from the registry.
2. Keep compatibility aliases in CSS during the first pass so the migration can be incremental.
3. Convert hardcoded status colors in `shell.css` to `--state-success`, `--state-warning`, `--state-info`, and `--state-danger`.
4. Audit all `#[hex]`, `rgb()`, and `rgba()` color literals outside theme registry files. Shadows and transparent black overlays can remain if they are material tokens or are moved into `--shadow-*`.
5. Keep `color-mix()` usage only when mixing semantic tokens.

Useful audit command:

```bash
rg -n "#[0-9a-fA-F]{3,8}|rgba?\(" apps/desktop/src/renderer/src
```

Expected end state: component CSS contains semantic variables and layout rules; actual theme colors live in the theme registry.

### Phase 3: CodeMirror Integration

1. Move `exoSyntaxHighlightStyle` and `editorTheme` out of `NoteEditor.tsx`.
2. Make them accept `resolvedTheme` rather than `appearance`.
3. Preserve CodeMirror's `{ dark: resolvedTheme.appearance === "dark" }`.
4. Use theme syntax tokens for `HighlightStyle`.
5. Use CSS variables or resolved values for editor foreground, caret, selection, gutters, active line, diagnostics, and fold gutters.
6. Add a focused renderer test around theme switching without losing document content.

### Phase 4: xterm Integration

1. Move `xtermTheme` out of `TerminalView.tsx`.
2. Make it accept `resolvedTheme.terminal`.
3. Include ANSI colors, not only background/foreground/cursor/selection.
4. Preserve `minimumContrastRatio: 4.5`.
5. Ensure switching `colorThemeId` updates existing terminal instances without remounting or losing hydration state.

### Phase 5: Visual QA Matrix

Add or extend Playwright visual tests to capture every bundled theme family in both light and dark resolved appearances where variants exist.

Required scenarios:

- Default workspace shell with editor, explorer, statusbar, terminal rail.
- Terminal pane with shell, Claude, and Codex tabs.
- Expanded project roots drawer.
- Search panel with grouped results and snippets.
- Settings dialog on the Appearance section.
- Agent Config Editor dialog with instructions, skills, and sources tabs.
- Markdown live preview with headings, links, tags, tables, blockquotes, code blocks, lists, checked tasks, and folded list controls.
- Raw code file with line numbers, syntax, active line, selection, cursor, fold/lint gutters.
- Browser pane header/address field.
- Onboarding/workspace picker.
- Project changed-files list with observed agent chips.
- Subagent drawer/cards once agent roster work expands.

For screenshots, use the existing `apps/desktop/tests/visual/shell.visual.spec.ts` patterns. Add helpers that select mode and theme deterministically rather than clicking the appearance cycle repeatedly.

### Phase 6: Documentation For New Themes

Add `docs/theme-authoring.md` after the first implementation. It should include:

- token meanings
- required contrast pairs
- how to add a theme family
- how to run contrast tests
- how to update visual baselines
- examples of bad token usage

## Initial Bundled Themes

Start with a small set. More themes can come after the model holds.

### `exo-neutral`

Default. Charcoal dark and neutral paper light.

Purpose: the baseline Exo identity. Quiet, operational, less warm than the current light theme.

### `exo-solar`

Current warm/Solarized-like light and matching soft dark.

Purpose: preserve the existing warm direction as an explicit user choice.

### `exo-graphite`

Darker, denser, more code/terminal-forward.

Purpose: long terminal-agent sessions, lower glare, strong editor/terminal integration.

### `exo-high-contrast`

Accessibility-forward theme.

Purpose: stronger text, borders, focus rings, and state separation. This should be visually restrained, not a novelty theme.

## Surface Inventory For Agents

Agents implementing themes should verify these surfaces use semantic tokens:

- App shell: `shell-frame`, `topbar`, `statusbar`, `workspace`.
- Explorer: `sidebar`, `sidebar__rail`, `tree-node`, `search-result`, `project-change`.
- Editor panes: `editor-pane`, `tab-strip`, `chrome-tab`, `editor-panel`, `properties-card`, `editor-surface`.
- Markdown live preview: `exo-md-line-*`, `exo-md-table`, `exo-md-checkbox`, `exo-md-fold-toggle`, tag/link/list styling.
- CodeMirror: content, gutter, active line, cursor, selection, syntax highlighting.
- Terminal: `terminal-dock`, `terminal-rail`, `terminal-tab`, `terminal-surface`, xterm theme.
- Browser: `browser-pane`, address field, controls.
- Drawers: `snap-drawer`, `footer-drawer`, `floating-panel`.
- Panels/dialogs: `search-panel`, `dialog-card`, settings, onboarding, path list, help tooltip.
- Agent surfaces: `agent-icon`, `agent-config-editor`, `agent-skills`, `agent-sources`, subagent drawer/cards.
- Review/provenance surfaces: `project-changes`, `project-change__agent--observed`, future human/agent authorship marks.

## Acceptance Criteria

Functional:

- User can choose a named color theme in Settings.
- User can still choose `System`, `Light`, or `Dark` mode.
- Theme and mode persist in workspace settings.
- System mode updates when OS color scheme changes.
- Theme switching updates CSS, CodeMirror, and xterm without app restart.
- Existing settings normalization preserves old settings files.

Quality:

- No meaningful renderer color literals remain outside theme registry/contrast test fixtures, except documented shadows or transparent overlays.
- All bundled themes pass contrast tests.
- Visual tests cover at least default, terminal, drawer, settings, markdown, and light/dark variants.
- Theme changes do not resize panes, tabs, terminals, or editor content.
- Text remains readable in compact split panes and side drawers.

Regression commands:

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm test:visual
```

Run focused Playwright e2e around settings/theme switching when implementation lands.

## Non-Goals For First Pass

- Arbitrary user-defined color pickers.
- Marketplace/imported third-party themes.
- Per-project theme overrides.
- Theme-aware typography changes.
- Animated or decorative theme backgrounds.
- Graph-specific theme customization before graph views exist.

## Risks

- Partial migration: CSS changes but CodeMirror/xterm stay hardcoded. Mitigation: registry is the source for all consumers.
- Low-contrast muted text: paths, snippets, comments, and status labels become unreadable. Mitigation: contrast pair tests include muted roles.
- State color overload: accent used for everything. Mitigation: explicit state tokens and status migration.
- Light theme glare or beige dominance. Mitigation: ship neutral light as default and keep warm/Solarized as named optional.
- Visual baseline churn. Mitigation: introduce one default theme first, then add additional themes after screenshot matrix is stable.

## Suggested First PR Slice

1. Add `colorThemeId` setting, normalization, tests, and Settings UI select.
2. Add theme registry with `exo-neutral` and an `exo-solar` mapping of current colors.
3. Apply resolved theme CSS variables in `App.tsx`.
4. Move CodeMirror syntax and xterm themes to registry-backed functions.
5. Replace hardcoded statusbar state colors with state tokens.
6. Add contrast unit tests for registry themes.
7. Add one visual test that captures default workspace under `exo-neutral` dark and light.

After that PR lands, add `exo-graphite`, `exo-high-contrast`, broaden screenshots, and write `docs/theme-authoring.md`.

-- Shoshin | 2026-06-20
