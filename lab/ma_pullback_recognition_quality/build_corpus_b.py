"""Pullback-to-21-EMA (Minervini SEPA) Corpus B -- first real-world
recognition-quality corpus for family #3 (MA pullback / support-setup
intelligence). Same certified two-view, gate-traced methodology as the
Hammer and Bull Flag programs (render_ma.py, trace.py).

`pullback_to_21ema.py` is a REAL, production-registered detector (verified
reachable via `api/routers/patterns.py`'s explicit import, and present in
`list_pattern_ids()` after that import) -- the owner's preferred family-#3
target, used as-is (no fallback to pullback_to_50sma needed).

A quick real-data probe (single as-of point per ticker, 300-ticker sample)
found only ~1.8% of (ticker, single-as-of) pairs fire -- the detector's hard
Stage-2 + stacked-bullish + RS-up + EMA-rising + volume-contraction stack is
genuinely selective. Multiple as-of offsets per ticker (as in the Bull Flag
program) are used to build a big-enough fired pool from a bounded universe
sample.
"""
from __future__ import annotations

import json
import random
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.detectors.uct.pullback_to_21ema import detect_pullback_to_21ema
from api.services.pattern_engine.primitives.context import build_context
from lab.ma_pullback_recognition_quality.trace import trace_pullback_21ema
from lab.ma_pullback_recognition_quality.render_ma import (
    render_structure, render_detail, STRUCTURE_BARS, DETAIL_BARS,
)

BARS_DB_PATH = r"C:\data\bars.db"
WINDOW_BARS = 400
MIN_HISTORY_BARS = 320
AS_OF_OFFSETS = (0, 20, 45, 90, 150, 220, 300)
SEED = 20260907501
UNIVERSE_SAMPLE_SIZE = 1400
TARGET_FIRED = 20
TARGET_NOT_FIRED = 20

OUT_DIR = Path(__file__).resolve().parent / "corpus_b"


def _repo_commit() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=str(REPO_ROOT),
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


def _neutral_context(bars):
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

    return {
        "last_close": round(last_close, 4),
        "pct_of_52w_high": round(last_close / hi_52w * 100, 2) if hi_52w else None,
        "pct_above_52w_low": round((last_close - lo_52w) / lo_52w * 100, 2) if lo_52w else None,
        "sma10": sma(10), "sma20": sma(20), "sma50": sma(50), "sma200": sma(200),
        "vol_20d_avg": vol_avg(20), "vol_50d_avg": vol_avg(50),
        "adr_pct_21d": adr_pct, "n_bars_available": len(bars),
    }


def main():
    con = sqlite3.connect(f"file:{BARS_DB_PATH}?mode=ro", uri=True)
    all_tickers = _all_tickers(con)
    rng = random.Random(SEED)
    sample = rng.sample(all_tickers, min(UNIVERSE_SAMPLE_SIZE, len(all_tickers)))
    print(f"Universe: {len(all_tickers)} tickers; sampling {len(sample)}.")

    fired_pool, not_fired_pool = [], []
    tickers_scanned = 0
    windows_evaluated = 0

    for ticker in sample:
        bars_full = _bars_for_range(con, ticker, WINDOW_BARS + max(AS_OF_OFFSETS) + 5)
        if len(bars_full) < MIN_HISTORY_BARS:
            continue
        tickers_scanned += 1
        for offset in AS_OF_OFFSETS:
            end = len(bars_full) - offset
            if end < MIN_HISTORY_BARS:
                continue
            window = bars_full[max(0, end - WINDOW_BARS):end]
            if len(window) < MIN_HISTORY_BARS:
                continue
            ctx = build_context(window, sym=ticker)
            windows_evaluated += 1
            try:
                dets = detect_pullback_to_21ema(window, ctx)
            except Exception as exc:
                print(f"[warn] pullback_to_21ema raised on {ticker}@{window[-1]['t']}: {exc!r}", file=sys.stderr)
                dets = []
            fired = bool(dets)
            top_conf = dets[0]["confidence"] if fired else None
            record = {"symbol": ticker, "as_of_t": window[-1]["t"], "bars": window,
                      "fired": fired, "top_confidence": top_conf}
            (fired_pool if fired else not_fired_pool).append(record)

        if len(fired_pool) >= TARGET_FIRED * 3 and len(not_fired_pool) >= TARGET_NOT_FIRED * 2:
            break

    print(f"Scanned {tickers_scanned} tickers, {windows_evaluated} windows.")
    print(f"FIRED pool: {len(fired_pool)}  NOT-FIRED pool: {len(not_fired_pool)}")

    n_fired = min(TARGET_FIRED, len(fired_pool))
    n_not_fired = min(TARGET_NOT_FIRED, len(not_fired_pool))
    fired_sample = rng.sample(fired_pool, n_fired)
    not_fired_sample = rng.sample(not_fired_pool, n_not_fired)
    combined = fired_sample + not_fired_sample
    rng.shuffle(combined)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    charts_dir = OUT_DIR / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)
    repo_commit = _repo_commit()

    blind_packets, answer_key = [], {}
    for i, rec in enumerate(combined):
        case_id = f"case_{i:04d}"
        bars = rec["bars"]
        ctx = build_context(bars, sym=rec["symbol"])
        tuples = _bars_to_tuples(bars)

        struct_png = render_structure(tuples)
        detail_png = render_detail(tuples)
        struct_rel = f"charts/{case_id}_structure.png"
        detail_rel = f"charts/{case_id}_detail.png"
        (OUT_DIR / struct_rel).write_bytes(struct_png)
        (OUT_DIR / detail_rel).write_bytes(detail_png)

        trace = trace_pullback_21ema(bars, ctx)

        blind_packets.append({
            "case_id": case_id,
            "family": "pullback_to_21ema",
            "structure_chart_file": struct_rel,
            "detail_chart_file": detail_rel,
            "provenance": {
                "timeframe": "D", "symbol_shown": False,
                "structure_bars_shown": min(STRUCTURE_BARS, len(bars)),
                "detail_bars_shown": min(DETAIL_BARS, len(bars)),
                "n_bars_available": len(bars),
                "corporate_action_treatment": (
                    "as stored in bars.db (Massive/Polygon-sourced, split/dividend-adjusted "
                    "per standard provider convention) -- flag AMBIGUOUS-INSUFFICIENT if a "
                    "chart looks internally inconsistent rather than force a call"
                ),
            },
            "neutral_context": _neutral_context(bars),
        })

        answer_key[case_id] = {
            "symbol": rec["symbol"], "as_of_t": rec["as_of_t"],
            "detector_fired": rec["fired"],
            "detector_top_confidence": rec["top_confidence"],
            "pipeline_trace": trace,
            "note": "CANDIDATE ONLY -- not adjudicated ground truth. Never shown to the blind judge.",
        }

    (OUT_DIR / "blind_packets.json").write_text(json.dumps(blind_packets, indent=2))
    (OUT_DIR / "answer_key_ingredients.json").write_text(json.dumps(answer_key, indent=2, default=str))

    manifest = f"""# Pullback-to-21-EMA (Minervini SEPA) Corpus B -- family #3 first evaluation

Real-world, blinded recognition-quality corpus for `pullback_to_21ema.py`
(a real, production-registered detector -- verified reachable via
`api/routers/patterns.py`'s explicit import). Same certified two-view,
gate-traced methodology as the Hammer/Bull Flag programs
(render_ma.py: structure {STRUCTURE_BARS} bars + SMA50/SMA200/EMA21;
detail {DETAIL_BARS} bars + EMA21 + volume; trace.py: full gate-by-gate
re-derivation of the detector's own logic).

- Universe sampled: {len(sample)} tickers of {len(all_tickers)} total.
- Tickers scanned: {tickers_scanned}. Windows evaluated: {windows_evaluated}.
- FIRED pool found: {len(fired_pool)} (sampled {n_fired}). NOT-FIRED pool found: {len(not_fired_pool)} (sampled {n_not_fired}).
- Total corpus size: {len(combined)} cases.
- Repo commit at build time: {repo_commit}.

**GROUND_TRUTH_STATUS: PENDING** -- a blind judge with zero access to
detector source, `pipeline_trace`, or `detector_fired` must adjudicate
before any unblinding.
"""
    (OUT_DIR / "manifest.md").write_text(manifest)
    print(f"Wrote {len(combined)} cases to {OUT_DIR}")
    print(manifest)


if __name__ == "__main__":
    main()
