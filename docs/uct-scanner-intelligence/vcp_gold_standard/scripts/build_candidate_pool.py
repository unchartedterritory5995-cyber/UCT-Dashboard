"""Phase 3B Lane A -- VCP gold-standard candidate pool builder.

Runs System A (api/services/pattern_engine/detectors/uct/vcp.py) and System D
(api/services/screener/base_catalog.py::vcp_state, via bases.py::BaseCtx) on
the SAME frozen bars for a broad, real ticker sample, at THREE distinct
evaluation timestamps (no look-ahead: each timestamp's bars are queried with
an explicit as-of cutoff via bars_sqlite.get_bars_before, and no bar after
that cutoff is ever read for that timestamp's evaluation).

Read-only against C:\\data\\bars.db. Writes results to
docs/uct-scanner-intelligence/vcp_gold_standard/data/candidate_pool.json.

Run: python docs/uct-scanner-intelligence/vcp_gold_standard/scripts/build_candidate_pool.py
"""
import json
import os
import random
import sys
import time

os.environ["DATA_DIR"] = "C:/data"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

from api.services import bars_sqlite  # noqa: E402
bars_sqlite._DB_PATH = "C:/data/bars.db"

from api.services.pattern_engine.detectors.uct.vcp import detect_vcp  # noqa: E402
from api.services.pattern_engine.primitives.context import build_context  # noqa: E402
from api.services.screener.bases import BaseCtx  # noqa: E402
from api.services.screener.base_catalog import vcp_state  # noqa: E402

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "candidate_pool.json")
UNIVERSE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "api", "data", "cap_universe.json")

# Three evaluation timestamps (YYYYMMDD, as-of cutoffs). "current" is the most
# recent bar in the DB; the other two are ~6 and ~12 months back, giving
# genuine temporal spread without needing a regime classifier.
EVAL_TIMESTAMPS = [
    ("current", None),       # None = use get_bars(), i.e. up through the latest bar
    ("t_minus_6mo", 20260302),
    ("t_minus_12mo", 20250902),
]

BARS_WINDOW = 400
SAMPLE_SIZE = 1400
SEED = 20260903


def load_bars(sym, as_of):
    if as_of is None:
        rows = bars_sqlite.get_bars(sym, "D", BARS_WINDOW)
    else:
        rows = bars_sqlite.get_bars_before(sym, "D", BARS_WINDOW, as_of)
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def liquidity_tier(bars):
    if len(bars) < 20:
        return "unknown"
    tail = bars[-60:] if len(bars) >= 60 else bars
    dollar_vol = sum((b["c"] or 0) * (b["v"] or 0) for b in tail) / len(tail)
    if dollar_vol >= 50_000_000:
        return "high_liquidity"
    if dollar_vol >= 5_000_000:
        return "mid_liquidity"
    if dollar_vol > 0:
        return "low_liquidity"
    return "unknown"


def volatility_tier(bars):
    if len(bars) < 21:
        return "unknown"
    tail = bars[-21:]
    adr_pcts = []
    for b in tail:
        if b["c"]:
            adr_pcts.append((b["h"] - b["l"]) / b["c"] * 100.0)
    if not adr_pcts:
        return "unknown"
    adr = sum(adr_pcts) / len(adr_pcts)
    if adr >= 8.0:
        return "extreme_volatility"
    if adr >= 4.0:
        return "elevated_volatility"
    return "normal_volatility"


def event_distortion_flag(bars):
    """Best-effort: any single-day |gap| >= 15% in the trailing 30 bars, a
    crude proxy for an earnings/news-event distortion rather than organic
    structure."""
    if len(bars) < 31:
        return False
    tail = bars[-30:]
    for i in range(1, len(tail)):
        prior_close = tail[i - 1]["c"]
        if not prior_close:
            continue
        gap = abs(tail[i]["o"] - prior_close) / prior_close
        if gap >= 0.15:
            return True
    return False


def main():
    t0 = time.time()
    universe = json.load(open(UNIVERSE_PATH, encoding="utf-8"))
    rng = random.Random(SEED)
    sample = rng.sample(universe, min(SAMPLE_SIZE, len(universe)))

    results = []
    n_evaluated = 0
    n_skipped_insufficient = 0

    for sym in sample:
        for label, as_of in EVAL_TIMESTAMPS:
            bars = load_bars(sym, as_of)
            if len(bars) < 250:
                n_skipped_insufficient += 1
                continue
            n_evaluated += 1

            ctx = build_context(bars, sym=sym)
            a_result = detect_vcp(bars, ctx)
            a_fired = len(a_result) > 0
            a_conf = a_result[0]["confidence"] if a_result else None

            d_ctx = BaseCtx(bars=bars, bars_full=bars)
            d_result = vcp_state(d_ctx)
            d_fired = d_result is not None

            if a_fired and d_fired:
                category = "both_agree_positive"
            elif (not a_fired) and (not d_fired):
                category = "both_agree_negative"
            elif a_fired and not d_fired:
                category = "system_a_only"
            else:
                category = "system_d_only"

            results.append({
                "symbol": sym,
                "timeframe": "D",
                "eval_label": label,
                "eval_as_of": as_of,
                "last_bar_t": bars[-1]["t"],
                "n_bars": len(bars),
                "detector_versions": {
                    "system_a": "pattern_engine/detectors/uct/vcp.py (Phase 3A trend-template gate, 2026-09-02)",
                    "system_d": "screener/base_catalog.py::vcp_state (fresh origin/master read, Phase 3B)",
                },
                "rubric_version": None,  # filled in by the labeling step
                "liquidity_tier": liquidity_tier(bars),
                "volatility_tier": volatility_tier(bars),
                "event_distortion_flag": event_distortion_flag(bars),
                "system_a": {"fired": a_fired, "confidence": a_conf,
                             "detection": a_result[0] if a_result else None},
                "system_d": {"fired": d_fired, "state": d_result},
                "agreement_category": category,
            })

    elapsed = time.time() - t0
    payload = {
        "generated_at_note": "Phase 3B Lane A candidate pool -- read-only against C:/data/bars.db",
        "universe_source": "api/data/cap_universe.json",
        "sample_size": len(sample),
        "sample_seed": SEED,
        "eval_timestamps": EVAL_TIMESTAMPS,
        "bars_window": BARS_WINDOW,
        "n_evaluated": n_evaluated,
        "n_skipped_insufficient_history": n_skipped_insufficient,
        "elapsed_seconds": round(elapsed, 1),
        "results": results,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)

    # Console summary
    from collections import Counter
    cat_counts = Counter(r["agreement_category"] for r in results)
    liq_counts = Counter(r["liquidity_tier"] for r in results)
    vol_counts = Counter(r["volatility_tier"] for r in results)
    event_count = sum(1 for r in results if r["event_distortion_flag"])
    print(f"evaluated={n_evaluated} skipped_insufficient={n_skipped_insufficient} elapsed={elapsed:.1f}s")
    print("agreement categories:", dict(cat_counts))
    print("liquidity tiers:", dict(liq_counts))
    print("volatility tiers:", dict(vol_counts))
    print("event-distortion-flagged:", event_count)
    print("wrote", OUT_PATH)


if __name__ == "__main__":
    main()
