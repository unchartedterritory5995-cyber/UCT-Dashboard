"""Generate api/data/leader_universe.json from cap_universe.json + bars + context.

Scores each ticker on leader criteria (52w high proximity, volume, advance, MA stack,
stage, RS, CAN SLIM). Outputs the top ~200 to leader_universe.json.

Should be run periodically (weekly?) to refresh as leaders rotate.

Usage: python scripts/generate_leader_universe.py [--limit 200] [--min-score 80]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, _REPO_ROOT)


def score_ticker(sym: str) -> dict | None:
    """Return {sym, leader_score, breakdown} or None if insufficient data."""
    from api.services import bars_sqlite
    from api.services.pattern_engine.primitives.context import build_context

    bars = bars_sqlite.get_bars(sym, "D", 300)
    if not bars or len(bars) < 200:
        return None
    bars_list = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in bars]

    ctx = build_context(bars_list, sym=sym)

    score = 0
    breakdown = {}

    # 52w proximity
    high_52w = max(b["h"] for b in bars_list[-252:]) if len(bars_list) >= 252 else max(b["h"] for b in bars_list)
    current = bars_list[-1]["c"]
    if high_52w > 0:
        dist_pct = (high_52w - current) / high_52w * 100
        if dist_pct <= 5:
            score += 25
            breakdown["52w_proximity"] = "+25 (within 5% of high)"
        elif dist_pct <= 15:
            score += 10
            breakdown["52w_proximity"] = "+10 (within 15%)"
        else:
            breakdown["52w_proximity"] = f"0 ({dist_pct:.1f}% off high)"

    # Average volume
    last_60_vol = [b["v"] for b in bars_list[-60:]]
    avg_vol = sum(last_60_vol) / len(last_60_vol) if last_60_vol else 0
    if avg_vol >= 2_000_000:
        score += 30
        breakdown["avg_volume"] = f"+30 ({avg_vol:.0f} avg)"
    elif avg_vol >= 500_000:
        score += 20
        breakdown["avg_volume"] = f"+20 ({avg_vol:.0f} avg)"
    else:
        breakdown["avg_volume"] = f"0 ({avg_vol:.0f} avg — below 500K threshold)"

    # 12-month advance
    if len(bars_list) >= 252:
        start_close = bars_list[-252]["c"]
        end_close = bars_list[-1]["c"]
        if start_close > 0:
            advance_pct = (end_close - start_close) / start_close * 100
            if advance_pct >= 60:
                score += 30
                breakdown["12m_advance"] = f"+30 ({advance_pct:.0f}%)"
            elif advance_pct >= 30:
                score += 20
                breakdown["12m_advance"] = f"+20 ({advance_pct:.0f}%)"
            elif advance_pct >= 0:
                score += 5
                breakdown["12m_advance"] = f"+5 ({advance_pct:.0f}%)"
            else:
                breakdown["12m_advance"] = f"0 ({advance_pct:.0f}% — declined)"

    # MA alignment
    if ctx.get("ma_alignment") == "stacked_bullish":
        score += 15
        breakdown["ma_alignment"] = "+15 (stacked bullish)"

    # Trend stage
    if ctx.get("trend_stage") == 2:
        score += 10
        breakdown["trend_stage"] = "+10 (Stage 2)"

    # RS trend
    if ctx.get("rs_trend") == "up":
        score += 10
        breakdown["rs_trend"] = "+10 (RS up)"

    # CAN SLIM
    grade = ctx.get("can_slim_grade", "C")
    if grade == "A":
        score += 15
        breakdown["can_slim"] = f"+15 (Grade A — {ctx.get('can_slim_score', 0):.0f})"
    elif grade == "B":
        score += 8
        breakdown["can_slim"] = f"+8 (Grade B — {ctx.get('can_slim_score', 0):.0f})"

    return {
        "sym": sym,
        "leader_score": score,
        "breakdown": breakdown,
        "current_close": current,
        "avg_volume": int(avg_vol),
        "can_slim_grade": grade,
    }


def main(limit: int = 200, min_score: int = 80):
    universe_path = os.path.join(_REPO_ROOT, "api", "data", "cap_universe.json")
    output_path = os.path.join(_REPO_ROOT, "api", "data", "leader_universe.json")

    with open(universe_path) as f:
        data = json.load(f)
    universe = data if isinstance(data, list) else data.get("tickers", [])

    print(f"Scoring {len(universe)} tickers from cap_universe...")

    results = []
    for i, sym in enumerate(universe):
        if i % 250 == 0:
            print(f"  Progress: {i} / {len(universe)} ({len(results)} qualifying so far)")
        try:
            r = score_ticker(sym)
            if r is not None and r["leader_score"] >= min_score:
                results.append(r)
        except Exception as e:
            print(f"  Failed for {sym}: {e}")

    # Sort by score descending
    results.sort(key=lambda r: -r["leader_score"])
    top = results[:limit]

    print(f"\nQualified leaders: {len(results)}")
    print(f"Saving top {len(top)} to {output_path}")

    output = {
        "version": "1.0",
        "generated_at": int(__import__("time").time()),
        "leader_count": len(top),
        "tickers": [r["sym"] for r in top],
        "details": top,
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print("Done.\n\nTop 20:")
    for r in top[:20]:
        print(f"  {r['sym']:6s}  score={r['leader_score']:3d}  vol={r['avg_volume']:>12,d}  grade={r['can_slim_grade']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--min-score", type=int, default=80)
    args = parser.parse_args()
    main(args.limit, args.min_score)
