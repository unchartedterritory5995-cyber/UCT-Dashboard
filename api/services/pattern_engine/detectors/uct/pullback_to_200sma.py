"""Pullback to 200-SMA detector — Weinstein Stage 2 major-trend retest.

Stan Weinstein's seminal 'Secrets For Profiting In Bull And Bear Markets'
(Dow Jones-Irwin, 1988) codified the four-stage cycle (1=accumulation,
2=advance, 3=distribution, 4=decline) and pinned the institutional
re-entry zone of a Stage 2 advance to the test of the 30-week (≈150-day,
practically the 200-day) moving average. The rising 200-SMA is the
'institutional plimsoll line' — the level at which pension funds,
endowments, and CTAs make the explicit decision to defend or abandon
a position in a leadership name. Mark Minervini's SEPA system (Trade
Like a Stock Market Wizard, 2013) carries the same principle: deep
pullbacks to the rising 200-day in a confirmed leader are the highest-
edge MAJOR-trend re-entry trade, distinct from O'Neil's 50-SMA second
buy point (shallower test) or Minervini's 21-EMA SEPA primary support
(shallowest test).

Conditions:
  - Stage 2 uptrend with rising 200-SMA
  - Stock has prior >=40% advance from Stage 2 entry (deeper qualifier
    than the 50-SMA test because the 200-day test is a major-trend retest)
  - Bar's low touches/tests the 200-SMA (within 3%)
  - Close back above 200-SMA within 1-5 bars (wider reclaim window than
    50-SMA because deep tests take longer to base + reclaim)
  - Volume on test moderate; reclaim shows volume expansion
  - Stacked bullish (close > 10 > 20 > 50 > 200 prior to test, close >
    200 on reclaim)

Levels:
  - entry = test_bar_high * 1.001
  - stop = 200-SMA - 1 ATR (wider stop than 50-SMA stop because deeper
    test demands wider technical tolerance)
  - target = entry + (prior_advance_height * 0.5) — substantial extension

Geometry: "horizontal_line" at 200-SMA value.

Attribution: Stan Weinstein, "Secrets For Profiting In Bull And Bear
Markets" (1988) — Stage 2 advance often retests the 30-week MA.
Mark Minervini variant: deep-pullback re-entry while context.trend_stage
remains 2 and the stock retains leadership characteristics.
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


_PATTERN_ID = "pullback_to_200sma"

_SMA_PERIOD = 200
_PULLBACK_LOOKBACK = 8                  # wider scan window than 50-SMA (5)
_SMA_TOUCH_TOLERANCE_PCT = 0.03         # within 3% of 200-SMA (vs 2% for 50-SMA)
_RECLAIM_LAG = 5                        # close back above within 1-5 bars
_MIN_PRIOR_ADVANCE_PCT = 0.40           # 40%+ prior advance required (Weinstein/Minervini)
_PRIOR_ADVANCE_LOOKBACK = 200           # search up to 200 bars back (major trend)
_CONFIDENCE_FLOOR = 50.0


def detect_pullback_to_200sma(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Weinstein/Minervini deep pullback to 200-SMA. Emits 0 or 1 detection."""
    n = len(bars)
    # Need 200-SMA period + 20 bars for slope + 50 bars buffer
    if n < _SMA_PERIOD + 70:
        return []

    if context.get("trend_stage") != 2:
        return []
    if context.get("ma_alignment") != "stacked_bullish":
        return []

    closes = [b["c"] for b in bars]
    sma200 = _sma(closes, _SMA_PERIOD)
    if sma200 is None:
        return []

    # 200-SMA must be RISING — Weinstein's structural confirmation that the
    # major-trend reference is still in markup phase
    sma200_past = _sma(closes[:-20], _SMA_PERIOD) if n >= _SMA_PERIOD + 20 else None
    if sma200_past is None or sma200_past >= sma200:
        return []

    # Prior advance: must be >=40% in the recent lookback window
    last_close = bars[-1]["c"]
    lookback_window = bars[-_PRIOR_ADVANCE_LOOKBACK:] if n >= _PRIOR_ADVANCE_LOOKBACK else bars
    prior_low = min(b["l"] for b in lookback_window)
    prior_high = max(b["h"] for b in lookback_window)
    prior_advance_pct = (prior_high - prior_low) / prior_low if prior_low > 0 else 0.0
    if prior_advance_pct < _MIN_PRIOR_ADVANCE_PCT:
        return []
    prior_low_idx = None
    for i, b in enumerate(lookback_window):
        if b["l"] == prior_low:
            prior_low_idx = n - len(lookback_window) + i
            break
    prior_advance_bars = (n - 1) - prior_low_idx if prior_low_idx is not None else len(lookback_window)

    # Find the test bar (low touches/tests the 200-SMA within tolerance)
    pullback_bar_idx = None
    pullback_low = None
    for back in range(_PULLBACK_LOOKBACK):
        idx = n - 1 - back
        if idx < _SMA_PERIOD:
            break
        b = bars[idx]
        if b["l"] <= sma200 * (1.0 + _SMA_TOUCH_TOLERANCE_PCT):
            pullback_bar_idx = idx
            pullback_low = b["l"]
            break
    if pullback_bar_idx is None:
        return []

    pullback_bar = bars[pullback_bar_idx]
    # Find the reclaim bar (closes above SMA within 1-5 bars after test)
    reclaim_bar_idx = None
    for j in range(pullback_bar_idx, min(pullback_bar_idx + 1 + _RECLAIM_LAG, n)):
        if bars[j]["c"] > sma200:
            reclaim_bar_idx = j
            break
    if reclaim_bar_idx is None:
        return []

    # Volume on test should be moderate; reclaim should show expansion
    lookback_start = max(0, pullback_bar_idx - 20)
    lookback = bars[lookback_start:pullback_bar_idx]
    if not lookback:
        return []
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        return []
    test_vol_ratio = pullback_bar["v"] / avg_vol
    reclaim_vol_ratio = bars[reclaim_bar_idx]["v"] / avg_vol

    # Test volume must not be panic-distribution heavy (Weinstein: a panicky
    # high-volume break of the 30-week is THE signal to exit, not buy)
    if test_vol_ratio > 1.5:
        return []
    # Reclaim must show explicit volume return (>=1.0x — institutional defense)
    if reclaim_vol_ratio < 0.9:
        return []

    atr14 = _atr(bars[-15:])
    if atr14 <= 0:
        return []
    prior_advance_height = prior_high - prior_low
    distance_to_sma_pct = abs(pullback_low - sma200) / sma200 * 100.0 if sma200 > 0 else 0.0

    sq = compute_structure_quality(bars, pullback_bar_idx, pullback_low)

    candidate = {
        "pullback_bar_idx": pullback_bar_idx,
        "pullback_low": pullback_low,
        "pullback_high": pullback_bar["h"],
        "pullback_close": pullback_bar["c"],
        "reclaim_bar_idx": reclaim_bar_idx,
        "sma_200": sma200,
        "sma_200_slope_pct_over_20": (sma200 - sma200_past) / sma200_past * 100.0,
        "test_volume_ratio": test_vol_ratio,
        "reclaim_volume_ratio": reclaim_vol_ratio,
        "distance_to_sma_pct": distance_to_sma_pct,
        "atr14": atr14,
        "prior_advance_pct": prior_advance_pct * 100.0,
        "prior_advance_bars": prior_advance_bars,
        "prior_advance_height": prior_advance_height,
        "prior_low": prior_low,
        "prior_high": prior_high,
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


def _sma(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _atr(bars: List[Bar]) -> float:
    if not bars:
        return 0.0
    if len(bars) == 1:
        return bars[0]["h"] - bars[0]["l"]
    trs = []
    for i in range(1, len(bars)):
        b = bars[i]
        pc = bars[i - 1]["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _score_geometry(c: dict) -> float:
    sma200 = c["sma_200"]
    pullback_low = c["pullback_low"]
    dist_pct = abs(pullback_low - sma200) / sma200 * 100.0 if sma200 > 0 else 100.0
    # Touch quality: ideal test is right at the 200-SMA
    if dist_pct <= 0.75:
        touch_score = 100.0
    elif dist_pct <= 1.5:
        touch_score = 85.0
    elif dist_pct <= 3.0:
        touch_score = 70.0
    else:
        touch_score = 50.0

    # 200-SMA slope: Weinstein wants rising — steeper is stronger
    slope_pct = c["sma_200_slope_pct_over_20"]
    if slope_pct >= 2.0:
        slope_score = 100.0
    elif slope_pct >= 1.0:
        slope_score = 80.0
    elif slope_pct >= 0.3:
        slope_score = 60.0
    else:
        slope_score = 30.0

    # Prior advance: 40%+ minimum; deeper advance = stronger leadership confirmation
    adv = c["prior_advance_pct"]
    if adv >= 100.0:
        advance_score = 100.0
    elif adv >= 70.0:
        advance_score = 85.0
    elif adv >= _MIN_PRIOR_ADVANCE_PCT * 100.0:
        advance_score = 70.0
    else:
        advance_score = 40.0

    base = 0.40 * touch_score + 0.30 * slope_score + 0.30 * advance_score
    base += structure_geom_boost(c)
    return round(min(100.0, base), 2)


def _score_volume(c: dict) -> float:
    """Weinstein/Minervini: moderate test volume + expanding reclaim volume."""
    test = c["test_volume_ratio"]
    reclaim = c["reclaim_volume_ratio"]

    # Test should be moderate — too heavy = distribution panic
    if test <= 0.8:
        test_score = 100.0
    elif test <= 1.1:
        test_score = 80.0
    elif test <= 1.3:
        test_score = 60.0
    else:
        test_score = 40.0

    if reclaim >= 1.5:
        reclaim_score = 100.0
    elif reclaim >= 1.2:
        reclaim_score = 85.0
    elif reclaim >= 1.0:
        reclaim_score = 70.0
    elif reclaim >= 0.9:
        reclaim_score = 55.0
    else:
        reclaim_score = 30.0

    return round(0.50 * test_score + 0.50 * reclaim_score, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("rs_trend") == "up":
        score += 15.0
    elif context.get("rs_trend") == "flat":
        score += 5.0
    score += _dcr_score_adjustment(context)
    score += _can_slim_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _can_slim_score_adjustment(context: dict) -> float:
    grade = context.get("can_slim_grade", "C")
    score = context.get("can_slim_score", 50) or 50
    # CAN SLIM boost on this continuation pattern: +15 Grade A, +8 Grade B
    if grade == "A" and score >= 80:
        return 15.0
    if grade == "B" and score >= 65:
        return 8.0
    return 0.0


def _dcr_score_adjustment(context: dict) -> float:
    # DCR scoring: +12 accumulation / -8 distribution (bullish detector)
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0
    if dcr_sig == "distribution":
        return -8.0
    return 0.0


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    pullback_bar = bars[c["pullback_bar_idx"]]
    sma200 = c["sma_200"]
    atr14 = c["atr14"]

    entry = round(c["pullback_high"] * 1.001, 2)
    # Wider stop than 50-SMA: 200-SMA minus 1 ATR (the major trend can swing
    # an extra ATR without breaking the leadership thesis)
    stop = round(sma200 - 1.0 * atr14, 2)
    # Target: 50% of prior advance projected from entry — substantial
    # extension reflecting the major-trend re-entry edge
    target = round(entry + c["prior_advance_height"] * 0.5, 2)
    rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
    stop_distance_pct = ((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    anchors = [{"t": int(last_bar["t"]), "price": float(sma200)}]
    pivot_ts = [int(pullback_bar["t"]), int(last_bar["t"])]

    extras = {
        "sma_200_value": round(sma200, 4),
        "sma_200_slope_pct_over_20": round(c["sma_200_slope_pct_over_20"], 3),
        "prior_advance_pct": round(c["prior_advance_pct"], 2),
        "prior_advance_bars": int(c["prior_advance_bars"]),
        "test_bar_idx": int(c["pullback_bar_idx"]),
        "test_bar_low": round(c["pullback_low"], 2),
        "test_bar_high": round(c["pullback_high"], 2),
        "test_bar_close": round(c["pullback_close"], 2),
        "distance_to_sma_pct": round(c["distance_to_sma_pct"], 3),
        "reclaim_bar_idx": int(c["reclaim_bar_idx"]),
        "test_volume_ratio": round(c["test_volume_ratio"], 3),
        "reclaim_volume_ratio": round(c["reclaim_volume_ratio"], 3),
        "atr14": round(atr14, 4),
        "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
        **structure_extras(c),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct, atr14)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Pullback to 200-SMA (Weinstein Stage 2 Retest)",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(bars[max(0, c["pullback_bar_idx"] - 40)]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "horizontal_line",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (test bar high + 0.1%)",
            "stop": stop,
            "stop_basis": "200sma_minus_1_ATR",
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


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, rr: float, stop_distance_pct: float,
                       atr14: float) -> dict:
    sma200 = c["sma_200"]
    test_vol = c["test_volume_ratio"]
    reclaim_vol = c["reclaim_volume_ratio"]
    pullback_low = c["pullback_low"]
    pullback_high = c["pullback_high"]
    prior_adv = c["prior_advance_pct"]
    prior_bars = c["prior_advance_bars"]
    slope_pct = c["sma_200_slope_pct_over_20"]
    dist_pct = c["distance_to_sma_pct"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Pullback to 200-SMA (Weinstein Stage 2 Retest) - rising 200-day at "
        f"${sma200:.2f} (slope {slope_pct:.2f}% over 20 bars), prior advance "
        f"{prior_adv:.0f}% over {prior_bars} bars, test {dist_pct:.2f}% from "
        f"the 200-day on {test_vol * 100:.0f}% volume, reclaim on "
        f"{reclaim_vol * 100:.0f}% volume. Pivot ${entry:.2f}, target "
        f"${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Pullback to 200-SMA is Stan Weinstein's classic Stage 2 major-"
        f"trend retest, codified in 'Secrets For Profiting In Bull And Bear "
        f"Markets' (Dow Jones-Irwin, 1988) and refined by Mark Minervini in "
        f"'Trade Like A Stock Market Wizard' (McGraw-Hill, 2013). Weinstein's "
        f"four-stage cycle teaches that a confirmed Stage 2 advance — the "
        f"institutional markup phase — periodically retests the rising 30-"
        f"week moving average (practically the 200-day SMA) as portfolio "
        f"managers, CTAs, and pension funds re-evaluate position exposure "
        f"against the major-trend reference. Here, the stock has advanced "
        f"{prior_adv:.0f}% over {prior_bars} bars from its Stage 2 entry — "
        f"comfortably above the 40% threshold that qualifies the name as a "
        f"major-trend leader worth re-entering on a deep test. The 200-day "
        f"moving average sits at ${sma200:.2f} and is rising at "
        f"{slope_pct:.2f}% over the trailing 20 bars — the structural slope "
        f"confirming that the institutional plimsoll line is still in markup "
        f"orientation. The test bar's low at ${pullback_low:.2f} pulled "
        f"within {dist_pct:.2f}% of the 200-day on volume "
        f"{test_vol * 100:.0f}% of the 20-bar average — moderate, "
        f"absorptive, NOT the panic-distribution volume signature Weinstein "
        f"explicitly warns is the signal to EXIT a Stage 2 position. The "
        f"reclaim bar closed back above the 200-day on volume "
        f"{reclaim_vol * 100:.0f}% of average — explicit institutional "
        f"defense of the major-trend reference, the Weinstein signature of a "
        f"continuation rather than a stage transition. Weinstein's framework "
        f"distinguishes this 200-day test from O'Neil's 50-SMA second buy "
        f"point (a shallower swing-trade reference) and from Minervini's 21-"
        f"EMA SEPA pullback (the shallowest fastest-momentum reference). The "
        f"200-day is the MAJOR-trend retest — the level where the structural "
        f"thesis (Stage 2 markup continues) is either confirmed in a single "
        f"bar or invalidated cleanly, no in-between."
    )

    why_it_matters = (
        f"This Weinstein major-trend setup is firing inside {stage_phrase} "
        f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. The "
        f"{prior_adv:.0f}% prior advance qualifies the stock as a major-"
        f"trend leader — Weinstein's published research from his decades of "
        f"newsletter publication (Professional Tape Reader, 1979-2005) is "
        f"unambiguous that the highest-edge deep-pullback re-entries are "
        f"those in stocks that have already proven they can run substantially "
        f"in Stage 2, not in names trying to break out of Stage 1 bases. "
        f"{vol_phrase} on the test bar is the institutional absorption "
        f"fingerprint — the same behavior Weinstein documented across "
        f"hundreds of charts as the difference between a healthy retest and "
        f"a Stage 3 distribution event. {dcr_p} "
        f"{dcr_interpretation(context, 'bullish')} The expanding-volume "
        f"reclaim at {reclaim_vol * 100:.0f}% of average is THE explicit "
        f"signal both Weinstein and Minervini look for — without volume "
        f"expansion on the reclaim, the test could be a dead-cat bounce "
        f"before a Stage 3 transition; with it, institutional capital is "
        f"overtly defending the major-trend reference. The structural edge "
        f"of the 200-day comes from three reinforcing dynamics: (1) the "
        f"200-day is THE single most-watched moving average in equity "
        f"markets, with both institutional and retail attention focused on "
        f"its slope and price relationship; (2) the 200-day defines Stage "
        f"membership in Weinstein's framework — Stage 2 names trade above "
        f"a rising 200-day, Stage 4 names trade below a falling 200-day, "
        f"and the transition between stages is THE highest-impact moment in "
        f"a stock's multi-year cycle; (3) the asymmetric reward profile is "
        f"clean and structural — a {stop_distance_pct:.2f}% stop distance "
        f"against the 50%-of-prior-advance target produces R:R {rr:.1f}, "
        f"reflecting the substantial extension typical of major-trend re-"
        f"entries that resolve cleanly. {structure_narrative_sentence(c)}"
    ).strip()

    what_to_watch_for = (
        f"Trigger: a close above ${entry:.2f} (test bar high "
        f"${pullback_high:.2f} plus a 0.1% confirmation buffer). The ideal "
        f"trigger bar prints on volume at or above the 20-bar average — "
        f"Minervini's 'follow-through volume' requirement for confirming a "
        f"major-trend re-entry. The ATR(14) of {atr14:.4f} sets the stop: "
        f"${stop:.2f} sits a full ATR below the 200-SMA — wider than the "
        f"50-SMA half-ATR stop because the 200-day test is structurally "
        f"deeper and demands wider technical tolerance. The deeper stop "
        f"reflects Weinstein's explicit guidance that Stage 2 names "
        f"frequently overshoot the 30-week MA by one normalized-volatility "
        f"unit before reclaiming. The target at ${target:.2f} reflects "
        f"Weinstein's measurement: 50% of the prior advance height "
        f"(${c['prior_advance_height']:.2f}) projected from entry — "
        f"substantial extension reflecting that major-trend re-entries "
        f"typically run 50-100% of the prior leg before the next "
        f"meaningful consolidation. Position sizing should reflect the "
        f"{stop_distance_pct:.2f}% stop distance — risking 1% of account "
        f"on the trade implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position. Weinstein's specific execution rules for "
        f"the 30-week test: (a) take the trade only in stocks with rising "
        f"200-day AND prior advance >=40% — the major-trend re-entry edge "
        f"requires confirmed leadership; (b) trail the stop up to the 50-"
        f"day as price recovers (Weinstein's 'tighten the stop as Stage 2 "
        f"re-accelerates'); (c) exit at the first weekly close back below "
        f"the 200-day on rising volume — that print signals Stage 2 to "
        f"Stage 3 transition; (d) clean 200-day re-entries typically "
        f"resolve within 15-40 bars to the target. Minervini's overlay: "
        f"watch the 50-day relative to the 200-day — if 50 crosses BELOW "
        f"200 within 10 bars of the re-entry, exit regardless of price "
        f"behavior because the moving-average architecture has degraded."
    )

    failure_signal = (
        f"The 200-SMA test is invalidated if price closes below ${stop:.2f} "
        f"(200-SMA minus 1 ATR) — that signals the institutional bid at the "
        f"major-trend reference has stepped aside, and the Stage 2 "
        f"continuation thesis is broken. Weinstein's hard discipline: 'A "
        f"break of the 30-week MA on rising volume is THE signal to exit' — "
        f"regardless of any other factor. If the test bar AND the reclaim "
        f"bar both print with volume >=1.8x the 20-bar average AND the "
        f"reclaim closes below the prior pivot low, that is a Stage 2-to-"
        f"Stage 3 transition signature and the position should be cut "
        f"immediately. A subtler failure: the trigger fires above "
        f"${entry:.2f} but the next 10-15 bars consolidate against the "
        f"200-day rather than extending — this 'failed major-trend re-"
        f"entry' often precedes a deeper drawdown to retest the prior "
        f"swing low, and the prudent response is to exit on the first bar "
        f"that closes back below the 200-day with above-average volume. "
        f"The deepest invalidation: the stock's leadership characteristics "
        f"degrade post-trigger (RS line breaks down, the 50-day flattens "
        f"and crosses BELOW the 200-day, or volume signature degrades from "
        f"accumulation to distribution) — when that happens, the position "
        f"should be reduced even if the price stop hasn't fired, because "
        f"the structural Stage 2 thesis has degraded. Weinstein's published "
        f"track record from the Professional Tape Reader newsletter was "
        f"built on this discipline: NEVER widen the 30-week stop, NEVER "
        f"average into a failing major-trend re-entry, and ALWAYS treat "
        f"the rising-200-day requirement as binary — either it's rising "
        f"and the trade is alive, or it has flattened and the major-trend "
        f"thesis is dead. The trader who treats the 200-day reference as "
        f"'flexible' will give back the substantial reward this setup "
        f"offers over many trades — the deep retest IS the trade, but only "
        f"when the discipline of the underlying Stage 2 framework is "
        f"honored."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_pullback_to_200sma)
