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
- Plugin Manager can inspect categories, details, local trust/enable/disable, local plugin settings, and Exo-managed local plugin add/remove/swap actions.
- Plugin Manager now surfaces Exograph Baseline versus official, local, and developer plugin layers so users can tell what is core, what is optional, and which plugin rows are actually manageable there.
- Plugin Manager now includes category-scoped state filters for all, active, needs-attention, disabled, local/developer, and plugin-settings rows, so it reads more like a management surface than a manifest browser.
- Onboarding shows a read-only capability review.
- Profiles can be parsed, dry-run previewed, activated as workspace state, and copied into trusted workspace-local metadata profile plugins.
- Exograph Baseline exists as a bundled metadata-only profile plugin at `plugins/exograph-baseline/exo.plugin.json`.
- Settings uses vertical navigation and includes a workspace Profile page plus a read-only Profile Customize screen.
- Profile Settings now asks the main process for the canonical `ProfilePlanPreview` so the UI can show real profile actions, warnings, blockers, and future effects without importing Node-only core planning code into the renderer.
- Profile Customize now reads as a component edit hub: recommended plugins link to Plugin Manager, instruction/templates/skills link to Agent Config, and direct profile writes remain disabled until the staged apply/permission model exists.
- The bottom status bar shows profile review state and changed notes state.
- Changed notes open a read-only modal listing note-root git changes with path, status, root label, changed line when known, and an open-note action.
- Trusted, enabled profile capabilities can stage profile-owned context, instruction, and MCP config file templates as `.exo` proposal records when the profile declares `reviewPolicy.fileChanges: "propose"`, `requireHumanReview: true`, and allowed template paths. Target files are written only by later UI/CLI proposal acceptance, and the apply host re-checks Exo-created profile-apply metadata, embedded review policy, item kinds, and allowed paths.

Gaps:

- Profile component edits are centralized visually but not yet editable.
- Profile component hub links to existing specialized managers, but it does not yet provide inline editors for profile JSON, instruction files, skills, routines, schemas, or graph views.
- Templatize, permission review, AI/headless harness calls, plugin enablement, grants, skills, routines, settings changes, and broad profile apply are not implemented.
- Profile-owned context, instruction, and MCP config templates can be staged as reviewable proposal batches only through explicit UI invocation and policy gates; they still require explicit Desktop/CLI acceptance before any target file write.
- Profile modified/review state is visible, but there is no diff against profile-owned component refs yet.
- Notes repo git state is visible, but there are no inline diffs, stage/commit actions, or provenance links yet.
- Local plugin add/remove/swap flows exist for Exo-managed user/workspace plugin directories, but not for remote install/update flows or marketplace-style distribution.

## Target UX

### Plugin Manager

The right-rail Plugin Manager should become a quick management surface:

- a top-level baseline/layer summary: Exograph Baseline, official plugins, local plugins, developer plugins, and how each is managed
- summary buckets: active, disabled, untrusted, missing setup, permissions needed, updates/review needed
- categories: Search, Harnesses, Profiles, Routines, Graph, Analyzers, Dashboards, Local
- fast trust/enable/disable actions for local/developer plugins
- visible setup state and dependency guidance
- visible requested/granted/missing permissions
- visible surfaces contributed by a plugin
- visible plugin-owned settings for trusted/enabled local plugins
- links/buttons to open deeper settings pages for complex configuration
- open manifest/root folder actions
- add/remove/swap local metadata plugin directories from managed user/workspace plugin roots

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

Current implementation keeps this screen read-only but already uses that routing model: plugin recommendations open Plugin Manager, and instruction/template/skill sections open Agent Config Editor. Inline profile field editing remains behind the staged apply and permission model.

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
- `../tasks.md` has concrete UI/backend tasks for profile/plugin management

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

- no profile apply flow that writes plugins/routines/settings/permission grants
- profile-owned instruction/context/MCP file templates may be staged as reviewable proposals only
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

Completed in this phase:

- profile review state appears as a bottom-bar affordance and opens Profile Settings
- changed note-root git state appears as a bottom-bar affordance and opens a read-only changed-notes modal
- the changed-notes modal can open changed notes and carries future diff/commit copy without exposing commit actions yet
- Profile Settings and Customize show backend profile plan sections: recommended plugins, templates/config refs, skills, schemas, routines, graph/analyzer defaults, policies, warnings, blockers, and apply-safety state.
- Profile Customize links plugin recommendations to Plugin Manager and agent instruction/template/skill components to Agent Config Editor while keeping direct profile writes disabled.
- Top-level Review and Copy actions use safe existing behavior: review opens the read-only plan view, and copy creates a workspace-local metadata profile. Apply, Save draft, and Templatize remain disabled until explicit permissioned flows exist.
- Plugin Manager rows can now show provider-neutral readiness metadata. QMD is the first producer, but the UI reads a generic readiness state, label, detail, and metrics so future search providers can report setup/indexing/degraded/error states without becoming core-specific.

Verification:

- renderer tests for stateful profile settings
- Playwright flow for opening settings, seeing profile, toggling auto-update, copying profile, opening notes changes modal
- screenshots for Profile Settings, Edit Profile, Plugin Manager, notes changes modal

### Phase 5: Backend Pass 2

Goal: finish the documented plugin/profile management foundation before GA-specific work.

Deliverables:

- permission prompt UX/backend integration for metadata grants
- profile apply review model that can stage planned file-template changes but still requires explicit confirmation
- plugin install/remove state cleanup
- split remaining terminal/session substrate ids from harness-adapter ids where needed for arbitrary registered harnesses

Completed foundation pieces:

- local plugin add/remove/swap primitives for metadata plugin directories
- provider-neutral search readiness metadata in Plugin Manager

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
- Adding broad profile apply before permission prompts would create hidden mutations. Keep plugin enables, skills, routines, settings, and grants disabled until their confirmation model exists; profile-owned file templates may use the proposal review queue only with trusted/enabled profile metadata, human-reviewed propose policy, allowed-path evidence, and UI/CLI proposal acceptance.
- Adding git commit flows too early would expand scope. Start with read-only changed-note listing.
- Templatize via AI is valuable, but it should wait until headless routine/harness execution and review artifacts are stronger.

-- Exo | 2026-06-28
