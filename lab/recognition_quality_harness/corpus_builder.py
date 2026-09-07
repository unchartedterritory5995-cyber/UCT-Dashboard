"""Generalized real-data corpus builder for the recognition-quality program,
factored out of the Hammer / Bull Flag / Pullback-to-21-EMA build_corpus_*.py
scripts (which were ~90% identical boilerplate written three times). ANY
detector matching the shared `Detection` contract (`api/services/
pattern_engine/types.py` -- `confidence` field, 0-100) can build a
blind-packets + answer-key corpus with one call.

Reused, not rewritten: the sampling strategy (universe sample -> multiple
as-of offsets per ticker -> separate fired/not-fired pools -> capped random
sample from each) is the exact strategy that worked three times running,
including the "keep scanning until pools are big enough OR the universe
runs out" early-stop. The only genuinely new thing here is that it is
PARAMETERIZED instead of copy-pasted.

`trace_fn` is optional and family-specific (Tier-2 deep loops want a full
gate-by-gate trace; Tier-1 rapid triage can skip it and rely on
`detector_fn`'s own return value -- confidence/fired is enough to build a
confusion matrix, even with no trace).
"""
from __future__ import annotations

import json
import random
import sqlite3
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from lab.recognition_quality_harness.renderer_profiles import (
    RenderProfile, render_structure, render_detail,
)

BARS_DB_PATH = r"C:\data\bars.db"


@dataclass
class CorpusSpec:
    """Everything needed to build one corpus. `detector_id` is a free-text
    label (used in the manifest only); `detector_fn`/`context_fn` are the
    real callables. `extra_neutral_context_fn(bars) -> dict` lets a family
    add fields to the neutral packet beyond the shared defaults (e.g. a
    family-specific indicator value) without subclassing anything."""
    detector_id: str
    detector_fn: Callable[[list, dict], list]
    context_fn: Callable[..., dict]
    render_profile: RenderProfile
    out_dir: Path
    seed: int
    as_of_offsets: tuple[int, ...]
    universe_sample_size: int
    target_fired: int
    target_not_fired: int
    window_bars: int = 400
    min_history_bars: int = 320
    bars_db_path: str = BARS_DB_PATH
    trace_fn: Optional[Callable[[list, dict], dict]] = None
    extra_neutral_context_fn: Optional[Callable[[list], dict]] = None
    repo_root: Optional[Path] = None


def _repo_commit(repo_root: Optional[Path]) -> str:
    if repo_root is None:
        return "unknown"
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=str(repo_root),
                              capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _bars_for_range(con, ticker, limit):
    cur = con.cursor()
    cur.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts DESC LIMIT ?", (ticker, limit))
    rows = cur.fetchall()
    rows.reverse()
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def _all_tickers(con):
    cur = con.cursor()
    cur.execute("SELECT DISTINCT ticker FROM ohlcv WHERE tf='D'")
    return [r[0] for r in cur.fetchall()]


def _bars_to_tuples(bars):
    return [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]


def _neutral_context(bars: list[dict], extra_fn: Optional[Callable[[list], dict]]) -> dict:
    closes = [b["c"] for b in bars]
    vols = [b["v"] for b in bars]
    last_close = closes[-1]
    lookback_52w = bars[-252:] if len(bars) >= 252 else bars
    hi_52w = max(b["h"] for b in lookback_52w)
    lo_52w = min(b["l"] for b in lookback_52w)

    def sma(n):
        return round(sum(closes[-n:]) / n, 4) if len(closes) >= n else None

    def vol_avg(n):
        w = vols[-n:] if len(vols) >= n else vols
        return round(sum(w) / len(w), 1) if w else None

    adr_window = bars[-21:] if len(bars) >= 21 else bars
    adr_vals = [(b["h"] - b["l"]) / b["c"] * 100 for b in adr_window if b.get("c")]
    adr_pct = round(sum(adr_vals) / len(adr_vals), 3) if adr_vals else None

    out = {
        "last_close": round(last_close, 4),
        "pct_of_52w_high": round(last_close / hi_52w * 100, 2) if hi_52w else None,
        "pct_above_52w_low": round((last_close - lo_52w) / lo_52w * 100, 2) if lo_52w else None,
        "sma10": sma(10), "sma20": sma(20), "sma50": sma(50), "sma200": sma(200),
        "vol_20d_avg": vol_avg(20), "vol_50d_avg": vol_avg(50),
        "adr_pct_21d": adr_pct, "n_bars_available": len(bars),
    }
    if extra_fn is not None:
        out.update(extra_fn(bars))
    return out


def build_corpus(spec: CorpusSpec, verbose: bool = True) -> dict:
    """Build a corpus per `spec`. Returns a small summary dict (also written
    to manifest.md). Side effects: writes blind_packets.json,
    answer_key_ingredients.json, manifest.md, and charts/*.png under
    `spec.out_dir`."""
    con = sqlite3.connect(f"file:{spec.bars_db_path}?mode=ro", uri=True)
    all_tickers = _all_tickers(con)
    rng = random.Random(spec.seed)
    sample = rng.sample(all_tickers, min(spec.universe_sample_size, len(all_tickers)))
    if verbose:
        print(f"[{spec.detector_id}] Universe: {len(all_tickers)} tickers; sampling {len(sample)}.")

    fired_pool, not_fired_pool = [], []
    tickers_scanned = 0
    windows_evaluated = 0

    for ticker in sample:
        bars_full = _bars_for_range(con, ticker, spec.window_bars + max(spec.as_of_offsets) + 5)
        if len(bars_full) < spec.min_history_bars:
            continue
        tickers_scanned += 1
        for offset in spec.as_of_offsets:
            end = len(bars_full) - offset
            if end < spec.min_history_bars:
                continue
            window = bars_full[max(0, end - spec.window_bars):end]
            if len(window) < spec.min_history_bars:
                continue
            ctx = spec.context_fn(window, sym=ticker)
            windows_evaluated += 1
            try:
                dets = spec.detector_fn(window, ctx)
            except Exception as exc:
                print(f"[warn] {spec.detector_id} raised on {ticker}@{window[-1]['t']}: {exc!r}", file=sys.stderr)
                dets = []
            fired = bool(dets)
            top_conf = max((d["confidence"] for d in dets), default=None) if fired else None
            record = {"symbol": ticker, "as_of_t": window[-1]["t"], "bars": window,
                      "fired": fired, "top_confidence": top_conf}
            (fired_pool if fired else not_fired_pool).append(record)

        if len(fired_pool) >= spec.target_fired * 3 and len(not_fired_pool) >= spec.target_not_fired * 2:
            break

    if verbose:
        print(f"[{spec.detector_id}] Scanned {tickers_scanned} tickers, {windows_evaluated} windows.")
        print(f"[{spec.detector_id}] FIRED pool: {len(fired_pool)}  NOT-FIRED pool: {len(not_fired_pool)}")

    n_fired = min(spec.target_fired, len(fired_pool))
    n_not_fired = min(spec.target_not_fired, len(not_fired_pool))
    fired_sample = rng.sample(fired_pool, n_fired)
    not_fired_sample = rng.sample(not_fired_pool, n_not_fired)
    combined = fired_sample + not_fired_sample
    rng.shuffle(combined)

    spec.out_dir.mkdir(parents=True, exist_ok=True)
    charts_dir = spec.out_dir / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)
    repo_commit = _repo_commit(spec.repo_root)

    blind_packets, answer_key = [], {}
    for i, rec in enumerate(combined):
        case_id = f"case_{i:04d}"
        bars = rec["bars"]
        ctx = spec.context_fn(bars, sym=rec["symbol"])
        tuples = _bars_to_tuples(bars)

        struct_png = render_structure(tuples, spec.render_profile)
        detail_png = render_detail(tuples, spec.render_profile)
        struct_rel = f"charts/{case_id}_structure.png"
        detail_rel = f"charts/{case_id}_detail.png"
        (spec.out_dir / struct_rel).write_bytes(struct_png)
        (spec.out_dir / detail_rel).write_bytes(detail_png)

        trace = spec.trace_fn(bars, ctx) if spec.trace_fn is not None else None

        blind_packets.append({
            "case_id": case_id,
            "family": spec.detector_id,
            "structure_chart_file": struct_rel,
            "detail_chart_file": detail_rel,
            "provenance": {
                "timeframe": "D", "symbol_shown": False,
                "structure_bars_shown": min(spec.render_profile.structure_bars, len(bars)),
                "detail_bars_shown": min(spec.render_profile.detail_bars, len(bars)),
                "n_bars_available": len(bars),
                "corporate_action_treatment": (
                    "as stored in bars.db (Massive/Polygon-sourced, split/dividend-adjusted "
                    "per standard provider convention) -- flag AMBIGUOUS-INSUFFICIENT if a "
                    "chart looks internally inconsistent rather than force a call"
                ),
            },
            "neutral_context": _neutral_context(bars, spec.extra_neutral_context_fn),
        })

        answer_key[case_id] = {
            "symbol": rec["symbol"], "as_of_t": rec["as_of_t"],
            "detector_fired": rec["fired"],
            "detector_top_confidence": rec["top_confidence"],
            "pipeline_trace": trace,
            "note": "CANDIDATE ONLY -- not adjudicated ground truth. Never shown to the blind judge.",
        }

    (spec.out_dir / "blind_packets.json").write_text(json.dumps(blind_packets, indent=2))
    (spec.out_dir / "answer_key_ingredients.json").write_text(json.dumps(answer_key, indent=2, default=str))

    summary = {
        "detector_id": spec.detector_id,
        "universe_sampled": len(sample), "universe_total": len(all_tickers),
        "tickers_scanned": tickers_scanned, "windows_evaluated": windows_evaluated,
        "fired_pool": len(fired_pool), "not_fired_pool": len(not_fired_pool),
        "n_fired_sampled": n_fired, "n_not_fired_sampled": n_not_fired,
        "total_cases": len(combined), "repo_commit": repo_commit,
        "render_profile": spec.render_profile.name, "seed": spec.seed,
        "as_of_offsets": list(spec.as_of_offsets),
    }
    manifest = (
        f"# {spec.detector_id} -- recognition-quality corpus\n\n"
        f"Render profile: {spec.render_profile.name} "
        f"(structure {spec.render_profile.structure_bars}b / detail {spec.render_profile.detail_bars}b)\n\n"
        f"- Universe sampled: {len(sample)} tickers of {len(all_tickers)} total.\n"
        f"- Tickers scanned: {tickers_scanned}. Windows evaluated: {windows_evaluated}.\n"
        f"- FIRED pool found: {len(fired_pool)} (sampled {n_fired}). "
        f"NOT-FIRED pool found: {len(not_fired_pool)} (sampled {n_not_fired}).\n"
        f"- Total corpus size: {len(combined)} cases.\n"
        f"- Repo commit at build time: {repo_commit}.\n"
        f"- Seed: {spec.seed}. As-of offsets: {spec.as_of_offsets}.\n\n"
        f"**GROUND_TRUTH_STATUS: PENDING** -- a blind judge with zero access to "
        f"detector source, `pipeline_trace`, or `detector_fired` must adjudicate "
        f"before any unblinding.\n"
    )
    (spec.out_dir / "manifest.md").write_text(manifest)
    if verbose:
        print(f"[{spec.detector_id}] Wrote {len(combined)} cases to {spec.out_dir}")
    return summary
