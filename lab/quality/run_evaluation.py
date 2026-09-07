"""Run the bounded cohort evaluation + the candlestick context pilot.

Usage:
    python lab/quality/run_evaluation.py

Writes lab/quality/results.json (full per-fixture detail for the cohort) and
prints a human-readable summary, including the context pilot, to stdout.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from lab.quality.harness import DETECTOR_REGISTRY, run_families  # noqa: E402
from tests.pattern_engine.detectors.fixture_loader import load_fixture  # noqa: E402
from api.services.pattern_engine.detectors.candlestick.hammer import detect_hammer  # noqa: E402
from api.services.pattern_engine.primitives.context import build_context  # noqa: E402


COHORT = [
    "hammer",              # candlestick — single-bar reversal
    "bull_flag",           # classical/structural — continuation
    "vcp",                 # uct — growth-stock base/contraction setup
    "pullback_to_50sma",   # uct — moving-average pullback (O'Neil 2nd buy point)
    "power_earnings_gap",  # uct — event/gap setup
    "ascending_triangle",  # classical — momentum/breakout structure
]


def _raw_candle_geometry(bar: dict) -> dict:
    """Pure geometry arithmetic on one bar, independent of any detector or
    context gate -- mirrors the calc in hammer.py::_try_extract exactly, but
    reimplemented locally so it can be computed even for bars the detector's
    reversal-context gate discards before building a Detection (in which case
    hammer.py never surfaces geometry.extras at all).
    """
    o, h, l, c = bar["o"], bar["h"], bar["l"], bar["c"]
    total_range = h - l
    body = abs(c - o)
    body_top, body_bot = max(o, c), min(o, c)
    upper_wick = h - body_top
    lower_wick = body_bot - l
    return {
        "body_to_range": round(body / total_range, 4) if total_range else None,
        "lower_wick_body_ratio": round(lower_wick / body, 3) if body else None,
        "upper_wick_pct": round(upper_wick / total_range, 4) if total_range else None,
        "is_green": c > o,
    }


def run_candlestick_context_pilot() -> dict:
    """Compare raw shape-match vs. the additional context UCT already
    computes (trend_stage / ma_alignment / rs_trend / volume_signature),
    on two real hammer fixtures with near-identical or even LESS favorable
    raw geometry, but very different context.
    """
    pairs = [
        ("hammer_at_support", "positive"),
        ("hammer_in_uptrend", "negative"),
        ("hammer_no_context", "negative"),
    ]
    out = {}
    for name, _cat in pairs:
        fixture = load_fixture("hammer", f"{name}.json")
        last_bar = fixture.bars[-1]
        raw_shape = _raw_candle_geometry(last_bar)

        # Context exactly as authored in the fixture (what the detector battery uses).
        fixture_ctx = fixture.context
        # Context as build_context would derive it fresh from the bars alone
        # (sanity cross-check: does the real primitives/context.py agree with
        # the fixture author's hand-authored context?).
        derived_ctx = build_context(fixture.bars, sym="TEST")

        detections = detect_hammer(fixture.bars, fixture_ctx)
        fired = bool(detections)
        conf = detections[0]["confidence"] if fired else None

        out[name] = {
            "raw_shape_from_last_bar": raw_shape,
            "fixture_context": {
                "trend_stage": fixture_ctx.get("trend_stage"),
                "ma_alignment": fixture_ctx.get("ma_alignment"),
                "rs_trend": fixture_ctx.get("rs_trend"),
                "regime": fixture_ctx.get("regime"),
            },
            "build_context_derived": {
                "trend_stage": derived_ctx.get("trend_stage"),
                "ma_alignment": derived_ctx.get("ma_alignment"),
                "rs_trend": derived_ctx.get("rs_trend"),
                "dcr_signature": derived_ctx.get("dcr_signature"),
            },
            "fired": fired,
            "confidence": conf,
        }
    return out


def main() -> None:
    print("=" * 88)
    print("COHORT EVALUATION -- real fixtures through real detector code")
    print("=" * 88)
    reports = run_families(COHORT)
    for pid in COHORT:
        print(reports[pid].summary_line())
        mism = reports[pid].to_dict()["mismatches"]
        if mism:
            print(f"    mismatches: {mism}")

    print()
    print("=" * 88)
    print("CANDLESTICK CONTEXT PILOT (hammer family)")
    print("=" * 88)
    pilot = run_candlestick_context_pilot()
    for name, row in pilot.items():
        print(f"\n-- {name} --")
        print(f"  raw shape (last bar):  {row['raw_shape_from_last_bar']}")
        print(f"  fixture context:       {row['fixture_context']}")
        print(f"  build_context derived: {row['build_context_derived']}")
        print(f"  detector result:       fired={row['fired']} confidence={row['confidence']}")

    out_path = Path(__file__).resolve().parent / "results.json"
    payload = {
        "cohort": {pid: reports[pid].to_dict() for pid in COHORT},
        "candlestick_context_pilot": pilot,
        "detector_registry": {k: list(v) for k, v in DETECTOR_REGISTRY.items()},
    }
    out_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
