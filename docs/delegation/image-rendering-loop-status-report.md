# image-rendering-loop status

## 2026-07-13 — delegated
**State:** working
**Goal:** Make local Markdown images render reliably in Exo, including the reported root-relative site image, with deterministic Electron E2E proof.
**Done:** Worktree and branch created from `refactor/note-native-exo` at `73add97`.
**Evidence:** Reported note uses `![The nested agentic work loop and human governance loop](/images/posts/self-improving-business-systems/loop-stack.png)` in `notes/kenneth-dot-computer/garden/blog/self-improving-business-systems.md`; the real asset is `notes/kenneth-dot-computer/garden/images/posts/self-improving-business-systems/loop-stack.png`.
**Next:** Build a red-capable Electron repro, rank hypotheses, implement the narrowest path-resolution/rendering fix, then run focused and full gates.
**Needs orchestrator:** none
**Risk / scope note:** Preserve filesystem containment and never enable remote image loading. Do not paper over failures with a generic fallback.

## 2026-07-13 — orientation complete
**State:** red-capable feedback loop established
**Goal:** Reproduce the reported nested-site root-relative image failure through both the resolver and the real Electron renderer/main/IPC path.
**Done:** Read repository protocols, architecture/harness/task/issue ledgers, debugging and Electron QA skills, and mapped the full `MarkdownImageWidget` → preload IPC → `WorkspaceNotesService` path. Added focused resolver and Electron regression cases using the exact `/images/posts/self-improving-business-systems/loop-stack.png` syntax under a nested `kenneth-dot-computer/garden` content tree.
**Evidence:** `pnpm --filter @exo/desktop exec vitest run src/main/workspace-notes-service.test.ts` is the fast red loop. It fails deterministically because the service resolves the target to `<Note Root>/images/...` while the fixture asset exists at `<Note Root>/kenneth-dot-computer/garden/images/...`: `ENOENT .../notes/images/posts/self-improving-business-systems/loop-stack.png`. The required Electron command is `pnpm --filter @exo/desktop build && pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/markdown-images.spec.ts`; its assertion requires a real `<img>` with `naturalWidth > 0`.
**Next:** Run the Electron loop red, minimize the reproduction, rank falsifiable hypotheses, then probe one variable at a time before changing production code.
**Needs orchestrator:** none
**Risk / scope note:** No shared/public contract changes are currently indicated. Resolution must remain inside main-process `WorkspaceFiles` authorization and must not admit remote or arbitrary `file:` URLs.

## 2026-07-13 — diagnosis started
**State:** reproduced and minimized
**Goal:** Identify the failing boundary without changing production behavior.
**Done:** Ran the source-built Electron journey red. The widget is created and visible, but no loaded `<img>` appears (`naturalWidth` remains `0`), matching the user's `Image unavailable` symptom. The lower-level failure reduces to one variable: the current root-relative resolver always prefixes the configured Note Root.
**Evidence:** `pnpm --filter @exo/desktop build && pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/markdown-images.spec.ts` fails at `naturalWidth > 0`; trace: `apps/desktop/test-results/markdown-images-loads-a-ro-6a77e-the-Electron-notes-resolver/trace.zip`. Ranked hypotheses: (1) **highest** — root-relative resolution incorrectly treats the outer Note Root as the authored site's root; prediction: resolving against the nearest source ancestor containing the target makes both unit and Electron cases green. (2) Electron rejects the authorized `file:` URL; prediction: even a known-good Note-Root-level `/images/...` target would retain `naturalWidth = 0`. (3) the Markdown parser/title stripping alters the target; prediction: main IPC would receive a target differing from the exact source string. (4) lazy loading or viewport timing prevents load; prediction: scrolling the visible widget into view or removing lazy load would make it load without changing resolution. (5) the PNG fixture is invalid; prediction: the same bytes fail when addressed through a known-good relative path.
**Next:** Add/control-run known-good relative and Note-Root-root-relative cases to falsify hypotheses 2–5, then implement ancestor-aware root-relative resolution only if hypothesis 1 remains.
**Needs orchestrator:** none
**Risk / scope note:** The proposed rule is deterministic nearest-existing ancestor search bounded by the source note's authorized Note Root. Every candidate must still pass `WorkspaceFiles.existing`; missing candidates alone may be skipped, while containment/symlink/permission failures must fail closed.

## 2026-07-13 — diagnosis complete
**State:** root cause proven
**Goal:** Falsify renderer, parsing, lazy-load, and fixture hypotheses before production edits.
**Done:** Added relative and Note-Root-root-relative control images to the same Electron note and reran the red journey unchanged.
**Evidence:** Both controls loaded with `naturalWidth > 0`; only the nested-site `/images/...` image remained at `0`. This falsifies hypotheses 2–5: Electron accepts the authorized file URL, the parser/IPC path preserves usable targets, lazy loading works in the visible editor, and the PNG bytes are valid. Hypothesis 1 is confirmed: the single fixed Note Root base is the wrong resolution rule for nested authored site roots. The existing image work passed because its only root-relative test used `/folder/...` whose asset was deliberately located directly under the configured Note Root; it never represented a nested content tree.
**Next:** Implement nearest-existing ancestor resolution for root-relative targets, preserving source-directory semantics for relative targets and fail-closed authorization for every candidate.
**Needs orchestrator:** none
**Risk / scope note:** Do not catch non-missing failures during ancestor search. A symlink escape, traversal outside the Note Root, permission error, remote scheme, or malformed target must terminate resolution rather than falling through to another ancestor.

## 2026-07-13 — fix complete
**State:** verification in progress
**Goal:** Apply the narrowest evidence-backed rule without changing filesystem authority.
**Done:** Root-relative image lookup now walks from the source Note's directory toward its authorized Note Root and selects the nearest existing regular file. Relative paths remain source-directory-relative. Every candidate passes `WorkspaceFiles.existing`; only `ENOENT`/`ENOTDIR` advance the search. Added regression coverage for the reported nested site, nearest-match precedence, URL-encoded spaces, directory-vs-file behavior, traversal, remote/file refusal, missing targets, and symlink escape.
**Evidence:** Focused resolver suite is green: 13/13. The built Electron journey is green and proves relative, Note-Root-root-relative, and nested-site-root-relative images all produce real loaded `<img>` elements with `naturalWidth > 0`. A read-only probe against the user's exact note/asset pair resolves to `file:///Users/kenneth/Desktop/lab/notes/kenneth-dot-computer/garden/images/posts/self-improving-business-systems/loop-stack.png` without mutating either file.
**Next:** Run all related desktop tests, typecheck, production build, repository checks, rerun Electron evidence, capture screenshot if feasible, review the diff, then commit.
**Needs orchestrator:** none
**Risk / scope note:** No renderer, preload, IPC, shared protocol, CLI, or public contract changed. The behavioral change is confined to the existing main-process resolver behind the existing IPC route.

## 2026-07-13 — ready for review
**State:** ready-for-review
**Goal:** Hand off a clean, evidence-backed fix.
**Done:** Removed all diagnostic-only work, documented behavior and the resolved issue, added the Unreleased changelog entry, reviewed the final control/data flow, and captured source-built Electron screenshot evidence at `apps/desktop/test-results/markdown-images-loads-a-ro-6a77e-the-Electron-notes-resolver/markdown-images-loaded.png`.
**Evidence:** Desktop typecheck passed; 179/179 desktop main/renderer tests passed; production Electron build passed; `pnpm check:repo` passed; focused Electron Playwright passed in 1.3s with a visible nested-site image and `naturalWidth > 0`; `git diff --check` passed; no `[DEBUG-...]` instrumentation remains.
**Next:** Re-run the repository check after the final report edit, commit on `delegates/image-rendering-loop`, mark complete, and notify the orchestrator with commit/evidence.
**Needs orchestrator:** none
**Risk / scope note:** Packaged-app installation was not used because this is a source resolver change with full main/preload/renderer Electron coverage. The exact live-vault pair was exercised through a read-only resolver probe; no user file was changed.

## 2026-07-13 — complete
**State:** complete
**Goal:** Finish the delegated image-rendering loop with a reviewable branch commit.
**Done:** Committed the scoped implementation, tests, tracker entry, architecture note, changelog, and durable status evidence on `delegates/image-rendering-loop`.
**Evidence:** Commit `e356e97` (`fix: resolve nested root-relative markdown images`) contains the completed slice; all ready-for-review gates above passed on that tree.
**Next:** Orchestrator review/cherry-pick or merge into the active Exo branch, then rebuild/relaunch Exo for user verification on the original note.
**Needs orchestrator:** integrate commit and rebuild the active app
**Risk / scope note:** Remaining risk is limited to installed-app visual confirmation on the user's original note after integration; automated Electron and exact-path resolver evidence are green.
