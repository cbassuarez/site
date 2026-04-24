#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-seminar-default}"

cd "/Users/seb/Documents/New project 2"
python3 -m soc_console.cli tmux bootstrap --profile "$PROFILE"
