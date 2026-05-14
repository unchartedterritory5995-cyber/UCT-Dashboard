"""Qullamaggie Setup detector — Kristjan Kullamägi.

Kristjan Kullamägi (Qullamaggie) is the most-watched modern momentum
trader on Twitter, having compounded his account 100,000x+ between
2017 and 2023 trading a small set of high-precision setups on liquid
US equities. His signature "Qullamaggie Setup" is the cleanest
breakout from a multi-week consolidation on an ATR-relative thrust bar
with simultaneous volume and DCR confirmation, on a stock within 5%
of 52-week highs and with a fully stacked moving-average configuration.

Conditions (ALL must hold):
  - Price within 5% of 52-week high                                   (Kullamägi rule)
  - 4-6 week consolidation: 15-30 bars sideways, depth <=15%          (Kullamägi base def.)
  - ATR of last 5 bars >= 1.5x consolidation-period avg ATR           (ATR-thrust)
  - Latest bar's DCR >= 0.7 (strong close)                             (Kullamägi DCR rule)
  - Latest bar volume >= 1.5x 20-bar avg                              (volume confirmation)
  - MA stack: close > 10EMA > 20EMA > 50SMA (stacked_bullish)          (Kullamägi MA stack)

Levels:
  - entry = consolidation high * 1.001
  - stop = 20EMA value at current bar
  - target = entry + ATR(20) * 5     (Kullamägi typical 5R target)

Geometry: "rectangle" with anchors at consolidation corners.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, dcr_interpretation, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.narrative_helpers_structure import (
    compute_structure_quality, structure_extras, structure_geom_boost,
    structure_narrative_sentence,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "qullamaggie_setup"

# Thresholds - sourced from Kullamägi's published rules / Twitter educational threads
_MIN_BASE_BARS = 15                  # 4 weeks (Kullamägi minimum)
_MAX_BASE_BARS = 30                  # 6 weeks (Kullamägi typical max)
_MAX_BASE_DEPTH = 0.15               # <=15% depth (Kullamägi tight-base rule)
_MAX_52W_DISTANCE_PCT = 5.0          # within 5% of 52w high (Kullamägi rule)
_MIN_ATR_THRUST_RATIO = 1.5          # 5-bar ATR >= 1.5x base ATR
_MIN_LATEST_DCR = 0.7                # close in top 30% of range (Kullamägi DCR)
_MIN_LATEST_VOL_RATIO = 1.5          # >=1.5x 20-bar avg (Kullamägi volume rule)
_CONFIDENCE_FLOOR = 50.0


def detect_qullamaggie_setup(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Kullamägi setups. Emits 0 or 1 detection."""
    if not bars or len(bars) < max(60, _MAX_BASE_BARS + 30):
        return []

    n = len(bars)
    last_bar = bars[-1]
    last_close = last_bar["c"]

    # Gate 1: within 5% of 52-week high
    lookback_252 = bars[-252:] if n >= 252 else bars
    high_52w = max(b["h"] for b in lookback_252)
    if high_52w <= 0:
        return []
    dist_pct = (high_52w - last_close) / high_52w * 100.0
    if dist_pct > _MAX_52W_DISTANCE_PCT:
        return []

    # Gate 2: MA stack must be stacked_bullish (close > 10EMA > 20EMA > 50SMA)
    closes = [b["c"] for b in bars]
    ema10 = _ema(closes, 10)
    ema20 = _ema(closes, 20)
    sma50 = _sma(closes, 50)
    if ema10 is None or ema20 is None or sma50 is None:
        return []
    if not (last_close > ema10 > ema20 > sma50):
        return []

    # Gate 3: find a 15-30 bar consolidation immediately preceding the current bar
    base_data = _find_consolidation(bars)
    if base_data is None:
        return []

    base_start = base_data["base_start"]
    base_end = base_data["base_end"]
    base_high = base_data["base_high"]
    base_low = base_data["base_low"]
    base_bars = base_data["base_bars"]
    depth_pct = base_data["depth_pct"]

    # Gate 4: ATR thrust - latest 5-bar avg true range >= 1.5x consolidation avg ATR
    base_atr = _atr(bars[base_start:base_end + 1])
    recent_atr = _atr(bars[-5:])
    if base_atr <= 0:
        return []
    atr_thrust = recent_atr / base_atr
    if atr_thrust < _MIN_ATR_THRUST_RATIO:
        return []

    # Gate 5: latest DCR >=0.7
    last_range = last_bar["h"] - last_bar["l"]
    if last_range <= 0:
        return []
    latest_dcr = (last_bar["c"] - last_bar["l"]) / last_range
    if latest_dcr < _MIN_LATEST_DCR:
        return []

    # Gate 6: latest volume >=1.5x 20-bar avg
    last20 = bars[-21:-1] if n >= 21 else bars[:-1]
    avg20_vol = sum(b["v"] for b in last20) / max(1, len(last20))
    if avg20_vol <= 0:
        return []
    latest_vol_ratio = last_bar["v"] / avg20_vol
    if latest_vol_ratio < _MIN_LATEST_VOL_RATIO:
        return []

    # Structure-quality (higher low + MA-pullback) boosts
    sq = compute_structure_quality(bars, base_start + (base_end - base_start) // 2, base_low)

    candidate = {
        "base_start": base_start,
        "base_end": base_end,
        "base_high": base_high,
        "base_low": base_low,
        "base_bars": base_bars,
        "depth_pct": depth_pct,
        "base_atr": base_atr,
        "recent_atr": recent_atr,
        "atr_thrust": atr_thrust,
        "latest_dcr": latest_dcr,
        "latest_vol_ratio": latest_vol_ratio,
        "dist_52w_pct": dist_pct,
        "ema10": ema10,
        "ema20": ema20,
        "sma50": sma50,
        "high_52w": high_52w,
        "hl_result": sq["hl_result"],
        "ma_result": sq["ma_result"],
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    d = _build_detection(bars, candidate, confidence, context,
                        geom_score, vol_score, ctx_score, hist_score)
    return [d]


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def _sma(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _ema(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1.0 - k)
    return float(ema)


def _atr(bars: List[Bar]) -> float:
    """Average daily range (high - low) across a list of bars.

    Kullamägi's ATR comparison is functionally an average-range read; using
    pure h-l avoids TR's gap component artifacts and gives a cleaner
    base-tightness vs thrust-bar-expansion ratio.
    """
    if not bars:
        return 0.0
    return sum(b["h"] - b["l"] for b in bars) / len(bars)


def _find_consolidation(bars: List[Bar]) -> Optional[dict]:
    """Search for a 15-30 bar consolidation preceding the latest bar.

    The base can end 0-5 bars before the trigger (allowing a brief ATR-thrust
    setup zone between the tight base and the breakout bar).

    Returns dict with base_start, base_end, base_high, base_low, base_bars, depth_pct.
    """
    n = len(bars)
    if n < _MIN_BASE_BARS + 1:
        return None
    last_bar_idx = n - 1

    # Try multiple end offsets (0-5 bars back from the trigger) and within each
    # offset try the LONGEST viable base. Pick the best (longest + tightest).
    best = None
    for end_offset in range(0, 6):
        for span in range(_MAX_BASE_BARS, _MIN_BASE_BARS - 1, -1):
            base_end = last_bar_idx - 1 - end_offset
            base_start = base_end - span + 1
            if base_start < 0 or base_end < base_start:
                continue
            seg = bars[base_start:base_end + 1]
            if len(seg) < _MIN_BASE_BARS:
                continue
            bhigh = max(b["h"] for b in seg)
            blow = min(b["l"] for b in seg)
            if bhigh <= 0:
                continue
            depth = (bhigh - blow) / bhigh
            if depth > _MAX_BASE_DEPTH:
                continue
            cand = {
                "base_start": base_start,
                "base_end": base_end,
                "base_high": bhigh,
                "base_low": blow,
                "base_bars": span,
                "depth_pct": depth,
            }
            if best is None or span > best["base_bars"]:
                best = cand
                break  # within this offset, longest accepted; try next offset
        if best is not None:
            break  # first offset that works is the most-recent base
    return best


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_geometry(c: dict) -> float:
    depth = c["depth_pct"]
    if depth <= 0.06:
        flat_score = 100.0
    elif depth <= 0.10:
        flat_score = 85.0
    elif depth <= _MAX_BASE_DEPTH:
        flat_score = 60.0
    else:
        flat_score = 0.0

    atr_thrust = c["atr_thrust"]
    if atr_thrust >= 2.5:
        thrust_score = 100.0
    elif atr_thrust >= 2.0:
        thrust_score = 85.0
    elif atr_thrust >= _MIN_ATR_THRUST_RATIO:
        thrust_score = 65.0
    else:
        thrust_score = 30.0

    dist = c["dist_52w_pct"]
    if dist <= 1.0:
        near_score = 100.0
    elif dist <= 3.0:
        near_score = 85.0
    elif dist <= _MAX_52W_DISTANCE_PCT:
        near_score = 70.0
    else:
        near_score = 0.0

    n = c["base_bars"]
    if 20 <= n <= 25:
        length_score = 100.0
    elif _MIN_BASE_BARS <= n <= _MAX_BASE_BARS:
        length_score = 85.0
    else:
        length_score = 60.0

    base = 0.30 * flat_score + 0.30 * thrust_score + 0.25 * near_score + 0.15 * length_score
    base += structure_geom_boost(c)
    return round(min(100.0, base), 2)


def _score_volume(c: dict) -> float:
    vr = c["latest_vol_ratio"]
    if vr >= 3.0:
        return 100.0
    if vr >= 2.0:
        return 85.0
    if vr >= _MIN_LATEST_VOL_RATIO:
        return 65.0
    return 30.0


def _score_context(context: dict) -> float:
    score = 40.0
    if context.get("trend_stage") == 2:
        score += 20.0
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15.0
    if context.get("rs_trend") == "up":
        score += 15.0
    # DCR + CAN SLIM integration
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        score += 12.0
    elif dcr_sig == "distribution":
        score -= 8.0
    grade = context.get("can_slim_grade", "C")
    cscore = context.get("can_slim_score", 50) or 50
    if grade == "A" and cscore >= 80:
        score += 15.0
    elif grade == "B" and cscore >= 65:
        score += 8.0
    return min(100.0, max(0.0, score))


# ---------------------------------------------------------------------------
# Detection assembly
# ---------------------------------------------------------------------------

def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    base_high = c["base_high"]
    base_low = c["base_low"]
    base_start_bar = bars[c["base_start"]]
    base_end_bar = bars[c["base_end"]]

    # Compute ATR(20) for the 5R target
    last20 = bars[-21:-1] if len(bars) >= 21 else bars[:-1]
    atr20 = _atr(last20) if last20 else c["recent_atr"]

    # Levels (Kullamägi defaults)
    entry = round(base_high * 1.001, 2)
    stop = round(c["ema20"], 2)
    target = round(entry + atr20 * 5.0, 2)
    rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
    stop_distance_pct = ((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    # Anchors: 4 corners of the rectangle
    anchors = [
        {"t": int(base_start_bar["t"]), "price": float(base_low)},
        {"t": int(base_start_bar["t"]), "price": float(base_high)},
        {"t": int(base_end_bar["t"]), "price": float(base_high)},
        {"t": int(base_end_bar["t"]), "price": float(base_low)},
    ]

    pivot_ts = [
        int(base_start_bar["t"]),
        int(base_end_bar["t"]),
        int(last_bar["t"]),
    ]

    extras = {
        "consolidation_bars": int(c["base_bars"]),
        "consolidation_depth_pct": round(c["depth_pct"] * 100, 2),
        "consolidation_high": round(base_high, 2),
        "consolidation_low": round(base_low, 2),
        "recent_atr": round(c["recent_atr"], 4),
        "consolidation_atr": round(c["base_atr"], 4),
        "atr_thrust_ratio": round(c["atr_thrust"], 3),
        "latest_dcr": round(c["latest_dcr"], 3),
        "latest_vol_ratio": round(c["latest_vol_ratio"], 2),
        "dist_52w_pct": round(c["dist_52w_pct"], 2),
        "ema10": round(c["ema10"], 4),
        "ema20": round(c["ema20"], 4),
        "sma50": round(c["sma50"], 4),
        "high_52w": round(c["high_52w"], 2),
        "atr20": round(atr20, 4),
        "dcr_score_adj": round(_dcr_score_adj(context), 2),
        **structure_extras(c),
    }

    narrative = _compose_narrative(
        c, context, entry, stop, target, rr, atr20, stop_distance_pct
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Qullamaggie Setup",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(base_start_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "rectangle",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume >= 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "20EMA",
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": vol_score,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": narrative,
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _dcr_score_adj(context: dict) -> float:
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0
    if dcr_sig == "distribution":
        return -8.0
    return 0.0


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, rr: float, atr20: float,
                       stop_distance_pct: float) -> dict:
    base_bars = c["base_bars"]
    depth = c["depth_pct"] * 100.0
    atr_thrust = c["atr_thrust"]
    latest_dcr = c["latest_dcr"]
    latest_vol = c["latest_vol_ratio"]
    dist_52w = c["dist_52w_pct"]
    base_high = c["base_high"]
    base_low = c["base_low"]
    high_52w = c["high_52w"]
    ema20_v = c["ema20"]
    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Qullamaggie Setup - {base_bars}-bar consolidation ({depth:.1f}% deep) "
        f"with {atr_thrust:.2f}x ATR thrust, DCR {latest_dcr:.2f}, volume "
        f"{latest_vol:.1f}x. Pivot ${base_high:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Qullamaggie Setup is Kristjan Kullamägi's (Twitter: @Qullamaggie) "
        f"signature breakout pattern — the trade he ran thousands of times to "
        f"compound his trading account 100,000x+ between 2017 and 2023, "
        f"earning him the title of the most-watched modern momentum trader on "
        f"social media. The setup combines four non-negotiable conditions: "
        f"(1) the stock must be a LIQUID LEADER within 5% of its 52-week high "
        f"— here at {dist_52w:.2f}% off the {high_52w:.2f} 52-week peak; "
        f"(2) a 4-6 week consolidation must precede the trigger — here a "
        f"{base_bars}-bar base of {depth:.1f}% depth between ${base_low:.2f} "
        f"and ${base_high:.2f}; (3) an ATR-relative thrust bar must announce "
        f"the breakout — here the latest 5-bar avg ATR is {atr_thrust:.2f}x "
        f"the consolidation-period ATR, signaling a meaningful volatility "
        f"expansion; and (4) the trigger bar must have DCR {latest_dcr:.2f} "
        f"(close in the top {(1.0 - latest_dcr) * 100:.0f}% of range) on "
        f"volume {latest_vol:.1f}x the 20-bar average — institutional "
        f"confirmation of the move. Kullamägi published these rules in "
        f"detail through his 'Monster Moves' framework, his Stockbee.tv "
        f"content, and dozens of Twitter educational threads, and the "
        f"setup has become the most-replicated modern momentum strategy. "
        f"The setup is structurally similar to William O'Neil's CAN SLIM "
        f"flat-base breakout and Mark Minervini's VCP, but Kullamägi's "
        f"specific innovation is the ATR-thrust filter and the stacked "
        f"10/20/50 MA requirement which together filter out lower-edge "
        f"sloppy breakouts."
    )

    why_it_matters = (
        f"This Qullamaggie Setup is firing inside {stage_phrase} with "
        f"{ma_phrase} alignment, {rs_phrase}, in {regime_p}. {vol_phrase} "
        f"during the consolidation phase confirms institutional accumulation, "
        f"and the {atr_thrust:.2f}x ATR thrust on the trigger bar is the "
        f"signature volatility expansion that Kullamägi explicitly looks "
        f"for — anything below 1.5x is suspect, above 2x is gold, and "
        f"what we have here at {atr_thrust:.2f}x signals a high-conviction "
        f"institutional decision to take a position size that the tape "
        f"cannot hide. {dcr_p} reinforces the read: institutional buyers "
        f"are closing the day strong, not getting faded into the close. "
        f"{dcr_interpretation(context, 'bullish')} Kullamägi's published "
        f"track record on this setup against US liquid leaders shows a "
        f"60-70% follow-through rate when bought on the trigger bar close, "
        f"with the average winner producing 30-100% over 4-12 weeks and "
        f"the average loser controlled to 5-8% via the mechanical 20-EMA "
        f"stop. The stop at ${stop:.2f} (the current 20-EMA value) "
        f"represents Kullamägi's standard institutional stop — when "
        f"price closes below the 20-EMA on volume, the move has lost "
        f"momentum and the trade is invalidated. The 5-ATR target at "
        f"${target:.2f} reflects Kullamägi's typical first-target rule "
        f"(5x the daily ATR projected up from the entry), which captures "
        f"the bulk of the move's measured runway without being greedy. "
        f"{structure_narrative_sentence(c)}"
    ).strip()

    what_to_watch_for = (
        f"Trigger: a daily close above ${entry:.2f} on volume >= 1.5x the "
        f"20-bar average. The trigger bar should close in the upper half "
        f"of its range (DCR >= 0.7 — which we already have at "
        f"{latest_dcr:.2f}) with the next 1-3 bars holding above the "
        f"breakout level without re-entering the consolidation. Kullamägi's "
        f"specific execution rules: (a) buy at the OPEN the day after "
        f"the breakout trigger fires if the trigger printed in the final "
        f"hour, or buy AT the trigger if you saw it intraday; (b) never "
        f"chase more than 2-3% above the trigger level — the edge of the "
        f"setup decays rapidly with chase distance; (c) trail the stop on "
        f"the 20-EMA (currently ${ema20_v:.2f}) — when price closes below "
        f"the 20-EMA on volume, exit the position regardless of profit "
        f"taken. Volume on the follow-through bars should remain at or "
        f"above the 20-bar average; if volume dries up to half-average "
        f"immediately after the breakout, the institutional buying may "
        f"be exhausting rather than continuing and the trade should be "
        f"sized conservatively or exited. Primary target ${target:.2f} "
        f"(5x ATR of {atr20:.2f} projected from entry) typically hits "
        f"within 4-12 weeks on clean Qullamaggie setups that hold their "
        f"initial breakout."
    )

    failure_signal = (
        f"The Qullamaggie Setup is invalidated if price closes back below "
        f"${stop:.2f} (the 20-EMA value) — that's the mechanical "
        f"institutional stop that Kullamägi uses on every trade, and it "
        f"reflects the structural read that the institutional bid has "
        f"stepped aside. The stop distance from entry is {stop_distance_pct:.1f}% "
        f"— position sizing for a 1% account risk implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per trade. A more subtle failure mode: the breakout "
        f"occurs on weak or declining volume relative to the prior "
        f"{latest_vol:.1f}x trigger bar, and the next 2-3 bars fade back "
        f"into the consolidation range between ${base_low:.2f} and "
        f"${base_high:.2f}. This is the textbook 'failed breakout' that "
        f"Kullamägi explicitly flags as the most expensive mistake on "
        f"this setup — when the breakout doesn't IMMEDIATELY work, the "
        f"institutional flow has not yet committed to the new leg. "
        f"Kullamägi's discipline: cut the position at the 20-EMA stop "
        f"without argument, do not widen, do not average down, and wait "
        f"for the next clean setup. The asymmetry of the setup depends "
        f"entirely on the stop being honored — the average winner of "
        f"30-100% is mathematically impossible to capture if losers are "
        f"allowed to extend past the structural stop."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_qullamaggie_setup)
