# Security

Stem is local-first desktop software. It reads and writes files only within the
Note Roots a user authorizes, and it can launch explicitly configured local
commands. Treat it as a trusted local tool, not as a sandbox.

## Report a vulnerability

Please use GitHub's private vulnerability-reporting flow for this repository.
Do not open a public issue for a suspected security vulnerability.

Include the affected version or commit, reproduction steps, impact, and any
safe mitigation you found. We will acknowledge valid reports and coordinate a
fix before public disclosure.

## Local data

Markdown and frontmatter inside authorized Note Roots are canonical user data.
Exograph's derived local state may include:

- `.exograph/server.json` — local command-server discovery;
- `.exograph/qmd/` — a rebuildable local search index;
- `.exograph/invocations/` — invocation records and review snapshots;
- `.exograph/invocation-continuity/` — scoped command-session continuity state;
- `.exograph/ontology/` — the accepted identity of an optional ontology source;
- `.exograph/artifacts/` — local generated artifacts when needed.

Do not publish a workspace's `.exograph/` directory. It can contain file paths,
note content, prompts, or command metadata. Exograph warns when `.exograph/` is not
ignored by a Git workspace; it does not rewrite the user's `.gitignore`.

Desktop settings and command-trust decisions live in the platform application
data directory. Commands are explicitly authorized per Workspace and executable
fingerprint; changing the executable or copying the Workspace requires renewed
authorization.
