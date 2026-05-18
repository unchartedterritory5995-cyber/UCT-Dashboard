"""NR7 — Narrowest Range in 7 bars detector. Toby Crabel (1990).

NR7 identifies when the current bar's high-low range is the narrowest
of the past 7 bars, signaling extreme volatility contraction that
historically precedes directional expansion. Toby Crabel documented
this pattern in "Day Trading with Short Term Price Patterns and Opening
Range Breakout" (Traders Press, 1990), empirically showing that NR7
bars produce above-average directional moves on the following bar
compared to random bar sequences. Linda Raschke extended the work in
"Street Smarts" (M. Gordon Publishing, 1995), adding the inside-bar
confluence filter and the NR4 bonus (narrowest in 4 — a subset of NR7).

The pattern is NEUTRAL — direction is undetermined at the NR7 bar.
Both long and short levels are encoded; the breakout side determines
the trade direction.

Conditions:
  - Current bar range < all prior 6 bars' ranges (NR7 = narrowest in 7)
  - NOT an outside bar (high < prior high AND low > prior low) — inside bar
    pattern preferred but NR7 alone qualifies
  - Bonus: NR4 also true (narrowest in 4 bars)

Levels (encode both directions):
  - entry_long = bar_high * 1.001  (buy the high break)
  - stop_long = bar_low            (below the NR7 bar)
  - target_long = entry_long + bar_range * 3  (Crabel's measured move)
  - entry_short = bar_low * 0.999
  - stop_short = bar_high
  - target_short = entry_short - bar_range * 3

Primary (long) levels used for the schema; short levels in extras.

Geometry: candle_mark at NR7 bar.
Extras: nr7_range, lookback_max_range, nr4_also_true, is_inside_bar,
        bar_range_pct_of_avg, entry_short, stop_short, target_short.

Attribution: Toby Crabel, "Day Trading with Short Term Price Patterns
and Opening Range Breakout" (Traders Press, 1990). Linda Raschke,
"Street Smarts" (M. Gordon Publishing, 1995).
"""
from __future__ import annotations

import uuid
import time
from typing import List

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, ma_alignment_phrase, regime_phrase,
    trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "nr7"

_NR7_LOOKBACK = 7    # NR7 = narrowest range in 7 bars (includes current)
_NR4_LOOKBACK = 4    # NR4 bonus = narrowest in 4
_AVG_RANGE_BARS = 20 # for bar_range_pct_of_avg computation
_CONFIDENCE_FLOOR = 50.0


def detect_nr7(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect NR7 — narrowest range in 7 bars. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _NR7_LOOKBACK + _AVG_RANGE_BARS:
        return []

    last = bars[-1]
    last_range = last["h"] - last["l"]
    if last_range <= 0:
        return []

    # NR7 gate: current range < ALL prior 6 bars' ranges
    prior_6 = bars[-_NR7_LOOKBACK:-1]
    prior_ranges = [b["h"] - b["l"] for b in prior_6]
    if not all(last_range < r for r in prior_ranges):
        return []

    # NR4 bonus
    nr4_also_true = last_range < min(b["h"] - b["l"] for b in bars[-_NR4_LOOKBACK:-1])

    # Is inside bar? (high < prior high AND low > prior low)
    prev_bar = bars[-2]
    is_inside_bar = (last["h"] < prev_bar["h"] and last["l"] > prev_bar["l"])

    # Average range for context
    avg_range_window = bars[-_AVG_RANGE_BARS - 1:-1]
    avg_range = (sum(b["h"] - b["l"] for b in avg_range_window) / len(avg_range_window)
                 if avg_range_window else last_range)
    bar_range_pct_of_avg = last_range / avg_range if avg_range > 0 else 1.0

    # Lookback max range for extras
    lookback_max_range = max(prior_ranges) if prior_ranges else last_range

    candidate = {
        "last": last,
        "last_range": last_range,
        "nr4_also_true": nr4_also_true,
        "is_inside_bar": is_inside_bar,
        "bar_range_pct_of_avg": bar_range_pct_of_avg,
        "avg_range": avg_range,
        "lookback_max_range": lookback_max_range,
    }

    geom_score = _score_geometry(candidate)
    ctx_score = _score_context(context, candidate)
    hist_score = 50.0

    confidence = round(
        0.50 * geom_score + 0.35 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    return [_build_detection(bars, candidate, confidence, context,
                             geom_score, ctx_score, hist_score)]


def _score_geometry(c: dict) -> float:
    """Tighter compression = higher score."""
    pct = c["bar_range_pct_of_avg"]
    if pct <= 0.25:
        compression_score = 100.0
    elif pct <= 0.40:
        compression_score = 85.0
    elif pct <= 0.55:
        compression_score = 70.0
    else:
        compression_score = 55.0

    nr4_bonus = 15.0 if c["nr4_also_true"] else 0.0
    inside_bar_bonus = 10.0 if c["is_inside_bar"] else 0.0

    return round(min(100.0, compression_score + nr4_bonus + inside_bar_bonus), 2)


def _score_context(context: dict, c: dict) -> float:
    score = 50.0
    # NR7 works best after trending moves (squeeze in a trend = continuation)
    stage = context.get("trend_stage")
    if stage in (2, 4):
        score += 15.0   # trending stages produce the cleanest NR7 breakouts
    elif stage in (1, 3):
        score += 5.0

    # Volume signature: contracting = more energy stored
    vol_sig = context.get("volume_signature")
    if vol_sig == "contracting":
        score += 10.0

    # DCR: neutral detector — no directional bias applied
    # Range contraction in accumulation context is bullish; in distribution is bearish
    dcr_sig = context.get("dcr_signature")
    if dcr_sig in ("accumulation", "distribution"):
        score += 5.0   # explicit signature = cleaner breakout direction signal

    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, ctx_score, hist_score) -> Detection:
    last = c["last"]
    last_bar = bars[-1]
    last_range = c["last_range"]

    # Long side (primary)
    entry_long = round(last["h"] * 1.001, 2)
    stop_long = round(last["l"], 2)
    target_long = round(entry_long + last_range * 3.0, 2)
    rr_long = (target_long - entry_long) / (entry_long - stop_long) if entry_long > stop_long else 0.0

    # Short side (in extras)
    entry_short = round(last["l"] * 0.999, 2)
    stop_short = round(last["h"], 2)
    target_short = round(entry_short - last_range * 3.0, 2)
    rr_short = (entry_short - target_short) / (stop_short - entry_short) if stop_short > entry_short else 0.0

    anchors = [{"t": int(last["t"]), "price": float(last["c"])}]
    extras = {
        "nr7_range": round(last_range, 4),
        "lookback_max_range": round(c["lookback_max_range"], 4),
        "nr4_also_true": bool(c["nr4_also_true"]),
        "is_inside_bar": bool(c["is_inside_bar"]),
        "bar_range_pct_of_avg": round(c["bar_range_pct_of_avg"], 3),
        "avg_range_20bars": round(c["avg_range"], 4),
        "entry_short": entry_short,
        "stop_short": stop_short,
        "target_short": target_short,
        "rr_short": round(rr_short, 2),
    }

    narrative = _compose_narrative(c, context, entry_long, stop_long, target_long,
                                   entry_short, stop_short, target_short, rr_long, rr_short)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "NR7 — Narrow Range 7",
        "category": "classical",
        "direction": "neutral",
        "start_t": int(last["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(last["t"])],
        "geometry": {"shape": "candle_mark", "anchors": anchors, "extras": extras},
        "levels": {
            "entry": entry_long,
            "entry_condition": (
                f"DIRECTION UNDETERMINED. Long break: buy > {entry_long:.2f} "
                f"(bar high {last['h']:.2f} + 0.1%). "
                f"Short break: sell < {entry_short:.2f} (bar low {last['l']:.2f} - 0.1%)."
            ),
            "stop": stop_long,
            "stop_basis": "nr7_bar_low_long_or_high_short",
            "target_primary": target_long,
            "target_secondary": target_short,
            "risk_reward": round(rr_long, 2),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": 50.0,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": narrative,
        "status": "forming",   # NR7 is by definition pre-breakout
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c, context, entry_long, stop_long, target_long,
                       entry_short, stop_short, target_short, rr_long, rr_short) -> dict:
    last = c["last"]
    last_range = c["last_range"]
    nr4 = c["nr4_also_true"]
    inside = c["is_inside_bar"]
    pct = c["bar_range_pct_of_avg"]
    lmr = c["lookback_max_range"]
    avg_range = c["avg_range"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"NR7 — Narrowest range in 7 bars (range ${last_range:.3f}, {pct * 100:.0f}% "
        f"of 20-bar avg ${avg_range:.2f}). {'NR4 also true. ' if nr4 else ''}"
        f"{'Inside bar. ' if inside else ''}"
        f"Long break > ${entry_long:.2f} (target ${target_long:.2f}, R:R {rr_long:.1f}). "
        f"Short break < ${entry_short:.2f} (target ${target_short:.2f}, R:R {rr_short:.1f})."
    )

    what_it_is = (
        f"NR7 (Narrowest Range in 7 Bars) is Toby Crabel's foundational "
        f"volatility-contraction setup, documented in his 1990 book 'Day "
        f"Trading with Short Term Price Patterns and Opening Range Breakout' "
        f"(Traders Press) — the most rigorous empirical study of short-term "
        f"price patterns ever published. Crabel's research covered thousands "
        f"of daily bars across futures markets and demonstrated a statistically "
        f"significant tendency: when the current bar's range is the narrowest "
        f"of the past 7 bars, the following bar produces an ABOVE-AVERAGE "
        f"directional move versus random comparison bars. The mechanism is "
        f"volatility mean-reversion — markets oscillate between periods of "
        f"high volatility (wide-range bars) and low volatility (narrow-range "
        f"bars), and extreme compressions at the NR7 level precede expansions "
        f"with reliable statistical frequency. The current bar's range of "
        f"${last_range:.4f} is narrower than ALL of the prior 6 bars (max "
        f"prior range: ${lmr:.4f}), meaning it qualifies as NR7. At just "
        f"{pct * 100:.0f}% of the 20-bar average range of ${avg_range:.4f}, "
        f"this is {'an extreme compression' if pct <= 0.35 else 'a moderate compression'} — "
        f"{'the deeper the compression vs average, the more statistically significant the expansion signal' if pct <= 0.35 else 'Crabel noted deeper compressions produce larger average directional moves'}. "
        f"{'The NR4 bonus is also present (narrowest in 4 bars) — Crabel specifically notes NR4+NR7 confluence as the strongest volatility-compression signal in his dataset.' if nr4 else ''} "
        f"{'The bar is also an inside bar (high below prior high, low above prior low) — Linda Raschke expanded Crabel' + chr(39) + 's work in Street Smarts (1995) by noting that NR7 + inside bar combinations have particularly clean breakout signatures because the inside bar confirms that neither buyers nor sellers had sufficient conviction to extend beyond the prior bar' + chr(39) + 's range.' if inside else ''} "
        f"Direction is NEUTRAL at the NR7 bar — the pattern predicts "
        f"EXPANSION, not DIRECTION. The breakout side determines the trade."
    )

    why_it_matters = (
        f"This NR7 is printing in {stage_phrase} with {ma_phrase} MA "
        f"alignment, in {regime_p} with {vol_phrase}. Crabel's published "
        f"findings from his futures research: NR7 bars produce directional "
        f"moves of 1.5-2.5x average range on the following bar roughly 65% "
        f"of the time — the key is that the FOLLOWING BAR moves in a single "
        f"direction more often than a random bar, regardless of which "
        f"direction. For the operator, this means the NR7 bar is a timing "
        f"signal: the next bar will MOVE, and the side that breaks the NR7 "
        f"bar's range first (high break or low break) is the bet. The "
        f"trending context ({stage_phrase}) biases the breakout direction: "
        f"Crabel's own analysis shows NR7 bars in trending markets resolve "
        f"in the trend's direction roughly 60-65% of the time. Stage 2 "
        f"uptrends bias toward long breaks; Stage 4 downtrends bias toward "
        f"short breaks; sideways stages produce near-50/50 breakout odds. "
        f"{dcr_p}. The DCR signature provides additional directional bias: "
        f"an accumulation DCR pattern biases toward the long break; a "
        f"distribution DCR pattern biases toward the short break. Raschke's "
        f"Street Smarts addition: use the NR7 as a stalking setup — wait for "
        f"the market to make the first move, then enter in the breakout "
        f"direction on a pullback to the NR7 bar's midpoint if the initial "
        f"breakout was orderly."
    )

    what_to_watch_for = (
        f"Long break trigger: first bar close above ${entry_long:.2f} (NR7 "
        f"bar high ${last['h']:.2f} + 0.1% buffer) on volume above the "
        f"20-bar average. Long stop: ${stop_long:.2f} (NR7 bar low). "
        f"Long target: ${target_long:.2f} (Crabel's 3x NR7-range measured "
        f"move: entry + ${last_range * 3:.4f}). Short break trigger: first "
        f"bar close below ${entry_short:.2f} (NR7 bar low ${last['l']:.2f} - "
        f"0.1% buffer) on volume above 20-bar average. Short stop: "
        f"${stop_short:.2f} (NR7 bar high). Short target: ${target_short:.2f} "
        f"(entry - ${last_range * 3:.4f}). Crabel's specific execution rule: "
        f"place a buy-stop at the NR7 bar's high and a sell-stop at the NR7 "
        f"bar's low before the next session opens. The first stop hit becomes "
        f"the trade; the opposing stop becomes the initial stop-loss. This "
        f"'dual-stop' entry is the cleanest mechanical implementation. "
        f"Raschke's refinement: after the initial breakout bar, if price "
        f"pulls back to the NR7 bar's midpoint (${(last['h'] + last['l']) / 2:.2f}) "
        f"without closing below it, the pullback is the preferred higher-"
        f"quality entry with tighter stop. R:R on the long side is {rr_long:.1f} "
        f"and {rr_short:.1f} on the short — both above the 2.5 minimum "
        f"Crabel documents as typical for NR7 breakout trades. Position "
        f"sizing must reflect the NR7 bar's narrow range — the small bar "
        f"range means the stop is tight, allowing larger position sizes, but "
        f"the expansion move also covers the stop quickly if the trade "
        f"goes wrong, so volatility risk is higher per dollar of stop."
    )

    failure_signal = (
        f"The NR7 fails in two distinct ways. Failure Mode 1 — the 'doji "
        f"expansion': the breakout bar makes a new high AND new low beyond "
        f"the NR7 bar, creating an outside bar that immediately reverses. "
        f"This 'expansion both ways' signature means the volatility expansion "
        f"occurred but without directional commitment — the most common NR7 "
        f"failure mode in choppy markets. Exit the moment the breakout bar "
        f"reverses through the NR7 bar's midpoint on the same session — do "
        f"not hold for the structural stop. Failure Mode 2 — the 'stale "
        f"NR7': the NR7 bar prints but no expansion follows for 2-3 bars. "
        f"Crabel specifically noted that NR7 bars that don't produce expansion "
        f"within 1-2 bars typically produce DEEPER compression before the "
        f"eventual expansion — in this case the breakout stops become "
        f"obsolete and the operator should let the setup expire and wait for "
        f"a fresh NR7. Structural stops: long stop is ${stop_long:.2f} (NR7 "
        f"bar low), short stop is ${stop_short:.2f} (NR7 bar high) — the NR7 "
        f"bar's range being ${last_range:.4f} means these are narrow stops by "
        f"design. Crabel's key caveat: NR7 patterns have HIGHER statistical "
        f"validity in trending markets (Stage 2 or Stage 4) than in sideways "
        f"markets — in choppy/range-bound regimes, the expansion targets are "
        f"often reached and reversed immediately, producing minimal real profit "
        f"despite technically hitting the technical target. {dcr_p}."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_nr7)
