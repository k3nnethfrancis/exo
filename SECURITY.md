# Security

Exo is local-first software that can read workspace files and operate terminal sessions. Treat it as a trusted local developer tool, not a sandbox.

## Reporting

If you find a vulnerability, please open a private report through GitHub security advisories once the repository is public. Until then, contact the maintainer directly.

## Local Data

Exo stores runtime state under the configured workspace root:

- `.exo/server.json`
- `.exo/terminal-sessions.json`
- `.exo/terminal-transcripts/`
- `.exo/instructions/`
- `.exo/qmd/`
- `.exo/routines/`, `.exo/runs/`, and `.exo/artifacts/` when routine/activity features are used

Desktop settings are stored in the platform application-data directory unless `EXO_SETTINGS_PATH` is set.

Terminal transcripts, QMD indexes, routine artifacts, and run records may contain secrets typed or printed in terminals, note contents, prompts, or project data. Terminal transcript retention currently defaults to `forever`; users should review retention settings and avoid exposing `.exo/` publicly.

Plugins are not a sandbox boundary yet. Current plugin manifests are metadata-only, and future executable plugins must go through explicit trust and permission surfaces before they can read files, launch processes, expose tools, or use network/model providers.
