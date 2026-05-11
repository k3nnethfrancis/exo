#!/usr/bin/env bash
set -euo pipefail

cd "/Users/kenneth/Desktop/lab/projects/exo"

if ./bin/exo show >/dev/null 2>&1; then
  exit 0
fi

exec ./bin/exo dev
