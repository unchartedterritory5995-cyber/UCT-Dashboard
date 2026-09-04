"""Phase 3B Lane A -- build blinded chart + neutral-context packets for each
selected VCP gold-standard case. Read-only against C:\\data\\bars.db.

Produces:
  charts/case_XXXX.png              -- unannotated candlestick+volume+MA chart
  data/case_packets.json            -- per-case frozen provenance + neutral
                                        context (NO detector outputs -- blind)
  data/case_answer_key.json         -- case_id -> {symbol, eval_label, system_a,
                                        system_d, agreement_category} (kept
                                        separate, unblinded only after review)
"""
import json
import os
import sys

os.environ["DATA_DIR"] = "C:/data"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

import matplotlib
matplotlib.use("Agg")
import mplfinance as mpf  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(__file__)
SELECTED_PATH = os.path.join(HERE, "..", "data", "selected_cases_raw.json")
CHARTS_DIR = os.path.join(HERE, "..", "charts")
PACKETS_PATH = os.path.join(HERE, "..", "data", "case_packets.json")
ANSWER_KEY_PATH = os.path.join(HERE, "..", "data", "case_answer_key.json")

RUBRIC_VERSION = "v2"


def _sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def build_neutral_context(bars):
    closes = [b["c"] for b in bars]
    highs = [b["h"] for b in bars]
    lows = [b["l"] for b in bars]
    vols = [b["v"] for b in bars]
    last_close = closes[-1]

    lookback_252 = bars[-252:] if len(bars) >= 252 else bars
    high_252 = max(b["h"] for b in lookback_252)
    low_252 = min(b["l"] for b in lookback_252)
    pct_of_high = round(last_close / high_252 * 100, 1) if high_252 else None
    pct_above_low = round((last_close - low_252) / low_252 * 100, 1) if low_252 else None

    sma10 = _sma(closes, 10)
    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, 50)
    sma150 = _sma(closes, 150)
    sma200 = _sma(closes, 200)

    vol20 = _sma(vols, 20)
    vol50 = _sma(vols, 50)

    adr_tail = bars[-21:] if len(bars) >= 21 else bars
    adr_pct = round(
        sum((b["h"] - b["l"]) / b["c"] * 100 for b in adr_tail if b["c"]) / len(adr_tail), 2
    ) if adr_tail else None

    return {
        "last_close": round(last_close, 2),
        "pct_of_52w_high": pct_of_high,
        "pct_above_52w_low": pct_above_low,
        "sma10": round(sma10, 2) if sma10 else None,
        "sma20": round(sma20, 2) if sma20 else None,
        "sma50": round(sma50, 2) if sma50 else None,
        "sma150": round(sma150, 2) if sma150 else None,
        "sma200": round(sma200, 2) if sma200 else None,
        "ma_order_ascending": bool(
            sma10 and sma20 and sma50 and sma150 and sma200
            and last_close > sma10 > sma20 > sma50 > sma150 > sma200
        ) if all([sma10, sma20, sma50, sma150, sma200]) else None,
        "trend_template_150_200": (
            bool(last_close > sma150 and last_close > sma200 and sma150 > sma200)
            if (sma150 and sma200) else None
        ),
        "vol_20d_avg": round(vol20, 0) if vol20 else None,
        "vol_50d_avg": round(vol50, 0) if vol50 else None,
        "vol_20_vs_50_ratio": round(vol20 / vol50, 3) if (vol20 and vol50) else None,
        "adr_pct_21d": adr_pct,
        "n_bars_shown": len(bars),
    }


def render_chart(bars, out_path, sym_display):
    idx = pd.to_datetime([str(b["t"]) for b in bars], format="%Y%m%d")
    df = pd.DataFrame({
        "Open": [b["o"] for b in bars],
        "High": [b["h"] for b in bars],
        "Low": [b["l"] for b in bars],
        "Close": [b["c"] for b in bars],
        "Volume": [b["v"] for b in bars],
    }, index=idx)

    mav = tuple(p for p in (10, 20, 50, 150, 200) if len(bars) >= p)
    mc = mpf.make_marketcolors(up="#26a69a", down="#ef5350", edge="inherit",
                                wick="inherit", volume="in")
    style = mpf.make_mpf_style(marketcolors=mc, gridstyle=":", gridcolor="#333333",
                                facecolor="#111111", figcolor="#111111",
                                edgecolor="#555555", rc={"font.size": 9})
    mpf.plot(
        df, type="candle", volume=True, mav=mav if mav else None,
        style=style, title="",
        savefig=dict(fname=out_path, dpi=110, bbox_inches="tight"),
        figsize=(11, 7), tight_layout=True,
    )


def main():
    selected = json.load(open(SELECTED_PATH, encoding="utf-8"))
    os.makedirs(CHARTS_DIR, exist_ok=True)

    packets = []
    answer_key = {}

    for i, case in enumerate(selected):
        case_id = f"case_{i:04d}"
        bars = None
        # We do not have raw bars stored in selected_cases_raw.json (only the
        # detector outputs), so re-fetch identically to build_candidate_pool.py
        # using the SAME as-of cutoff -- this is a deterministic re-read of the
        # same frozen window, not a new/different evaluation.
        from api.services import bars_sqlite
        bars_sqlite._DB_PATH = "C:/data/bars.db"
        as_of = case["eval_as_of"]
        if as_of is None:
            rows = bars_sqlite.get_bars(case["symbol"], "D", 400)
        else:
            rows = bars_sqlite.get_bars_before(case["symbol"], "D", 400, as_of)
        bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]

        # Show reviewers only the most recent ~170 bars (matches Phase 2C's
        # chart framing -- enough to see the prior advance + contractions
        # without dumping 400 bars of unrelated history) while the NEUTRAL
        # CONTEXT stats (52w high/low, SMA150/200) are still computed from the
        # full available window, exactly like Phase 2C did.
        chart_bars = bars[-170:] if len(bars) >= 170 else bars
        ctx = build_neutral_context(bars)

        img_path = os.path.join(CHARTS_DIR, f"{case_id}.png")
        render_chart(chart_bars, img_path, case["symbol"])

        packets.append({
            "case_id": case_id,
            "rubric_version": RUBRIC_VERSION,
            "chart_file": f"charts/{case_id}.png",
            "provenance": {
                "symbol_shown": False,  # ticker withheld from reviewers, per blinding
                "timeframe": "D",
                "evaluation_as_of": case["eval_as_of"] if case["eval_as_of"] else case["last_bar_t"],
                "eval_label": case["eval_label"],
                "n_bars_available": case["n_bars"],
                "n_bars_shown_on_chart": len(chart_bars),
                "corporate_action_treatment": "as stored in bars.db (Massive/Polygon-sourced, split/dividend-adjusted per standard provider convention -- see CLAUDE.md Bars Correctness Layer)",
                "detector_versions": case["detector_versions"],
            },
            "neutral_context": ctx,
        })
        answer_key[case_id] = {
            "symbol": case["symbol"],
            "eval_label": case["eval_label"],
            "eval_as_of": case["eval_as_of"],
            "liquidity_tier": case["liquidity_tier"],
            "volatility_tier": case["volatility_tier"],
            "event_distortion_flag": case["event_distortion_flag"],
            "agreement_category": case["agreement_category"],
            "system_a": case["system_a"],
            "system_d": case["system_d"],
        }

    json.dump(packets, open(PACKETS_PATH, "w", encoding="utf-8"), indent=2, default=str)
    json.dump(answer_key, open(ANSWER_KEY_PATH, "w", encoding="utf-8"), indent=2, default=str)
    print(f"wrote {len(packets)} case packets + charts to {CHARTS_DIR}")
    print(f"wrote {PACKETS_PATH}")
    print(f"wrote {ANSWER_KEY_PATH} (KEEP SEPARATE FROM REVIEWERS)")


if __name__ == "__main__":
    main()
