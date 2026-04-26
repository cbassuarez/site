#!/usr/bin/env python3
"""Generate diversified AMPLIFICATIONS segments for chunk-surfer.

Deterministic with fixed input + seed.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

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
    zcr = np.zeros(n_frames, dtype=np.float64)
    centroids = np.zeros(n_frames, dtype=np.float64)
    rolloffs = np.zeros(n_frames, dtype=np.float64)

    window = np.hanning(frame).astype(np.float64)
    freqs = np.fft.rfftfreq(frame, d=1.0 / sr)

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
) -> List[Candidate]:
    rng = random.Random(seed)
    times, energies, zcr_frames, centroids_f, rolloffs_f = frame_features(audio, sr)

    loge = np.log1p(energies)
    onset_curve = np.maximum(0.0, np.diff(loge, prepend=loge[0]))
    onset_peaks = find_local_peaks(onset_curve, pct=82, min_gap=6)

    sil_thr = float(np.percentile(energies, 22))
    silent = energies <= sil_thr
    silence_edges = []
    for i in range(1, len(silent)):
        if silent[i] != silent[i - 1]:
            silence_edges.append(i)

    timeline_n = max(18, count // 2)
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
            if kind == "onset" and dedup[-1][1] != "onset":
                dedup[-1] = (t, kind)

    duration_options = [0.55, 0.75, 1.05, 1.45, 2.0, 2.8, 3.9, 5.2, 6.8, 9.6, 12.8]
    offsets = [-0.34, -0.12, 0.0, 0.14, 0.31]

    candidates: List[Candidate] = []
    for t, kind in dedup:
        durs = duration_options[:]
        rng.shuffle(durs)
        for dur in durs[:6]:
            for off in offsets:
                if kind == "onset" and off > 0.2:
                    continue
                if kind == "silence" and abs(off) < 0.1:
                    continue
                start = t + off * dur
                end = start + dur
                if start < 0.05 or end > duration - 0.05:
                    continue
                s0 = int(start * sr)
                s1 = int(end * sr)
                seg = audio[s0:s1]
                if seg.size < int(0.45 * sr):
                    continue

                rms, zcr, centroid, rolloff, attack = segment_features(seg, sr)
                dur_bucket = bucket_duration(dur)
                tbin = min(7, int((start / duration) * 8.0))
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


def select_diverse(candidates: List[Candidate], count: int, duration: float, seed: int) -> List[Candidate]:
    rng = random.Random(seed)
    items = candidates[:]
    rng.shuffle(items)

    target_duration = {
        "short": int(round(count * 0.34)),
        "mid": int(round(count * 0.31)),
        "long": int(round(count * 0.24)),
    }
    target_duration["xlong"] = count - sum(target_duration.values())

    target_tbin = {i: count // 8 for i in range(8)}
    for i in range(count % 8):
        target_tbin[i] += 1

    target_tri = {"low": count // 3, "mid": count // 3, "high": count // 3}
    for k in ["low", "mid", "high"][: count - sum(target_tri.values())]:
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
            r = inter / min(c.duration, s.duration)
            if r > 0.62:
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
            score += (target_duration[c.duration_bucket] - dur_cnt[c.duration_bucket]) * 2.2
            score += (target_tbin[c.timeline_bin] - tbin_cnt[c.timeline_bin]) * 1.8
            score += (target_tri[c.centroid_bin] - cen_cnt[c.centroid_bin]) * 1.5
            score += (target_tri[c.attack_bin] - atk_cnt[c.attack_bin]) * 1.5
            score += 0.35 if c.anchor_type == "onset" else 0.0
            score += 0.15 if c.anchor_type == "silence" else 0.0

            if left <= 10:
                pos = (c.start + c.end) * 0.5 / duration
                score += (0.5 - abs(pos - 0.5)) * 0.2

            score += rng.random() * 0.05
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

    selected.sort(key=lambda c: c.start)
    return selected


def export_segments(input_path: Path, out_dir: Path, selected: List[Candidate], bitrate: str):
    out_dir.mkdir(parents=True, exist_ok=True)

    # Clear old generated clips so directory stays deterministic/idempotent.
    for old in out_dir.glob("amp_*.mp3"):
        old.unlink()

    for i, c in enumerate(selected, start=1):
        out = out_dir / f"amp_{i:03d}.mp3"
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
):
    duration_counts = {}
    timeline_counts = {}
    centroid_counts = {}
    attack_counts = {}
    category_counts = {}

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
                "label": f"amp-{i:03d}",
                "file": f"amp_{i:03d}.mp3",
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
                },
            }
        )

    payload = {
        "generator": {
            "name": "generate_amplifications.py",
            "version": 1,
            "seed": seed,
            "count": count,
            "bitrate": bitrate,
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
    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input}")
    if args.count <= 0:
        raise SystemExit("--count must be > 0")

    dur = probe_duration(args.input)
    audio = decode_audio(args.input, args.analysis_sr)
    candidates = build_candidates(audio, args.analysis_sr, dur, args.count, args.seed)
    selected = select_diverse(candidates, args.count, dur, args.seed)
    export_segments(args.input, args.out_dir, selected, args.bitrate)
    write_metadata(args.input, args.out_dir, selected, args.count, args.seed, args.bitrate, dur)

    print(f"Generated {len(selected)} segments in {args.out_dir}")


if __name__ == "__main__":
    main()
