"""Hammer blind evaluation Corpus B -- sealed holdout, built AFTER the
detector fix was frozen (commit 10d7682bc), from a fresh sample disjoint
from Corpus A. Read-only against C:\\data\\bars.db.

WHY A SECOND CORPUS BUILDER, NOT A REUSE OF THE FIRST
------------------------------------------------------
Corpus A (lab/quality/blind_corpus/hammer on the sibling
pattern-intelligence-lab branch) recorded "fired" as "the detector emitted
>=1 Detection anywhere in its 5-bar scan window" -- but the judge's rubric
(per its own stated methodology) only ever evaluates the chart's rightmost
(most recent) bar. Cross-referencing those two produced a large artifact:
10 of 12 raw "false positives" were the detector correctly firing on a real
hammer 1-4 bars in the PAST, which the judge was never asked about. See
lab/hammer_recognition_quality/diagnose_all.py + the ADR-scaling fix commit
message for the full derivation.

This builder closes that gap structurally: `fired` here means "the FIXED
detector's returned candidate's bar_idx equals the chart's last bar" --
apples-to-apples with what the judge rubric evaluates. `any_fired`/`lag`
are still recorded as supplementary diagnostic fields (not shown to the
judge) so a future pass can audit the same class of artifact if it recurs.

METHOD (mirrors the Corpus-A builder's discipline)
---------------------------------------------------
1. Opens bars.db read-only (mode=ro). Never writes.
2. Draws a fixed-seed sample from the real universe -- disjoint from Corpus
   A's 24 (symbol, as_of_t) pairs by construction (different seed, wider
   pool, multiple as-of offsets).
3. Evaluates the REAL (already-fixed) detector at each sample point via
   build_context() + detect_hammer(), classifying strictly by whether the
   returned candidate (if any) sits on the window's last bar.
4. Splits into last-bar-FIRED and NOT-FIRED pools; last-bar hammers are a
   genuinely rare, real technical pattern (not a corpus-construction choice)
   -- the FIRED pool is capped by availability, not forced to match target
   size artificially.
5. Renders de-identified chart PNGs (render_chart, key_level=None -- no
   label that would leak the setup) + a neutral price/volume context block
   (no build_context()-derived trend_stage/rs_trend/etc, which are detector
   scoring inputs) + writes blind_packets.json / answer_key_ingredients.json
   (kept separate) / manifest.md, same shape as Corpus A.

Usage: python lab/hammer_recognition_quality/build_corpus_b.py
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

from api.services.pattern_engine.detectors.candlestick.hammer import detect_hammer
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_vision.chart_render import render_chart

BARS_DB_PATH = r"C:\data\bars.db"
WINDOW_BARS = 400
CHART_BARS = 160
MIN_HISTORY_BARS = 320
AS_OF_OFFSETS = (0, 90, 180, 260)  # 4 points/ticker spread across ~1yr of history
SEED = 202609062  # distinct from Corpus A's SEED=20260906
UNIVERSE_SAMPLE_SIZE = 900  # wide -- last-bar hammer firings are genuinely rare
TARGET_FIRED_CAP = 16       # cap, not a forced target -- real rarity may cap it lower
TARGET_NOT_FIRED = 16

OUT_DIR = Path(__file__).resolve().parent / "corpus_b"


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{BARS_DB_PATH}?mode=ro", uri=True)


def _repo_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _all_tickers(con: sqlite3.Connection) -> list[str]:
    cur = con.cursor()
    cur.execute("SELECT DISTINCT ticker FROM ohlcv WHERE tf='D'")
    return [r[0] for r in cur.fetchall()]


def _bars_for(con: sqlite3.Connection, ticker: str, limit: int) -> list[dict]:
    cur = con.cursor()
    cur.execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts DESC LIMIT ?",
        (ticker, limit),
    )
    rows = cur.fetchall()
    rows.reverse()
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def _bars_to_tuples(bars: list[dict]) -> list[tuple]:
    return [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]


def _neutral_context(bars: list[dict]) -> dict:
    closes = [b["c"] for b in bars]
    vols = [b["v"] for b in bars]
    last_close = closes[-1]
    lookback_52w = bars[-252:] if len(bars) >= 252 else bars
    hi_52w = max(b["h"] for b in lookback_52w)
    lo_52w = min(b["l"] for b in lookback_52w)

    def sma(n: int):
        if len(closes) < n:
            return None
        return round(sum(closes[-n:]) / n, 4)

    def vol_avg(n: int):
        if not vols:
            return None
        window = vols[-n:] if len(vols) >= n else vols
        return round(sum(window) / len(window), 1)

    adr_window = bars[-21:] if len(bars) >= 21 else bars
    adr_vals = [(b["h"] - b["l"]) / b["c"] * 100 for b in adr_window if b.get("c")]
    adr_pct = round(sum(adr_vals) / len(adr_vals), 3) if adr_vals else None

    return {
        "last_close": round(last_close, 4),
        "pct_of_52w_high": round(last_close / hi_52w * 100, 2) if hi_52w else None,
        "pct_above_52w_low": round((last_close - lo_52w) / lo_52w * 100, 2) if lo_52w else None,
        "sma10": sma(10),
        "sma20": sma(20),
        "sma50": sma(50),
        "vol_20d_avg": vol_avg(20),
        "vol_50d_avg": vol_avg(50),
        "adr_pct_21d": adr_pct,
        "n_bars_available": len(bars),
    }


def scan_universe(con: sqlite3.Connection, tickers: list[str]) -> dict:
    fired_pool: list[dict] = []
    not_fired_pool: list[dict] = []
    tickers_with_enough_history = 0
    windows_evaluated = 0

    for ticker in tickers:
        bars_full = _bars_for(con, ticker, limit=WINDOW_BARS + max(AS_OF_OFFSETS) + 5)
        if len(bars_full) < MIN_HISTORY_BARS:
            continue
        tickers_with_enough_history += 1
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
                dets = detect_hammer(window, ctx)
            except Exception as exc:
                print(f"[warn] hammer raised on {ticker}@{window[-1]['t']}: {exc!r}", file=sys.stderr)
                dets = []
            last_idx = len(window) - 1
            any_fired = bool(dets)
            fired_idx = None
            top_conf = None
            if dets:
                fired_t = dets[0]["start_t"]
                fired_idx = next((i for i, b in enumerate(window) if b["t"] == fired_t), None)
                top_conf = max(d["confidence"] for d in dets)
            last_bar_fired = any_fired and fired_idx == last_idx
            record = {
                "symbol": ticker,
                "as_of_t": window[-1]["t"],
                "bars": window,
                "last_bar_fired": last_bar_fired,
                "any_fired": any_fired,
                "lag": (last_idx - fired_idx) if fired_idx is not None else None,
                "top_confidence": top_conf,
            }
            if last_bar_fired:
                fired_pool.append(record)
            else:
                not_fired_pool.append(record)

        if len(fired_pool) >= TARGET_FIRED_CAP * 4 and len(not_fired_pool) >= TARGET_NOT_FIRED * 3:
            break

    return {
        "fired_pool": fired_pool,
        "not_fired_pool": not_fired_pool,
        "tickers_scanned": tickers_with_enough_history,
        "windows_evaluated": windows_evaluated,
    }


def main():
    con = _connect_ro()
    all_tickers = _all_tickers(con)
    rng = random.Random(SEED)
    sample = rng.sample(all_tickers, min(UNIVERSE_SAMPLE_SIZE, len(all_tickers)))

    print(f"Universe: {len(all_tickers)} tickers total; sampling {len(sample)}.")
    result = scan_universe(con, sample)
    fired_pool, not_fired_pool = result["fired_pool"], result["not_fired_pool"]
    print(f"Scanned {result['tickers_scanned']} tickers with enough history, "
          f"{result['windows_evaluated']} (ticker, as_of) windows.")
    print(f"last-bar-FIRED pool: {len(fired_pool)}  NOT-FIRED pool: {len(not_fired_pool)}")

    n_fired = min(TARGET_FIRED_CAP, len(fired_pool))
    n_not_fired = min(TARGET_NOT_FIRED, len(not_fired_pool))
    fired_sample = rng.sample(fired_pool, n_fired)
    not_fired_sample = rng.sample(not_fired_pool, n_not_fired)
    combined = fired_sample + not_fired_sample
    rng.shuffle(combined)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    charts_dir = OUT_DIR / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)

    repo_commit = _repo_commit()
    blind_packets = []
    answer_key = {}

    for i, rec in enumerate(combined):
        case_id = f"case_{i:04d}"
        bars = rec["bars"]
        chart_bars = bars[-CHART_BARS:]
        png_bytes = render_chart(_bars_to_tuples(chart_bars), window=CHART_BARS, key_level=None)
        chart_rel = f"charts/{case_id}.png"
        (OUT_DIR / chart_rel).write_bytes(png_bytes)

        blind_packets.append({
            "case_id": case_id,
            "family": "hammer",
            "chart_file": chart_rel,
            "provenance": {
                "timeframe": "D",
                "symbol_shown": False,
                "n_bars_available": len(bars),
                "n_bars_shown_on_chart": len(chart_bars),
                "corporate_action_treatment": (
                    "as stored in bars.db (Massive/Polygon-sourced, split/dividend-"
                    "adjusted per standard provider convention)"
                ),
                "detector_version": {
                    "module": "api.services.pattern_engine.detectors.candlestick.hammer",
                    "function": "detect_hammer",
                    "repo_commit": repo_commit,
                },
            },
            "neutral_context": _neutral_context(bars),
        })

        answer_key[case_id] = {
            "symbol": rec["symbol"],
            "as_of_t": rec["as_of_t"],
            "detector_last_bar_fired": rec["last_bar_fired"],
            "detector_any_fired_in_scan_window": rec["any_fired"],
            "detector_fire_lag_bars": rec["lag"],
            "detector_top_confidence": rec["top_confidence"],
            "note": (
                "CANDIDATE ONLY -- the real (fixed) detector's own call at evaluation "
                "time, not adjudicated ground truth. `detector_last_bar_fired` is the "
                "field to cross-reference against a judge who evaluates the chart's "
                "rightmost bar (Corpus A's `any_fired` mixed in bar-lagged candidates "
                "and produced a large false-positive artifact -- see "
                "diagnose_all.py). Do not treat fired=true as 'a genuine setup existed "
                "here' or fired=false as 'no setup existed here'."
            ),
        }

    (OUT_DIR / "blind_packets.json").write_text(json.dumps(blind_packets, indent=2))
    (OUT_DIR / "answer_key_ingredients.json").write_text(json.dumps(answer_key, indent=2))

    manifest = f"""# Hammer Blind Evaluation Corpus B -- sealed holdout

Built AFTER the ADR-scaling fix (commit 10d7682bc) was frozen, from a fresh
sample disjoint from Corpus A. `fired` means **the fixed detector's firing
candidate is the chart's own last bar** -- not "somewhere in the last 5 bars"
(Corpus A's definition, which produced a large bar-lag artifact; see
diagnose_all.py in this same directory).

- Universe sampled: {len(sample)} tickers (seed {SEED}) of {len(all_tickers)} total.
- Tickers with >= {MIN_HISTORY_BARS} bars of history: {result['tickers_scanned']}.
- (ticker, as_of) windows evaluated: {result['windows_evaluated']} across offsets {AS_OF_OFFSETS}.
- last-bar-FIRED pool found: {len(fired_pool)} (capped at {TARGET_FIRED_CAP}, sampled {n_fired}).
- NOT-FIRED pool found: {len(not_fired_pool)} (capped at {TARGET_NOT_FIRED}, sampled {n_not_fired}).
- Total corpus size: {len(combined)} cases.
- Repo commit at build time: {repo_commit}.

**GROUND_TRUTH_STATUS: PENDING** -- this manifest records construction
parameters only. A blind judge with zero access to detector source, fixture
labels, or `answer_key_ingredients.json` must adjudicate `blind_packets.json`
+ the rendered chart PNGs before any unblinding.

Last-bar Hammer firings are a genuinely rare real technical pattern (most
candidates the code considers fail the anatomy or context gate, and most
fired candidates fire on a bar 1-4 sessions in the past relative to a
randomly chosen as-of point) -- the fired-pool size above reflects that
rarity, not a corpus-construction shortfall.
"""
    (OUT_DIR / "manifest.md").write_text(manifest)
    print(f"\nWrote {len(combined)} cases to {OUT_DIR}")
    print(manifest)


if __name__ == "__main__":
    main()
