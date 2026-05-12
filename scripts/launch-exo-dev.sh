#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if ./bin/exo show >/dev/null 2>&1; then
  exit 0
fi

exec ./bin/exo dev
