# Security

Exo is local-first software that can read workspace files and operate terminal sessions. Treat it as a trusted local developer tool, not a sandbox.

## Reporting

If you find a vulnerability, please open a private report through GitHub security advisories once the repository is public. Until then, contact the maintainer directly.

## Local Data

Exo stores runtime state under the configured workspace root:

- `.exo/server.json`
- `.exo/terminal-state.json`
- `.exo/terminal-transcripts/`
- `.exo/instructions/`

Desktop settings are stored in the platform application-data directory unless `EXO_SETTINGS_PATH` is set.

Terminal transcripts may contain secrets typed or printed in terminals. The default retention policy limits age and size, but users should still avoid exposing `.exo/` publicly.
