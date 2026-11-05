#!/bin/sh
set -eu
if ! command -v mise >/dev/null 2>&1; then
  echo 'mise is required. Install mise and run mise install first.' >&2
  exit 1
fi
if ! t3=$(mise -C "$HOME" which t3); then
  echo 'T3 CLI is not installed with mise. Run mise install first.' >&2
  exit 1
fi
exec "$t3" connect "$@"
