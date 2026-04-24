# CalArts Agentic TUI Talk Console

Python + Textual + tmux performance system for a 60-minute doctoral seminar built around:

- Cybernetics dissertation corpus
- LetGo
- THE TUB
- Praetorius
- Dex / dexDRONES

## Features

- Stage engine with explicit scene state machine
- Strict schema contracts for dossiers, scripts, reasoning cards, and tmux layouts
- Cloud-first OpenAI reasoning with tool-restricted local retrieval
- Verbose public rationale stream (claim/evidence/inference/confidence/counterpoint)
- tmux orchestration with scene-aware layout profiles
- Constrained co-pilot command palette and shared baton switching
- Fallback-first resilience (local retrieval + precomputed cards)

## Quick Start

```bash
cd /Users/seb/Documents/New\ project\ 2
python3 -m soc_console.cli ingest
python3 -m soc_console.cli rehearse --mode dry-run
python3 -m soc_console.cli run
```

To force plain REPL mode (no Textual UI):

```bash
python3 -m soc_console.cli run --no-ui
```

If `textual` is not installed, install dependencies:

```bash
python3 -m pip install -e .
```

For cloud reasoning:

```bash
export OPENAI_API_KEY="..."
```

## tmux bootstrap

```bash
./scripts/tmux_bootstrap.sh seminar-default
```

Switch layouts during performance:

```bash
./scripts/tmux_switch_layout.sh scene-media-focus
```

## Test Suite

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```
