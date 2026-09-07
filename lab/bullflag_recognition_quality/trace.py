"""Detector-independent-in-spirit, but code-grounded, per-case pipeline trace
for Bull Flag. Re-uses bull_flag.py's OWN internal functions (not a
reimplementation -- avoids inventing a second, possibly-divergent notion of
"pole"/"flag") to answer, for EVERY corpus case (fired or not), exactly
which gate a candidate reached and where it stopped. This is what makes
root-cause classification (item 10/11 of the recognition-quality report)
evidence-based rather than a guess, for both fired and not-fired cases.

Read-only, diagnostic only -- imports private (`_`-prefixed) module functions
directly, which is standard practice already used elsewhere in this lab
program (Hammer's diagnose_all.py did the same for hammer.py's helpers).
No detector code is modified.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.detectors.classical import bull_flag as bf
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from api.services.pattern_engine.primitives.geometry import channel_width_parallel_score
from api.services.pattern_engine.primitives.trendlines import fit_pair_parallel


def trace_all_candidates(bars: list[dict], context: dict) -> dict:
    """Walk every pole-top candidate bull_flag.py itself would consider and
    record exactly which gate each one passes/fails, plus the final detector
    output. Returns a dict with `final_detections` (what detect_bull_flag
    itself returns) and `candidates` (per-pole-top trace)."""
    result = {
        "n_bars": len(bars),
        "liquidity_ok": None,
        "n_pivots": None,
        "candidates": [],
        "final_fired": False,
        "final_confidence": None,
    }

    if len(bars) < 30:
        result["reject_reason"] = "too_few_bars"
        return result

    liq = liquidity_floor(bars)
    result["liquidity_ok"] = bool(liq.passes)
    if not liq.passes:
        result["reject_reason"] = "liquidity_floor"
        return result

    pivots = detect_pivots(bars, window=3)
    result["n_pivots"] = len(pivots)
    if len(pivots) < 3:
        result["reject_reason"] = "too_few_pivots"
        return result

    pole_tops = bf._candidate_pole_tops(bars, pivots)
    result["n_pole_top_candidates"] = len(pole_tops)

    for pole_top_idx, pole_top in pole_tops:
        c = bf._try_extract_pattern(bars, pivots, pole_top_idx, pole_top)
        entry = {"pole_top_idx": pole_top_idx, "pole_top_t": int(bars[pole_top_idx]["t"])}
        if c is None:
            # _try_extract_pattern returns None at the FIRST failing gate; we
            # can't see which one without re-deriving the same checks. Redo
            # them here in the SAME order as the source, stopping at the
            # first failure, to attribute the specific gate.
            entry.update(_reattribute_extraction_failure(bars, pivots, pole_top_idx, pole_top))
            result["candidates"].append(entry)
            continue

        entry["extracted"] = True
        entry["pole_pct"] = round(c["pole_pct"], 4)
        entry["pole_bars"] = c["pole_bars"]
        entry["flag_count"] = c["flag_count"]
        entry["retrace_pct"] = round(c["retrace_pct"], 4)
        entry["parallel_score"] = round(c["parallel_score"], 4)
        entry["flag_low"] = c["flag_low"]
        entry["flag_high"] = c["flag_high"]
        entry["pole_base_idx"] = c["pole_base_idx"]
        entry["pole_base_t"] = int(bars[c["pole_base_idx"]]["t"])

        vol_ok = bf._flag_volume_contracted(bars, c)
        entry["volume_contracted"] = vol_ok
        flag_vol_ratio = bf._flag_volume_ratio(bars, c)
        entry["flag_pole_vol_ratio"] = round(flag_vol_ratio, 4)
        if not vol_ok:
            entry["reject_reason"] = "volume_not_contracted"
            result["candidates"].append(entry)
            continue

        geom = bf._score_geometry(c)
        vol_score = bf._score_volume(bars, c)
        ctx_score = bf._score_context(context)
        hist_score = 50.0
        confidence = round(0.40 * geom + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2)
        entry["geom_score"] = geom
        entry["vol_score"] = vol_score
        entry["ctx_score"] = ctx_score
        entry["confidence"] = confidence

        if confidence < bf._CONFIDENCE_FLOOR:
            entry["reject_reason"] = "confidence_below_floor"
            result["candidates"].append(entry)
            continue

        entry["reject_reason"] = None
        entry["would_fire"] = True
        result["candidates"].append(entry)

    fired_entries = [e for e in result["candidates"] if e.get("would_fire")]
    result["final_fired"] = bool(fired_entries)
    if fired_entries:
        best = max(fired_entries, key=lambda e: e["confidence"])
        result["final_confidence"] = best["confidence"]
        result["best_candidate"] = best

    return result


def _reattribute_extraction_failure(bars, pivots, pole_top_idx, pole_top) -> dict:
    """Re-derive _try_extract_pattern's checks in the same order, stopping at
    the first failure, purely to name WHICH gate rejected this candidate
    (the real function only returns None, with no reason code)."""
    out = {"extracted": False}
    window_start = max(0, pole_top_idx - bf._MAX_POLE_BARS)
    low_pivots_before = [p for p in pivots
                          if p["type"] == "low" and window_start <= p["bar_index"] < pole_top_idx]
    if low_pivots_before:
        pole_base_pivot = min(low_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"], "price": pole_base_pivot["price"]}
    else:
        if window_start >= pole_top_idx:
            out["reject_reason"] = "no_pole_base_window"
            return out
        best_idx, best_low = window_start, bars[window_start]["l"]
        for j in range(window_start, pole_top_idx):
            if bars[j]["l"] < best_low:
                best_low, best_idx = bars[j]["l"], j
        pole_base = {"bar_index": best_idx, "price": best_low}

    pole_height = pole_top["price"] - pole_base["price"]
    out["pole_base_idx"] = pole_base["bar_index"]
    if pole_height <= 0:
        out["reject_reason"] = "pole_height_nonpositive"
        return out
    pole_pct = pole_height / pole_base["price"]
    out["pole_pct"] = round(pole_pct, 4)
    if pole_pct < bf._MIN_POLE_PCT:
        out["reject_reason"] = "pole_pct_below_min"
        return out

    pole_bars = pole_top_idx - pole_base["bar_index"]
    out["pole_bars"] = pole_bars
    if pole_bars <= 0 or pole_bars > bf._MAX_POLE_BARS:
        out["reject_reason"] = "pole_bars_out_of_range"
        return out

    flag_bars_count = len(bars) - 1 - pole_top_idx
    out["flag_count"] = flag_bars_count
    if flag_bars_count < bf._MIN_FLAG_BARS or flag_bars_count > bf._MAX_FLAG_BARS:
        out["reject_reason"] = "flag_bar_count_out_of_range"
        return out

    flag_bars = bars[pole_top_idx + 1:]
    if not flag_bars:
        out["reject_reason"] = "no_flag_bars"
        return out
    flag_low = min(b["l"] for b in flag_bars)
    flag_high = max(b["h"] for b in flag_bars)
    out["flag_high"] = flag_high
    if flag_high > pole_top["price"] * (1 + bf._MAX_FLAG_HIGH_OVERSHOOT_PCT):
        out["reject_reason"] = "flag_high_exceeds_pole_top"
        return out
    retrace = (pole_top["price"] - flag_low) / pole_height
    out["retrace_pct"] = round(retrace, 4)
    if retrace < bf._MIN_FLAG_RETRACE or retrace > bf._MAX_FLAG_RETRACE:
        out["reject_reason"] = "retrace_out_of_range"
        return out

    upper_pivots = [{"t": pole_top_idx + 1 + i, "price": b["h"], "type": "high",
                      "strength": 50, "bar_index": pole_top_idx + 1 + i}
                     for i, b in enumerate(flag_bars)]
    lower_pivots = [{"t": pole_top_idx + 1 + i, "price": b["l"], "type": "low",
                      "strength": 50, "bar_index": pole_top_idx + 1 + i}
                     for i, b in enumerate(flag_bars)]
    upper_line, lower_line = fit_pair_parallel(upper_pivots, lower_pivots)
    flag_high = max(b["h"] for b in flag_bars)
    par_score = channel_width_parallel_score(upper_line, lower_line, flag_high, flag_low)
    out["parallel_score"] = round(par_score, 4)
    if par_score < bf._MIN_PARALLEL_SCORE:
        out["reject_reason"] = "parallel_score_below_min"
        return out

    out["reject_reason"] = "unknown_downstream"  # compute_structure_quality or similar
    return out
