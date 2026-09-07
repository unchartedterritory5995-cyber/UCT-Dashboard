"""Blind evaluation corpus builder — hammer + bull_flag (real market data).

WHY THIS EXISTS
----------------
`lab/quality/harness.py` already showed that every detector family's own
fixture battery scores an artificial 100% recall / 0% false-positive rate on
itself (see `lab/quality/RESULTS.md`) -- that is circular, not independent
evidence. The ONE family with real independent evidence is VCP, via
`docs/uct-scanner-intelligence/vcp_gold_standard/` (82 real-symbol cases,
rubric-adjudicated, precision ~0.40 / recall ~0.50). No other family has
anything like that.

This script builds the *reproducible workflow* (and one honest partial
sample) for extending that kind of independent evidence to two more
families: `hammer` (candlestick/context) and `bull_flag`
(structural/setup). It does NOT adjudicate the cases it produces -- see
`GROUND_TRUTH_STATUS: PENDING` in each family's manifest. A future human or
LLM-judge pass reads the blind packets + charts this script writes and fills
in `case_answer_key.json`-equivalent labels; this script does not fabricate
those labels itself.

WHAT IT DOES
------------
1. Opens `C:\\data\\bars.db` **read-only** (`file:...?mode=ro`, URI mode --
   never `bars_sqlite.py`'s read-write connection, and never any INSERT/
   UPDATE statement anywhere in this file).
2. Draws a fixed-seed random sample of real tickers from the full universe
   present in bars.db (~4,300 symbols) -- NOT cherry-picked, NOT filtered by
   how the detector will later score them.
3. For each sampled ticker, evaluates the REAL detector (via
   `lab.quality.harness.get_detector`, the same registry the existing
   fixture-battery harness uses) at 2 distinct "as of" points per symbol
   (most-recent bar, and ~130 trading days back) -- so the sample spans both
   recent and older market regimes, not just today's tape.
4. Splits results into a FIRED pool (detector emitted >=1 Detection) and a
   NOT-FIRED pool (it didn't) and subsamples BOTH down to the target size --
   this is the "a real recall check needs examples the detector missed too"
   requirement. Firing is recorded as a CANDIDATE label only; it is never
   treated as ground truth here.
5. Shuffles the combined, de-identified case order (so fired/not-fired
   status can't be inferred from case_id ordering), renders a neutral
   candlestick+volume PNG per case via the EXISTING
   `api.services.pattern_vision.chart_render.render_chart` (already
   documented to emit "No title/label that would leak the setup name" --
   reused verbatim, not duplicated, and called with `key_level=None` for
   every case so a highlighted level can't leak which cases fired either),
   and writes:
     - `<family>/blind_packets.json`      -- de-identified, NO verdict
     - `<family>/answer_key_ingredients.json` -- symbol/date/detector verdict,
       kept in a SEPARATE file so a reviewer given only the blind packets +
       charts cannot see it
     - `<family>/manifest.md`             -- workflow parameters + counts +
       GROUND_TRUTH_STATUS: PENDING

Usage:
    python lab/quality/blind_corpus/build_blind_corpus.py
    python lab/quality/blind_corpus/build_blind_corpus.py --families hammer
"""
from __future__ import annotations

import argparse
import json
import random
import sqlite3
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from lab.quality.harness import DETECTOR_REGISTRY, get_detector  # noqa: E402
from api.services.pattern_engine.primitives.context import build_context  # noqa: E402
from api.services.pattern_vision.chart_render import render_chart  # noqa: E402

BARS_DB_PATH = r"C:\data\bars.db"

WINDOW_BARS = 400          # bars fed to build_context() + the real detector
CHART_BARS = 160           # bars actually rendered on the blind chart image
MIN_HISTORY_BARS = 320     # skip a ticker/as-of point with less history than this
AS_OF_OFFSETS = (0, 130)   # 0 = most recent bar; 130 trading days back (~6mo)
SEED = 20260906            # fixed -- reproducible, not re-rolled to chase a result
UNIVERSE_SAMPLE_SIZE = 260 # tickers drawn from the full bars.db universe
TARGET_FIRED = 12
TARGET_NOT_FIRED = 12
FAMILIES = ["hammer", "bull_flag"]


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{BARS_DB_PATH}?mode=ro", uri=True)


def _repo_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_REPO_ROOT), capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _all_tickers(con: sqlite3.Connection) -> list[str]:
    cur = con.cursor()
    cur.execute("SELECT DISTINCT ticker FROM ohlcv WHERE tf='D'")
    return [r[0] for r in cur.fetchall()]


def _bars_for(con: sqlite3.Connection, ticker: str, limit: int) -> list[dict]:
    """Real daily bars, ascending by time. `t` is bars.db's own `ts` (YYYYMMDD
    int for daily) used AS-IS as Bar.t -- the same convention production code
    uses (see api/services/pattern_vision/orchestrator.py::_signals_hash,
    which builds identical dict-shaped bars from the identical tuple shape)."""
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
    """Basic, detector-independent price/volume technical context -- modeled
    on docs/uct-scanner-intelligence/vcp_gold_standard/data/case_packets.json's
    `neutral_context` block. Deliberately computed here from raw bars, NOT
    read off build_context()'s output -- build_context's trend_stage/
    rs_trend/dcr_signature/regime fields are inputs to the detectors' own
    confidence scoring (per the tier1_validation code audit), so including
    them here would leak detector-relevant signal into a "neutral" block.
    """
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


def scan_universe(con: sqlite3.Connection, tickers: list[str], detect_fns: dict) -> dict:
    """One shared pass over the sampled universe: fetches each ticker's bars
    once, builds context once per as-of point, and evaluates EVERY family's
    real detector against that same window (cheaper than rescanning per
    family, and guarantees every family's pool is drawn from the identical
    symbol/date universe -- no family gets an easier or harder sample)."""
    pools = {fam: {"fired": [], "not_fired": []} for fam in detect_fns}
    windows_evaluated = 0
    tickers_with_enough_history = 0

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
            for fam, fn in detect_fns.items():
                try:
                    detections = fn(window, ctx)
                except Exception as exc:  # a detector bug must not kill the scan
                    detections = []
                    print(f"[warn] {fam} raised on {ticker}@{window[-1]['t']}: {exc!r}", file=sys.stderr)
                fired = bool(detections)
                top_conf = max((d["confidence"] for d in detections), default=None) if fired else None
                record = {
                    "symbol": ticker,
                    "as_of_t": window[-1]["t"],
                    "bars": window,
                    "fired": fired,
                    "top_confidence": top_conf,
                }
                bucket = "fired" if fired else "not_fired"
                pools[fam][bucket].append(record)

        enough = all(
            len(p["fired"]) >= TARGET_FIRED * 3 and len(p["not_fired"]) >= TARGET_NOT_FIRED * 3
            for p in pools.values()
        )
        if enough:
            break

    return {
        "pools": pools,
        "tickers_scanned": tickers_with_enough_history,
        "windows_evaluated": windows_evaluated,
    }


def build_family_corpus(family: str, pools: dict, rng: random.Random, out_dir: Path, repo_commit: str, universe_size: int, tickers_scanned: int) -> dict:
    fired_pool = pools["fired"]
    not_fired_pool = pools["not_fired"]

    n_fired = min(TARGET_FIRED, len(fired_pool))
    n_not_fired = min(TARGET_NOT_FIRED, len(not_fired_pool))
    fired_sample = rng.sample(fired_pool, n_fired)
    not_fired_sample = rng.sample(not_fired_pool, n_not_fired)

    combined = fired_sample + not_fired_sample
    rng.shuffle(combined)  # interleave fired/not-fired so case_id order leaks nothing

    fam_dir = out_dir / family
    charts_dir = fam_dir / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)

    module_path, func_name = DETECTOR_REGISTRY[family]
    detector_version = {
        "module": module_path,
        "function": func_name,
        "repo_commit": repo_commit,
    }

    blind_packets = []
    answer_key = {}

    for i, rec in enumerate(combined):
        case_id = f"case_{i:04d}"
        bars = rec["bars"]
        chart_bars = bars[-CHART_BARS:]
        png_bytes = render_chart(_bars_to_tuples(chart_bars), window=CHART_BARS, key_level=None)
        chart_rel = f"charts/{case_id}.png"
        (fam_dir / chart_rel).write_bytes(png_bytes)

        blind_packets.append({
            "case_id": case_id,
            "family": family,
            "chart_file": chart_rel,
            "rubric_version": None,  # no rubric authored yet -- see manifest.md
            "provenance": {
                "timeframe": "D",
                "symbol_shown": False,
                "n_bars_available": len(bars),
                "n_bars_shown_on_chart": len(chart_bars),
                "corporate_action_treatment": (
                    "as stored in bars.db (Massive/Polygon-sourced, split/dividend-"
                    "adjusted per standard provider convention -- see CLAUDE.md "
                    "'Bars Correctness Layer')"
                ),
                "detector_version": detector_version,
            },
            "neutral_context": _neutral_context(bars),
        })

        answer_key[case_id] = {
            "symbol": rec["symbol"],
            "as_of_t": rec["as_of_t"],
            "detector_candidate_fired": rec["fired"],
            "detector_top_confidence": rec["top_confidence"],
            "note": (
                "CANDIDATE ONLY -- this is the real detector's own call at "
                "evaluation time, not adjudicated ground truth. Do not treat "
                "'fired=true' as 'a genuine setup existed here', and do not "
                "treat 'fired=false' as 'no setup existed here' -- that is "
                "exactly the recall question this corpus exists to let a "
                "future adjudicator answer independently."
            ),
        }

    (fam_dir / "blind_packets.json").write_text(
        json.dumps(blind_packets, indent=2), encoding="utf-8"
    )
    (fam_dir / "answer_key_ingredients.json").write_text(
        json.dumps(answer_key, indent=2), encoding="utf-8"
    )

    manifest = f"""# Blind evaluation corpus — {family}

GROUND_TRUTH_STATUS: PENDING

No adjudication has been performed on this corpus. `answer_key_ingredients.json`
records the real detector's own candidate calls ONLY (clearly labeled as such) —
it is NOT a ground-truth label and must not be reported as one. Precision/recall
numbers must not be computed from this corpus until a real adjudication pass
(human or LLM-judge, out of scope for this pass) fills in real identity labels,
analogous to `docs/uct-scanner-intelligence/vcp_gold_standard/data/case_answer_key.json`.

## Sample construction (reproducible)

- Universe: all `{universe_size}` distinct tickers with daily bars in
  `C:\\data\\bars.db` (read-only).
- Sampling: `random.Random({SEED})` fixed-seed shuffle of the full universe,
  taking the first {UNIVERSE_SAMPLE_SIZE} tickers — not filtered or
  cherry-picked by how the detector later scores them.
- Per ticker, evaluated at {len(AS_OF_OFFSETS)} "as of" points:
  offsets {list(AS_OF_OFFSETS)} trading days back from the ticker's most
  recent bar (0 = most recent), each fed a {WINDOW_BARS}-bar lookback window
  (skipped if fewer than {MIN_HISTORY_BARS} bars were available).
- Tickers with sufficient history that were actually scanned before the
  scan's early-stop condition was met: {tickers_scanned}.
- The REAL detector (`{module_path}.{func_name}`, repo commit `{repo_commit}`)
  was run on every window via `build_context()` + the same
  `lab/quality/harness.py::DETECTOR_REGISTRY` entry the fixture-battery
  harness uses — no mocking, no synthetic bars.
- Windows were split into a FIRED pool (n={len(fired_pool)} available) and a
  NOT-FIRED pool (n={len(not_fired_pool)} available); this corpus draws
  {n_fired} fired + {n_not_fired} not-fired cases from those pools
  (`random.Random({SEED}).sample`), so the sample is not entirely
  detector-selected — a real recall check needs examples the detector
  missed too.
- Case order was shuffled (same seeded RNG) so fired/not-fired status cannot
  be inferred from `case_id` ordering.

## What's in each file

- `blind_packets.json` — {len(blind_packets)} cases. Each has a rendered
  chart (`charts/case_XXXX.png`, no symbol/title, no highlighted level — the
  same `api.services.pattern_vision.chart_render.render_chart` the VCP
  gold-standard corpus's own render path uses, called with `key_level=None`
  for every case so a highlighted level can't leak which ones fired) plus
  `neutral_context` (last close, 52w range position, SMA10/20/50, volume
  averages, ADR% — computed directly from bars, NOT from `build_context()`'s
  categorical fields, since those feed the detectors' own confidence scoring
  and would leak verdict-adjacent signal into a "neutral" block).
  **Contains no detector verdict.**
- `answer_key_ingredients.json` — symbol, as-of date, and the detector's own
  candidate call per case_id, kept in a SEPARATE file so a reviewer given
  only `blind_packets.json` + `charts/` cannot see it.

## Next step (not done in this pass)

A human or LLM-judge adjudication pass reads `blind_packets.json` +
`charts/*.png` blind (never `answer_key_ingredients.json`) and produces a
`case_answer_key.json`-equivalent identity label per case (e.g. a
YES/BORDERLINE/NO/INSUFFICIENT_DATA rubric, modeled on
`docs/uct-scanner-intelligence/vcp_gold_standard/rubric_v2.md`). Only after
that exists can precision/recall be computed by joining the answer key
against `answer_key_ingredients.json`'s `detector_candidate_fired` column —
exactly the join `docs/uct-scanner-intelligence/vcp_gold_standard/data/metrics.json`
already performs for VCP.
"""
    (fam_dir / "manifest.md").write_text(manifest, encoding="utf-8")

    return {
        "family": family,
        "n_fired": n_fired,
        "n_not_fired": n_not_fired,
        "fired_pool_size": len(fired_pool),
        "not_fired_pool_size": len(not_fired_pool),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--families", default=",".join(FAMILIES))
    parser.add_argument("--universe-sample", type=int, default=UNIVERSE_SAMPLE_SIZE)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument(
        "--out-dir", default=str(Path(__file__).resolve().parent)
    )
    args = parser.parse_args()

    families = [f.strip() for f in args.families.split(",") if f.strip()]
    for fam in families:
        if fam not in DETECTOR_REGISTRY:
            raise SystemExit(f"{fam!r} not in DETECTOR_REGISTRY: {sorted(DETECTOR_REGISTRY)}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    con = _connect_ro()
    try:
        universe = _all_tickers(con)
        rng = random.Random(args.seed)
        rng.shuffle(universe)
        sample = universe[: args.universe_sample]

        detect_fns = {fam: get_detector(fam) for fam in families}
        scan = scan_universe(con, sample, detect_fns)
    finally:
        con.close()

    repo_commit = _repo_commit()
    summary = []
    for fam in families:
        result = build_family_corpus(
            fam,
            scan["pools"][fam],
            random.Random(args.seed),  # fresh RNG per family so subsampling
                                        # is deterministic per-family too
            out_dir,
            repo_commit,
            universe_size=len(universe),
            tickers_scanned=scan["tickers_scanned"],
        )
        summary.append(result)

    print(json.dumps({
        "universe_size": len(universe),
        "universe_sample_size": len(sample),
        "tickers_with_enough_history": scan["tickers_scanned"],
        "windows_evaluated": scan["windows_evaluated"],
        "families": summary,
    }, indent=2))


if __name__ == "__main__":
    main()
