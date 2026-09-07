"""Corpus B v2 -- SAME 32 (symbol, as_of_t) cases as the original Corpus B,
re-rendered with the two-view harness fix (render_v2.py) instead of a
single 160-bar/~7px-per-candle image.

Does NOT touch or overwrite the original corpus_b/ directory -- that
evidence (original images, original blind verdicts, original unblinding)
is preserved exactly as-is, per owner instruction. This writes a separate
corpus_b_v2/ directory.

Read-only against C:\\data\\bars.db. Reuses the same case_id assignment as
corpus_b/ (case_0000 old == case_0000 new, same underlying symbol/date) so
a per-case old-vs-new comparison is possible.
"""
from __future__ import annotations

import json
import subprocess
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from lab.hammer_recognition_quality.render_v2 import render_morphology, render_context, MORPH_BARS, CONTEXT_BARS

BARS_DB_PATH = r"C:\data\bars.db"
WINDOW_BARS = 400

ORIG_DIR = Path(__file__).resolve().parent / "corpus_b"
OUT_DIR = Path(__file__).resolve().parent / "corpus_b_v2"


def _repo_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _bars_for_upto(con, ticker, as_of_t, limit):
    cur = con.cursor()
    cur.execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
        (ticker, as_of_t, limit),
    )
    rows = cur.fetchall()
    rows.reverse()
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


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
        window = vols[-n:] if len(vols) >= n else vols
        return round(sum(window) / len(window), 1) if window else None

    adr_window = bars[-21:] if len(bars) >= 21 else bars
    adr_vals = [(b["h"] - b["l"]) / b["c"] * 100 for b in adr_window if b.get("c")]
    adr_pct = round(sum(adr_vals) / len(adr_vals), 3) if adr_vals else None

    return {
        "last_close": round(last_close, 4),
        "pct_of_52w_high": round(last_close / hi_52w * 100, 2) if hi_52w else None,
        "pct_above_52w_low": round((last_close - lo_52w) / lo_52w * 100, 2) if lo_52w else None,
        "sma10": sma(10), "sma20": sma(20), "sma50": sma(50),
        "vol_20d_avg": vol_avg(20), "vol_50d_avg": vol_avg(50),
        "adr_pct_21d": adr_pct, "n_bars_available": len(bars),
    }


def main():
    orig_ak = json.loads((ORIG_DIR / "answer_key_ingredients.json").read_text())
    con = sqlite3.connect(f"file:{BARS_DB_PATH}?mode=ro", uri=True)
    repo_commit = _repo_commit()

    charts_dir = OUT_DIR / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)

    blind_packets = []
    answer_key = {}
    data_quality_flags = {}

    for case_id in sorted(orig_ak.keys()):
        entry = orig_ak[case_id]
        sym, as_of_t = entry["symbol"], entry["as_of_t"]
        bars = _bars_for_upto(con, sym, as_of_t, WINDOW_BARS)
        assert bars[-1]["t"] == as_of_t, f"{case_id}: window mismatch"
        tuples = _bars_to_tuples(bars)

        morph_bytes = render_morphology(tuples)
        ctx_bytes = render_context(tuples)
        morph_rel = f"charts/{case_id}_morphology.png"
        ctx_rel = f"charts/{case_id}_context.png"
        (OUT_DIR / morph_rel).write_bytes(morph_bytes)
        (OUT_DIR / ctx_rel).write_bytes(ctx_bytes)

        # Known data-quality flag carried forward from the label-integrity
        # review (SPRB's unadjusted-split discontinuity) -- NOT hidden from
        # the corpus record, but also NOT shown to the judge (that would
        # leak an answer-adjacent signal). Recorded here for the eventual
        # comparison step only.
        dq_flag = "unadjusted_split_discontinuity_in_window" if sym == "SPRB" else None
        if dq_flag:
            data_quality_flags[case_id] = dq_flag

        blind_packets.append({
            "case_id": case_id,
            "family": "hammer",
            "morphology_chart_file": morph_rel,
            "context_chart_file": ctx_rel,
            "provenance": {
                "timeframe": "D",
                "symbol_shown": False,
                "morphology_bars_shown": min(MORPH_BARS, len(bars)),
                "context_bars_shown": min(CONTEXT_BARS, len(bars)),
                "n_bars_available": len(bars),
                "candidate_marker": (
                    "a neutral gray dashed vertical line marks the candidate bar "
                    "(always the rightmost bar) identically on both views, "
                    "regardless of the true label"
                ),
                "corporate_action_treatment": (
                    "as stored in bars.db (Massive/Polygon-sourced, split/dividend-"
                    "adjusted per standard provider convention) -- a small number of "
                    "cases may show a raw data discontinuity; flag AMBIGUOUS-INSUFFICIENT "
                    "if the chart itself looks internally inconsistent (e.g. price jumps "
                    "orders of magnitude with no gradual transition) rather than force a call"
                ),
            },
            "neutral_context": _neutral_context(bars),
        })

        answer_key[case_id] = {
            "symbol": sym, "as_of_t": as_of_t,
            "detector_last_bar_fired": entry["detector_last_bar_fired"],
            "note": "Same field as corpus_b/answer_key_ingredients.json -- re-rendered, not re-evaluated.",
        }

    (OUT_DIR / "blind_packets.json").write_text(json.dumps(blind_packets, indent=2))
    (OUT_DIR / "answer_key_ingredients.json").write_text(json.dumps(answer_key, indent=2))
    (OUT_DIR / "data_quality_flags_INTERNAL.json").write_text(json.dumps(data_quality_flags, indent=2))

    manifest = f"""# Hammer Corpus B v2 -- render/corpus-integrity fix (same 32 cases)

Re-renders the EXACT SAME 32 (symbol, as_of_t) cases as `corpus_b/`
(the original is preserved untouched) using the two-view harness fix in
`render_v2.py`: a MORPHOLOGY view (last {MORPH_BARS} bars, no MAs, wide
per-candle resolution) and a CONTEXT view (last {CONTEXT_BARS} bars, with
10/20/50 MAs, for trend/location judgment) -- both marking the same
candidate (rightmost) bar with an identical neutral gray dashed vertical
line, never encoding pass/fail.

Repo commit at build time: {repo_commit}.

**GROUND_TRUTH_STATUS: PENDING re-adjudication.** A fresh judge with zero
access to detector source, the original Corpus B images/verdicts, or this
corpus's answer key must adjudicate `blind_packets.json` + the rendered
PNGs before any unblinding, exactly like the original pass.

One case (SPRB, case id logged in `data_quality_flags_INTERNAL.json`,
**not surfaced to the judge**) is known from the original label-integrity
review to carry a real bars.db data-quality artifact (an apparent
unadjusted reverse split) that partially corrupts its own context signals
regardless of rendering fix -- kept in the corpus deliberately (to see
whether the new rendering at least lets a judge correctly flag it as
internally inconsistent / AMBIGUOUS-INSUFFICIENT, rather than silently
excluding a known-hard case).
"""
    (OUT_DIR / "manifest.md").write_text(manifest)
    print(f"Wrote {len(blind_packets)} v2 cases to {OUT_DIR}")
    print(manifest)


if __name__ == "__main__":
    main()
