# Open Source Readiness

Last updated: 2026-05-12

## Support Target

Exo is currently macOS-first.

- Supported target: macOS development and unsigned macOS packaging.
- Experimental targets: Windows and Linux source builds.
- Not yet promised: Windows installers, Linux packages, cross-platform terminal persistence, or platform-specific agent recovery.

Electron can support the other platforms later, but Exo's terminal and tmux-backed agent recovery paths need explicit Windows/Linux validation before release claims change.

## Packaging

Local unsigned macOS app bundle:

```bash
pnpm pack:mac
```

Unsigned macOS DMG and ZIP for the current build machine architecture:

```bash
pnpm dist:mac
```

Artifacts are written to `release/`.

Unsigned builds are useful for early testers, but macOS will warn users. Public binary releases should eventually be signed and notarized with an Apple Developer account. Intel or universal macOS artifacts should be added as a separate tested release slice.

## Public Repo Hygiene

Before public release:

- keep Apache-2.0 license metadata and `LICENSE` in sync
- confirm `.exo/`, logs, settings files, and local transcripts are ignored
- keep examples generic unless they are clearly marked as local examples
- run CI checks from a clean clone
- publish unsigned artifacts only with clear warning text

## CI

The default CI workflow runs on macOS:

```bash
pnpm check
```

The package workflow is manual and builds unsigned macOS artifacts.
