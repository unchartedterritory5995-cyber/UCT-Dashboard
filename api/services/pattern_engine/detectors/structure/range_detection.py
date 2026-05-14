"""Trading Range detector - structure detector.

Wyckoff trading-range / Edwards-and-Magee rectangle. Scans the last 50 bars
for the LARGEST window in which price has been BOUNDED between a high and a
low - the classical signature of consolidation, equilibrium between supply
and demand, and (very often) the pre-launch coil before a directional move.

Where rectangle, channel, and pennant detectors search for specific
geometric breakout setups, range_detection is a STRUCTURE detector: it
emits exactly ONE Detection summarizing the current active range so the
chart overlay can render the box, and so downstream consumers can reason
about the level grid (the entry / stop / target framework derives directly
from the range high and range low).

Geometric definition:
  - Scan window: most recent 50 bars
  - For each candidate window length L in [duration_max .. 10]:
      For each end_idx in [scan window], take the L bars ending at end_idx.
      Compute window_high = max(h), window_low = min(l), window_mid.
      depth_pct = (window_high - window_low) / window_mid * 100
      If depth_pct < 10.0 AND L >= 10, this window is a candidate.
  - Among all candidates, pick the one with the GREATEST duration that
    ENDS at the latest bar (the most recent active range).
  - Validate touches: at least 2 highs within 1.5% of window_high AND
    at least 2 lows within 1.5% of window_low (defended on both sides).

Output:
  - 0 or 1 Detection per call.
  - Direction: "neutral" - a range is two-sided by definition.

Confidence:
  Base 50. Bonuses:
    + (min(duration, 40) - 10) * 1.25   # longer ranges = stronger (max +37.5)
    + (high_touches + low_touches - 4) * 2.5   # extra touches (max ~+10)
    - clamp to [50, 90]

Levels (the range is the level grid):
  entry = current_close (with directional notes in narrative)
  stop = (range_high + range_low) / 2 (midpoint)
  target = range_high + (range_high - range_low) (measured-move up)

Attribution: classical Wyckoff trading-range concept (1908-1930s),
Edwards & Magee "Technical Analysis of Stock Trends" (1948), used by
every range trader from Linda Raschke to Brian Shannon.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional, Tuple

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "range_detection"
_SCAN_WINDOW = 50
_MIN_DURATION = 10
_MAX_DEPTH_PCT = 10.0
_TOUCH_TOLERANCE_PCT = 1.5
_MIN_TOUCHES_PER_SIDE = 2


def detect_range_detection(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect an active trading range. Emits 0 or 1 Detection."""
    if len(bars) < _MIN_DURATION:
        return []

    n = len(bars)
    scan_start = max(0, n - _SCAN_WINDOW)
    last_idx = n - 1

    # Find the longest valid range ENDING at the latest bar.
    # Walk backward from the last bar; expand the window as far as we can
    # while depth stays under the threshold and touch validation holds.
    best = None
    # Try every candidate duration from largest down to _MIN_DURATION,
    # for the window ENDING at last_idx (the active/current range).
    max_duration = min(_SCAN_WINDOW, n)
    for duration in range(max_duration, _MIN_DURATION - 1, -1):
        start_idx = last_idx - duration + 1
        if start_idx < scan_start:
            continue
        window = bars[start_idx:last_idx + 1]
        if len(window) < _MIN_DURATION:
            continue

        w_high = max(float(b["h"]) for b in window)
        w_low = min(float(b["l"]) for b in window)
        w_mid = (w_high + w_low) / 2.0
        if w_mid <= 0:
            continue
        depth_pct = (w_high - w_low) / w_mid * 100.0
        if depth_pct >= _MAX_DEPTH_PCT:
            continue

        # Validate touches
        high_tol = w_high * (1.0 - _TOUCH_TOLERANCE_PCT / 100.0)
        low_tol = w_low * (1.0 + _TOUCH_TOLERANCE_PCT / 100.0)
        high_touches = sum(1 for b in window if float(b["h"]) >= high_tol)
        low_touches = sum(1 for b in window if float(b["l"]) <= low_tol)
        if high_touches < _MIN_TOUCHES_PER_SIDE:
            continue
        if low_touches < _MIN_TOUCHES_PER_SIDE:
            continue

        # Found the largest valid active range
        best = {
            "start_idx": start_idx,
            "end_idx": last_idx,
            "duration": duration,
            "w_high": w_high,
            "w_low": w_low,
            "w_mid": w_mid,
            "depth_pct": depth_pct,
            "high_touches": high_touches,
            "low_touches": low_touches,
        }
        break  # largest found - we walked from biggest to smallest

    if best is None:
        return []

    return [_build_detection(bars, best, context)]


def _build_detection(bars: List[Bar], r: dict, context: dict) -> Detection:
    n = len(bars)
    last_bar = bars[-1]
    last_idx = n - 1

    start_bar = bars[r["start_idx"]]
    end_bar = bars[r["end_idx"]]

    duration = r["duration"]
    w_high = r["w_high"]
    w_low = r["w_low"]
    w_mid = r["w_mid"]
    depth_pct = r["depth_pct"]
    high_touches = r["high_touches"]
    low_touches = r["low_touches"]

    current_close = float(last_bar["c"])
    range_position_pct = (
        (current_close - w_low) / (w_high - w_low) * 100.0
        if (w_high - w_low) > 0 else 50.0
    )

    # Volume signature inside the range
    window = bars[r["start_idx"]:r["end_idx"] + 1]
    vol_inside = sum(float(b["v"]) for b in window) / max(1, len(window))
    pre_window_start = max(0, r["start_idx"] - duration)
    pre_window = bars[pre_window_start:r["start_idx"]]
    vol_pre = (
        sum(float(b["v"]) for b in pre_window) / len(pre_window)
        if pre_window else vol_inside
    )
    vol_contraction_pct = (
        (vol_pre - vol_inside) / vol_pre * 100.0 if vol_pre > 0 else 0.0
    )

    # ---------- Confidence ----------
    base = 50.0
    duration_bonus = (min(duration, 40) - 10) * 1.25  # max +37.5 at 40 bars
    touch_bonus = (high_touches + low_touches - 4) * 2.5
    raw_conf = base + duration_bonus + touch_bonus
    confidence = round(max(50.0, min(90.0, raw_conf)), 1)

    # ---------- Levels ----------
    entry = round(current_close, 2)
    entry_condition = (
        f"Trading range active. Long trigger: close above range high "
        f"${w_high:.2f} on volume >1.5x average ({vol_inside:,.0f}) for "
        f"breakout. Short trigger: close below range low ${w_low:.2f} on "
        f"volume for breakdown. Inside the range: buy support tests at "
        f"${w_low:.2f}, sell resistance tests at ${w_high:.2f}; the range "
        f"midpoint ${w_mid:.2f} is the equilibrium pivot"
    )
    stop = round(w_mid, 2)
    stop_basis = (
        f"Range midpoint at ${w_mid:.2f} - a directional commitment that "
        f"loses the midpoint has rejected the breakout thesis"
    )
    # Measured-move target up (conservative bullish projection)
    target_primary = round(w_high + (w_high - w_low), 2)
    target_secondary = round(w_low - (w_high - w_low), 2)
    rng_width = w_high - w_low
    if abs(entry - stop) > 0:
        rr = round(abs(target_primary - entry) / abs(entry - stop), 2)
    else:
        rr = 0.0

    # ---------- Anchors: range box corners ----------
    anchors = [
        {"t": int(start_bar["t"]), "price": float(w_high)},
        {"t": int(end_bar["t"]), "price": float(w_high)},
        {"t": int(end_bar["t"]), "price": float(w_low)},
        {"t": int(start_bar["t"]), "price": float(w_low)},
    ]

    # ---------- Narrative ----------
    duration_desc = _duration_descriptor(duration)
    depth_desc = _depth_descriptor(depth_pct)
    touch_desc = _touch_descriptor(high_touches, low_touches)
    position_desc = _position_descriptor(range_position_pct)
    volume_desc = _volume_descriptor(vol_contraction_pct, vol_inside)
    wyckoff_phase = _wyckoff_phase_hint(range_position_pct, vol_contraction_pct,
                                        duration, context)
    stage_phrase = _stage_phrase(context)

    headline = (
        f"Trading Range - {duration} bars between ${w_low:.2f} and "
        f"${w_high:.2f} ({depth_pct:.1f}% depth). "
        f"{high_touches} highs / {low_touches} lows defended; "
        f"current close ${current_close:.2f} sits "
        f"{range_position_pct:.0f}% of the way from low to high."
    )

    what_it_is = (
        f"This chart is inside an active trading range - a {duration}-bar "
        f"consolidation bounded by the upper level at ${w_high:.2f} and "
        f"the lower level at ${w_low:.2f}, with a total depth of "
        f"{depth_pct:.2f}% around a midpoint of ${w_mid:.2f}. The range has "
        f"persisted for {duration_desc}, which classifies the consolidation "
        f"as a structurally meaningful institutional event rather than a "
        f"random oscillation. Inside the range the upper level has been "
        f"defended {high_touches} times (every reaction within 1.5% of "
        f"${w_high:.2f} that printed a high counts as a touch) and the "
        f"lower level has been defended {low_touches} times - "
        f"{touch_desc} both walls of the structure. The depth of "
        f"{depth_pct:.2f}% places this in the {depth_desc} category, which "
        f"matters for two reasons: shallow ranges produce sharper, more "
        f"explosive breakouts because the coiled energy is greater per unit "
        f"of price, and deeper ranges produce more two-sided opportunity "
        f"because the swing trade between support and resistance carries "
        f"a meaningful R:R on its own. The current bar at "
        f"${current_close:.2f} is positioned {position_desc} within the "
        f"range, and the volume signature reads {volume_desc}. This is the "
        f"classical Wyckoff trading-range structure: a battle between "
        f"supply at the upper bound and demand at the lower bound, with "
        f"institutional positioning happening quietly through the middle. "
        f"Richard Schabacker formalized the trading range in 'Technical "
        f"Analysis and Stock Market Profits' (1932) as the foundational "
        f"consolidation pattern from which every directional move emerges. "
        f"Mark Minervini's empirical work on stage-2 leaders makes the "
        f"point explicit — in his words, 'trading ranges precede every "
        f"major advance; the longer the consolidation before the launch, "
        f"the more powerful the subsequent move.' His SEPA framework "
        f"specifically hunts the longest, tightest ranges as the highest-"
        f"edge bases for momentum entries."
    )

    why_it_matters = (
        f"Trading ranges are the institutional fingerprint of "
        f"accumulation or distribution and the natural launchpad for the "
        f"next directional move - the longer and tighter the range, the "
        f"more explosive the subsequent breakout (or breakdown) tends to "
        f"be. The Wyckoff trading-range framework identifies five phases "
        f"inside any consolidation: Phase A (preliminary support / supply, "
        f"the initial stop after a trend), Phase B (institutional buying "
        f"or selling, the bulk of the range duration), Phase C (the test, "
        f"often a spring or upthrust that flushes weak hands), Phase D "
        f"(the sign of strength or weakness, where the range begins to "
        f"resolve), and Phase E (markup or markdown, the breakout). At "
        f"{duration} bars of duration and a {depth_pct:.2f}% depth, this "
        f"range reads as {wyckoff_phase}. The volume profile of "
        f"{vol_contraction_pct:+.1f}% contraction versus the prior "
        f"{duration}-bar window {volume_desc[volume_desc.find('-')+1:].strip() if '-' in volume_desc else volume_desc} - "
        f"declining volume during a range is the textbook accumulation "
        f"signature (supply exhausted at the highs, demand accumulating at "
        f"the lows), while expanding volume on declines or rallies inside "
        f"the range signals distribution and a higher probability of a "
        f"downside resolution. {stage_phrase} The R:R framework here is "
        f"explicit: with the midpoint at ${w_mid:.2f} as the directional "
        f"stop, an upside breakout above ${w_high:.2f} targets a "
        f"measured-move move to ${target_primary:.2f} (the range width "
        f"projected above the high), and a downside breakdown below "
        f"${w_low:.2f} targets a measured-move move to "
        f"${target_secondary:.2f}. Range-bound markets are where patient "
        f"traders accumulate edge - the breakout is the climax, not the "
        f"setup."
    )

    what_to_watch_for = (
        f"The primary trigger to watch is the resolution: a daily close "
        f"above ${w_high:.2f} on volume of at least 1.5x the in-range "
        f"average of {vol_inside:,.0f} (so >= {vol_inside * 1.5:,.0f}) "
        f"confirms an upside breakout and triggers the long entry, with "
        f"target ${target_primary:.2f} (full measured-move projection) "
        f"and stop on a return back inside the range below ${w_mid:.2f}. "
        f"A daily close below ${w_low:.2f} on volume >= {vol_inside * 1.5:,.0f} "
        f"confirms a downside breakdown and triggers the short entry, "
        f"with target ${target_secondary:.2f} and stop on a return above "
        f"${w_mid:.2f}. Inside the range, the trade is the reversion: "
        f"buy approaches to ${w_low:.2f} with stops just below at "
        f"${w_low * 0.985:.2f} targeting ${w_high:.2f}, and sell "
        f"approaches to ${w_high:.2f} with stops just above at "
        f"${w_high * 1.015:.2f} targeting ${w_low:.2f} - these reversion "
        f"trades have a clean R:R because the range walls have been "
        f"defended {high_touches} and {low_touches} times respectively, "
        f"a structural confirmation that institutional defense is active "
        f"at both levels. Wyckoff signature events to track inside the "
        f"range: (a) a SPRING - a brief penetration below ${w_low:.2f} "
        f"that fails to follow through and reverses back inside - often "
        f"marks the institutional bottom of the range and precedes the "
        f"upside resolution; (b) an UPTHRUST - the mirror, a brief poke "
        f"above ${w_high:.2f} that fails and reverses - often marks the "
        f"distributive top and precedes the downside resolution; (c) "
        f"volume drying up to multi-month lows in the final 1-3 bars "
        f"before resolution is the classic pre-breakout signature. "
        f"Position sizing should reflect the range structure: full size "
        f"only after the breakout confirms; partial size on the "
        f"reversion trade against the range walls."
    )

    failure_signal = (
        f"The most expensive lesson in trading ranges is the FALSE "
        f"BREAKOUT - a close above ${w_high:.2f} (or below ${w_low:.2f}) "
        f"that reverses back inside the range within 1-3 bars, often "
        f"trapping breakout traders with stops above/below the level. "
        f"Specific failure signals: (a) the breakout closes back below "
        f"${w_high:.2f} on the very next bar - the textbook 'failed "
        f"breakout' and a high-probability fade entry in the opposite "
        f"direction (target the range midpoint at ${w_mid:.2f} or the "
        f"opposite wall); (b) the breakout occurs on volume LESS than "
        f"the in-range average of {vol_inside:,.0f} - genuine breakouts "
        f"are accompanied by 1.5x+ volume, and a weak-volume break is "
        f"the institutional tell that the move has no conviction; (c) "
        f"the breakout produces a 3-5 day extension but then fails the "
        f"first pullback test of ${w_high:.2f} - the level should hold "
        f"as new support, and a failure to do so means supply has "
        f"re-asserted at the level. The range itself can also EXPAND "
        f"rather than resolve: if a new wide-range bar prints with depth "
        f">10% of midpoint, the original range structure is invalidated "
        f"and a new (wider) consolidation is forming. Range trades that "
        f"work best have these characteristics: (i) duration > 20 bars "
        f"(more institutional positioning has occurred); (ii) depth < 6% "
        f"(coiled energy is higher); (iii) volume contraction during the "
        f"range > 20%; (iv) the prior trend was up (bullish bias for "
        f"breakouts) or down (bearish bias for breakdowns) - the range "
        f"is typically a continuation pattern, and trading the prior "
        f"trend's direction has a higher win rate than the counter-trend "
        f"reversal. This particular range scores {confidence:.0f} on the "
        f"confidence scale and at {duration} bars of duration with "
        f"{depth_pct:.2f}% depth and {high_touches}/{low_touches} touch "
        f"validation, the structural setup is real - whether the "
        f"resolution is up or down is the trader's job to read from the "
        f"volume and momentum at the break."
    )

    extras = {
        "range_high": round(float(w_high), 4),
        "range_low": round(float(w_low), 4),
        "range_mid": round(float(w_mid), 4),
        "range_width": round(float(rng_width), 4),
        "depth_pct": round(float(depth_pct), 3),
        "duration_bars": int(duration),
        "high_touches": int(high_touches),
        "low_touches": int(low_touches),
        "current_close": round(current_close, 4),
        "range_position_pct": round(float(range_position_pct), 2),
        "vol_avg_in_range": round(float(vol_inside), 2),
        "vol_avg_pre_range": round(float(vol_pre), 2),
        "vol_contraction_pct": round(float(vol_contraction_pct), 3),
        "scan_window_bars": int(_SCAN_WINDOW),
        "dcr_score_adj": 0.0,
    }

    geometry_score = round(
        min(100.0, 40.0 + (40.0 - min(depth_pct, 10.0)) * 4.0), 2
    )
    volume_score = round(
        min(100.0, 50.0 + max(0.0, vol_contraction_pct)), 2
    )
    context_score = 60.0
    historical_score = 50.0

    now = int(time.time())
    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Trading Range",
        "category": "structure",
        "direction": "neutral",
        "start_t": int(start_bar["t"]),
        "end_t": int(end_bar["t"]),
        "pivot_ts": [int(start_bar["t"]), int(end_bar["t"])],
        "geometry": {
            "shape": "rectangle",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
            "target_primary": target_primary,
            "target_secondary": target_secondary,
            "risk_reward": rr,
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geometry_score,
            "volume_score": volume_score,
            "context_score": context_score,
            "historical_score": historical_score,
        },
        "narrative": {
            "headline": headline,
            "what_it_is": what_it_is,
            "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for,
            "failure_signal": failure_signal,
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }
    return detection


# ---------------------------------------------------------------------------
# Narrative helpers
# ---------------------------------------------------------------------------

def _duration_descriptor(duration: int) -> str:
    if duration >= 40:
        return "a multi-month consolidation reading as a deep accumulation/distribution base"
    if duration >= 25:
        return "a multi-week consolidation reading as a mature institutional base"
    if duration >= 15:
        return "a 2-3 week consolidation, the textbook intermediate-term coil"
    return "a 2-week minimum-duration consolidation, the shortest range that still carries structural weight"


def _depth_descriptor(depth_pct: float) -> str:
    if depth_pct < 3.0:
        return "tight (Minervini-grade contraction)"
    if depth_pct < 6.0:
        return "narrow (clean Wyckoff range, high coiled energy)"
    if depth_pct < 8.0:
        return "moderate (healthy two-sided swing opportunity)"
    return "wide (opportunity for the reversion trade outweighs the breakout setup)"


def _touch_descriptor(high_touches: int, low_touches: int) -> str:
    total = high_touches + low_touches
    if total >= 8:
        return "institutional grade defense on"
    if total >= 6:
        return "strong defense on"
    if total >= 5:
        return "solid validation of"
    return "the minimum-validation level of"


def _position_descriptor(pct: float) -> str:
    if pct >= 80:
        return f"near the upper bound ({pct:.0f}% of the way from low to high) - testing resistance"
    if pct >= 60:
        return f"in the upper half ({pct:.0f}% from low) - leaning bullish bias"
    if pct >= 40:
        return f"near the midpoint ({pct:.0f}% from low) - neutral equilibrium"
    if pct >= 20:
        return f"in the lower half ({pct:.0f}% from low) - leaning bearish bias"
    return f"near the lower bound ({pct:.0f}% from low) - testing support"


def _volume_descriptor(contraction_pct: float, vol_inside: float) -> str:
    if contraction_pct >= 25:
        return (
            f"strongly contracting - in-range average {vol_inside:,.0f} vs "
            f"prior-window average is a {contraction_pct:.1f}% decline, the "
            "textbook accumulation signature"
        )
    if contraction_pct >= 10:
        return (
            f"contracting - in-range average {vol_inside:,.0f} reflects "
            f"a {contraction_pct:.1f}% decline from the prior window, "
            "consistent with institutional positioning"
        )
    if contraction_pct >= -10:
        return (
            f"neutral - in-range average {vol_inside:,.0f} is roughly "
            f"steady with the prior window ({contraction_pct:+.1f}%), "
            "two-sided flow with no clear accumulation/distribution edge"
        )
    return (
        f"expanding - in-range average {vol_inside:,.0f} is "
        f"{abs(contraction_pct):.1f}% higher than the prior window, "
        "the distribution signature: heavy participation without "
        "directional resolution typically precedes a breakdown"
    )


def _wyckoff_phase_hint(position_pct: float, vol_contraction_pct: float,
                       duration: int, context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if duration >= 30 and vol_contraction_pct >= 15:
        if stage in (1, 2) or position_pct >= 50:
            return (
                "a late-stage Phase B-to-C Wyckoff accumulation - duration "
                "is mature, volume has dried up materially, the range is "
                "ripe for an upside resolution"
            )
        return (
            "a late-stage Phase B-to-C Wyckoff distribution - duration is "
            "mature and volume contraction suggests the absorption is "
            "near completion, the range is ripe for a downside resolution"
        )
    if duration >= 20:
        return (
            "a mid-cycle Wyckoff Phase B consolidation - institutional "
            "absorption is in progress, neither the spring nor the upthrust "
            "has yet shown up, patient positioning is warranted"
        )
    return (
        "an early Wyckoff Phase A-to-B consolidation - the initial "
        "post-trend pause where the structure is just being established, "
        "the range walls are still being tested for validity"
    )


def _stage_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    rs = context.get("rs_trend", "flat")
    if stage == 2:
        return (
            f"The broader trend stage is Stage 2 (uptrend) and RS reads "
            f"{rs} - ranges inside Stage 2 are continuation patterns and "
            f"the upside breakout is the higher-probability resolution. "
        )
    if stage == 4:
        return (
            f"The broader trend stage is Stage 4 (downtrend) and RS reads "
            f"{rs} - ranges inside Stage 4 are bear-flag continuations "
            f"and the downside breakdown is the higher-probability "
            f"resolution. "
        )
    if stage == 1:
        return (
            f"The broader trend stage is Stage 1 (basing) and RS reads "
            f"{rs} - this range may itself BE the Stage 1 base, and an "
            f"upside breakout would mark the Stage 1-to-Stage 2 transition "
            f"(one of the highest-edge entries on the chart). "
        )
    if stage == 3:
        return (
            f"The broader trend stage is Stage 3 (topping) and RS reads "
            f"{rs} - this range may itself BE the Stage 3 distribution "
            f"top, and a downside breakdown would mark the Stage 3-to-"
            f"Stage 4 transition (an institutional supply event). "
        )
    return (
        f"Broader trend stage context is undefined and RS reads {rs} - "
        f"the range structure stands on its own as a directional pivot. "
    )


register(_PATTERN_ID, detect_range_detection)
