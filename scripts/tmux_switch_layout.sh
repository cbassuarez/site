#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-seminar-default}"
SCENE="${2:-}"

if [[ -z "$SCENE" ]]; then
  echo "Usage: ./scripts/tmux_switch_layout.sh [profile] <scene_id>" >&2
  exit 1
fi

cd "/Users/seb/Documents/New project 2"
python3 -m soc_console.cli tmux switch-layout --profile "$PROFILE" --scene "$SCENE"
