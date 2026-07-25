# Security

Exo is local-first desktop software. It reads and writes files only within the
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
Exo's derived local state may include:

- `.exo/server.json` — local command-server discovery;
- `.exo/qmd/` — a rebuildable local search index;
- `.exo/invocations/` — invocation records and review snapshots;
- `.exo/invocation-continuity/` — scoped command-session continuity state;
- `.exo/ontology/` — the accepted identity of an optional ontology source;
- `.exo/artifacts/` — local generated artifacts when needed.

Do not publish a workspace's `.exo/` directory. It can contain file paths,
note content, prompts, or command metadata. Exo warns when `.exo/` is not
ignored by a Git workspace; it does not rewrite the user's `.gitignore`.

Desktop settings and command-trust decisions live in the platform application
data directory. Commands are explicitly authorized per Workspace and executable
fingerprint; changing the executable or copying the Workspace requires renewed
authorization.
