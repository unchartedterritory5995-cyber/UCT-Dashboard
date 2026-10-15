"""Shared helpers for the four UCT trader-setup detectors.

`uct_kicker`, `uct_oops_reversal`, `uct_slingshot` and `uct_hve` are ports of an
offline lab study of setups as practising traders describe and scan for them.
The lab measured each rule against the traders' own called examples and a blind
adjudication; the production rules below are the variants that survived that
adjudication. Looser readings are carried only as LABELS in
`geometry.extras` (never as a reason to fire).

Visible to every member (owner ruling 2026-10-15): they shipped admin-only via
`registry.INTERNAL_PATTERN_IDS` and were made public; they are listed in the
member catalog (`api/routers/patterns.py::_PATTERN_METADATA`).

Every indicator here is causal: the value at index k depends only on bars[0..k],
so evaluating session i on the full list equals evaluating it on bars[:i+1].

This module registers nothing.
"""
from __future__ import annotations

import time
import uuid
from typing import Optional


HIST_SCORE = 50.0
CONFIDENCE_FLOOR = 50.0
#: Trigger sessions examined, newest first. A setup fires on the most recent of
#: these that qualifies, so a trigger from yesterday is still reported today.
MAX_TRIGGER_AGE = 3


# ----------------------------------------------------------------------------
# causal indicator series
# ----------------------------------------------------------------------------
def ema(xs, n):
    a, out, e = 2.0 / (n + 1), [], None
    for x in xs:
        e = x if e is None else e + a * (x - e)
        out.append(e)
    return out


def sma(xs, n):
    out, s = [], 0.0
    for k, x in enumerate(xs):
        s += x
        if k >= n:
            s -= xs[k - n]
        out.append(s / n if k >= n - 1 else None)
    return out


def atr(bars, n=14):
    """Simple average of true range over n bars ending at k."""
    tr = [None] + [
        max(bars[k]["h"], bars[k - 1]["c"]) - min(bars[k]["l"], bars[k - 1]["c"])
        for k in range(1, len(bars))
    ]
    out = [None] * len(bars)
    for k in range(n, len(bars)):
        out[k] = sum(tr[k - n + 1:k + 1]) / n
    return out


def series(bars) -> dict:
    c = [float(b["c"]) for b in bars]
    h = [float(b["h"]) for b in bars]
    v = [float(b["v"] or 0.0) for b in bars]
    return {
        "c": c, "h": h, "v": v,
        "e4h": ema(h, 4), "e8": ema(c, 8), "e9": ema(c, 9), "e20": ema(c, 20),
        "e21": ema(c, 21), "s50": sma(c, 50), "s200": sma(c, 200),
        "v50": sma(v, 50), "atr": atr(bars),
    }


def dcr(b) -> float:
    """Daily closing range: where the close sits in the bar's range, 0..1."""
    rng = b["h"] - b["l"]
    return (b["c"] - b["l"]) / rng if rng > 0 else 0.5


def near(x, levels, band):
    return [name for name, lv in levels
            if lv is not None and band is not None and abs(x - lv) <= band]


def stopped_out_since(bars, idx: int, stop: float, direction: str = "bullish") -> bool:
    """True when a session AFTER the trigger already traded through the stop.
    A trigger from a prior session is only reported while it is still intact."""
    later = bars[idx + 1:]
    if direction == "bullish":
        return any(b["l"] < stop for b in later)
    return any(b["h"] > stop for b in later)


def valid_bar(b) -> bool:
    try:
        return (b["h"] >= b["l"] and min(b["o"], b["h"], b["l"], b["c"]) > 0)
    except (TypeError, KeyError):
        return False


# ----------------------------------------------------------------------------
# high-volume-edge bar (shared by uct_hve and the slingshot's stack label)
# ----------------------------------------------------------------------------
HVE_MIN_PRIOR_BARS = 20          # [P] need this many prior bars to call a bar "highest volume"
HVE_HIGH_CLOSE_DCR = 0.70        # [P] high closing range tier
_HVE_LOOKBACK = 252              # [T] highest volume of the prior 252 sessions
_HVE_PRICE = 3                   # [T] close > 3
_HVE_26WK_LOOKBACK, _HVE_26WK_MINV = 130, 250000   # [T] 26-week variant (label)


def hve_bar(bars, S: dict, g: int) -> Optional[dict]:
    """Is bar g a high-volume-edge bar? Uses bars[:g+1] only.

    Qualifies (a1) when its volume beats every one of the prior 252 sessions
    and it closes above 3. The 26-week variant (volume >= the prior 130
    sessions' max, > 250K shares, up close) is reported as a label."""
    if g < HVE_MIN_PRIOR_BARS or g >= len(bars):
        return None
    v = S["v"]
    b = bars[g]
    c, c1 = b["c"], bars[g - 1]["c"]
    prior = v[max(0, g - _HVE_LOOKBACK):g]
    if not prior:
        return None
    a1 = v[g] > max(prior) and c > _HVE_PRICE
    p26 = v[max(0, g - _HVE_26WK_LOOKBACK):g]
    a26 = bool(p26) and v[g] >= max(p26) and v[g] > _HVE_26WK_MINV and c > c1
    if not (a1 or a26):
        return None
    return {
        "idx": g, "hvc": c, "hvo": b["o"], "hvl": b["l"], "hvh": b["h"],
        "a1_252": a1, "full_252_history": len(prior) >= _HVE_LOOKBACK,
        "ever_in_data": v[g] > max(v[:g]), "a26_26wk": a26,
        "dcr": round(dcr(b), 3), "high_close": dcr(b) >= HVE_HIGH_CLOSE_DCR,
        "up_day": c > c1, "prior_max_volume": max(prior),
    }


# ----------------------------------------------------------------------------
# scoring
# ----------------------------------------------------------------------------
def clamp(x, lo=0.0, hi=100.0) -> float:
    return max(lo, min(hi, x))


def volume_score(rvol: Optional[float]) -> float:
    """Relative volume vs its 50-bar average: 1x = 40, 3x+ = 100."""
    if rvol is None:
        return 40.0
    return round(clamp(40.0 + (rvol - 1.0) * 30.0, 40.0, 100.0), 2)


def context_score(context: dict, direction: str = "bullish") -> float:
    """Trend stage, MA stack and RS trend, read in the setup's direction.
    Floored at 40 so a valid setup in a mixed tape still clears the engine's
    confidence floor: context is a modifier here, never a gate."""
    score = 50.0
    stage = context.get("trend_stage")
    align = context.get("ma_alignment")
    rs = context.get("rs_trend")
    if direction == "bullish":
        score += {1: 10.0, 2: 20.0, 3: 5.0, 4: -10.0}.get(stage, 0.0)
        score += {"stacked_bullish": 15.0, "mixed": 5.0, "stacked_bearish": -10.0}.get(align, 0.0)
        score += {"up": 15.0, "flat": 5.0, "down": -5.0}.get(rs, 0.0)
    else:
        score += {4: 20.0, 3: 10.0, 2: -10.0}.get(stage, 0.0)
        score += {"stacked_bearish": 15.0, "mixed": 5.0, "stacked_bullish": -10.0}.get(align, 0.0)
        score += {"down": 15.0, "flat": 5.0, "up": -5.0}.get(rs, 0.0)
    return round(clamp(score, 40.0, 100.0), 2)


def confidence(geom: float, vol: float, ctx: float, hist: float = HIST_SCORE) -> float:
    return round(0.40 * geom + 0.25 * vol + 0.20 * ctx + 0.15 * hist, 2)


# ----------------------------------------------------------------------------
# levels + detection shape
# ----------------------------------------------------------------------------
def make_levels(entry: float, stop: float, direction: str, entry_condition: str,
                stop_basis: str) -> dict:
    """R-multiple targets from the setup's own stop. A stop that sits on the
    wrong side of (or exactly at) the entry is nudged 0.5% away so the risk is
    never zero; `stop_basis` says so when it happens."""
    if direction == "bullish":
        if stop >= entry:
            stop, stop_basis = entry * 0.995, stop_basis + "_floored_0.5pct"
        risk = entry - stop
        t1, t2 = entry + 2.0 * risk, entry + 3.0 * risk
    else:
        if stop <= entry:
            stop, stop_basis = entry * 1.005, stop_basis + "_floored_0.5pct"
        risk = stop - entry
        t1, t2 = entry - 2.0 * risk, entry - 3.0 * risk
    return {
        "entry": round(entry, 2),
        "entry_condition": entry_condition,
        "stop": round(stop, 2),
        "stop_basis": stop_basis,
        "target_primary": round(t1, 2),
        "target_secondary": round(t2, 2),
        "risk_reward": 2.0,
    }


def build_detection(*, pattern_id: str, pattern_name: str, direction: str,
                    bars: list, trig_idx: int, start_idx: int, anchors: list,
                    anchor_roles: list, extras: dict, levels: dict, context: dict,
                    narrative: dict, geom: float, vol: float, ctx: float) -> dict:
    now = int(time.time())
    conf = confidence(geom, vol, ctx)
    last = bars[-1]
    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": pattern_id,
        "pattern_name": pattern_name,
        "category": "uct",
        "direction": direction,
        "start_t": int(bars[start_idx]["t"]),
        "end_t": int(last["t"]),
        "pivot_ts": sorted({int(a["t"]) for a in anchors} | {int(last["t"])}),
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "anchor_roles": anchor_roles,
            "semantic_subtype": pattern_id,
            "extras": {**extras, "trigger_bars_ago": len(bars) - 1 - trig_idx},
        },
        "levels": levels,
        "context": context,
        "confidence": conf,
        "quality_components": {
            "geometry_score": geom,
            "volume_score": vol,
            "context_score": ctx,
            "historical_score": HIST_SCORE,
        },
        "narrative": narrative,
        "status": "triggered",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def context_phrase(context: dict) -> str:
    stage = context.get("trend_stage")
    align = context.get("ma_alignment", "mixed")
    rs = context.get("rs_trend", "flat")
    stage_txt = {1: "a Stage 1 base", 2: "a Stage 2 uptrend", 3: "a Stage 3 top",
                 4: "a Stage 4 downtrend"}.get(stage, "an unclassified trend stage")
    return (f"{stage_txt}, with {str(align).replace('_', ' ')} moving averages "
            f"and {rs} relative strength")


PROVENANCE_NOTE = (
    "This detector is ported from an offline study of how experienced "
    "discretionary traders define and scan for this setup; its rules were "
    "checked against called examples of the setup and a blind review."
)
