The review is complete and the plan file is written at `/Users/kenneth/.claude/plans/fable-review-mellow-bengio.md`. (ExitPlanMode is not available in this session's toolset, so the written plan file is the approval artifact.)

**TLDR of the ruling: Option B approved, with three amendments — rename `spawn` to `invoke` with no alias, keep `read`, and make `terminals` removal contingent on invocation records being the post-invoke observation path.**

Key positions, grounded in the actual code:

- **Retained set (Q1):** B's eight commands all pass the four-purpose test. The removals are safe — my consumer scan across the repo and notes vault found `terminals`, `preview`, and `config` referenced only in docs and session history, no live consumers. `terminals write|send` deserves removal on its own merits: it's a keystroke-injection path into user terminals, which is exactly what the public contract shouldn't advertise.
- **`read` stays (Q2):** the MCP/CLI asymmetry is principled. An MCP tool reads with Exo's authority regardless of host permissions; the CLI runs under the caller's own shell authority, so `exo read` adds value (docid addressing matching search results, Note-Root bounding, app-off parity) without adding authority.
- **`invoke` rename (Q3):** the product says "invocation" everywhere except this one verb, and the migration cost is near-zero now but becomes a real deprecation once a packaged CLI exists. Internal route/method names can stay.
- **Installer policy (Q4):** sound, with one structural correction — the replacement action belongs in `scripts/install-local`, not an in-app button, because the packaged app has no checkout to build from. The onboarding CLI card detects, classifies (five cases: missing / current / legacy Exo shim / dangling / non-Exo), and hands the user the exact command. Legacy Exo shims should be identified by the `packages/cli/dist/index.cjs` marker in the resolved launcher, not path shape alone, and replace without `--force`; non-Exo targets always refuse.
- **Tests/docs (Q5):** help-output contract assertion, installer classification cases, MCP-setup no-bin-writes assertion, and guard-ledger entries for all three protected slices (CLI flags, app-client methods, and command-server route table — the zero-caller routes should go in the same wave, per the 2026-07-11 discipline).
- **Sequencing (Q6):** one wave, three independently gateable chunks (CLI contract, installer, onboarding cards). The source-backed lifetime is a reason to move now, not to wait.

On approval, the only action is writing this ruling into the empty placeholder at `docs/reviews/2026-07-14-cli-contract-and-installation-response.md` as `## Fable ruling — 2026-07-14`; implementation assignment stays with Shoshin.
## Fable ruling — 2026-07-14

**Session:** `65e69d60-b17c-4a56-a62d-ff276faad9d9`
**Verdict:** approve Option B with amendments.

### Approved contract

```text
exo [start] | show
exo status
exo search <query> [--limit n]
exo read <path-or-docid> [--from n] [--lines n]
exo index status | sync
exo open <path>
exo invoke @handle <task>
exo mcp serve
```

`exo mcp serve` is installation transport, not an ordinary agent task.
`status`, `search`, and `read` remain app-off primitives. The remainder are
explicit app handoff, index maintenance, or configured-Command invocation.

Remove from the public CLI: `config get`, `preview`, `terminals`, and `index
add|remove`. The latter would create a second Workspace-scope mutation path;
terminal write/send is public keystroke injection into a user-visible terminal.
The only contingency is post-invocation observation: invocation records and
in-app review must remain sufficient. If real dogfood needs CLI observation of
a running invocation, evaluate a narrow future `exo invocations` read surface;
do not restore terminal remote control.

### Specific answers

1. Rename `spawn` to **`invoke`**, with no alias. Invocation is the product's
   vocabulary everywhere else, and zero known external consumers makes this the
   inexpensive point to align. Internal route/method names may remain unchanged.
2. Keep CLI `read` while MCP omits it. MCP reads through Exo authority; the CLI
   runs with the caller's existing shell authority. CLI `read` adds bounded
   document-id resolution and app-off parity without granting access.
3. The CLI installer, not the packaged app, owns replacement. The app has no
   checkout to build from. Onboarding diagnoses the command and gives the exact
   next command; it must never mutate a bin directory as an MCP side effect.
4. `scripts/install-local` classifies its target as missing, current Exo shim,
   legacy Exo shim, dangling shim, or non-Exo target. It may replace a verified
   legacy/dangling Exo `bin/exo` shim and must log old to new. It must refuse a
   regular file, directory, or non-Exo symlink unless the user uses `--force`.
   Detection checks the launcher marker (`packages/cli/dist/index.cjs`), not
   merely a path shape.

### Required implementation evidence

- Exact `exo help` contract tests; removed commands fail; `invoke` validation
  replaces `spawn`; app-off retrieval parity remains covered.
- Installer coverage for fresh/current/legacy/dangling/non-Exo/force/dry-run
  cases, plus main-process classification tests for the same states.
- MCP setup proves it performs no bin-directory writes and directs a missing CLI
  to CLI installation rather than MCP retry.
- Remove zero-caller command-server routes/client methods in the same wave and
  update protected-contract hashes with this ruling as the architecture review.
- Refresh README, onboarding/MCP documentation, global agent guidance, and the
  Unreleased changelog; package and exercise first-run onboarding.

### Sequencing

Proceed as one wave with three independent gates:

1. CLI contract and zero-caller route cleanup.
2. Source-backed CLI installer classification/replacement policy.
3. Separate MCP and CLI onboarding cards with detection-only CLI states.

The source-backed CLI is a reason to do this now, not to wait for a standalone
packaged CLI.

-- Fable | 2026-07-14
