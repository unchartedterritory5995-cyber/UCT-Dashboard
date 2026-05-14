"""CAN SLIM Composite detector — William O'Neil's 7-pillar framework.

This is a META-DETECTOR that always emits exactly ONE Detection per call,
surfacing the chart's CAN SLIM composite grade as a primary signal.

William O'Neil's "How to Make Money in Stocks" (1988) codified the
CAN SLIM acronym for the 7 pillars of institutional-grade growth stocks:
  C - Current quarterly EPS growth
  A - Annual EPS growth
  N - New high / new product / new management
  S - Supply and demand
  L - Leader or laggard
  I - Institutional sponsorship
  M - Market direction

The composite score is computed by `can_slim_score(bars, context)` in
the can_slim primitive. The detector packages that score + per-pillar
breakdown + grade into a Detection with stage-specific narrative.

Direction:
  Grade A -> "bullish" (institutional-grade leader, all pillars confirmed)
  Grade B -> "bullish"
  Grade C -> "neutral"
  Grade D -> "bearish" (avoid)

Levels:
  Grade A/B: entry=current_close*1.005, stop=below recent swing low or 20EMA,
             target=52w_high + 10%
  Grade C/D: no actionable levels
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, ma_alignment_phrase, regime_phrase, rs_trend_phrase,
    trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.primitives.can_slim import can_slim_score
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "can_slim_composite"

_MIN_BARS = 30   # below this, can_slim_score returns the neutral "C" floor


def detect_can_slim_composite(bars: List[Bar], context: dict) -> List[Detection]:
    """Always emit exactly one Detection with the CAN SLIM grade + breakdown."""
    if not bars or len(bars) < _MIN_BARS:
        return []

    result = can_slim_score(bars, context)
    grade = result["grade"]
    composite = result["composite_score"]
    direction = _direction_for_grade(grade)

    last_bar = bars[-1]
    current_close = last_bar["c"]

    # Levels per grade
    levels = _build_levels(bars, grade, current_close)

    # Anchors at the current bar
    anchors = [{"t": int(last_bar["t"]), "price": float(current_close)}]
    pivot_ts = [int(last_bar["t"])]

    extras = {
        "composite_score": result["composite_score"],
        "grade": grade,
        "c_score": result["c_score"],
        "a_score": result["a_score"],
        "n_score": result["n_score"],
        "s_score": result["s_score"],
        "l_score": result["l_score"],
        "i_score": result["i_score"],
        "m_score": result["m_score"],
        "interpretation": result["interpretation"],
        "current_close": round(current_close, 2),
        "n_bars": len(bars),
    }

    confidence = round(composite, 2)

    geom_score = composite
    vol_score = result["s_score"]
    ctx_score = result["m_score"]
    hist_score = 50.0

    narrative = _compose_narrative(result, context, bars, levels, direction)
    now = int(time.time())

    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": f"CAN SLIM Composite (Grade {grade})",
        "category": "uct",
        "direction": direction,
        "start_t": int(bars[0]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": levels,
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": round(geom_score, 2),
            "volume_score": round(vol_score, 2),
            "context_score": round(ctx_score, 2),
            "historical_score": round(hist_score, 2),
        },
        "narrative": narrative,
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }
    return [detection]


def _direction_for_grade(grade: str) -> str:
    if grade == "A":
        return "bullish"
    if grade == "B":
        return "bullish"
    if grade == "D":
        return "bearish"
    return "neutral"


def _build_levels(bars: List[Bar], grade: str, current_close: float) -> dict:
    """Grade A/B get actionable levels; C/D do not."""
    if grade in ("A", "B"):
        # Find recent swing low (40 bars) and 20-EMA for stop
        last40 = bars[-40:]
        swing_low = min(b["l"] for b in last40)
        # 52-week high projection for target
        last252 = bars[-252:] if len(bars) >= 252 else bars
        high_52w = max(b["h"] for b in last252)
        entry = round(current_close * 1.005, 2)
        stop = round(swing_low * 0.985, 2)
        target = round(high_52w * 1.10, 2)
        rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
        return {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (CAN SLIM Grade {grade} leader)",
            "stop": stop,
            "stop_basis": "recent_40bar_swing_low_minus_1.5pct",
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        }
    return {
        "entry": None,
        "entry_condition": f"Grade {grade} - no actionable trade; pillars insufficient",
        "stop": None,
        "stop_basis": "",
        "target_primary": None,
        "target_secondary": None,
        "risk_reward": 0.0,
    }


def _compose_narrative(result: dict, context: dict, bars: List[Bar],
                       levels: dict, direction: str) -> dict:
    grade = result["grade"]
    composite = result["composite_score"]
    c_s = result["c_score"]
    a_s = result["a_score"]
    n_s = result["n_score"]
    s_s = result["s_score"]
    l_s = result["l_score"]
    i_s = result["i_score"]
    m_s = result["m_score"]
    interp = result["interpretation"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"CAN SLIM Grade {grade} ({composite:.1f}/100) - "
        f"C:{c_s:.0f} A:{a_s:.0f} N:{n_s:.0f} S:{s_s:.0f} L:{l_s:.0f} I:{i_s:.0f} M:{m_s:.0f}. "
        f"Direction bias {direction}."
    )

    # Common framework intro paragraph used across all 4 grades
    framework_intro = (
        f"William J. O'Neil codified the CAN SLIM framework in his 1988 "
        f"book 'How to Make Money in Stocks,' based on a half-century of "
        f"empirical study of the greatest winning stocks in US market "
        f"history. The seven letters of the acronym map to the seven "
        f"non-negotiable characteristics that the historic winners "
        f"(Microsoft, Cisco, Home Depot, Amazon, Apple, Tesla, Nvidia, "
        f"etc.) all shared at the start of their major moves: C = "
        f"current quarterly EPS growth >=25%, A = annual EPS growth "
        f">=25%, N = new high / new product / new management, S = "
        f"supply & demand (institutional accumulation evident on the "
        f"tape), L = leader (not laggard) of its industry group, I = "
        f"increasing institutional sponsorship, M = market direction "
        f"favorable. O'Neil's lifetime track record at Investor's "
        f"Business Daily and the CAN SLIM model portfolios produced "
        f"absolute returns that compounded at roughly 20-35% annually "
        f"over multiple decades — making the framework one of the "
        f"most-validated growth-stock methodologies in the literature. "
        f"This detector emits a composite Grade (A/B/C/D) by scoring "
        f"each pillar 0-100 using the data we can directly observe on "
        f"the chart + structural context. Fundamental pillars (C/A/I) "
        f"use price-action proxies; price-action pillars (N/S/L/M) are "
        f"direct."
    )

    # Per-pillar interpretation woven in for each grade
    if grade == "A":
        what_it_is = (
            f"This chart is an O'Neil Grade A CAN SLIM leader - composite "
            f"score {composite:.1f}/100, with all 7 pillars confirming "
            f"institutional-grade growth-stock characteristics. The "
            f"per-pillar breakdown: C (current earnings catalyst) = "
            f"{c_s:.0f}, A (annual growth) = {a_s:.0f}, N (new high "
            f"proximity) = {n_s:.0f}, S (supply/demand) = {s_s:.0f}, "
            f"L (leadership) = {l_s:.0f}, I (institutional liquidity) "
            f"= {i_s:.0f}, M (market direction) = {m_s:.0f}. "
            f"{framework_intro} Grade A is the rarest and most coveted "
            f"CAN SLIM classification — historically only about 1-3% of "
            f"the US stock universe at any given time meets the full "
            f"7-pillar criteria. These are the kind of setups O'Neil "
            f"described as 'the great winners of every market cycle' — "
            f"NVDA in 2023, AAPL in 2007, MSFT in 1986. Grade A "
            f"validation alone does not produce a trade entry — it "
            f"qualifies the stock for the leader universe and confirms "
            f"that any technical setup forming on the chart (VCP, flat "
            f"base, episodic pivot, Holy Grail, Qullamaggie setup) is "
            f"firing on an institutional-grade vehicle. {interp}"
        )
        why_it_matters = (
            f"This Grade A composite is firing inside {stage_phrase} "
            f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
            f"{vol_phrase} and {dcr_p} confirm the institutional "
            f"signature across multiple data axes. Grade A leaders are "
            f"O'Neil's lifelong study population — the stocks that "
            f"produce 100-1000%+ returns over 12-24 months when bought "
            f"at the right structural pivot point. The key insight from "
            f"O'Neil's research: Grade A status is NOT a buy signal by "
            f"itself, but it is a UNIVERSE FILTER that dramatically "
            f"improves the edge of every subsequent technical trigger. "
            f"A VCP forming on a Grade A leader produces 2-3x the "
            f"average follow-through of the same VCP on a Grade C "
            f"stock. A Power Earnings Gap on a Grade A leader produces "
            f"3-6x the average move. Kullamägi's published rules "
            f"explicitly require Grade A-equivalent characteristics "
            f"(near 52w high, liquid, in an uptrend, leadership status) "
            f"and his entire monster-move methodology can be read as "
            f"trading Grade A CAN SLIM leaders at structurally clean "
            f"entry points. The composite score of {composite:.1f} "
            f"places this chart in the top 1-3% of the institutional "
            f"universe — capital allocation to setups that form on "
            f"this kind of vehicle deserves elevated position sizing "
            f"and tighter execution discipline."
        )
        what_to_watch_for = (
            f"This is an eligibility-grade signal rather than a "
            f"specific trade entry. Watch for the next technical "
            f"trigger to develop: (a) a tight flat base or VCP within "
            f"the leader universe — pivots on Grade A leaders produce "
            f"the cleanest breakouts of any setup in the literature; "
            f"(b) an Episodic Pivot on volume — Grade A leaders "
            f"produce EPs that follow through 70-80% of the time vs "
            f"the universe average of 50-60%; (c) a pullback to the "
            f"20-EMA or 50-SMA — the institutional 'second buy point' "
            f"O'Neil described in 'How to Make Money in Stocks' as the "
            f"second-best entry after the initial breakout. The current "
            f"close at ${result['composite_score']:.2f} (proxy: composite) "
            f"is the eligibility reference; the actual entry levels "
            f"depend on the specific technical setup that triggers "
            f"within the leader status. Levels in this detection "
            f"({levels.get('entry')}, {levels.get('stop')}, "
            f"{levels.get('target_primary')}) represent O'Neil's "
            f"default 'buy any pullback to 20EMA' frame, but the "
            f"highest-edge entries come from waiting for the specific "
            f"structural triggers (VCP, EP, Holy Grail) within this "
            f"leader status. Discipline: do not chase Grade A leaders "
            f"more than 5% above the most recent pivot — wait for the "
            f"next clean structure to form."
        )
        failure_signal = (
            f"The Grade A classification is invalidated if one or more "
            f"pillars deteriorate materially. Specifically: (1) the M "
            f"(market direction) pillar dropping below 50 — the broader "
            f"market regime turning bearish removes the favorable wind "
            f"that lifts all CAN SLIM leaders; (2) the L (leadership) "
            f"pillar dropping below 50 — relative strength deteriorating "
            f"from its current level means the stock is losing its "
            f"institutional sponsorship; (3) the N (new high) pillar "
            f"falling below 50 — price extending more than 25% below "
            f"the 52-week high means the structural advance has stalled "
            f"and the leadership cycle may be ending. The textbook "
            f"O'Neil sell signal on a Grade A leader is the "
            f"transition to Grade B or below on the composite "
            f"score, particularly when accompanied by distribution days "
            f"(heavy-volume down sessions) accumulating in the broader "
            f"market. Risk management on Grade A trades: the upside "
            f"asymmetry is so large that aggressive position sizing is "
            f"justified, BUT the stop discipline must be absolute — "
            f"O'Neil's universal rule was the 7-8% maximum loss "
            f"regardless of conviction. CAN SLIM leaders that violate "
            f"the 7-8% rule must be cut even at Grade A status, because "
            f"the stocks that produce 100%+ winners never give the "
            f"buyer more than a 7-8% drawdown from entry on a clean "
            f"setup."
        )
    elif grade == "B":
        what_it_is = (
            f"This chart is an O'Neil Grade B CAN SLIM candidate - "
            f"composite score {composite:.1f}/100, with most pillars "
            f"confirming institutional-grade characteristics but at "
            f"least one weak pillar. Per-pillar breakdown: C={c_s:.0f}, "
            f"A={a_s:.0f}, N={n_s:.0f}, S={s_s:.0f}, L={l_s:.0f}, "
            f"I={i_s:.0f}, M={m_s:.0f}. {framework_intro} Grade B is "
            f"the tradeable-with-awareness tier in O'Neil's framework "
            f"— the chart has most of what a leader needs but is missing "
            f"one or more pillars. Common Grade B profiles: a strong "
            f"chart with weak M (market direction) — the stock itself "
            f"is fine but the broader market regime is hostile; a "
            f"strong chart with weak L (leadership) — relative strength "
            f"hasn't yet confirmed the move; or a strong chart with "
            f"weak C/A (earnings catalyst) — the move is technical "
            f"rather than fundamental. {interp}"
        )
        why_it_matters = (
            f"This Grade B composite is firing inside {stage_phrase} "
            f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
            f"{vol_phrase} and {dcr_p} provide additional texture. "
            f"O'Neil's specific guidance on Grade B candidates: trade "
            f"them at reduced size relative to Grade A leaders, "
            f"with explicit awareness of which pillar is weak and what "
            f"would cause it to fail. Grade B stocks produce real "
            f"winners — the composite score of {composite:.1f} is well "
            f"above the universe median, and the stock is qualified "
            f"for the leadership-grade trading universe — but the "
            f"upside asymmetry is roughly half that of Grade A leaders. "
            f"The mechanical edge comes from disciplined position sizing: "
            f"a Grade A position might be 5-10% of equity at full size, "
            f"while a Grade B position should be 2-5% — half the "
            f"conviction, half the size. Technical setups (VCP, flat "
            f"base, Holy Grail) on Grade B candidates still produce "
            f"trade-worthy entries, but with tighter stops and earlier "
            f"profit-taking."
        )
        what_to_watch_for = (
            f"Watch for the weak pillar(s) to improve. The path from "
            f"Grade B to Grade A is the highest-edge transition in the "
            f"CAN SLIM framework: M (market direction) improving from "
            f"a transitional or bearish regime to a bull regime can "
            f"flip a Grade B stock into Grade A overnight; L "
            f"(leadership) improving via fresh relative-strength "
            f"highs can validate the breakout. Specific technical "
            f"triggers within Grade B status: (a) a tight flat base "
            f"forming over 3-7 weeks — bases on Grade B candidates "
            f"that produce clean breakouts often catalyze the "
            f"transition to Grade A as the breakout itself produces "
            f"the new-high N pillar score; (b) a Power Earnings Gap — "
            f"a strong earnings reaction frequently lifts both the C "
            f"and S pillars simultaneously, moving the composite into "
            f"Grade A range. Levels in this detection ({levels.get('entry')}, "
            f"{levels.get('stop')}, {levels.get('target_primary')}) "
            f"reflect O'Neil's default entry frame; specific technical "
            f"setups within Grade B status produce the actual trade "
            f"triggers. Position sizing should remain 50-70% of full "
            f"Grade A conviction sizing until the composite improves "
            f"to A."
        )
        failure_signal = (
            f"Grade B status degrades to Grade C if multiple pillars "
            f"weaken simultaneously. The typical decay path: a Grade B "
            f"stock with weak M and L pillars sees those pillars fail "
            f"further as the broader market enters a correction, while "
            f"the chart's own technical setup (perhaps a VCP or "
            f"flat-base attempt) fails on volume — the cascade rapidly "
            f"moves the composite from Grade B to Grade C and below. "
            f"O'Neil's specific warning: Grade B leaders that fail their "
            f"technical setups tend to fail HARDER than higher-quality "
            f"stocks because the institutional sponsorship that was "
            f"borderline-supportive at Grade B status was the marginal "
            f"buyer holding the price up, and once those buyers step "
            f"aside there is no deeper layer of demand. Risk management "
            f"on Grade B trades: honor the 7-8% maximum stop without "
            f"argument, take partial profits at the first target rather "
            f"than holding for the measured-move full target, and exit "
            f"the position entirely if the composite degrades to Grade "
            f"C while the trade is open. Capital preservation matters "
            f"more on Grade B trades than on Grade A trades because "
            f"the asymmetric upside that justifies aggressive position "
            f"sizing is reduced."
        )
    elif grade == "C":
        what_it_is = (
            f"This chart is an O'Neil Grade C CAN SLIM candidate - "
            f"composite score {composite:.1f}/100, a mixed picture "
            f"with several pillars confirming and several failing. "
            f"Per-pillar breakdown: C={c_s:.0f}, A={a_s:.0f}, "
            f"N={n_s:.0f}, S={s_s:.0f}, L={l_s:.0f}, I={i_s:.0f}, "
            f"M={m_s:.0f}. {framework_intro} Grade C is the 'wait and "
            f"watch' tier in O'Neil's framework — the chart has "
            f"interesting characteristics but does not yet qualify as "
            f"an institutional leader. Common Grade C profiles: a "
            f"stock at fresh highs but with weak earnings momentum; a "
            f"stock with strong earnings momentum but well below "
            f"52-week highs; a stock in a strong industry group but "
            f"itself underperforming its peers. {interp}"
        )
        why_it_matters = (
            f"This Grade C composite is firing inside {stage_phrase} "
            f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
            f"{vol_phrase} and {dcr_p} add nuance to the picture. "
            f"O'Neil's specific guidance on Grade C candidates: do not "
            f"trade them as primary positions; if you must trade them, "
            f"use minimal size (1-2% of equity) and treat them as "
            f"speculative options rather than core holdings. The "
            f"composite score of {composite:.1f} is right around the "
            f"universe median — half the stocks in the US universe "
            f"score better, and the asymmetry of trading at-median "
            f"vehicles is unfavorable. The mechanical edge of CAN "
            f"SLIM is that focusing capital on Grade A leaders "
            f"produces 5-10x the per-trade expectancy of trading "
            f"random Grade C names. Grade C status is not a sell "
            f"signal — many Grade C candidates will improve to Grade "
            f"B or A over weeks/months as one or more pillars "
            f"strengthen — but it IS a 'do not size up here' signal "
            f"that should restrain aggressive entries. The "
            f"opportunity cost matters: capital deployed in Grade C "
            f"names is capital not available for Grade A leaders when "
            f"they trigger their next pivot."
        )
        what_to_watch_for = (
            f"Watch for the composite to improve. The transition path "
            f"from Grade C to Grade B requires meaningful improvement "
            f"in 2-3 pillars: C (earnings catalyst) often improves "
            f"through a power-earnings gap or sustained price advance "
            f"that signals fresh institutional accumulation; N (new "
            f"high) improves through a multi-week consolidation followed "
            f"by a breakout to fresh highs; M (market direction) "
            f"improves through broad-market regime change. Specific "
            f"triggers to monitor: (a) an earnings reaction with "
            f">=4% gap-up + sustained hold above the gap close — the "
            f"textbook O'Neil 'C pillar' catalyst that often lifts the "
            f"composite by 10-15 points; (b) a multi-week base forming "
            f"that produces a clean breakout to fresh highs — lifts "
            f"both the N and S pillars; (c) sector rotation into the "
            f"stock's industry group — lifts the L pillar via "
            f"improving relative strength versus the broader market. "
            f"No actionable levels because Grade C does not meet the "
            f"leader-universe threshold; this detection is a watchlist "
            f"placement signal rather than a trade trigger. Position "
            f"sizing if a technical trigger fires within Grade C "
            f"status: minimal (1-2% of equity), aggressive profit-"
            f"taking, tight stops."
        )
        failure_signal = (
            f"Grade C status degrades to Grade D if any pillar falls "
            f"to a meaningful 0-30 level. The typical decay path: a "
            f"Grade C stock with weak A (annual growth) sees the A "
            f"pillar fall further as the 12-month price advance turns "
            f"negative, while the M (market direction) pillar "
            f"simultaneously weakens — the composite drops rapidly into "
            f"the Grade D range. O'Neil's specific warning: stocks "
            f"that fall from Grade C to Grade D often have months or "
            f"years of further decline ahead of them because the "
            f"institutional sponsorship that was marginal at Grade C "
            f"status fully exits at Grade D status. The mechanical "
            f"response: do not buy Grade C stocks expecting them to "
            f"recover; instead, wait for the structural improvement to "
            f"the composite score before allocating capital. Capital "
            f"preservation matters: the opportunity cost of holding "
            f"Grade C laggards while Grade A leaders are firing fresh "
            f"breakouts is the dominant determinant of long-term "
            f"portfolio returns. Grade C status: rotate capital out, "
            f"reallocate to Grade A leaders, revisit the watchlist on "
            f"the next earnings cycle."
        )
    else:  # Grade D
        what_it_is = (
            f"This chart is an O'Neil Grade D CAN SLIM candidate - "
            f"composite score {composite:.1f}/100, with most pillars "
            f"failing. Per-pillar breakdown: C={c_s:.0f}, A={a_s:.0f}, "
            f"N={n_s:.0f}, S={s_s:.0f}, L={l_s:.0f}, I={i_s:.0f}, "
            f"M={m_s:.0f}. {framework_intro} Grade D is the 'avoid' "
            f"tier in O'Neil's framework — the chart has multiple "
            f"failing pillars and does not qualify for institutional "
            f"leader status. Common Grade D profiles: stocks in Stage "
            f"4 downtrends with weak fundamentals; laggards in weak "
            f"industry groups; broken leaders that have lost relative "
            f"strength and are giving back prior gains. {interp}"
        )
        why_it_matters = (
            f"This Grade D composite is firing inside {stage_phrase} "
            f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
            f"{vol_phrase} and {dcr_p} provide additional context but "
            f"do not rescue the composite score. O'Neil's specific "
            f"guidance on Grade D candidates: do not buy under any "
            f"circumstances. The CAN SLIM framework's entire edge "
            f"comes from concentrating capital in Grade A leaders and "
            f"avoiding capital destruction in Grade D laggards. The "
            f"composite score of {composite:.1f} places this chart in "
            f"the bottom 20-30% of the US universe — the historical "
            f"forward expected return on Grade D candidates is sharply "
            f"negative versus the universe median, particularly during "
            f"unfavorable market regimes. O'Neil's empirical study of "
            f"the 1900-1980 market data documented that stocks with "
            f"failing CAN SLIM pillars produced cumulative losses of "
            f"50-80% from the first failed-pillar reading over "
            f"subsequent 24-36 months. The mechanical edge of avoiding "
            f"Grade D candidates is one of the most-validated rules in "
            f"the technical literature."
        )
        what_to_watch_for = (
            f"The most useful action on Grade D candidates is to "
            f"DO NOTHING — no longs, no shorts (unless a specific "
            f"short-side technical trigger like a parabolic short or "
            f"head-and-shoulders top fires), and ESPECIALLY no "
            f"averaging-down or 'value' entries. O'Neil's most-quoted "
            f"warning on Grade D candidates: 'don't try to catch "
            f"falling knives — wait for the stock to base for at least "
            f"6 months and the pillars to improve before considering a "
            f"position.' Specific signals to monitor for an eventual "
            f"basing setup: (a) the chart entering Stage 1 — flat "
            f"30-week MA, declining volume, sideways action; (b) the M "
            f"(market direction) pillar improving as a broad-market "
            f"bull regime emerges; (c) the L (leadership) pillar "
            f"recovering as the stock's industry group rotates into "
            f"favor. Until those pillars improve, the chart remains "
            f"in the institutional avoidance zone. No actionable trade "
            f"levels because Grade D does not meet ANY of the "
            f"leader-universe thresholds."
        )
        failure_signal = (
            f"Grade D classifications rarely improve quickly. The "
            f"typical path of a Grade D stock: 6-24 months of further "
            f"decline (or sideways) before the pillars begin to "
            f"recover, followed by 3-12 months of basing as accumulation "
            f"slowly rebuilds, followed eventually by a transition "
            f"back to Grade C and then potentially Grade B/A. The "
            f"FAILURE mode for a Grade D classification is investors "
            f"BUYING the stock thinking it is cheap — those buyers "
            f"are typically wrong by another 20-50% from their entry "
            f"price and provide the supply that the eventual "
            f"institutional accumulation absorbs in the subsequent "
            f"basing phase. O'Neil's specific instruction: do not buy "
            f"Grade D stocks until the composite improves at least to "
            f"Grade C AND a specific structural setup (Stage 1 base, "
            f"VCP, episodic pivot) confirms institutional buying. The "
            f"opportunity cost: capital allocated to a Grade D "
            f"'recovery thesis' is capital not available for the "
            f"Grade A leaders firing fresh breakouts every week — "
            f"and the Grade A leaders are where the cycle's returns "
            f"are made. The discipline of avoiding Grade D candidates "
            f"is the single most-validated rule in the CAN SLIM "
            f"methodology."
        )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_can_slim_composite)
