"""52-Week Proximity detector - structure / context detector.

A TOP-LEVEL momentum and context filter that classifies the chart by its
position relative to the 52-week (252 trading bar) high and 52-week low.
Position relative to these extremes is the single most widely-tracked
data point in equity markets - both institutional and retail participants
watch the 52-week list, and stocks within 5% of their 52-week high are
the highest-edge universe for momentum strategies (William O'Neil's
CAN SLIM 'N' criterion: New highs lead new bull markets).

ALWAYS emits exactly ONE Detection summarizing the current proximity.
Direction depends on classification:

  near_high (within 5% of 52w high) -> "bullish"
    The CAN SLIM 'N' criterion. Stocks within 5% of 52w high have
    historically outperformed the broader market by a meaningful margin
    over decades of empirical evidence (O'Neil, Minervini, IBD).

  near_low (within 5% of 52w low) -> "bearish"
    The weakest universe, where the technical damage is greatest. Most
    'falling knife' attempts fail; needs separate structural reversal
    pattern confirmation before any long thesis can be considered.

  mid_range (everything else) -> "neutral"
    Neither strong nor weak - the context filter alone does not generate
    a trade signal. Other patterns must provide the directional thesis.

Geometric definition:
  - Window: the last 252 bars (1 trading year). If fewer than 252 bars
    are available, use ALL bars and note the partial-window status in
    the narrative.
  - high_52w = max(b['h'] for b in last_252_bars)
  - low_52w = min(b['l'] for b in last_252_bars)
  - distance_from_high_pct = (high_52w - current_close) / high_52w * 100
  - distance_from_low_pct = (current_close - low_52w) / low_52w * 100

Confidence:
  - near_high or near_low: 100 minus distance-from-threshold (e.g., 1%
    from 52w high -> confidence ~100; 4.9% from high -> confidence ~60).
  - mid_range: fixed 60 (always informative but not directional).

Levels (per classification):
  - near_high: entry = close*1.001 (continuation breakout buy),
               stop = recent_swing_low * 0.985,
               target = high_52w * 1.10 (10% above prior 52w high)
  - near_low: entry = close*0.999 (basing-trade short),
              stop = recent_swing_high * 1.015,
              target = low_52w * 0.90 (10% below prior 52w low)
  - mid_range: levels = None (no directional bias)

Attribution: William O'Neil, "How to Make Money in Stocks" (CAN SLIM:
N = New highs / 1988). Mark Minervini's institutional rules: "no buys
in stocks more than 25% off their 52w high." IBD methodology: <5% from
52w high = the "buy zone." Used by every momentum trader from O'Neil
to Stockbee to modern factor-quant funds.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional, Tuple

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "52w_proximity"
_LOOKBACK_BARS = 252
_PROXIMITY_THRESHOLD_PCT = 5.0


def detect_52w_proximity(bars: List[Bar], context: dict) -> List[Detection]:
    """Always emit exactly ONE Detection summarizing 52w proximity.

    Returns [] only if bars is empty.
    """
    if not bars:
        return []

    n = len(bars)
    window_bars = bars[-_LOOKBACK_BARS:] if n >= _LOOKBACK_BARS else bars
    window_n = len(window_bars)
    partial = window_n < _LOOKBACK_BARS

    last_bar = bars[-1]
    current_close = float(last_bar["c"])
    high_52w = max(float(b["h"]) for b in window_bars)
    low_52w = min(float(b["l"]) for b in window_bars)

    distance_from_high_pct = (
        (high_52w - current_close) / high_52w * 100.0 if high_52w > 0 else 0.0
    )
    distance_from_low_pct = (
        (current_close - low_52w) / low_52w * 100.0 if low_52w > 0 else 0.0
    )

    # Locate the bar that set the 52w high / low
    high_bar_idx = max(
        range(len(window_bars)), key=lambda i: float(window_bars[i]["h"])
    )
    low_bar_idx = min(
        range(len(window_bars)), key=lambda i: float(window_bars[i]["l"])
    )
    # bars-since-event = position from the END
    bars_since_52w_high = (window_n - 1) - high_bar_idx
    bars_since_52w_low = (window_n - 1) - low_bar_idx

    # Classification
    if distance_from_high_pct <= _PROXIMITY_THRESHOLD_PCT:
        classification = "near_high"
        direction = "bullish"
    elif distance_from_low_pct <= _PROXIMITY_THRESHOLD_PCT:
        classification = "near_low"
        direction = "bearish"
    else:
        classification = "mid_range"
        direction = "neutral"

    # Confidence
    if classification == "near_high":
        # 1% from high -> 100; 5% from high -> 60
        # 100 - (distance / 5) * 40 = 100 - 8 * distance
        confidence = round(max(60.0, 100.0 - distance_from_high_pct * 8.0), 1)
    elif classification == "near_low":
        confidence = round(max(60.0, 100.0 - distance_from_low_pct * 8.0), 1)
    else:
        confidence = 60.0

    # Recent swing low / high for stop placement
    swing_lookback = bars[-40:] if n >= 40 else bars
    recent_swing_low = min(float(b["l"]) for b in swing_lookback)
    recent_swing_high = max(float(b["h"]) for b in swing_lookback)

    # ---------- Levels ----------
    if classification == "near_high":
        entry = round(current_close * 1.001, 2)
        entry_condition = (
            f"Near 52w high continuation buy. Trigger: any move above "
            f"current close ${current_close:.2f} (entry ${entry:.2f}) "
            f"with the stock {distance_from_high_pct:.2f}% from the "
            f"prior 52w high of ${high_52w:.2f}. Best entries pair with "
            f"a fresh consolidation breakout above the 52w high level"
        )
        stop = round(recent_swing_low * 0.985, 2)
        stop_basis = (
            f"1.5% below the most recent 40-bar swing low at "
            f"${recent_swing_low:.2f} - the structural invalidation point "
            f"if the 'near high' classification fails"
        )
        target_primary = round(high_52w * 1.10, 2)
        target_secondary = round(high_52w * 1.25, 2)
    elif classification == "near_low":
        entry = round(current_close * 0.999, 2)
        entry_condition = (
            f"Near 52w low short/short-the-rally. Trigger: any move below "
            f"current close ${current_close:.2f} (entry ${entry:.2f}) "
            f"with the stock only {distance_from_low_pct:.2f}% above the "
            f"prior 52w low of ${low_52w:.2f}. Caution: requires "
            f"structural reversal pattern confirmation before fading "
            f"further (catching a falling knife is the #1 mistake)"
        )
        stop = round(recent_swing_high * 1.015, 2)
        stop_basis = (
            f"1.5% above the most recent 40-bar swing high at "
            f"${recent_swing_high:.2f} - the invalidation level if a "
            f"bottoming process is underway"
        )
        target_primary = round(low_52w * 0.90, 2)
        target_secondary = round(low_52w * 0.80, 2)
    else:
        entry = None
        entry_condition = (
            f"Mid-range classification: stock is "
            f"{distance_from_high_pct:.2f}% off 52w high of "
            f"${high_52w:.2f} and {distance_from_low_pct:.2f}% above 52w "
            f"low of ${low_52w:.2f} - no top-level directional bias. "
            f"Trade signals must come from other patterns; this detector "
            f"is informational only"
        )
        stop = None
        stop_basis = ""
        target_primary = None
        target_secondary = None

    if entry is not None and stop is not None and target_primary is not None:
        denom = abs(entry - stop)
        rr = round(abs(target_primary - entry) / denom, 2) if denom > 0 else 0.0
    else:
        rr = 0.0

    # ---------- Anchors ----------
    anchors = [{"t": int(last_bar["t"]), "price": current_close}]

    # ---------- Narrative ----------
    classification_desc = {
        "near_high": "near the 52-week high",
        "near_low": "near the 52-week low",
        "mid_range": "in the mid-range zone between the 52-week extremes",
    }[classification]

    bars_since_high_desc = _bars_ago_descriptor(bars_since_52w_high, "high")
    bars_since_low_desc = _bars_ago_descriptor(bars_since_52w_low, "low")

    partial_str = (
        f" (using all available {window_n} bars; less than the full "
        f"252-bar year - the 52-week reference is approximate)"
        if partial else f" (full 252-bar window available)"
    )

    headline = (
        f"52-Week Proximity - {classification}: current close "
        f"${current_close:.2f} is {distance_from_high_pct:.2f}% from the "
        f"52w high of ${high_52w:.2f} and {distance_from_low_pct:.2f}% "
        f"above the 52w low of ${low_52w:.2f}."
    )

    if classification == "near_high":
        what_it_is = (
            f"This chart is positioned {classification_desc} - the "
            f"current close at ${current_close:.2f} is only "
            f"{distance_from_high_pct:.2f}% below the prior 252-bar high "
            f"of ${high_52w:.2f}{partial_str}, well inside William "
            f"O'Neil's CAN SLIM 'N' criterion (New highs / within 5% of "
            f"the 52-week high). The 52w high was set {bars_since_high_desc}, "
            f"and the 52w low of ${low_52w:.2f} was set "
            f"{bars_since_low_desc}; the stock is "
            f"{distance_from_low_pct:.2f}% above that prior low - a "
            f"complete reclaim of the 12-month range and a structural "
            f"confirmation that institutional accumulation has driven a "
            f"sustained advance. The 'near high' classification is the "
            f"single most powerful top-level momentum filter in equity "
            f"markets: O'Neil's decades of empirical research at "
            f"Investor's Business Daily documented that stocks within 5% "
            f"of their 52-week high produced systematic outperformance "
            f"versus the broader market over rolling multi-year periods, "
            f"and Mark Minervini's institutional framework rules out "
            f"any buys in stocks more than 25% off their 52-week high "
            f"(this stock is comfortably inside that rule). IBD's "
            f"published 'buy zone' methodology uses the same <5% from "
            f"52w high threshold as a candidate-universe filter. The "
            f"confidence score of {confidence:.0f} reflects the "
            f"proximity premium - the closer to the high, the higher "
            f"the structural edge. Mark Minervini's hard rule — 'no buys "
            f"more than 25% off the 52-week high' — operationalizes this "
            f"directly: any stock failing the proximity filter is out of "
            f"his universe regardless of how clean the setup geometry "
            f"looks. Kristjan Kullamägi takes this further still, "
            f"operating almost exclusively in stocks within 5% of their "
            f"52w highs because the historical hit rate on momentum "
            f"setups inside that band is dramatically higher than the "
            f"broader universe — a refinement that aligns him with "
            f"O'Neil's 'N' criterion at its strictest interpretation."
        )
        why_it_matters = (
            f"Near-52w-high positioning matters because the 52-week "
            f"high is the most widely-watched institutional level in "
            f"equity markets. Every momentum strategy, every "
            f"breakout-trader, and every CAN SLIM follower has scans "
            f"that filter on this exact criterion. When a stock prints "
            f"a fresh 52-week high, three things happen simultaneously: "
            f"(1) all shorts are pressed into covering because their "
            f"entire structural thesis has been invalidated - the "
            f"forced-buy flow is mechanical and self-reinforcing; "
            f"(2) the stock appears on hundreds of breakout scans "
            f"(IBD, Stockbee, Finviz, every screener that filters by "
            f"new-high lists) and attracts fresh momentum-buyer flow; "
            f"(3) the absence of overhead resistance means there are "
            f"NO trapped sellers from prior levels who need to exit at "
            f"break-even - the path of least resistance is up because "
            f"there is no structural supply. This stock at "
            f"${current_close:.2f}, only {distance_from_high_pct:.2f}% "
            f"from the ${high_52w:.2f} high, is in the highest-edge "
            f"universe for long-side momentum trading. The current "
            f"trend stage context (Stage "
            f"{context.get('trend_stage', '?')}) and RS trend "
            f"({context.get('rs_trend', 'flat')}) further qualify the "
            f"setup - the strongest near-high charts have Stage 2 "
            f"alignment AND improving relative strength. Caveat: late-"
            f"stage stocks that have rallied 200%+ from prior bases "
            f"may be at the END of their move rather than the start - "
            f"context.prior_advance_pct (visible on the stage_analysis "
            f"detector output) is the discriminator."
        )
        what_to_watch_for = (
            f"Watch for the actual breakout above ${high_52w:.2f} on "
            f"volume >= 1.5x the 20-bar average - that's the trigger "
            f"for the continuation long entry, with the measured-move "
            f"target at ${target_primary:.2f} (10% above the prior "
            f"high - O'Neil's typical pattern projection) and the "
            f"longer-term target at ${target_secondary:.2f} (25% above "
            f"the prior high - the institutional first-leg projection). "
            f"Stop placement: 1.5% below the most recent 40-bar swing "
            f"low at ${recent_swing_low:.2f}, sized to ${stop:.2f}. The "
            f"specific entry pattern matters: the highest-quality near-"
            f"high setups pair with one of the institutional breakout "
            f"templates - a flat base (<12% depth) just below the 52w "
            f"high, a VCP (volatility contraction pattern) tightening "
            f"into the high, a cup-with-handle with the handle below "
            f"the prior high, or a fresh Power Earnings Gap launching "
            f"into new high territory. A 52w high break that occurs "
            f"WITHOUT one of these structural setups (i.e., a vertical "
            f"unsupported run into the high) has a much higher failure "
            f"rate. Monitor volume on the approach: drying volume INTO "
            f"the high followed by 1.5x+ expansion AT the break is the "
            f"textbook signature; expanding volume into the high "
            f"followed by contraction at the break is the failure "
            f"warning. Time-stop discipline: if 5-10 bars pass after "
            f"the breakout trigger without follow-through, the setup is "
            f"weakening and should be scaled out."
        )
        failure_signal = (
            f"The 'near 52w high' classification fails (and the long "
            f"thesis with it) when the stock fails to break out and "
            f"instead rolls over from these levels - the precise "
            f"failure signal is a close below the most recent swing "
            f"low at ${recent_swing_low:.2f} on volume > 1.5x the "
            f"20-bar average, which invalidates the near-high "
            f"structural setup and triggers the stop at ${stop:.2f}. "
            f"Specific warning signs that the breakout is at risk "
            f"BEFORE the stop is hit: (a) the stock makes a series of "
            f"3+ attempts at ${high_52w:.2f} without breaking through "
            f"on volume - distribution is happening at the level and "
            f"institutional supply is overwhelming the marginal "
            f"breakout-buyer flow; (b) the broader market regime "
            f"deteriorates (Stage 2 -> Stage 3 transition on SPY/QQQ) - "
            f"individual stocks rarely break out cleanly when the "
            f"broader market is topping; (c) relative strength versus "
            f"the broader market deteriorates - the leadership "
            f"signature inverts before absolute price weakens; (d) the "
            f"earnings season produces a disappointing reaction that "
            f"the stock cannot recover from in 5-10 bars. Late-stage "
            f"failure mode: stocks that are 200%+ off their LAST major "
            f"base and within 5% of an all-time high are at the END of "
            f"their institutional cycle (Stage 3 distribution begins "
            f"here), and 'near high' is no longer a high-edge signal "
            f"but rather a topping warning - the discriminator is the "
            f"distance from the prior INSTITUTIONAL BASE rather than "
            f"from the high. The 52w low at ${low_52w:.2f}, set "
            f"{bars_since_low_desc}, gives important context: stocks "
            f"that recovered from a low <12 months ago have stronger "
            f"momentum than those that have been near the high all "
            f"year."
        )
    elif classification == "near_low":
        what_it_is = (
            f"This chart is positioned {classification_desc} - the "
            f"current close at ${current_close:.2f} is only "
            f"{distance_from_low_pct:.2f}% above the prior 252-bar low "
            f"of ${low_52w:.2f}{partial_str}, while sitting "
            f"{distance_from_high_pct:.2f}% below the 52w high of "
            f"${high_52w:.2f}. The 52w low was established "
            f"{bars_since_low_desc} and the 52w high "
            f"{bars_since_high_desc}; the stock is in the bottom decile "
            f"of its 12-month range and has surrendered the bulk of any "
            f"prior advance. The 'near low' classification is the WEAKEST "
            f"universe in equity markets - O'Neil, Minervini, and every "
            f"institutional momentum framework systematically AVOID this "
            f"zone for long-side trades because the technical damage is "
            f"too great to recover in the short term. Stage 4 markdown "
            f"phases (Weinstein) and accumulating distribution days "
            f"(O'Neil) are the typical institutional fingerprint. The "
            f"confidence score of {confidence:.0f} reflects how close to "
            f"the low the stock sits - {distance_from_low_pct:.2f}% above "
            f"the low is structurally dangerous because there is no "
            f"clear support beneath this level (the low itself is the "
            f"only reference) and a breakdown would target the next "
            f"measured-move down at ${target_primary:.2f}. Mark Minervini's "
            f"hard rule — 'no buys more than 25% off the 52-week high' — "
            f"excludes this universe entirely on the long side, framing "
            f"the near-52w-low zone as the wrong side of every leadership "
            f"filter. Kristjan Kullamägi operates exclusively in stocks "
            f"within 5% of their 52w highs and treats the near-52w-low "
            f"universe as functionally invisible to his playbook — the "
            f"opposite end of the same momentum-leadership spectrum."
        )
        why_it_matters = (
            f"Near-52w-low positioning is symmetric to (but opposite "
            f"from) near-52w-high - the 52-week low is the most "
            f"widely-watched WEAKNESS level in equity markets. Three "
            f"forces act on a stock at the 52w low: (1) every prior "
            f"buyer from the past 12 months is underwater and has "
            f"selling pressure at any rally that touches their break-"
            f"even level, creating a wall of overhead supply that "
            f"makes the rally to ${high_52w:.2f} structurally "
            f"improbable in the short term; (2) the stock appears on "
            f"every weakness scan (52w low list, Stage 4 stocks, "
            f"distribution-day leaders, RS-down quintile) and attracts "
            f"fresh short-seller flow rather than buyer flow; (3) "
            f"institutional managers have likely tax-loss-sold the "
            f"stock and are unlikely to re-enter until a multi-month "
            f"basing process completes (Stage 1 setup). The current "
            f"trend stage context (Stage {context.get('trend_stage', '?')}) "
            f"and RS trend ({context.get('rs_trend', 'flat')}) qualify "
            f"the setup - the strongest near-low charts (for shorts) "
            f"have Stage 4 alignment AND deteriorating relative "
            f"strength. The CRITICAL counter-point: near-low alone is "
            f"NOT a buy signal. The textbook 'falling knife' attempt "
            f"happens here, and the average failure rate for long "
            f"entries at the 52w low without a structural reversal "
            f"pattern (a clear higher low, an undercut-and-rally, a "
            f"reclaim of a key MA, a successful Stage 1 base) is "
            f">70%. The trade structure here is either (a) short the "
            f"breakdown below ${low_52w:.2f} for a measured move, or "
            f"(b) wait for the Stage 1 base to form (could take 6-16 "
            f"weeks) and trade the eventual Stage 2 reclaim."
        )
        what_to_watch_for = (
            f"For the short trade: watch for the breakdown below "
            f"${low_52w:.2f} on volume >= 1.5x the 20-bar average - "
            f"that's the trigger for the continuation short entry, "
            f"with the measured-move target at ${target_primary:.2f} "
            f"(10% below the prior low) and the institutional second-"
            f"leg target at ${target_secondary:.2f}. Stop placement: "
            f"1.5% above the most recent 40-bar swing high at "
            f"${recent_swing_high:.2f}, sized to ${stop:.2f}. For the "
            f"eventual long trade: the institutional reversal sequence "
            f"is well-documented and has the following gating tests: "
            f"(1) a successful UNDERCUT-AND-RALLY - a brief penetration "
            f"below ${low_52w:.2f} that fails and reverses back above "
            f"on heavy volume, the textbook Wyckoff spring; (2) a "
            f"successful Stage 1 base of 5+ weeks with the 50-SMA "
            f"flattening from its prior downward trajectory; (3) a "
            f"reclaim of the 50-SMA and 200-SMA in sequence with each "
            f"reclaim holding on a subsequent retest; (4) a fresh "
            f"higher low established above the most recent swing low "
            f"at ${recent_swing_low:.2f}. None of these signals are "
            f"yet present at the 52w low - patience now is rewarded "
            f"with a high-edge long entry in 1-6 months from the "
            f"breakout above the Stage 1 base. Earnings catalysts here "
            f"matter disproportionately - a beat-and-raise from a 52w "
            f"low stock often produces the largest single-day gains "
            f"in the market (the surprise factor is greatest where "
            f"sentiment is lowest)."
        )
        failure_signal = (
            f"The 'near 52w low' classification fails in two "
            f"directions. The BEARISH continuation failure (i.e., the "
            f"short trade fails) happens when the stock reclaims a key "
            f"resistance level - the most recent swing high at "
            f"${recent_swing_high:.2f} - on volume > 1.5x average, "
            f"which signals the bottoming process has begun and the "
            f"short thesis is invalidated. Stop at ${stop:.2f}. The "
            f"BULLISH classification failure (for a premature long "
            f"attempt) is the catastrophic one: every catch-the-bottom "
            f"long entry without one of the structural reversal "
            f"signals listed above fails approximately 70% of the time "
            f"in this zone, with the typical failure pattern being a "
            f"5-15 bar dead-cat bounce followed by a fresh breakdown "
            f"below the prior low and a 15-30% additional decline. "
            f"Specific signs that the 52w low is still under attack "
            f"and that catching the bottom remains premature: (a) "
            f"volume continues to expand on declines while contracting "
            f"on rallies (textbook distribution); (b) the 50-SMA "
            f"continues to slope downward steeply rather than "
            f"flattening; (c) relative strength continues to "
            f"deteriorate versus the broader market; (d) the broader "
            f"market regime is hostile (Stage 4 SPY/QQQ). The "
            f"transition from Stage 4 -> Stage 1 takes time and "
            f"patience is the operative discipline - fishing the "
            f"absolute low is statistically the worst trade in equity "
            f"markets. The 52w high at ${high_52w:.2f}, set "
            f"{bars_since_high_desc}, provides important context: the "
            f"farther the stock has fallen, the longer the eventual "
            f"basing process typically requires."
        )
    else:  # mid_range
        what_it_is = (
            f"This chart is positioned {classification_desc} - the "
            f"current close at ${current_close:.2f} is "
            f"{distance_from_high_pct:.2f}% off the 52w high of "
            f"${high_52w:.2f} and {distance_from_low_pct:.2f}% above "
            f"the 52w low of ${low_52w:.2f}{partial_str}. The 52w "
            f"high was set {bars_since_high_desc} and the 52w low "
            f"{bars_since_low_desc}. The mid-range classification "
            f"means the stock is neither in the high-edge momentum "
            f"universe (within 5% of the 52w high, William O'Neil's "
            f"CAN SLIM 'N' criterion) NOR in the high-risk weakness "
            f"universe (within 5% of the 52w low) - it sits in the "
            f"vast neutral zone where top-level momentum filters do "
            f"not generate a directional bias on their own. This is "
            f"the universe where structural patterns must do all the "
            f"directional work: a flat base or cup-with-handle within "
            f"a mid-range stock can still produce a high-quality "
            f"setup if it points up toward the 52w high, and a head-"
            f"and-shoulders or double-top within a mid-range stock "
            f"can produce a short setup if it points down toward the "
            f"52w low. The mid-range zone is where most stocks spend "
            f"most of their time, and where pattern-recognition adds "
            f"the most value (the momentum filter alone is silent "
            f"here). Mark Minervini's hard rule — 'no buys more than "
            f"25% off the 52-week high' — partitions the mid-range "
            f"universe in two: the upper portion (within 25% of the "
            f"high) remains tradeable with the right setup geometry, "
            f"while the lower portion is structurally outside his "
            f"long-side universe. Kristjan Kullamägi narrows this "
            f"further to within 5% of 52w highs, treating any deeper "
            f"mid-range positioning as low-edge for his momentum "
            f"playbook."
        )
        why_it_matters = (
            f"Mid-range positioning matters because it ELIMINATES the "
            f"top-level momentum tailwind (or headwind) and forces "
            f"the analysis back to the structural patterns themselves. "
            f"A flat base in a stock that is 25% off its 52w high "
            f"will perform very differently from the same flat base "
            f"in a stock that is 3% off its 52w high - the latter has "
            f"the CAN SLIM 'N' tailwind, the former does not. This "
            f"stock at ${current_close:.2f} is "
            f"{distance_from_high_pct:.2f}% off the high - meaningful "
            f"work remains to reach the prior peak, and any long "
            f"thesis must account for the overhead supply from prior "
            f"buyers who are now break-even or underwater on their "
            f"positions. Symmetrically, the {distance_from_low_pct:.2f}% "
            f"cushion above the 52w low provides downside support "
            f"context: the stock has demonstrated that the prior low "
            f"holds as buyable support, and a return toward that "
            f"level would mark a meaningful breakdown rather than "
            f"continuation. The current trend stage context (Stage "
            f"{context.get('trend_stage', '?')}) and RS trend "
            f"({context.get('rs_trend', 'flat')}) qualify how the "
            f"mid-range positioning resolves: Stage 2 mid-range stocks "
            f"with rising RS typically migrate back toward the 52w "
            f"high (the 'N' setup is forming), while Stage 3 or 4 "
            f"mid-range stocks with falling RS typically migrate "
            f"toward the 52w low. Confidence is fixed at 60 because "
            f"the proximity classification itself is informative "
            f"context but not a trade signal."
        )
        what_to_watch_for = (
            f"The key watchpoints in mid-range stocks are the "
            f"directional migration cues: (1) is the stock building "
            f"the structural pattern (flat base, VCP, cup-with-handle, "
            f"rounded base, U&R) that points UP toward the 52w high "
            f"at ${high_52w:.2f}, with each successive base higher "
            f"than the prior - this is the institutional accumulation "
            f"signature that eventually produces a CAN SLIM 'N' entry "
            f"as the stock re-enters the within-5% zone; (2) "
            f"alternatively, is the stock building the distribution "
            f"signature (lower highs, distribution days, head-and-"
            f"shoulders, descending triangle) that points DOWN toward "
            f"the 52w low at ${low_52w:.2f} - this is the "
            f"institutional distribution signature that eventually "
            f"produces a near-low classification. The specific "
            f"intermediate price levels to track: the 50-SMA and "
            f"200-SMA - if both are rising and price is above them, "
            f"the migration back toward the 52w high is the higher-"
            f"probability path; if both are falling and price is "
            f"below them, the migration toward the 52w low is the "
            f"higher-probability path; if they are intertwined and "
            f"flat, the stock is in extended consolidation and the "
            f"resolution will come from a fresh structural pattern. "
            f"Earnings catalysts in mid-range stocks can be the "
            f"decisive trigger - a beat-and-raise often produces the "
            f"breakout back toward the 52w high, while a miss often "
            f"produces the breakdown toward the 52w low. Position "
            f"sizing in mid-range stocks should reflect the absence "
            f"of the top-level edge: half-size entries are appropriate "
            f"until the stock migrates into the near-high or near-low "
            f"zone where the edge is sharper."
        )
        failure_signal = (
            f"Mid-range classification does not 'fail' in the same "
            f"sense as a setup detector - it is descriptive context "
            f"rather than a predictive signal. The classification "
            f"changes when the stock migrates into the near-high "
            f"(<5% off ${high_52w:.2f}) or near-low (<5% above "
            f"${low_52w:.2f}) zone, at which point the directional "
            f"bias becomes meaningful and other patterns can produce "
            f"high-edge entries. Specific levels to watch for "
            f"reclassification: a close above ${high_52w * 0.95:.2f} "
            f"would put the stock back inside the near-high zone "
            f"(CAN SLIM 'N' threshold restored), and a close below "
            f"${low_52w * 1.05:.2f} would put the stock into the "
            f"near-low zone (the warning threshold). The TIME spent in "
            f"the mid-range zone matters: stocks that linger in the "
            f"middle of their 12-month range for 6+ months typically "
            f"resolve in the direction of the prior trend before the "
            f"consolidation, while stocks that pass quickly through "
            f"the mid-range zone (in either direction) are signaling "
            f"a regime change. The current bar at ${current_close:.2f} "
            f"with the 52w high at ${high_52w:.2f} (set "
            f"{bars_since_high_desc}) and the 52w low at "
            f"${low_52w:.2f} (set {bars_since_low_desc}) describes a "
            f"stock that has demonstrated both sides of the range and "
            f"is currently neutral - the next 20-50 bars will reveal "
            f"the institutional bias, and the pattern detectors that "
            f"fire in that window will determine the directional "
            f"thesis."
        )

    extras = {
        "high_52w": round(float(high_52w), 4),
        "low_52w": round(float(low_52w), 4),
        "current_close": round(float(current_close), 4),
        "distance_from_high_pct": round(float(distance_from_high_pct), 3),
        "distance_from_low_pct": round(float(distance_from_low_pct), 3),
        "classification": classification,
        "bars_since_52w_high": int(bars_since_52w_high),
        "bars_since_52w_low": int(bars_since_52w_low),
        "window_bars_used": int(window_n),
        "partial_window": bool(partial),
        "lookback_bars_target": int(_LOOKBACK_BARS),
    }

    if classification == "near_high":
        geometry_score = round(min(100.0, 70.0 + (5.0 - distance_from_high_pct) * 6.0), 2)
        context_score = 80.0
    elif classification == "near_low":
        geometry_score = round(min(100.0, 70.0 + (5.0 - distance_from_low_pct) * 6.0), 2)
        context_score = 80.0
    else:
        geometry_score = 50.0
        context_score = 50.0
    volume_score = 50.0
    historical_score = 50.0

    now = int(time.time())
    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "52-Week Proximity",
        "category": "structure",
        "direction": direction,
        "start_t": int(window_bars[0]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(last_bar["t"])],
        "geometry": {
            "shape": "candle_mark",
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
    return [detection]


def _bars_ago_descriptor(n: int, kind: str) -> str:
    if n == 0:
        return f"on the current bar (the most recent close)"
    if n <= 5:
        return f"only {n} bars ago - very recent {kind}"
    if n <= 20:
        return f"{n} bars ago - recent {kind}"
    if n <= 60:
        return f"{n} bars ago (~{n // 21} months back) - intermediate-term {kind}"
    if n <= 130:
        return f"{n} bars ago (~{n // 21} months back) - older {kind} from the prior half-year"
    return f"{n} bars ago (~{n // 21} months back) - long-stale {kind} from far back in the lookback window"


register(_PATTERN_ID, detect_52w_proximity)
