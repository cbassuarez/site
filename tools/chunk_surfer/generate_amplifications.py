#!/usr/bin/env python3
"""Compatibility wrapper for AMPLIFICATIONS generation.

Delegates to generate_world_segments.py with hybrid-balanced defaults.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="Generate AMPLIFICATIONS chunk-surfer segments")
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--out-dir", required=True, type=Path)
    p.add_argument("--count", type=int, default=64)
    p.add_argument("--seed", type=int, default=20260426)
    p.add_argument("--bitrate", default="192k")
    p.add_argument("--analysis-sr", type=int, default=22050)
    return p.parse_args()


def main():
    args = parse_args()
    script = Path(__file__).with_name("generate_world_segments.py")
    cmd = [
        sys.executable,
        str(script),
        "--input",
        str(args.input),
        "--out-dir",
        str(args.out_dir),
        "--count",
        str(args.count),
        "--seed",
        str(args.seed),
        "--bitrate",
        str(args.bitrate),
        "--analysis-sr",
        str(args.analysis_sr),
        "--profile",
        "hybrid_balanced",
        "--prefix",
        "amp",
    ]
    raise SystemExit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
