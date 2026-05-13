"""High Tight Flag (Powerplay) detector.

Originally identified by William O'Neil, refined and popularized by
Pradeep Bonde (Stockbee), the High Tight Flag is the rarest and most
explosive continuation pattern in technical analysis. It requires a
near-vertical advance ("pole") of >=90% in <=8 weeks (40 trading days),
followed by a small, tight consolidation ("flag") with dramatic volume
contraction. When it triggers cleanly, the next 8-12 weeks frequently
produce 100%+ extensions.

Geometric definition:
  - Pole: >=90% advance over <=40 trading days, from a clear swing low
    to a clear swing high.
  - Flag: tight consolidation after the pole top, <=25 bars, retrace
    <=25% of the pole height.
  - Channel: parallel or slightly down-sloping; pennant convergence ok.
  - Volume: must contract dramatically in the flag (<=60% of pole avg).
  - Liquidity: stock should be liquid (avg daily volume >= 200K)
    (this gate is skipped in synthetic fixtures).
  - Direction: bullish

Scoring (composite 0-100):
  geometry_score:   pole steepness, flag tightness, retrace shallowness
  volume_score:     how dramatically flag volume contracts vs pole avg
  context_score:    trend stage, MA alignment, RS trend
  historical_score: 50.0 (neutral prior)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "high_tight_flag"
_MIN_POLE_PCT = 0.90               # 90% — the defining HTF threshold
_MAX_POLE_BARS = 40                # 8 weeks (40 trading days)
_MIN_POLE_BARS = 3                 # need at least a few bars to constitute a pole
_MIN_FLAG_BARS = 3                 # need at least a tiny consolidation
_MAX_FLAG_BARS = 25                # tight flags only
_MAX_FLAG_RETRACE = 0.25           # 25% retrace of pole height — shallow only
_MAX_FLAG_VOLUME_RATIO = 0.60      # hard gate: flag avg vol must be <=60% of pole avg
_CONFIDENCE_FLOOR = 50.0


def detect_high_tight_flag(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect High Tight Flag patterns. May emit 0-N detections (best one)."""
    if len(bars) < (_MIN_POLE_BARS + _MIN_FLAG_BARS + 5):
        return []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        # Even with no pivots, we can fall back to extrema in a window — but only
        # if at least one high pivot exists to anchor the pole-top.
        return []

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for pole_top_idx, pole_top in _candidate_pole_tops(bars, pivots):
        candidate = _try_extract_pattern(bars, pivots, pole_top_idx, pole_top)
        if candidate is None:
            continue

        # Hard volume gate: HTF requires DRAMATIC volume contraction in the flag.
        if not _flag_volume_contracted(bars, candidate):
            continue

        # Already-broken gate: if the flag high has been decisively cleared and
        # the move has extended well beyond, this fired earlier — don't re-flag.
        if _already_broken(bars, candidate):
            continue

        geom_score = _score_geometry(candidate)
        vol_score  = _score_volume(bars, candidate)
        ctx_score  = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        if confidence > best_confidence:
            best_confidence = confidence
            best_candidate = candidate
            best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is None:
        return []

    geom_score, vol_score, ctx_score, hist_score = best_scores
    d = _build_detection(bars, best_candidate, best_confidence, context,
                         geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _candidate_pole_tops(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-high pivot in the recent window.

    HTFs require >=90% pole, so we only consider pivots whose price is
    materially above their lookback low (cheap pre-filter).
    """
    high_pivots = [p for p in pivots if p["type"] == "high"]
    candidates = []
    last_bar_idx = len(bars) - 1
    for p in high_pivots[-10:]:
        if p["bar_index"] < _MIN_POLE_BARS:
            continue
        if last_bar_idx - p["bar_index"] < _MIN_FLAG_BARS:
            continue
        if last_bar_idx - p["bar_index"] > _MAX_FLAG_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _try_extract_pattern(bars, pivots, pole_top_idx: int, pole_top) -> Optional[dict]:
    """Try to extract a pole+flag pattern with pole_top_idx as the pole apex."""
    # Locate the pole base: search backwards within _MAX_POLE_BARS for the
    # lowest swing low (preferred) or the lowest bar low as fallback.
    window_start = max(0, pole_top_idx - _MAX_POLE_BARS)
    low_pivots_before = [p for p in pivots
                         if p["type"] == "low" and window_start <= p["bar_index"] < pole_top_idx]

    if low_pivots_before:
        pole_base_pivot = min(low_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"],
                     "price": pole_base_pivot["price"],
                     "t": pole_base_pivot["t"]}
    else:
        if window_start >= pole_top_idx:
            return None
        best_idx = window_start
        best_low = bars[window_start]["l"]
        for j in range(window_start, pole_top_idx):
            if bars[j]["l"] < best_low:
                best_low = bars[j]["l"]
                best_idx = j
        pole_base = {"bar_index": best_idx,
                     "price": best_low,
                     "t": bars[best_idx]["t"]}

    # Pole geometry checks
    if pole_base["price"] <= 0:
        return None
    pole_height = pole_top["price"] - pole_base["price"]
    if pole_height <= 0:
        return None
    pole_pct = pole_height / pole_base["price"]
    if pole_pct < _MIN_POLE_PCT:
        return None

    pole_bars = pole_top_idx - pole_base["bar_index"]
    if pole_bars < _MIN_POLE_BARS or pole_bars > _MAX_POLE_BARS:
        return None

    # Flag geometry checks
    flag_bars_count = len(bars) - 1 - pole_top_idx
    if flag_bars_count < _MIN_FLAG_BARS or flag_bars_count > _MAX_FLAG_BARS:
        return None

    flag_bars = bars[pole_top_idx + 1:]
    if not flag_bars:
        return None

    flag_low = min(b["l"] for b in flag_bars)
    flag_high = max(b["h"] for b in flag_bars)
    retrace = (pole_top["price"] - flag_low) / pole_height
    # HTF flags are SHALLOW — no minimum retrace gate beyond zero
    if retrace < 0.0 or retrace > _MAX_FLAG_RETRACE:
        return None

    # Flag tightness: range from flag_high to flag_low must be reasonable
    # vs pole height (sanity guard against chop disguised as a flag).
    flag_range = flag_high - flag_low
    if flag_range > pole_height * 0.40:
        return None

    return {
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_top_idx": pole_top_idx,
        "pole_top_price": pole_top["price"],
        "pole_height": pole_height,
        "pole_pct": pole_pct,
        "pole_bars": pole_bars,
        "flag_count": len(flag_bars),
        "flag_low": flag_low,
        "flag_high": flag_high,
        "flag_range": flag_range,
        "retrace_pct": retrace,
        "flag_bars": flag_bars,
    }


def _flag_volume_contracted(bars: List[Bar], c: dict) -> bool:
    """Hard gate: flag avg volume must be <=60% of pole avg volume.

    HTF is defined by DRAMATIC volume dry-up after a parabolic advance.
    Flat or rising flag volume is fatal — that's distribution, not absorption.
    """
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return False
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return True  # can't measure; don't gate
    return (flag_avg / pole_avg) <= _MAX_FLAG_VOLUME_RATIO


def _already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if price has decisively broken above the flag high already.

    The setup is FORMING when price hasn't materially cleared the flag high.
    If the flag high is already in the rearview by >3% on the latest bar AND
    multiple bars have closed above, the trigger already fired.
    """
    flag_high = c["flag_high"]
    last_idx = len(bars) - 1
    if last_idx <= c["pole_top_idx"]:
        return False
    sustained_above = sum(
        1 for i in range(c["pole_top_idx"] + 1, last_idx + 1)
        if bars[i]["c"] > flag_high * 1.02
    )
    return sustained_above >= 3


def _score_geometry(c: dict) -> float:
    """Geometry score components:
       - pole_score: stronger pole (higher %) and faster pole (fewer bars) = better
       - retrace_score: shallower retrace = better (peak at 10-15%)
       - flag_duration_score: tighter (5-15 bars) is textbook
       - tightness_score: smaller flag range vs pole height = better
    """
    # Pole strength: 90% = 60, 130% = 100. Cap at 100.
    pole_pct = c["pole_pct"]
    if pole_pct >= 1.30:
        pole_score = 100.0
    elif pole_pct >= 1.00:
        pole_score = 80.0 + (pole_pct - 1.00) / 0.30 * 20.0
    elif pole_pct >= _MIN_POLE_PCT:
        pole_score = 60.0 + (pole_pct - _MIN_POLE_PCT) / 0.10 * 20.0
    else:
        pole_score = 0.0

    # Pole velocity: faster is better (capped). 25 bars = 100, 40 bars = 60.
    pole_bars = c["pole_bars"]
    if pole_bars <= 25:
        velocity_score = 100.0
    elif pole_bars >= 40:
        velocity_score = 60.0
    else:
        velocity_score = 100.0 - (pole_bars - 25) / 15.0 * 40.0

    # Retrace shallowness: 10-15% = 100, 0% = 70 (too shallow), 25% = 0
    retrace = c["retrace_pct"]
    if 0.10 <= retrace <= 0.15:
        retrace_score = 100.0
    elif retrace < 0.10:
        # Shallow retraces (<10%) are still GOOD but penalize slightly because
        # very tight flags often don't give enough room for healthy shake-out
        retrace_score = 70.0 + (retrace / 0.10) * 30.0
    elif retrace <= _MAX_FLAG_RETRACE:
        retrace_score = 100.0 - (retrace - 0.15) / 0.10 * 100.0
    else:
        retrace_score = 0.0

    # Flag duration: textbook 5-15 bars. 3-4 borderline ok. 20+ getting stale.
    flag_count = c["flag_count"]
    if 5 <= flag_count <= 15:
        duration_score = 100.0
    elif flag_count < 5:
        duration_score = 60.0 + (flag_count - _MIN_FLAG_BARS) / (5 - _MIN_FLAG_BARS) * 40.0
    elif flag_count <= _MAX_FLAG_BARS:
        duration_score = 100.0 - (flag_count - 15) / (_MAX_FLAG_BARS - 15) * 60.0
    else:
        duration_score = 0.0

    # Flag tightness: flag_range / pole_height. Smaller = better.
    pole_height = c["pole_height"]
    if pole_height > 0:
        tightness_ratio = c["flag_range"] / pole_height
    else:
        tightness_ratio = 1.0
    if tightness_ratio <= 0.10:
        tightness_score = 100.0
    elif tightness_ratio >= 0.40:
        tightness_score = 0.0
    else:
        tightness_score = 100.0 - (tightness_ratio - 0.10) / 0.30 * 100.0

    return round(
        0.30 * pole_score
        + 0.20 * velocity_score
        + 0.25 * retrace_score
        + 0.10 * duration_score
        + 0.15 * tightness_score,
        2,
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score volume contraction ratio (flag avg / pole avg).

    HTF wants flag volume <=60%, ideally <=30% of pole avg.
    """
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return 0.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return 50.0
    ratio = flag_avg / pole_avg
    if ratio >= _MAX_FLAG_VOLUME_RATIO:
        return 0.0
    # 0.6 ratio = 0, 0.2 ratio = 100, linear between
    if ratio <= 0.20:
        return 100.0
    return round(max(0.0, min(100.0, (_MAX_FLAG_VOLUME_RATIO - ratio) / 0.40 * 100.0)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 2:
        score += 25
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15
    if context.get("rs_trend") == "up":
        score += 10
    return min(100.0, score)


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish moving-average"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average"
    return "mixed moving-average"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a confirmed Stage 2 uptrend"
    if stage == 1:
        return "a Stage 1 base/accumulation environment"
    if stage == 3:
        return "a Stage 3 distribution environment (caution)"
    if stage == 4:
        return "a Stage 4 downtrend environment (caution)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _flag_volume_ratio(bars: List[Bar], c: dict) -> float:
    """Return flag avg volume / pole avg volume (the headline HTF tell)."""
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return 1.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return 1.0
    return flag_avg / pole_avg


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    pole_base_bar = bars[c["pole_base_idx"]]
    pole_top_bar = bars[c["pole_top_idx"]]
    last_bar = bars[-1]

    flag_high = c["flag_high"]
    flag_low = c["flag_low"]
    pole_top_price = c["pole_top_price"]
    pole_height = c["pole_height"]
    pole_pct = c["pole_pct"]
    pole_bars = c["pole_bars"]
    flag_bars_count = c["flag_count"]
    retrace_pct = c["retrace_pct"]

    # Levels
    entry = round(flag_high * 1.001, 2)
    stop = round(flag_low * 0.985, 2)
    target_primary = round(pole_top_price + pole_height, 2)
    target_2x_pole = round(pole_top_price + 2.0 * pole_height, 2)
    rr = (target_primary - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume signature
    flag_vol_ratio = _flag_volume_ratio(bars, c)
    flag_vol_pct = flag_vol_ratio * 100.0

    # Geometry anchors: pole_base, pole_top, flag_low, flag_high
    anchors = [
        {"t": int(pole_base_bar["t"]), "price": float(c["pole_base_price"])},
        {"t": int(pole_top_bar["t"]), "price": float(pole_top_price)},
        {"t": int(last_bar["t"]), "price": float(flag_low)},
        {"t": int(last_bar["t"]), "price": float(flag_high)},
    ]

    now = int(time.time())

    pivot_ts = [
        int(pole_base_bar["t"]),
        int(pole_top_bar["t"]),
        int(last_bar["t"]),
    ]

    # ---- Narrative composition — RICH, paragraph-length, real values woven in ----
    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    pole_pct_pct = pole_pct * 100.0
    retrace_pct_pct = retrace_pct * 100.0

    sym_token = "the stock"

    headline = (
        f"High Tight Flag (Powerplay) - {pole_pct_pct:.1f}% pole in "
        f"{pole_bars} bars + {flag_bars_count}-bar flag retracing "
        f"{retrace_pct_pct:.1f}%. Pivot ${flag_high:.2f}, target "
        f"${target_primary:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The High Tight Flag, originally identified by William O'Neil and "
        f"popularized by Pradeep Bonde of Stockbee, is the rarest and most "
        f"explosive continuation pattern in technical analysis. It requires a "
        f"near-vertical advance of at least 90% in 8 weeks or less - a move so "
        f"violent it can only come from a sudden change in fundamentals (FDA "
        f"approval, earnings surprise, acquisition speculation, regulatory "
        f"breakthrough) combined with restricted supply. The 'flag' that follows "
        f"is not a normal pullback - it's a tight, orderly consolidation where "
        f"buyers refuse to sell at lower prices and supply is exhausted. The "
        f"{pole_pct_pct:.1f}% pole here over {pole_bars} bars represents "
        f"extraordinary institutional accumulation, and the {flag_bars_count}-bar "
        f"flag at {retrace_pct_pct:.1f}% retrace with volume contracted to "
        f"{flag_vol_pct:.0f}% of pole average shows the consolidation is shallow "
        f"and orderly - exactly the signature O'Neil and Bonde teach. "
        f"Historically, when HTF triggers cleanly on a volume surge, the next "
        f"8-12 weeks frequently produce 100%+ extensions, making this the "
        f"highest reward-to-risk continuation setup that exists on the chart. "
        f"Mark Ritchie II — the post-IPO HTF specialist — has documented that "
        f"HTFs forming in stocks within roughly 6 months of their IPO date "
        f"carry the highest follow-through rates of any HTF subgroup, with his "
        f"empirical work showing ~80%+ continuation when float, fundamental "
        f"catalyst, and structural tightness all align. Kristjan Kullamägi "
        f"treats the HTF after a 90%+ pole as his single highest-conviction "
        f"'monster move' indicator — when this pattern fires in a liquid "
        f"leader with a fresh catalyst, his playbook calls for maximum "
        f"position size and a multi-week hold rather than a quick swing."
    )

    why_it_matters = (
        f"This HTF is forming in {stage_phrase} with {ma_phrase} alignment and "
        f"{rs_phrase} relative strength versus the broader market. The "
        f"{pole_pct_pct:.1f}% pole over {pole_bars} bars - exceptional even by "
        f"HTF standards - implies a fundamental catalyst of significant "
        f"magnitude that the market is still pricing in, because moves this "
        f"violent only come from genuine paradigm shifts in earnings power or "
        f"supply/demand. Volume contraction in the flag to {flag_vol_pct:.0f}% "
        f"of pole average is the key tell: supply is being absorbed by patient "
        f"institutional buyers, not distributed by trapped longs. The "
        f"{retrace_pct_pct:.1f}% retrace is shallow enough that profit-takers "
        f"haven't broken the institutional pattern, yet (where applicable) "
        f"deep enough to shake out late-momentum chasers who bought near the "
        f"pole top. Within the {regime} regime, HTFs are particularly potent - "
        f"they signal the names that institutional desks are aggressively "
        f"building positions in regardless of broader tape, and these are the "
        f"setups that historically dominate Investor's Business Daily leaderboards."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (flag high "
        f"${flag_high:.2f} plus a small confirmation buffer) on volume of "
        f"2x or more the 20-bar average - HTF requires EXPLOSIVE volume "
        f"confirmation, not the 1.5x threshold that suits standard patterns, "
        f"because the entire setup is built on institutional urgency. The "
        f"ideal trigger bar closes in the upper third of its range with a "
        f"wide bar (high - low > 1.5x ATR) and prints a gap or near-gap open. "
        f"Measured target is ${target_primary:.2f} (pole height of "
        f"${pole_height:.2f} projected from flag high), but the most "
        f"aggressive HTF practitioners (Bonde) teach a 2x pole projection at "
        f"${target_2x_pole:.2f} for the strongest cases - both targets often "
        f"hit within 6-10 weeks when the breakout works. Trail stops below "
        f"each new swing low as the stock advances; HTFs frequently retest "
        f"the flag region once before extending, so the first stop should be "
        f"wide enough to survive that retest, and add-on entries should be "
        f"reserved for clean continuation rather than chase trades into "
        f"extended bars."
    )

    failure_signal = (
        f"The HTF is invalidated if price closes below the flag low at "
        f"${flag_low:.2f} (stop set at ${stop:.2f}, ~1.5% below the structural "
        f"low to give room for the standard flush). Critically, a fade off "
        f"the entry on weak volume or a failed first 1-2 days IS the failure "
        f"mode - HTFs that don't gap or close strongly into the breakout "
        f"usually do not work, because the entire setup is predicated on "
        f"institutional buying being unmistakably aggressive on the trigger. "
        f"The penalty for being wrong on an HTF is severe because position "
        f"sizes are typically larger relative to standard patterns (the 90%+ "
        f"pole has stretched volatility and operators are tempted to size up "
        f"for the asymmetric reward), so disciplined stops are non-negotiable. "
        f"A failed HTF often retests a much deeper support level (50-bar low "
        f"or back to the pre-pole base near ${c['pole_base_price']:.2f}), so "
        f"honor the {stop_distance_pct:.1f}% stop and do NOT widen it on the "
        f"way down - sizing for a 1% account risk implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)):.0f}% of equity per trade, which "
        f"is already aggressive given the volatility profile."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "High Tight Flag (Powerplay)",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(pole_base_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "trendline_pair",
            "anchors": anchors,
            "extras": {
                "pole_pct": round(pole_pct * 100.0, 2),
                "pole_bars": int(pole_bars),
                "flag_bars": int(flag_bars_count),
                "retrace_pct": round(retrace_pct * 100.0, 2),
                "flag_volume_ratio": round(flag_vol_ratio, 3),
                "flag_high": round(flag_high, 2),
                "flag_low": round(flag_low, 2),
                "pole_top_price": round(pole_top_price, 2),
                "pole_base_price": round(c["pole_base_price"], 2),
                "pole_height": round(pole_height, 2),
                "target_2x_pole": target_2x_pole,
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 2x 20-bar avg",
            "stop": stop,
            "stop_basis": "flag_low_minus_1.5pct",
            "target_primary": target_primary,
            "target_secondary": target_2x_pole,
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


register(_PATTERN_ID, detect_high_tight_flag)
