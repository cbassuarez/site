#!/usr/bin/env python3
"""Generate deterministic world segment sets for chunk-surfer.

Supports profile-specific asymmetric segmentation while preserving a stable
output contract: same input + seed + profile + count => same segment order.
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np


@dataclass
class Candidate:
    start: float
    end: float
    duration: float
    anchor_type: str
    rms: float
    zcr: float
    centroid: float
    rolloff: float
    attack: float
    duration_bucket: str
    timeline_bin: int
    centroid_bin: str = "mid"
    attack_bin: str = "mid"
    category: str = "resonance"


@dataclass(frozen=True)
class ProfileConfig:
    name: str
    duration_options: Tuple[float, ...]
    duration_target: Dict[str, float]
    onset_percentile: float
    onset_min_gap: int
    silence_percentile: float
    timeline_bins: int
    timeline_anchor_factor: float
    max_durations_per_anchor: int
    overlap_limit: float
    onset_weight: float
    silence_weight: float
    timeline_weight: float
    anchor_offsets: Tuple[float, ...]


PROFILES: Dict[str, ProfileConfig] = {
    "hybrid_balanced": ProfileConfig(
        name="hybrid_balanced",
        duration_options=(0.55, 0.75, 1.05, 1.45, 2.0, 2.8, 3.9, 5.2, 6.8, 9.6, 12.8),
        duration_target={"short": 0.34, "mid": 0.31, "long": 0.24, "xlong": 0.11},
        onset_percentile=82.0,
        onset_min_gap=6,
        silence_percentile=22.0,
        timeline_bins=8,
        timeline_anchor_factor=0.55,
        max_durations_per_anchor=6,
        overlap_limit=0.62,
        onset_weight=0.35,
        silence_weight=0.15,
        timeline_weight=0.05,
        anchor_offsets=(-0.34, -0.12, 0.0, 0.14, 0.31),
    ),
    "quartet_dense": ProfileConfig(
        name="quartet_dense",
        duration_options=(0.35, 0.5, 0.7, 0.95, 1.25, 1.7, 2.2, 2.9, 3.8, 5.0),
        duration_target={"short": 0.46, "mid": 0.35, "long": 0.15, "xlong": 0.04},
        onset_percentile=74.0,
        onset_min_gap=4,
        silence_percentile=26.0,
        timeline_bins=10,
        timeline_anchor_factor=0.75,
        max_durations_per_anchor=7,
        overlap_limit=0.86,
        onset_weight=0.52,
        silence_weight=0.12,
        timeline_weight=0.18,
        anchor_offsets=(-0.46, -0.25, -0.08, 0.0, 0.1, 0.22, 0.34),
    ),
    "lux_stackable_long": ProfileConfig(
        name="lux_stackable_long",
        duration_options=(1.25, 1.8, 2.6, 3.6, 4.8, 6.2, 8.0, 10.5, 13.0, 16.0, 20.0),
        duration_target={"short": 0.08, "mid": 0.28, "long": 0.42, "xlong": 0.22},
        onset_percentile=88.0,
        onset_min_gap=8,
        silence_percentile=30.0,
        timeline_bins=8,
        timeline_anchor_factor=0.45,
        max_durations_per_anchor=6,
        overlap_limit=0.48,
        onset_weight=0.14,
        silence_weight=0.36,
        timeline_weight=0.07,
        anchor_offsets=(-0.62, -0.32, -0.1, 0.0, 0.08, 0.22),
    ),
}


def run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{proc.stderr}")
    return proc.stdout.strip()


def probe_duration(path: Path) -> float:
    out = run([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        str(path),
    ])
    return float(out)


def decode_audio(path: Path, sample_rate: int) -> np.ndarray:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "ignore"))
    arr = np.frombuffer(proc.stdout, dtype=np.float32)
    if arr.size == 0:
        raise RuntimeError("Decoded audio buffer is empty")
    return arr


def frame_features(audio: np.ndarray, sr: int, frame: int = 2048, hop: int = 512):
    if audio.size < frame:
        pad = np.zeros(frame - audio.size, dtype=np.float32)
        audio = np.concatenate([audio, pad])
    n_frames = 1 + max(0, (audio.size - frame) // hop)
    energies = np.zeros(n_frames, dtype=np.float64)

    window = np.hanning(frame).astype(np.float64)
    freqs = np.fft.rfftfreq(frame, d=1.0 / sr)
    zcr = np.zeros(n_frames, dtype=np.float64)
    centroids = np.zeros(n_frames, dtype=np.float64)
    rolloffs = np.zeros(n_frames, dtype=np.float64)

    for i in range(n_frames):
        s = i * hop
        x = audio[s : s + frame].astype(np.float64)
        energies[i] = float(np.sqrt(np.mean(x * x) + 1e-12))

        signs = (x >= 0).astype(np.int8)
        zcr[i] = float(np.mean(np.abs(np.diff(signs))))

        X = np.abs(np.fft.rfft(x * window))
        mag_sum = float(np.sum(X) + 1e-12)
        centroids[i] = float(np.sum(X * freqs) / mag_sum)
        csum = np.cumsum(X)
        cutoff = 0.85 * csum[-1]
        idx = int(np.searchsorted(csum, cutoff))
        idx = min(idx, len(freqs) - 1)
        rolloffs[i] = float(freqs[idx])

    times = (np.arange(n_frames) * hop) / sr
    return times, energies, zcr, centroids, rolloffs


def find_local_peaks(x: np.ndarray, pct: float, min_gap: int) -> List[int]:
    if x.size < 3:
        return []
    thr = np.percentile(x, pct)
    peaks = []
    last = -10**9
    for i in range(1, len(x) - 1):
        if x[i] >= thr and x[i] >= x[i - 1] and x[i] > x[i + 1]:
            if i - last >= min_gap:
                peaks.append(i)
                last = i
            elif x[i] > x[last]:
                peaks[-1] = i
                last = i
    return peaks


def bucket_duration(d: float) -> str:
    if d < 1.2:
        return "short"
    if d < 3.2:
        return "mid"
    if d < 7.0:
        return "long"
    return "xlong"


def classify_category(rms: float, zcr: float, centroid: float, attack: float) -> str:
    if zcr > 0.09 and centroid > 2200:
        return "noise"
    if attack < 0.07 and rms > 0.08:
        return "pulse"
    if centroid > 2600:
        return "shimmer"
    if attack > 0.2 and zcr < 0.05:
        return "drone"
    return "resonance"


def segment_features(seg: np.ndarray, sr: int) -> Tuple[float, float, float, float, float]:
    if seg.size == 0:
        return (0.0, 0.0, 0.0, 0.0, 0.0)

    rms = float(np.sqrt(np.mean(seg * seg) + 1e-12))
    signs = (seg >= 0).astype(np.int8)
    zcr = float(np.mean(np.abs(np.diff(signs)))) if seg.size > 1 else 0.0

    n = min(8192, seg.size)
    x = seg[:n].astype(np.float64)
    win = np.hanning(n)
    X = np.abs(np.fft.rfft(x * win))
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    mag_sum = float(np.sum(X) + 1e-12)
    centroid = float(np.sum(X * freqs) / mag_sum)
    csum = np.cumsum(X)
    ridx = int(np.searchsorted(csum, 0.85 * csum[-1]))
    ridx = min(ridx, len(freqs) - 1)
    rolloff = float(freqs[ridx])

    peak = float(np.max(np.abs(seg)) + 1e-12)
    thr = 0.5 * peak
    above = np.where(np.abs(seg) >= thr)[0]
    attack = float((above[0] / sr) if above.size else 0.0)
    return (rms, zcr, centroid, rolloff, attack)


def build_candidates(
    audio: np.ndarray,
    sr: int,
    duration: float,
    count: int,
    seed: int,
    profile: ProfileConfig,
) -> List[Candidate]:
    rng = random.Random(seed)
    times, energies, _, _, _ = frame_features(audio, sr)

    loge = np.log1p(energies)
    onset_curve = np.maximum(0.0, np.diff(loge, prepend=loge[0]))
    onset_peaks = find_local_peaks(onset_curve, pct=profile.onset_percentile, min_gap=profile.onset_min_gap)

    sil_thr = float(np.percentile(energies, profile.silence_percentile))
    silent = energies <= sil_thr
    silence_edges = []
    for i in range(1, len(silent)):
        if silent[i] != silent[i - 1]:
            silence_edges.append(i)

    timeline_n = max(14, int(round(count * profile.timeline_anchor_factor)))
    timeline_points = np.linspace(0.8, max(0.9, duration - 0.8), timeline_n)

    anchors: List[Tuple[float, str]] = []
    anchors += [(float(times[i]), "onset") for i in onset_peaks]
    anchors += [(float(times[i]), "silence") for i in silence_edges]
    anchors += [(float(t), "timeline") for t in timeline_points]

    anchors.sort(key=lambda x: x[0])
    dedup: List[Tuple[float, str]] = []
    for t, kind in anchors:
        if not dedup or abs(t - dedup[-1][0]) > 0.06:
            dedup.append((t, kind))
        else:
            # Keep most informative anchor in merged bin.
            if kind == "onset" and dedup[-1][1] != "onset":
                dedup[-1] = (t, kind)
            elif kind == "silence" and dedup[-1][1] == "timeline":
                dedup[-1] = (t, kind)

    candidates: List[Candidate] = []
    for t, kind in dedup:
        durs = list(profile.duration_options)
        rng.shuffle(durs)
        for dur in durs[: profile.max_durations_per_anchor]:
            for off in profile.anchor_offsets:
                if kind == "onset" and off > 0.26:
                    continue
                if kind == "silence" and abs(off) < 0.08:
                    continue
                start = t + off * dur
                end = start + dur
                if start < 0.05 or end > duration - 0.05:
                    continue
                s0 = int(start * sr)
                s1 = int(end * sr)
                seg = audio[s0:s1]
                if seg.size < int(0.35 * sr):
                    continue

                rms, zcr, centroid, rolloff, attack = segment_features(seg, sr)
                dur_bucket = bucket_duration(dur)
                tbin = min(profile.timeline_bins - 1, int((start / duration) * profile.timeline_bins))
                category = classify_category(rms, zcr, centroid, attack)
                candidates.append(
                    Candidate(
                        start=float(start),
                        end=float(end),
                        duration=float(dur),
                        anchor_type=kind,
                        rms=rms,
                        zcr=zcr,
                        centroid=centroid,
                        rolloff=rolloff,
                        attack=attack,
                        duration_bucket=dur_bucket,
                        timeline_bin=tbin,
                        category=category,
                    )
                )

    if not candidates:
        raise RuntimeError("No segmentation candidates generated")

    centroids = np.array([c.centroid for c in candidates], dtype=np.float64)
    attacks = np.array([c.attack for c in candidates], dtype=np.float64)
    c_q1, c_q2 = np.quantile(centroids, [0.33, 0.66])
    a_q1, a_q2 = np.quantile(attacks, [0.33, 0.66])
    for c in candidates:
        c.centroid_bin = "low" if c.centroid <= c_q1 else ("mid" if c.centroid <= c_q2 else "high")
        c.attack_bin = "low" if c.attack <= a_q1 else ("mid" if c.attack <= a_q2 else "high")

    return candidates


def targets_from_weights(count: int, weights: Dict[str, float]) -> Dict[str, int]:
    keys = list(weights.keys())
    raw = {k: count * float(weights[k]) for k in keys}
    out = {k: int(raw[k]) for k in keys}
    remainder = count - sum(out.values())
    frac = sorted(keys, key=lambda k: (raw[k] - out[k]), reverse=True)
    for i in range(remainder):
        out[frac[i % len(frac)]] += 1
    return out


def select_diverse(
    candidates: List[Candidate],
    count: int,
    duration: float,
    seed: int,
    profile: ProfileConfig,
) -> List[Candidate]:
    rng = random.Random(seed)
    items = candidates[:]
    rng.shuffle(items)

    target_duration = targets_from_weights(count, profile.duration_target)

    target_tbin = {i: count // profile.timeline_bins for i in range(profile.timeline_bins)}
    for i in range(count % profile.timeline_bins):
        target_tbin[i] += 1

    tri_keys = ["low", "mid", "high"]
    target_tri = {k: count // len(tri_keys) for k in tri_keys}
    for k in tri_keys[: count - sum(target_tri.values())]:
        target_tri[k] += 1

    selected: List[Candidate] = []
    dur_cnt = {k: 0 for k in target_duration}
    tbin_cnt = {k: 0 for k in target_tbin}
    cen_cnt = {k: 0 for k in target_tri}
    atk_cnt = {k: 0 for k in target_tri}

    def overlaps_too_much(c: Candidate) -> bool:
        for s in selected:
            inter = max(0.0, min(c.end, s.end) - max(c.start, s.start))
            if inter <= 0:
                continue
            ratio = inter / min(c.duration, s.duration)
            if ratio > profile.overlap_limit:
                return True
        return False

    remaining = items[:]
    while len(selected) < count and remaining:
        best_idx = None
        best_score = -1e9
        left = count - len(selected)

        for i, c in enumerate(remaining):
            if overlaps_too_much(c):
                continue

            score = 0.0
            score += (target_duration[c.duration_bucket] - dur_cnt[c.duration_bucket]) * 2.4
            score += (target_tbin[c.timeline_bin] - tbin_cnt[c.timeline_bin]) * 1.9
            score += (target_tri[c.centroid_bin] - cen_cnt[c.centroid_bin]) * 1.4
            score += (target_tri[c.attack_bin] - atk_cnt[c.attack_bin]) * 1.4

            if c.anchor_type == "onset":
                score += profile.onset_weight
            elif c.anchor_type == "silence":
                score += profile.silence_weight
            else:
                score += profile.timeline_weight

            if left <= max(8, count // 8):
                pos = (c.start + c.end) * 0.5 / duration
                score += (0.5 - abs(pos - 0.5)) * 0.2

            score += rng.random() * 0.06
            if score > best_score:
                best_score = score
                best_idx = i

        if best_idx is None:
            break

        c = remaining.pop(best_idx)
        selected.append(c)
        dur_cnt[c.duration_bucket] += 1
        tbin_cnt[c.timeline_bin] += 1
        cen_cnt[c.centroid_bin] += 1
        atk_cnt[c.attack_bin] += 1

    if len(selected) < count:
        for c in items:
            if len(selected) >= count:
                break
            if overlaps_too_much(c):
                continue
            selected.append(c)

    if len(selected) != count:
        raise RuntimeError(f"Could not select exactly {count} segments; got {len(selected)}")

    selected.sort(key=lambda c: (c.start, c.duration, c.anchor_type))
    return selected


def export_segments(input_path: Path, out_dir: Path, selected: List[Candidate], bitrate: str, prefix: str):
    out_dir.mkdir(parents=True, exist_ok=True)

    for old in out_dir.glob(f"{prefix}_*.mp3"):
        old.unlink()

    for i, c in enumerate(selected, start=1):
        out = out_dir / f"{prefix}_{i:03d}.mp3"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-ss",
                f"{c.start:.6f}",
                "-t",
                f"{c.duration:.6f}",
                "-i",
                str(input_path),
                "-ac",
                "1",
                "-ar",
                "44100",
                "-b:a",
                bitrate,
                str(out),
            ],
            check=True,
        )


def write_metadata(
    input_path: Path,
    out_dir: Path,
    selected: List[Candidate],
    count: int,
    seed: int,
    bitrate: str,
    duration: float,
    profile: str,
    prefix: str,
):
    duration_counts: Dict[str, int] = {}
    timeline_counts: Dict[str, int] = {}
    centroid_counts: Dict[str, int] = {}
    attack_counts: Dict[str, int] = {}
    category_counts: Dict[str, int] = {}

    items = []
    for i, c in enumerate(selected, start=1):
        duration_counts[c.duration_bucket] = duration_counts.get(c.duration_bucket, 0) + 1
        timeline_counts[str(c.timeline_bin)] = timeline_counts.get(str(c.timeline_bin), 0) + 1
        centroid_counts[c.centroid_bin] = centroid_counts.get(c.centroid_bin, 0) + 1
        attack_counts[c.attack_bin] = attack_counts.get(c.attack_bin, 0) + 1
        category_counts[c.category] = category_counts.get(c.category, 0) + 1
        items.append(
            {
                "id": i,
                "label": f"{prefix}-{i:03d}",
                "file": f"{prefix}_{i:03d}.mp3",
                "source": {
                    "path": str(input_path),
                    "start_sec": round(c.start, 6),
                    "end_sec": round(c.end, 6),
                    "duration_sec": round(c.duration, 6),
                },
                "features": {
                    "rms": round(c.rms, 8),
                    "zcr": round(c.zcr, 8),
                    "centroid_hz": round(c.centroid, 4),
                    "rolloff_hz": round(c.rolloff, 4),
                    "attack_sec": round(c.attack, 6),
                },
                "tags": {
                    "anchor": c.anchor_type,
                    "duration_bucket": c.duration_bucket,
                    "timeline_bin": c.timeline_bin,
                    "centroid_bin": c.centroid_bin,
                    "attack_bin": c.attack_bin,
                    "category": c.category,
                    "profile": profile,
                },
            }
        )

    payload = {
        "generator": {
            "name": "generate_world_segments.py",
            "version": 1,
            "seed": seed,
            "count": count,
            "bitrate": bitrate,
            "profile": profile,
            "prefix": prefix,
            "source_duration_sec": round(duration, 6),
        },
        "summary": {
            "duration_buckets": duration_counts,
            "timeline_bins": timeline_counts,
            "centroid_bins": centroid_counts,
            "attack_bins": attack_counts,
            "category_counts": category_counts,
        },
        "segments": items,
    }

    with (out_dir / "_segments.json").open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def parse_args():
    p = argparse.ArgumentParser(description="Generate profile-driven chunk-surfer segments")
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--out-dir", required=True, type=Path)
    p.add_argument("--count", type=int, default=64)
    p.add_argument("--seed", type=int, default=20260426)
    p.add_argument("--bitrate", default="192k")
    p.add_argument("--analysis-sr", type=int, default=22050)
    p.add_argument("--profile", choices=sorted(PROFILES.keys()), default="hybrid_balanced")
    p.add_argument("--prefix", required=True, help="Output filename prefix, e.g. amp/snm/lux")
    return p.parse_args()


def main():
    args = parse_args()
    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input}")
    if args.count <= 0:
        raise SystemExit("--count must be > 0")

    profile = PROFILES[args.profile]
    dur = probe_duration(args.input)
    audio = decode_audio(args.input, args.analysis_sr)
    candidates = build_candidates(audio, args.analysis_sr, dur, args.count, args.seed, profile)
    selected = select_diverse(candidates, args.count, dur, args.seed, profile)
    export_segments(args.input, args.out_dir, selected, args.bitrate, args.prefix)
    write_metadata(
        args.input,
        args.out_dir,
        selected,
        args.count,
        args.seed,
        args.bitrate,
        dur,
        args.profile,
        args.prefix,
    )

    print(f"Generated {len(selected)} segments in {args.out_dir} ({args.profile})")


if __name__ == "__main__":
    main()
