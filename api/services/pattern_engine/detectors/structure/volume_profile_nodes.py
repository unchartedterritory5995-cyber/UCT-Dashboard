"""Volume Profile Node detector - structure detector.

Pete Steidlmayer (Market Profile, 1980s) and Jim Dalton (Mind Over Markets)
established that markets spend most of their time in 'value' zones where
buyers and sellers agree on price - and accelerate quickly through zones
where they don't. The volume profile makes this geometry literal: divide
the recent price range into horizontal price buckets and tally how much
volume traded in each one.

  - High Volume Nodes (HVN): price levels where institutions accumulated
    real size. Markets remember these levels. Price approaching an HVN
    typically pauses, reverses, or chops sideways as the residual supply/
    demand from the prior auction re-engages.

  - Low Volume Nodes (LVN): price levels where the market 'skipped' -
    little participation, no real auction occurred. Once price re-enters
    an LVN it tends to traverse it quickly because there's nothing to
    'grab' it on the way through.

Unlike trade-setup detectors (one Detection per fire), this detector emits
ONE Detection PER active node. A chart with three HVNs and two LVNs will
return five Detections in a single call.

Geometric definition:
  - Window: the most recent 60 bars (or all bars if series is shorter)
  - Divide the high-to-low range across the window into 20 price buckets
  - For each bar, distribute its volume across the buckets its OHLC range
    spans (split proportionally based on bar overlap with each bucket)
  - HVN: bucket where total volume >= 1.5x average bucket volume
  - LVN: bucket where total volume <= 0.5x average bucket volume
  - Adjacent HVN/LVN buckets are merged into single nodes

Levels:
  - HVN: entry = node_mid * 1.005 (above the node); stop = node_min * 0.985;
         target = None (no measured-move target - these are reference levels)
  - LVN: entry = None (LVN is a structural reference, not a trigger);
         stop = None; target = None

Confidence (node strength):
  - HVN: max(50, 50 + (volume_ratio - 1.5) * 20)
  - LVN: max(50, 50 + (0.5 - volume_ratio) * 100)

Attribution: Pete Steidlmayer ("Market Profile", J.P. James, 1980s),
Jim Dalton ("Mind Over Markets", 1990, and "Markets in Profile", 2007).
The TPO/Market Profile framework is the foundational tool of institutional
auction-market theory.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional, Tuple

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "volume_profile_nodes"
_WINDOW_BARS = 60
_N_BUCKETS = 20
_HVN_THRESHOLD = 1.5
_LVN_THRESHOLD = 0.5


def detect_volume_profile_nodes(bars: List[Bar], context: dict) -> List[Detection]:
    """Build a 20-bucket volume profile over the last 60 bars and emit one
    Detection per HVN and per LVN.
    """
    if len(bars) < 30:
        return []

    last_bar_idx = len(bars) - 1
    window_start_idx = max(0, last_bar_idx - _WINDOW_BARS + 1)
    window_bars = bars[window_start_idx:last_bar_idx + 1]
    if len(window_bars) < 10:
        return []

    # Compute window price extremes
    high_max = max(float(b["h"]) for b in window_bars)
    low_min = min(float(b["l"]) for b in window_bars)
    if high_max <= low_min:
        return []

    price_range = high_max - low_min
    bucket_size = price_range / _N_BUCKETS
    if bucket_size <= 0:
        return []

    # Allocate volume to buckets
    bucket_volumes = [0.0] * _N_BUCKETS

    for b in window_bars:
        bar_low = float(b["l"])
        bar_high = float(b["h"])
        bar_vol = float(b["v"])
        if bar_vol <= 0 or bar_high <= bar_low:
            continue
        bar_span = bar_high - bar_low
        for i in range(_N_BUCKETS):
            bucket_low = low_min + i * bucket_size
            bucket_high = bucket_low + bucket_size
            # Overlap of [bar_low, bar_high] with [bucket_low, bucket_high]
            overlap_lo = max(bar_low, bucket_low)
            overlap_hi = min(bar_high, bucket_high)
            if overlap_hi <= overlap_lo:
                continue
            overlap = overlap_hi - overlap_lo
            bucket_volumes[i] += bar_vol * (overlap / bar_span)

    total_volume = sum(bucket_volumes)
    if total_volume <= 0:
        return []

    # Only buckets with any meaningful activity contribute to the average
    avg_bucket_volume = total_volume / _N_BUCKETS
    if avg_bucket_volume <= 0:
        return []

    # Identify HVN and LVN bucket indexes
    hvn_buckets = []
    lvn_buckets = []
    for i, v in enumerate(bucket_volumes):
        ratio = v / avg_bucket_volume if avg_bucket_volume > 0 else 0.0
        if v >= _HVN_THRESHOLD * avg_bucket_volume:
            hvn_buckets.append((i, ratio))
        elif v <= _LVN_THRESHOLD * avg_bucket_volume:
            lvn_buckets.append((i, ratio))

    # Merge adjacent HVN buckets
    hvn_nodes = _merge_adjacent(hvn_buckets, bucket_volumes)
    lvn_nodes = _merge_adjacent(lvn_buckets, bucket_volumes)

    detections: List[Detection] = []
    window_start_t = int(window_bars[0]["t"])
    current_close = float(bars[-1]["c"])

    for node in hvn_nodes:
        d = _build_detection(
            bars=bars,
            node_type="HVN",
            node=node,
            low_min=low_min,
            bucket_size=bucket_size,
            total_volume=total_volume,
            avg_bucket_volume=avg_bucket_volume,
            window_start_t=window_start_t,
            window_bars_count=len(window_bars),
            current_close=current_close,
            context=context,
        )
        detections.append(d)

    for node in lvn_nodes:
        d = _build_detection(
            bars=bars,
            node_type="LVN",
            node=node,
            low_min=low_min,
            bucket_size=bucket_size,
            total_volume=total_volume,
            avg_bucket_volume=avg_bucket_volume,
            window_start_t=window_start_t,
            window_bars_count=len(window_bars),
            current_close=current_close,
            context=context,
        )
        detections.append(d)

    return detections


def _merge_adjacent(buckets: List[Tuple[int, float]],
                    bucket_volumes: List[float]) -> List[dict]:
    """Greedily merge adjacent buckets into single nodes."""
    if not buckets:
        return []
    sorted_b = sorted(buckets, key=lambda x: x[0])
    nodes = []
    current = {
        "first_idx": sorted_b[0][0],
        "last_idx": sorted_b[0][0],
        "volume_sum": bucket_volumes[sorted_b[0][0]],
        "max_ratio": sorted_b[0][1],
    }
    for idx, ratio in sorted_b[1:]:
        if idx == current["last_idx"] + 1:
            current["last_idx"] = idx
            current["volume_sum"] += bucket_volumes[idx]
            if ratio > current["max_ratio"]:
                current["max_ratio"] = ratio
        else:
            nodes.append(current)
            current = {
                "first_idx": idx,
                "last_idx": idx,
                "volume_sum": bucket_volumes[idx],
                "max_ratio": ratio,
            }
    nodes.append(current)
    return nodes


def _compute_confidence(node_type: str, volume_ratio: float) -> float:
    if node_type == "HVN":
        raw = 50.0 + (volume_ratio - _HVN_THRESHOLD) * 20.0
    else:  # LVN
        raw = 50.0 + (_LVN_THRESHOLD - volume_ratio) * 100.0
    return float(min(100.0, max(50.0, raw)))


def _distance_descriptor(distance_pct: float) -> str:
    abs_d = abs(distance_pct)
    if abs_d <= 0.5:
        return "essentially at the node - price is sitting on this reference now"
    if abs_d <= 2.0:
        return "an immediate reference level - within 1-2 sessions of being tested"
    if abs_d <= 5.0:
        return "a near-term swing reference - reachable in 1-2 weeks of normal volatility"
    if abs_d <= 10.0:
        return "a mid-distance reference - relevant for position framing but not for same-day positioning"
    return "a more distant reference - useful for higher-timeframe stop and target framing"


def _build_detection(
    bars: List[Bar],
    node_type: str,
    node: dict,
    low_min: float,
    bucket_size: float,
    total_volume: float,
    avg_bucket_volume: float,
    window_start_t: int,
    window_bars_count: int,
    current_close: float,
    context: dict,
) -> Detection:
    first_idx = int(node["first_idx"])
    last_idx = int(node["last_idx"])
    node_volume = float(node["volume_sum"])
    bucket_volume_ratio = node_volume / (avg_bucket_volume * (last_idx - first_idx + 1)) if avg_bucket_volume > 0 else 0.0

    price_min = low_min + first_idx * bucket_size
    price_max = low_min + (last_idx + 1) * bucket_size
    price_mid = (price_min + price_max) / 2.0
    node_width = price_max - price_min

    percent_of_total = (node_volume / total_volume * 100.0) if total_volume > 0 else 0.0

    confidence = _compute_confidence(node_type, bucket_volume_ratio)

    last_bar = bars[-1]
    last_bar_t = int(last_bar["t"])

    # Levels (per scope: HVN has trade levels, LVN does not trigger)
    if node_type == "HVN":
        entry = round(price_mid * 1.005, 2)
        stop = round(price_min * 0.985, 2)
        entry_condition = (
            f"close > {entry:.2f} above HVN at ${price_mid:.2f} - long entry "
            f"with stop below ${stop:.2f}"
        )
        stop_basis = "1.5% below HVN low edge"
        target_primary = None
        target_secondary = None
        rr = 0.0
    else:
        entry = None
        stop = None
        entry_condition = (
            f"LVN at ${price_mid:.2f} is a STRUCTURAL reference, not a trade "
            "trigger - markets accelerate through LVNs rather than reversing in them"
        )
        stop_basis = ""
        target_primary = None
        target_secondary = None
        rr = 0.0

    # Distance from current price
    distance_pct = (price_mid - current_close) / current_close * 100.0 if current_close > 0 else 0.0
    above_or_below = "above" if distance_pct >= 0 else "below"
    distance_desc = _distance_descriptor(distance_pct)

    regime = context.get("regime", "current")
    rs_trend = context.get("rs_trend", "flat")
    vol_signature = context.get("volume_signature", "neutral")

    # Geometry: horizontal_line anchors
    anchors = [
        {"t": window_start_t, "price": float(price_mid)},
        {"t": last_bar_t, "price": float(price_mid)},
    ]

    extras = {
        "node_type": node_type,
        "volume_ratio": round(float(bucket_volume_ratio), 4),
        "price_min": round(float(price_min), 4),
        "price_max": round(float(price_max), 4),
        "price_mid": round(float(price_mid), 4),
        "bucket_volume": round(float(node_volume), 2),
        "percent_of_total_volume": round(float(percent_of_total), 3),
        "window_bars": int(window_bars_count),
        "bucket_count": int(last_idx - first_idx + 1),
        "n_buckets_total": int(_N_BUCKETS),
        "node_width": round(float(node_width), 4),
        "distance_from_current_pct": round(float(distance_pct), 3),
        "current_close": round(float(current_close), 4),
        "dcr_score_adj": 0.0,
    }

    # -------- Narrative --------
    headline = (
        f"{node_type} at ${price_mid:.2f} - "
        f"{bucket_volume_ratio:.2f}x average bucket volume, "
        f"{percent_of_total:.1f}% of {window_bars_count}-bar volume profile, "
        f"{abs(distance_pct):.2f}% {above_or_below} current close ${current_close:.2f}."
    )

    if node_type == "HVN":
        what_it_is = (
            f"This High Volume Node (HVN) at ${price_mid:.2f} is a price "
            f"level where {node_volume:,.0f} units of volume traded over the "
            f"last {window_bars_count} bars - {percent_of_total:.1f}% of the "
            f"entire window's volume concentrated in a single price band "
            f"spanning ${price_min:.2f} to ${price_max:.2f} (a "
            f"${node_width:.2f}-wide zone). The volume here ran at "
            f"{bucket_volume_ratio:.2f}x the average bucket volume across "
            f"the 20-bucket volume profile, which means the market spent "
            f"significantly more time and significantly more capital "
            f"transacting at this price than at any of the surrounding "
            f"prices - the very definition of a Market Profile 'value area' "
            f"node in Pete Steidlmayer's original framework. HVNs are the "
            f"prices the market has 'agreed' on: buyers and sellers found "
            f"each other repeatedly and willingly here, executing real "
            f"institutional size rather than skipping through on thin "
            f"prints. Jim Dalton's auction-market theory frames this as "
            f"'fair value' - the price the market has discovered through "
            f"its own auction process to be the equilibrium where neither "
            f"side dominates. The mechanic that produces an HVN is "
            f"institutional accumulation or distribution playing out over "
            f"many sessions at a specific anchor price: large orders being "
            f"worked in tranches, dealer hedging flows clustering around "
            f"option strikes, and algorithmic VWAP-style execution all "
            f"compound to create these magnetic price zones. Once an HVN "
            f"is established, it carries a persistent gravitational "
            f"signature - future price action approaching the level "
            f"typically slows down, chops sideways, or outright reverses, "
            f"as the residual supply and demand from the prior auction "
            f"re-engages. Linda Raschke uses volume profile + Market "
            f"Profile (TPO chart) reads in her swing playbook as a "
            f"primary confluence input — she treats price approaching a "
            f"prior HVN with diverging momentum as one of the highest-edge "
            f"mean-reversion setups in the entire structural-analysis "
            f"library."
        )
        why_it_matters = (
            f"This HVN at ${price_mid:.2f} is currently "
            f"{abs(distance_pct):.2f}% {above_or_below} the most recent "
            f"close (${current_close:.2f}), which makes it "
            f"{distance_desc}. In a {regime} regime with {rs_trend} "
            f"relative strength and {vol_signature} volume signature, this "
            f"node has direct trading application: HVNs act as MAGNETS for "
            f"price - the deeper the volume concentration relative to "
            f"surrounding levels (this node ran {bucket_volume_ratio:.2f}x "
            f"the bucket average, while merely 'present' levels run 0.8-"
            f"1.2x), the stronger the magnetism. Three common interaction "
            f"patterns apply when price tags an HVN: (1) MEAN REVERSION - "
            f"price oscillates inside the node for hours to days as the "
            f"old auction re-engages, providing range-trade entries with "
            f"tight stops at the node edges; (2) ACCEPTANCE - price closes "
            f"through the node and consolidates on the new side, signaling "
            f"that the prior value area is being re-priced and the level "
            f"now flips role (HVN-as-support becomes HVN-as-resistance "
            f"after a downside acceptance, and vice versa); (3) REJECTION "
            f"- price wicks into the node and immediately reverses, "
            f"confirming the level is still active and producing the "
            f"highest-conviction reversal trades around HVNs. The "
            f"${node_width:.2f} width of this specific node is meaningful: "
            f"narrow HVNs (single-bucket, sharp prints) tend to act as "
            f"precision levels with predictable touch-and-go behavior, "
            f"while wide HVNs (multi-bucket merges) act as broad value "
            f"zones where price chops for extended periods. The "
            f"{percent_of_total:.1f}% share of total volume at this node "
            f"versus a flat-distribution baseline of "
            f"{100.0 / _N_BUCKETS:.1f}% per bucket reveals how distinctly "
            f"this price stands out from its neighbors - any HVN above "
            f"~8-10% concentration in a 20-bucket profile is "
            f"institutional-grade."
        )
        what_to_watch_for = (
            f"As price approaches ${price_mid:.2f} from "
            f"{('below' if distance_pct >= 0 else 'above')}, watch the "
            f"interaction closely: a clean rejection with above-average "
            f"volume on the touch bar confirms the node's continued "
            f"validity and offers the highest-conviction reversal trades. "
            f"For a long bias around this HVN: ideal entry is ${entry:.2f} "
            f"(just above the node midpoint), stop at ${stop:.2f} (1.5% "
            f"below the node low edge at ${price_min:.2f}), with profit "
            f"targets at the next HVN above or at recent swing structure - "
            f"HVN trades typically resolve in 1-2:1 R:R because the "
            f"measured-move target lives at the next inflection node, not "
            f"a textbook geometric projection. The volume on the rejection "
            f"bar matters enormously: heavy volume rejection ($)>=1.5x "
            f"20-bar average) confirms institutional defense of the node, "
            f"while light-volume rejection often gives way to acceptance "
            f"on the second or third test. Watch the BAR ANATOMY at the "
            f"node: a wick that pokes into the node and closes back out "
            f"with a wide opposite-side real body is the classic "
            f"single-bar rejection signal, while a series of small-body "
            f"bars that close INSIDE the node range signals acceptance and "
            f"a probable break to the other side. In trending markets, "
            f"HVNs in the path of the trend get absorbed quickly on a "
            f"first test (acceptance is the default), so trade them with "
            f"smaller size against the trend. In ranging markets, HVNs "
            f"reverse cleanly on first touch (rejection is the default), "
            f"so trade them with larger size as range-edge entries. The "
            f"current {regime} regime informs which mode is dominant: in "
            f"trending regimes, expect acceptance; in ranging regimes, "
            f"expect rejection. Use the cluster_count (number of buckets "
            f"in this node: {last_idx - first_idx + 1}) as a size guide - "
            f"single-bucket HVNs trade as precision pivots, multi-bucket "
            f"HVNs trade as broad value-zone chops."
        )
        failure_signal = (
            f"An HVN level fails when price closes through it on volume "
            f">=1.5x the 20-bar average AND fails to immediately recover. "
            f"For this specific node at ${price_mid:.2f}: a daily close "
            f"more than 1.5% on the opposite side of the node edge "
            f"(${price_min:.2f} below or ${price_max:.2f} above) on heavy "
            f"tape is the textbook failure signal - the prior 'value area' "
            f"has been re-discovered, the old equilibrium price has been "
            f"rejected, and the market is moving to find a new fair value. "
            f"When an HVN breaks, it does NOT disappear - it FLIPS ROLE. "
            f"An HVN that previously acted as support, when broken to the "
            f"downside, becomes a high-conviction overhead reference on "
            f"any retest rally; an HVN that previously acted as resistance, "
            f"when broken to the upside, becomes a defended floor on the "
            f"next pullback. This polarity reversal is one of the most "
            f"reliable principles in technical analysis and explains why "
            f"the ${price_mid:.2f} zone will continue to be a relevant "
            f"reference even after price clears it. The "
            f"{bucket_volume_ratio:.2f}x volume ratio at this node "
            f"directly indexes its strength: the higher the ratio, the "
            f"more capital is sitting at this anchor price waiting to be "
            f"unwound, and the more violent the eventual break tends to "
            f"be when it finally happens. Failed HVN trades are usually "
            f"signaled in two ways: (a) the node is tagged but volume on "
            f"the rejection bar is well below average (the move into the "
            f"node was noise, not institutional positioning); (b) multiple "
            f"close-the-bar-inside-the-node prints accumulate without "
            f"actually rejecting price, signaling the auction is "
            f"transitioning to acceptance of the node as new value. "
            f"Position discipline: always size against the volume ratio "
            f"of the specific node, never against an abstract 'this is an "
            f"HVN' label - the gradient matters."
        )
    else:  # LVN
        what_it_is = (
            f"This Low Volume Node (LVN) at ${price_mid:.2f} is a price "
            f"zone where the market 'skipped' - only {node_volume:,.0f} "
            f"units of volume traded across this ${node_width:.2f}-wide "
            f"band (${price_min:.2f} to ${price_max:.2f}) over the last "
            f"{window_bars_count} bars, representing just "
            f"{percent_of_total:.1f}% of total volume in the window. The "
            f"volume ratio of {bucket_volume_ratio:.2f}x average bucket "
            f"volume marks this price band as well below the participation "
            f"threshold - Pete Steidlmayer originally defined LVNs as the "
            f"'single prints' on the TPO profile where the auction "
            f"executed in a single time period rather than building value. "
            f"The market did not find equilibrium here; buyers and sellers "
            f"transited the level quickly without engaging in real size. "
            f"Jim Dalton frames LVNs as the 'unfinished business' of "
            f"price action - zones the market has flagged as not "
            f"institutional-grade and will tend to traverse rapidly on "
            f"any future visit. The mechanic that produces an LVN is "
            f"absence of two-sided commitment: in this band, one side "
            f"clearly dominated for the brief time the price spent here, "
            f"with no meaningful counter-flow stepping in to slow the "
            f"move. That asymmetry leaves a structural fingerprint - "
            f"there is no residual order book history at this price to "
            f"slow future price action when it returns. Volume Profile "
            f"theory holds that price tends to MOVE rapidly through LVNs "
            f"on every visit, accelerating from one HVN to the next "
            f"rather than stalling in between. Linda Raschke uses volume "
            f"profile and Market Profile reads in her swing playbook as "
            f"a primary confluence input — she specifically targets LVN "
            f"transit zones as continuation accelerators, treating a "
            f"breakout that enters an LVN on volume as a high-edge "
            f"trigger for adding to existing trend positions."
        )
        why_it_matters = (
            f"This LVN at ${price_mid:.2f} sits {abs(distance_pct):.2f}% "
            f"{above_or_below} the current close (${current_close:.2f}), "
            f"making it {distance_desc}. In a {regime} regime with "
            f"{rs_trend} relative strength and {vol_signature} volume "
            f"signature, this node has a SPECIFIC and DIFFERENT trading "
            f"application from an HVN: LVNs are MOMENTUM ACCELERATION "
            f"ZONES, not reversal levels. The expected behavior when price "
            f"breaks into the ${price_min:.2f}-${price_max:.2f} band is "
            f"rapid traversal through the band without pausing - the "
            f"market 'remembers' that this price did not auction with size "
            f"and respects that history by skipping through quickly. This "
            f"makes LVNs ideal for: (1) MEASURED-MOVE EXTENSIONS - when "
            f"price breaks an HVN and enters an LVN, expect a "
            f"capitulation-style move to the next HVN with little "
            f"counter-trend friction in between; (2) STOP PLACEMENT - "
            f"never park stops INSIDE an LVN because price moves through "
            f"them too fast to give you a controlled exit; place stops "
            f"BEYOND the LVN on the far side at the next HVN, where "
            f"counter-flow will at least slow the bleed; (3) TARGET "
            f"PROJECTION - LVNs reveal where price 'wants' to skip to next "
            f"in a developing trend, making them useful waypoints for "
            f"profit-taking but never the final destination. Crucially, "
            f"LVNs are NOT trade-entry triggers. You don't BUY an LVN or "
            f"SELL an LVN - you respect the gap they reveal in the auction "
            f"and use that information for sizing, timing, and target "
            f"selection. The {percent_of_total:.1f}% volume share of this "
            f"node versus a flat-distribution baseline of "
            f"{100.0 / _N_BUCKETS:.1f}% per bucket reveals how "
            f"unmistakably it stands out as a non-participation zone - "
            f"the deeper the LVN (the lower the volume ratio), the more "
            f"acceleration to expect on traversal."
        )
        what_to_watch_for = (
            f"As price approaches the LVN at ${price_mid:.2f}, the "
            f"playbook differs fundamentally from HVN trading: expect "
            f"price to traverse the ${node_width:.2f}-wide band quickly "
            f"once it enters, NOT to pause or reverse. Concrete patterns "
            f"to watch: (1) the bar that pushes into the LVN often has a "
            f"wider-than-average range AND closes near its extreme in the "
            f"direction of the move - that's the 'velocity bar' signature "
            f"signaling the band is being skipped per textbook; (2) "
            f"volume on the traversal bar is usually MODERATE or even "
            f"LOW, NOT high - LVNs by definition see little participation, "
            f"and the bar that crosses one inherits that scarcity; (3) "
            f"if price enters the LVN and STALLS (closes inside the band "
            f"on multiple consecutive bars), that's a STRUCTURAL ANOMALY "
            f"that signals the LVN is being re-priced into an HVN-"
            f"in-formation - rare but it happens, usually around news "
            f"events that bring fresh capital to a previously-skipped "
            f"zone. Use this LVN as a WAYPOINT, not a destination: if "
            f"you're long from below, this LVN is a 'pass-through' rather "
            f"than a partial-exit zone, because price will continue to "
            f"the next HVN. If you're sizing a long entry from below, "
            f"position your stop BEYOND the LVN low edge at "
            f"${price_min:.2f} rather than inside it - the LVN provides "
            f"no friction to slow a stop-out, so a stop placed inside "
            f"will burn at full speed. Conversely, for shorts: position "
            f"stops BEYOND the LVN high edge at ${price_max:.2f}. The "
            f"asymmetry is key: LVNs hurt you when used as friction "
            f"levels and help you when used as targets/projection zones."
        )
        failure_signal = (
            f"The LVN classification at ${price_mid:.2f} 'fails' (in the "
            f"sense of behaving unexpectedly) when price enters the band "
            f"and STALLS rather than accelerating through. Specifically: "
            f"three or more consecutive daily closes inside the "
            f"${price_min:.2f}-${price_max:.2f} band signal the LVN is "
            f"being CONVERTED into an HVN as fresh capital flows in and "
            f"establishes new auction value at the previously-skipped "
            f"price. This is a regime-change signal: a former skip zone "
            f"becoming a parking zone usually reflects a news catalyst, "
            f"earnings reaction, or institutional initiative that re-"
            f"discovers value in a previously-ignored band. The "
            f"{bucket_volume_ratio:.2f}x volume ratio at this node "
            f"indexes its 'skip likelihood': the lower the ratio, the "
            f"cleaner the skip-through behavior; LVNs at 0.30x and lower "
            f"are the most reliable acceleration zones, while LVNs near "
            f"the 0.50x threshold are weaker and more prone to "
            f"acceptance-based stalls. Practical risk-management "
            f"implication: an LVN that gets accepted (stalls and "
            f"establishes value inside) invalidates any trade thesis that "
            f"depended on rapid traversal through it - if you projected "
            f"a target at the far-side HVN on the assumption price would "
            f"skip this LVN, the conversion to an HVN-in-formation kills "
            f"the projection, and you should reduce position size or exit "
            f"and re-evaluate. The single most common LVN failure mode: "
            f"price wicks into the LVN, partially fills the bands, and "
            f"then chops sideways for 5-15 bars, slowly transferring "
            f"capital into the previously-skipped zone. Track this with "
            f"running volume profile updates: if the running per-bucket "
            f"volume here climbs above 1.0x average over 1-2 weeks of "
            f"action, the LVN has effectively ceased to exist as a "
            f"velocity zone and should be removed from your active "
            f"structural map."
        )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Volume Profile Node",
        "category": "structure",
        "direction": "neutral",
        "start_t": window_start_t,
        "end_t": last_bar_t,
        "pivot_ts": [window_start_t, last_bar_t],
        "geometry": {
            "shape": "horizontal_line",
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
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": round(float(confidence), 2),
        "quality_components": {
            "geometry_score": round(float(confidence), 2),
            "volume_score": round(float(min(100.0, bucket_volume_ratio * 50.0)), 2),
            "context_score": 50.0,
            "historical_score": 50.0,
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


register(_PATTERN_ID, detect_volume_profile_nodes)
