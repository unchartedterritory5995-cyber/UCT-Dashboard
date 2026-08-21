"""The scanner's 7-criteria pullback score, promoted to the snapshot.

Verbatim arithmetic port of uct-intelligence
scripts/scanner_candidates.py::_score_candle_from_df (read 2026-08-21).
The snapshot is now the single authority for candle_score and the EMA/volume
mechanics beside it; the scanner keeps its own copy until pointed here
(named in spec §8's duplication ledger — never silently diverge, change the
scanner side deliberately or not at all).

Deliberate deviations, all shape-level (the POINTS ARITHMETIC is untouched):
  - bars are the screener's {o,h,l,c,v} dicts, already usable_bars-sanitized
  - insufficient data / zero-range last candle → all-None (the snapshot's
    not-computable convention), not a notes string
  - candle_notes is not emitted (a UI string, not a screenable fact)
  - vol_updown_ratio: the COLUMN is None when the 10-bar window has no up
    days or no down days (undefined ratio); the SCORE still uses the
    scanner's 1.0 sentinel internally so the points are identical
  - volume_ratio is recomputed nowhere here — the snapshot's vol_ratio
    (30-day) is the platform's one volume-ratio column (spec §8 item 4)

Threshold provenance (E-8): every scored threshold below is shipped, live,
in scanner_candidates.py — a published in-product source.
"""
from api.services.screener.technicals import _linear_slope

_NULL = {"candle_score": None, "ema_touch_count": None, "ema10_rising": None,
         "ema20_rising": None, "ema_stack_intact": None,
         "vol_nweek_low": None, "vol_updown_ratio": None}


def compute(bars, pole_pct=None):
    if not bars or len(bars) < 21:
        return dict(_NULL)
    closes = [b["c"] for b in bars]
    lows = [b["l"] for b in bars]
    vols = [b.get("v") or 0 for b in bars]

    # EMA20 full series (SMA-seeded, k=2/21 — scanner lines 622-630)
    k20 = 2.0 / 21
    ema = sum(closes[:20]) / 20
    ema20_series = [ema]
    for c in closes[20:]:
        ema = c * k20 + ema * (1 - k20)
        ema20_series.append(ema)
    ema20 = ema20_series[-1]
    if not ema20 or ema20 <= 0:
        return dict(_NULL)

    # EMA10 series (scanner lines 634-643)
    k10 = 2.0 / 11
    ema10_series = []
    if len(closes) >= 10:
        e10 = sum(closes[:10]) / 10
        ema10_series = [e10]
        for c in closes[10:]:
            e10 = c * k10 + e10 * (1 - k10)
            ema10_series.append(e10)
    ema10 = ema10_series[-1] if ema10_series else None

    ema20_rising = _linear_slope(ema20_series[-10:]) > 0
    ema10_rising = (_linear_slope(ema10_series[-5:]) > 0) \
        if len(ema10_series) >= 5 else None
    ema_stack_intact = bool(
        ema10 is not None and closes[-1] > ema10 and ema10 > ema20
        and ema20_rising and (ema10_rising is None or ema10_rising))

    ema_touch_count = 0
    check_len = min(15, len(lows))
    for i in range(-check_len, 0):
        idx = len(ema20_series) + i
        if 0 <= idx < len(ema20_series) and lows[i] <= ema20_series[idx] * 1.005:
            ema_touch_count += 1

    last = bars[-1]
    o, h, l, c = last["o"], last["h"], last["l"], last["c"]
    v = last.get("v") or 0.0
    rng = h - l
    if rng <= 0:
        return dict(_NULL)
    close_position = (c - l) / rng
    ema_distance_pct = (c - ema20) / ema20 * 100

    vol_nweek_low = None
    if len(vols) >= 10 and v > 0:
        if len(vols) >= 20 and v <= min(vols[-20:]):
            vol_nweek_low = 20
        elif len(vols) >= 15 and v <= min(vols[-15:]):
            vol_nweek_low = 15
        elif v <= min(vols[-10:]):
            vol_nweek_low = 10

    up_vols, down_vols = [], []
    c_list = closes[-11:]
    v_list = vols[-10:]
    for i in range(len(v_list)):
        if len(c_list) >= i + 2:
            (up_vols if c_list[i + 1] > c_list[i] else down_vols).append(v_list[i])
    ratio_defined = bool(up_vols and down_vols)
    vol_acc = ((sum(up_vols) / len(up_vols)) / (sum(down_vols) / len(down_vols))
               if ratio_defined else 1.0)

    # 5-bar avg body + 10-close CV, recomputed for SCORING only (candles owns
    # the columns) — scanner lines 740-779
    bodies = []
    for b in bars[-5:]:
        r = b["h"] - b["l"]
        if r > 0:
            bodies.append(abs(b["c"] - b["o"]) / r)
    avg_body = sum(bodies) / len(bodies) if bodies else abs(c - o) / rng
    close_cv = 10.0
    recent_c = closes[-10:] if len(closes) >= 10 else closes
    if len(recent_c) >= 3:
        m = sum(recent_c) / len(recent_c)
        if m > 0:
            close_cv = (sum((x - m) ** 2 for x in recent_c)
                        / len(recent_c)) ** 0.5 / m * 100

    pole = pole_pct or 0.0
    score = 0
    if l <= ema20 * 1.005:
        score += 25
    elif ema_distance_pct <= 2.0:
        score += 18
    elif ema_distance_pct <= 4.0:
        score += 10
    elif ema_distance_pct <= 6.0:
        score += 5
    if vol_nweek_low == 20:
        score += 20
    elif vol_nweek_low == 15:
        score += 13
    elif vol_nweek_low == 10:
        score += 8
    if avg_body < 0.30:
        score += 15
    elif avg_body < 0.40:
        score += 8
    if close_position > 0.60:
        score += 15
    elif close_position > 0.50:
        score += 8
    if close_cv < 2.5:
        score += 10
    elif close_cv < 4.0:
        score += 5
    if pole >= 40.0:
        score += 15
    elif pole >= 20.0:
        score += 10
    elif pole >= 10.0:
        score += 5
    if vol_acc > 1.1:
        score += 10
    elif vol_acc > 0.9:
        score += 5

    return {"candle_score": score, "ema_touch_count": ema_touch_count,
            "ema10_rising": ema10_rising, "ema20_rising": ema20_rising,
            "ema_stack_intact": ema_stack_intact,
            "vol_nweek_low": vol_nweek_low,
            "vol_updown_ratio": round(vol_acc, 2) if ratio_defined else None}
