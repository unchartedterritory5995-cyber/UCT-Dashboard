"""Bull Flag blind evaluation Corpus B -- sealed holdout PREPARATION ONLY.

Per owner instruction: Bull Flag is NOT being modified in this pass (Hammer
is the priority recognition-quality problem); this builder only constructs
and preserves a fresh, disjoint sealed sample for a FUTURE improvement cycle,
mirroring Corpus A's original build_blind_corpus.py methodology (`fired` =
"the real detect_bull_flag() call returned >=1 Detection anywhere in the
window" -- unlike Hammer, bull_flag.py scans the *entire* window for
pole-top pivots rather than only the last 5 bars, so it does not have the
same recency-scan-lookback structure Hammer's fix addressed; no bar-lag
correction is applied here without further investigation, which is
out of scope for this pass).

Disjoint from Corpus A by construction: different seed, different as-of
offsets, wider universe sample. NOT adjudicated in this pass -- ground
truth status PENDING, exactly like Corpus A was before its judge ran.

Read-only against C:\\data\\bars.db.
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

from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_vision.chart_render import render_chart

BARS_DB_PATH = r"C:\data\bars.db"
WINDOW_BARS = 400
CHART_BARS = 160
MIN_HISTORY_BARS = 320
AS_OF_OFFSETS = (0, 75, 150, 225, 300)  # disjoint from Corpus A's (0, 130)
SEED = 202609063  # distinct from both Hammer Corpus B (202609062) and BF Corpus A (20260906)
UNIVERSE_SAMPLE_SIZE = 400
TARGET_FIRED = 16
TARGET_NOT_FIRED = 16

OUT_DIR = Path(__file__).resolve().parent / "corpus_b_bullflag"


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
                dets = detect_bull_flag(window, ctx)
            except Exception as exc:
                print(f"[warn] bull_flag raised on {ticker}@{window[-1]['t']}: {exc!r}", file=sys.stderr)
                dets = []
            fired = bool(dets)
            top_conf = max((d["confidence"] for d in dets), default=None) if fired else None
            record = {
                "symbol": ticker, "as_of_t": window[-1]["t"], "bars": window,
                "fired": fired, "top_confidence": top_conf,
            }
            (fired_pool if fired else not_fired_pool).append(record)

        if len(fired_pool) >= TARGET_FIRED * 3 and len(not_fired_pool) >= TARGET_NOT_FIRED * 3:
            break

    return {
        "fired_pool": fired_pool, "not_fired_pool": not_fired_pool,
        "tickers_scanned": tickers_with_enough_history, "windows_evaluated": windows_evaluated,
    }


def main():
    con = _connect_ro()
    all_tickers = _all_tickers(con)
    rng = random.Random(SEED)
    sample = rng.sample(all_tickers, min(UNIVERSE_SAMPLE_SIZE, len(all_tickers)))

    print(f"Universe: {len(all_tickers)} tickers total; sampling {len(sample)}.")
    result = scan_universe(con, sample)
    fired_pool, not_fired_pool = result["fired_pool"], result["not_fired_pool"]
    print(f"Scanned {result['tickers_scanned']} tickers, {result['windows_evaluated']} windows.")
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
        chart_bars = bars[-CHART_BARS:]
        png_bytes = render_chart(_bars_to_tuples(chart_bars), window=CHART_BARS, key_level=None)
        chart_rel = f"charts/{case_id}.png"
        (OUT_DIR / chart_rel).write_bytes(png_bytes)

        blind_packets.append({
            "case_id": case_id, "family": "bull_flag", "chart_file": chart_rel,
            "provenance": {
                "timeframe": "D", "symbol_shown": False,
                "n_bars_available": len(bars), "n_bars_shown_on_chart": len(chart_bars),
                "corporate_action_treatment": (
                    "as stored in bars.db (Massive/Polygon-sourced, split/dividend-adjusted "
                    "per standard provider convention)"
                ),
                "detector_version": {
                    "module": "api.services.pattern_engine.detectors.classical.bull_flag",
                    "function": "detect_bull_flag", "repo_commit": repo_commit,
                },
            },
            "neutral_context": _neutral_context(bars),
        })
        answer_key[case_id] = {
            "symbol": rec["symbol"], "as_of_t": rec["as_of_t"],
            "detector_candidate_fired": rec["fired"],
            "detector_top_confidence": rec["top_confidence"],
            "note": (
                "CANDIDATE ONLY -- this is the real detector's own call at evaluation time, "
                "not adjudicated ground truth. Do not treat 'fired=true' as 'a genuine setup "
                "existed here', and do not treat 'fired=false' as 'no setup existed here'."
            ),
        }

    (OUT_DIR / "blind_packets.json").write_text(json.dumps(blind_packets, indent=2))
    (OUT_DIR / "answer_key_ingredients.json").write_text(json.dumps(answer_key, indent=2))

    manifest = f"""# Bull Flag Blind Evaluation Corpus B -- sealed holdout (PREPARED, NOT YET ADJUDICATED)

Fresh sample, disjoint from Corpus A (different seed {SEED} vs. Corpus A's
20260906; different as-of offsets {AS_OF_OFFSETS} vs. Corpus A's (0, 130);
wider universe sample {UNIVERSE_SAMPLE_SIZE} vs. Corpus A's 260).

Bull Flag was NOT modified in this pass (owner priority: Hammer). This
corpus is prepared and preserved for a future improvement cycle -- the same
development/holdout protocol Hammer just went through, starting from
Corpus A's already-known failure modes (weak pole-verification, loose
pullback-depth/duration thresholds, a likely non-volatility-scaled
threshold; see lab/quality/blind_corpus/bull_flag/UNBLINDED_RESULTS.md on
the pattern-intelligence-lab branch).

- Universe sampled: {len(sample)} tickers of {len(all_tickers)} total.
- Tickers with >= {MIN_HISTORY_BARS} bars: {result['tickers_scanned']}.
- Windows evaluated: {result['windows_evaluated']} across offsets {AS_OF_OFFSETS}.
- FIRED pool found: {len(fired_pool)} (sampled {n_fired}). NOT-FIRED pool found: {len(not_fired_pool)} (sampled {n_not_fired}).
- Total corpus size: {len(combined)} cases.
- Repo commit at build time: {repo_commit}.

**GROUND_TRUTH_STATUS: PENDING.** Not yet adjudicated in this pass. `fired`
here means "detect_bull_flag() returned >=1 Detection anywhere in the
window" (same semantics as Corpus A) -- bull_flag.py scans pole-top pivots
across the whole window rather than only the last few bars (unlike
Hammer's pre-fix `_SCAN_LOOKBACK=5`), so the specific bar-lag artifact that
affected Hammer's raw precision number does not obviously apply here in the
same form; this has NOT been independently verified and is flagged as an
open question for whoever picks up Bull Flag next.
"""
    (OUT_DIR / "manifest.md").write_text(manifest)
    print(f"\nWrote {len(combined)} cases to {OUT_DIR}")
    print(manifest)


if __name__ == "__main__":
    main()
