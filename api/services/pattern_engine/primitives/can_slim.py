"""CAN SLIM scoring per William O'Neil ("How to Make Money in Stocks").

Provides:
  - can_slim_score(bars, context) -> CanSlimResult
    Returns: dict with composite score (0-100) + per-pillar scores + interpretation

Each pillar is approximated from price/volume data we have access to. Fundamental
pillars (C/A/I) use proxies; price-action pillars (N/S/L/M) are direct.

| Pillar | Meaning | What we detect |
|---|---|---|
| C | Current quarterly EPS growth | Recent earnings-style gap + sustained move |
| A | Annual EPS growth, ROE          | 12-month price advance |
| N | New high / new product         | Within 5% of 52-week high |
| S | Supply & demand                | DCR signature + volume signature |
| L | Leader or laggard              | RS trend + sector strength rank |
| I | Institutional sponsorship      | Avg daily volume liquidity proxy |
| M | Market direction               | Regime + Weinstein trend stage |
"""
from __future__ import annotations

from typing import TypedDict


class CanSlimResult(TypedDict):
    composite_score: float           # 0-100, average across pillars
    c_score: float                   # Current EPS growth (proxy: recent gap + sustained move)
    a_score: float                   # Annual growth (proxy: 12mo advance)
    n_score: float                   # New high (52w proximity)
    s_score: float                   # Supply/demand (volume + DCR)
    l_score: float                   # Leader/laggard (RS)
    i_score: float                   # Institutional (liquidity proxy)
    m_score: float                   # Market direction (regime)
    grade: str                       # "A" 80+, "B" 65-80, "C" 50-65, "D" <50
    interpretation: str              # Multi-sentence prose


def can_slim_score(bars: list[dict], context: dict) -> CanSlimResult:
    """Compute CAN SLIM composite score for the current chart.

    Args:
      bars: OHLCV list, sorted by t asc, most-recent last. Each bar is a dict
        with keys o/h/l/c/v (t optional, not used).
      context: partial Context dict supplying the structural inputs:
        - dcr_signature, volume_signature   (for S)
        - rs_trend, sector_strength_rank    (for L)
        - regime, trend_stage               (for M)

    Returns:
      CanSlimResult with composite + per-pillar 0-100 scores + grade + interpretation.
      Returns a neutral "insufficient data" result when fewer than 30 bars are
      supplied (composite=50, grade="C").
    """
    if not bars or len(bars) < 30:
        return _empty_result()

    c = _score_c_current(bars)
    a = _score_a_annual(bars)
    n = _score_n_new_high(bars, context)
    s = _score_s_supply_demand(context)
    l = _score_l_leader(context)
    i = _score_i_institutional(bars)
    m = _score_m_market(context)

    composite = (c + a + n + s + l + i + m) / 7
    grade = _grade(composite)
    interp = _interpretation(c, a, n, s, l, i, m, composite, grade)

    return {
        "composite_score": round(composite, 2),
        "c_score": round(c, 2),
        "a_score": round(a, 2),
        "n_score": round(n, 2),
        "s_score": round(s, 2),
        "l_score": round(l, 2),
        "i_score": round(i, 2),
        "m_score": round(m, 2),
        "grade": grade,
        "interpretation": interp,
    }


def _score_c_current(bars: list[dict]) -> float:
    """C: Current quarterly EPS growth proxy.

    Proxy: did the stock have a recent earnings gap-up + sustained advance?
    Look for any bar in the last 60 with gap_up >=4% (likely earnings) AND
    the close 20 bars later is at or above the gap close = earnings catalyst confirmed.

    Score: 100 if confirmed gap + hold, 70 if gap but didn't hold, 40 if no gap, 0-20 if gap-down.
    """
    if len(bars) < 30:
        return 50.0
    recent = bars[-60:] if len(bars) >= 60 else bars
    best_gap_score = 40.0
    saw_gap_down = False
    for i in range(1, len(recent) - 5):
        prev_close = recent[i - 1]["c"]
        bar_open = recent[i]["o"]
        if prev_close <= 0:
            continue
        gap_pct = (bar_open - prev_close) / prev_close
        if gap_pct >= 0.04:
            # Earnings gap candidate - did it hold?
            future_idx = min(i + 20, len(recent) - 1)
            future_close = recent[future_idx]["c"]
            if future_close >= recent[i]["c"]:
                best_gap_score = max(best_gap_score, 100.0)
            else:
                best_gap_score = max(best_gap_score, 70.0)
        elif gap_pct <= -0.04:
            # Earnings gap-down - bearish catalyst (only penalize if no offsetting gap-up)
            saw_gap_down = True
    if saw_gap_down and best_gap_score <= 40.0:
        return 20.0
    return best_gap_score


def _score_a_annual(bars: list[dict]) -> float:
    """A: Annual EPS growth proxy - 12-month price advance.

    Strong fundamental growth typically produces >=30% 12-month advance.
    Score mapping:
      >=60% advance -> 100
      30-60%        -> 70-100 (linear)
       0-30%        -> 30-70  (linear)
       negative     -> 30 + advance*100 (clamped at 0)
    """
    if not bars:
        return 50.0
    lookback = bars[-252:] if len(bars) >= 252 else bars
    if not lookback:
        return 50.0
    start_close = lookback[0]["c"]
    end_close = lookback[-1]["c"]
    if start_close <= 0:
        return 50.0
    advance_pct = (end_close - start_close) / start_close
    if advance_pct >= 0.60:
        return 100.0
    if advance_pct >= 0.30:
        return 70 + (advance_pct - 0.30) / 0.30 * 30
    if advance_pct >= 0.0:
        return 30 + advance_pct / 0.30 * 40
    return max(0.0, 30 + advance_pct * 100)


def _score_n_new_high(bars: list[dict], context: dict) -> float:
    """N: New high - proximity to 52-week high.

    Score: 100 if within 1% of 52w high, 90 if within 5%, 75 if within 10%,
    60 if within 15%, 40 if within 25%, 20 if within 50%, 0 if >50% off.
    """
    if not bars:
        return 50.0
    lookback = bars[-252:] if len(bars) >= 252 else bars
    if not lookback:
        return 50.0
    high_52w = max(b["h"] for b in lookback)
    current = bars[-1]["c"]
    if high_52w <= 0:
        return 50.0
    dist_pct = (high_52w - current) / high_52w * 100
    if dist_pct <= 1:
        return 100.0
    if dist_pct <= 5:
        return 90.0
    if dist_pct <= 10:
        return 75.0
    if dist_pct <= 15:
        return 60.0
    if dist_pct <= 25:
        return 40.0
    if dist_pct <= 50:
        return 20.0
    return 0.0


def _score_s_supply_demand(context: dict) -> float:
    """S: Supply/demand - volume + DCR signature.

    accumulation + contracting volume = perfect demand absorption setup.
    distribution + expanding volume = selling pressure.
    """
    dcr_sig = context.get("dcr_signature", "neutral")
    vol_sig = context.get("volume_signature", "neutral")

    score = 50.0
    if dcr_sig == "accumulation":
        score += 25
    elif dcr_sig == "distribution":
        score -= 25

    if vol_sig == "contracting":
        score += 15  # supply drying up
    elif vol_sig == "expanding":
        score += 5   # demand showing up
    # neutral volume = no adjustment

    return min(100.0, max(0.0, score))


def _score_l_leader(context: dict) -> float:
    """L: Leader or laggard - RS-based.

    rs_trend "up" + high relative rank -> leader.
    Without rank percentile, approximate using rs_trend + sector_strength_rank.
    """
    rs_trend = context.get("rs_trend", "flat")
    sector_rank = context.get("sector_strength_rank")  # 1-11, lower = stronger

    score = 50.0
    if rs_trend == "up":
        score += 30
    elif rs_trend == "down":
        score -= 25

    if sector_rank is not None:
        if sector_rank <= 3:
            score += 15
        elif sector_rank <= 6:
            score += 5
        elif sector_rank >= 9:
            score -= 10

    return min(100.0, max(0.0, score))


def _score_i_institutional(bars: list[dict]) -> float:
    """I: Institutional sponsorship - liquidity proxy.

    We don't have institutional ownership data; approximate via average daily volume.
    O'Neil's CAN SLIM looks for stocks with growing institutional sponsorship; we
    score based on whether the volume is institutional-tier (>500K avg).
    """
    if not bars:
        return 50.0
    last_60 = bars[-60:] if len(bars) >= 60 else bars
    if not last_60:
        return 50.0
    avg_vol = sum(b["v"] for b in last_60) / len(last_60)
    if avg_vol >= 5_000_000:
        return 100.0
    if avg_vol >= 1_000_000:
        return 85.0
    if avg_vol >= 500_000:
        return 70.0
    if avg_vol >= 200_000:
        return 50.0
    if avg_vol >= 100_000:
        return 30.0
    return 15.0


def _score_m_market(context: dict) -> float:
    """M: Market direction.

    Bull regime = high score; bear regime = low. trend_stage 2 = bullish.
    """
    regime = context.get("regime", "unknown")
    trend_stage = context.get("trend_stage")

    score = 50.0
    if regime == "bull":
        score += 30
    elif regime == "bear":
        score -= 30
    elif regime == "transition":
        score += 10

    if trend_stage == 2:
        score += 15
    elif trend_stage == 4:
        score -= 25

    return min(100.0, max(0.0, score))


def _grade(composite: float) -> str:
    if composite >= 80:
        return "A"
    if composite >= 65:
        return "B"
    if composite >= 50:
        return "C"
    return "D"


def _interpretation(c, a, n, s, l, i, m, composite, grade) -> str:
    """Compose a 4-6 sentence prose interpretation."""
    leading = []
    if c >= 70:
        leading.append("C (current earnings catalyst evident)")
    if a >= 70:
        leading.append("A (strong 12-month advance)")
    if n >= 80:
        leading.append("N (at or near new highs)")
    if s >= 70:
        leading.append("S (accumulation supply/demand)")
    if l >= 70:
        leading.append("L (leadership confirmed)")
    if i >= 70:
        leading.append("I (institutional-tier liquidity)")
    if m >= 70:
        leading.append("M (favorable market direction)")

    weak = []
    if c < 50:
        weak.append("C (no recent earnings catalyst)")
    if a < 50:
        weak.append("A (weak 12-month performance)")
    if n < 50:
        weak.append("N (extended from highs)")
    if s < 50:
        weak.append("S (distribution/weak supply absorption)")
    if l < 50:
        weak.append("L (laggard vs market)")
    if i < 50:
        weak.append("I (sub-institutional liquidity)")
    if m < 50:
        weak.append("M (unfavorable market direction)")

    out = f"CAN SLIM composite: {composite:.1f}/100 (Grade {grade}). "
    if leading:
        out += f"Strong pillars: {', '.join(leading)}. "
    if weak:
        out += f"Weak pillars: {', '.join(weak)}. "
    if grade == "A":
        out += ("This chart meets O'Neil's full CAN SLIM criteria - the kind of "
                "setup that historically produced the great winners of every "
                "market cycle.")
    elif grade == "B":
        out += ("Most CAN SLIM pillars confirmed; tradeable with awareness of "
                "the weak pillar(s).")
    elif grade == "C":
        out += ("Mixed CAN SLIM picture; trade with smaller size or wait for the "
                "weak pillars to improve.")
    else:
        out += ("CAN SLIM pillars largely failing - not an O'Neil-grade setup. "
                "Better opportunities likely exist elsewhere.")

    return out


def _empty_result() -> CanSlimResult:
    return {
        "composite_score": 50.0,
        "c_score": 50.0,
        "a_score": 50.0,
        "n_score": 50.0,
        "s_score": 50.0,
        "l_score": 50.0,
        "i_score": 50.0,
        "m_score": 50.0,
        "grade": "C",
        "interpretation": "Insufficient data for CAN SLIM scoring (need >=30 bars).",
    }
