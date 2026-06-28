# Profile And Plugin Management Plan

Last updated: 2026-06-28

This plan turns the current plugin inventory foundation into a usable profile and plugin management experience.

## Product Decision

Profiles and plugins are related but not the same thing.

- A **profile** is the workspace interpretation layer: graph conventions, metadata/frontmatter mappings, context templates, agent instruction files, recommended plugins, routine templates, graph views, review policy, and output policy.
- A **plugin** is a capability provider: search provider, harness adapter, graph visualization, routine template, analyzer, eval runner, exporter, dashboard, or local web app.
- **Settings** owns baseline Exo behavior and active workspace profile management.
- **Plugin Manager** owns plugin lifecycle, setup, quick enablement, dependency state, permissions, and plugin-owned configuration.
- **Onboarding** chooses/reviews the first workspace profile and initial plugin set, then hands ongoing management to Settings and Plugin Manager.

The user should be able to answer three questions without reading manifests:

1. What profile is this workspace using?
2. Which plugins are active, inactive, missing, untrusted, or misconfigured?
3. What changed from my profile or notes graph that needs review, sync, or commit?

## Current State

Already implemented:

- Plugin inventory API exposes core, official, local, developer, trust, enablement, dependency, settings, runtime, and permission-grant metadata.
- Plugin Manager can inspect categories, details, local trust/enable/disable, and local plugin settings.
- Onboarding shows a read-only capability review.
- Profiles can be parsed and dry-run previewed, but applying/activating a profile is not implemented.
- Exograph Baseline exists as a bundled metadata-only profile plugin at `plugins/exograph-baseline/exo.plugin.json`.

Gaps:

- There is no persistent active workspace profile state.
- Plugin Manager reads more like inventory than management.
- Profile details are visible only as a plugin detail panel, not as workspace-level state.
- Settings still uses horizontal tabs and has no Profile page.
- Profile component edits are not centralized.
- There is no profile modified indicator in the status bar.
- Notes repo git state is not surfaced as a first-class review affordance.

## Target UX

### Plugin Manager

The right-rail Plugin Manager should become a quick management surface:

- summary buckets: active, disabled, untrusted, missing setup, permissions needed, updates/review needed
- categories: Search, Harnesses, Profiles, Routines, Graph, Analyzers, Dashboards, Local
- fast trust/enable/disable actions for local/developer plugins
- visible setup state and dependency guidance
- visible requested/granted/missing permissions
- visible surfaces contributed by a plugin
- visible plugin-owned settings for trusted/enabled local plugins
- links/buttons to open deeper settings pages for complex configuration
- open manifest/root folder actions
- eventually add/remove/swap local plugins from configured plugin directories

The Plugin Manager is not the profile editor. It can show profile packages and whether they are available, but active profile editing belongs in Settings.

### Settings

Settings should move from horizontal tabs to a left vertical navigation list.

Initial pages:

- Workspace
- Profile
- Search
- Editor
- Appearance
- Terminal
- Preview
- Advanced

Agent Config remains a separate specialized surface, but Profile Settings can deep-link to it for instruction/skill editing.

### Profile Settings

The Profile page should show:

- active profile: `Exograph Baseline`, imported local profile, custom profile, or none
- source plugin/manifest path for the profile package
- profile scope: workspace, note root, selected project roots
- recommended plugins and their current state
- metadata/frontmatter schemas
- context templates
- instruction templates and linked `AGENTS.md` / `CLAUDE.md` files
- MCP config templates
- skills by harness
- routine templates
- graph views
- analyzer settings
- review and output policies
- auto-update toggle
- profile modified state

Actions:

- **Review change**: show what differs from the active profile.
- **Customize**: open an edit profile screen.
- **Copy**: duplicate the current profile into a local editable profile.
- **Templatize**: use the configured default/headless harness to turn a local customized profile into a generalized profile template proposal.
- **Apply**: future permissioned apply flow only after trust and permission prompts exist.

### Edit Profile Screen

The edit screen centralizes profile components:

- profile metadata: id, name, description, scope
- recommended plugins
- agent context files
- skills and harness mappings
- metadata/frontmatter mappings
- routines/templates
- graph views
- review/output policies

The first version can edit only JSON-backed profile state and link out to specialized editors:

- Agent Config Editor for `AGENTS.md` / `CLAUDE.md`
- Plugin Manager for plugin lifecycle/config
- Routine UI/CLI for routine instantiation

### Status Bar Indicators

Add compact bottom-bar affordances:

- profile modified indicator: current profile has unapplied or unreviewed linked state changes
- notes repo changes indicator: selected notes repository has changed files
- clickable notes changes modal listing changed notes, status, path, and future diff/commit actions

Near-term modal:

- list changed files under note roots
- show git status category
- open changed note
- show associated note root/repo

Future modal:

- inline diffs
- stage/commit actions
- link changes to profile/routine/agent provenance

## Phase Plan

### Phase 0: Docs Pass

Goal: make the product model clear before more code lands.

Done when:

- this plan exists and is linked from `docs/README.md`
- `docs/plugin-system-architecture.md` distinguishes Plugin Manager, Profile Settings, and Onboarding
- `docs/tasks.md` has concrete UI/backend tasks for profile/plugin management

Verification:

- `pnpm check:repo`

### Phase 1: Plan Pass

Goal: produce implementation-ready plans for UI and backend slices.

Workstreams:

- UI plan: Plugin Manager quick manager, vertical Settings nav, Profile page, Edit Profile screen
- Backend plan: active profile state, auto-update toggle, profile component references, copy/templatize boundaries
- Status plan: profile modified indicator, notes repo changes indicator, changed-notes modal

Done when:

- each workstream names files/modules to change
- each workstream has test and screenshot gates
- sequencing is clear enough for parallel implementation without overlapping write scopes

Verification:

- planning outputs reviewed against this doc

Planning outputs from 2026-06-28:

- UI work should start in `WorkspaceSettingsDialog.tsx`, `workspaceSettingsDialogTypes.ts`, `PluginManagerDialog.tsx`, `pluginManagerModel.ts`, shared onboarding/profile review helpers, and new `ProfileSettingsSection` / `profileSettingsModel` modules.
- Backend work should add a core `profile-state` store under the workspace runtime root, then expose read/set/clear/auto-update APIs through shared desktop API, preload, and main-process IPC. This state is a profile reference and review state only, not an apply/write engine.
- Status-bar work should keep `ShellLayout` as the renderer but separate project changes, note changes, profile review, and index indicators. Notes changes should reuse git-status parsing against note roots and open a read-only changed-notes modal before any diff/commit actions exist.
- Screenshots are required for the Settings/Profile page, Plugin Manager manager state, and notes/profile status indicators before treating UI slices as accepted.

### Phase 2: UI Pass 1

Goal: create the visible shells without enabling risky writes.

Deliverables:

- vertical Settings navigation
- Profile Settings read-only page
- Plugin Manager copy/layout changes so it reads as a manager
- profile details visible from Settings
- bottom-bar placeholders for profile and notes changes where data exists or can be stubbed safely

Non-goals:

- no profile apply
- no AI templatize execution
- no git commit actions
- no executable plugin loading

Verification:

- renderer unit tests for navigation/page rendering
- Playwright or screenshot QA for Settings/Profile and Plugin Manager
- screenshots sent to user before backend write flows

### Phase 3: Backend Pass 1

Goal: add persistent read/write state needed by the UI while staying metadata-only.

Deliverables:

- `.exo/profile-state.json` or equivalent core store for active profile id, source, scope, auto-update toggle, modified state, and component refs
- command-server/preload API for reading profile state and profile review previews
- profile copy operation that creates a local metadata profile without mutating user content
- notes git status API scoped to note roots

Non-goals:

- no profile apply flow that writes instructions/plugins/routines
- no headless harness templatize call yet
- no git commit/write actions

Verification:

- core tests for profile state store and plan/review
- main/preload/API tests
- CLI/desktop typecheck

### Phase 4: UI Pass 2

Goal: wire the UI to real backend state and make the workflows usable.

Deliverables:

- Profile Settings shows active profile state, auto-update toggle, modified indicator, copy action, and component summaries
- Edit Profile screen can edit metadata/profile-state fields and link to specialized editors
- Plugin Manager uses permission summaries and setup states prominently
- bottom-bar profile modified and notes changes indicators open useful modals

Verification:

- renderer tests for stateful profile settings
- Playwright flow for opening settings, seeing profile, toggling auto-update, copying profile, opening notes changes modal
- screenshots for Profile Settings, Edit Profile, Plugin Manager, notes changes modal

### Phase 5: Backend Pass 2

Goal: finish the documented plugin/profile management foundation before GA-specific work.

Deliverables:

- permission prompt UX/backend integration for metadata grants
- profile apply review model that can stage planned changes but still requires explicit confirmation
- local plugin add/remove/swap primitives for metadata plugin directories
- plugin install/remove state cleanup
- provider-neutral search readiness metadata in Plugin Manager
- split remaining terminal/session substrate ids from harness-adapter ids where needed for arbitrary registered harnesses

Deferred beyond this phase:

- executable plugin loading
- native renderer plugin loading
- plugin-contributed CLI/MCP tools
- AI templatize execution through a live headless harness
- git commit actions for notes

Verification:

- core, CLI, MCP, desktop tests
- `pnpm check`
- `pnpm stable:smoke`
- app screenshots for each changed UI surface
- manual QA checklist before GA work resumes

## Completion Criteria For This Cycle

This cycle is finished when:

- Plugin Manager clearly manages plugins rather than merely showing inventory.
- Settings has a Profile page and scalable vertical navigation.
- Active profile state is persistent and visible.
- Users can inspect everything contained in the active profile.
- Users can copy/customize a profile without mutating official profile packages.
- Profile modified state is visible.
- Notes repo changes are visible from the bottom bar.
- All write-capable flows are either safely implemented with explicit confirmation or clearly disabled with a reason.
- Tests and screenshots cover the new UI.

## Risks

- Overloading Plugin Manager with profile editing would blur product concepts. Keep profiles in Settings.
- Adding profile apply before permission prompts would create hidden mutations. Keep apply review-only until grants and confirmation exist.
- Adding git commit flows too early would expand scope. Start with read-only changed-note listing.
- Templatize via AI is valuable, but it should wait until headless routine/harness execution and review artifacts are stronger.

-- Exo | 2026-06-28
