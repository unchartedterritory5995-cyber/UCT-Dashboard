"""Cheap, universe-wide chart-pattern detection from daily bars.

Returns a comma-joined set of detector keys + the max confidence (0-1). These
are intentionally lightweight heuristics computed for every ticker in the nightly
build; expensive detectors live in the pattern engine (active-set only).
"""
from .technicals import _sma


def detect_patterns(bars):
    if not bars or len(bars) < 30:
        return ("", 0.0)
    closes = [b["c"] for b in bars]
    price = closes[-1]
    found = {}

    yr = bars[-252:] if len(bars) >= 252 else bars
    hi = max(b["h"] for b in yr)
    if bars[-1]["h"] >= hi:  # today prints (a tie with) the 52w high
        found["breakout_52w"] = 0.8

    s50, s200 = _sma(closes, 50), _sma(closes, 200)
    p50, p200 = _sma(closes[:-1], 50), _sma(closes[:-1], 200)
    if s50 and s200 and p50 and p200:
        if p50 <= p200 and s50 > s200:
            found["golden_cross"] = 0.7
        if p50 >= p200 and s50 < s200:
            found["death_cross"] = 0.7

    # flat base: last 20 closes within an 8% band, near the band high
    win = closes[-20:]
    if len(win) == 20:
        lo, hh = min(win), max(win)
        if hh and (hh - lo) / hh < 0.08 and price >= 0.95 * hh:
            found["flat_base"] = 0.6

    # VCP-ish: three ~10-bar swing ranges contracting
    if len(bars) >= 30:
        def rng(seg):
            return max(b["h"] for b in seg) - min(b["l"] for b in seg)
        a, b2, c = rng(bars[-30:-20]), rng(bars[-20:-10]), rng(bars[-10:])
        if a > b2 > c > 0:
            found["vcp"] = 0.6

    # bull flag: strong prior run then a shallow pullback
    if len(bars) >= 25:
        run = (closes[-10] - closes[-25]) / closes[-25] if closes[-25] else 0
        pull = (closes[-10] - price) / closes[-10] if closes[-10] else 0
        if run > 0.2 and 0 < pull < 0.1:
            found["bull_flag"] = 0.55

    if not found:
        return ("", 0.0)
    return (",".join(found.keys()), max(found.values()))
