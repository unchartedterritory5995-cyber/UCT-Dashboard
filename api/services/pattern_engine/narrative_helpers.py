"""Shared narrative composition helpers for pattern detectors.

These functions render specific Context fields into prose phrases that
detectors weave into their narrative dicts. Centralized here so every
detector uses identical phrasing for the *canonical* (uncustomized) case.

NOTE: many existing detectors carry *customized* variants of these helpers
that embed pattern-specific phrasing (e.g. "(textbook triple-bottom
reversal setup)"). Those local variants are intentionally left in place
and marked with a "# Custom variant — does not match shared narrative_helpers"
comment in their source file. New detectors should import from this module
instead of rolling their own.

The canonical helpers here take simple scalar inputs (Optional[str], int,
float) rather than the full context dict, which keeps them ergonomic for
direct unit testing.
"""
from __future__ import annotations

from typing import Optional


def ma_alignment_phrase(ma_alignment: Optional[str]) -> str:
    """Render context.ma_alignment as a prose phrase.

    Examples:
      "stacked_bullish" -> "fully stacked-bullish (close > 10 > 20 > 50 > 200)"
      "mixed"           -> "mixed (no clear stacking)"
      "stacked_bearish" -> "fully stacked-bearish (close < 10 < 20 < 50 < 200)"
      None              -> "unknown"
    """
    if ma_alignment == "stacked_bullish":
        return "fully stacked-bullish (close > 10 > 20 > 50 > 200)"
    if ma_alignment == "stacked_bearish":
        return "fully stacked-bearish (close < 10 < 20 < 50 < 200)"
    if ma_alignment == "mixed":
        return "mixed (no clear stacking)"
    return "unknown"


def trend_stage_description(stage: Optional[int]) -> str:
    """Weinstein stage number -> descriptive phrase.

    Stage 1 -> "a Stage 1 base/accumulation environment (counter-trend caution)"
    Stage 2 -> "a confirmed Stage 2 uptrend"
    Stage 3 -> "a Stage 3 distribution/topping environment"
    Stage 4 -> "a Stage 4 markdown/decline environment"
    """
    if stage == 1:
        return "a Stage 1 base/accumulation environment (counter-trend caution)"
    if stage == 2:
        return "a confirmed Stage 2 uptrend"
    if stage == 3:
        return "a Stage 3 distribution/topping environment"
    if stage == 4:
        return "a Stage 4 markdown/decline environment"
    return "an undetermined trend stage"


def rs_trend_phrase(rs_trend: Optional[str]) -> str:
    """context.rs_trend -> prose phrase.

    "up"   -> "improving relative strength versus the broader market"
    "flat" -> "neutral relative strength versus the broader market"
    "down" -> "weakening relative strength versus the broader market"
    """
    if rs_trend == "up":
        return "improving relative strength versus the broader market"
    if rs_trend == "down":
        return "weakening relative strength versus the broader market"
    return "neutral relative strength versus the broader market"


def dcr_phrase(dcr_signature: Optional[str], recent_dcr_avg: Optional[float]) -> str:
    """context.dcr_signature + context.recent_dcr_avg -> prose phrase.

    Examples:
      "accumulation" + 0.72 -> "DCR signature: accumulation (recent close-in-range avg 72%)"
      "distribution" + 0.30 -> "DCR signature: distribution (recent close-in-range avg 30%)"
      "neutral"      + 0.50 -> "DCR signature: neutral (recent close-in-range avg 50%)"
      "neutral"      + None -> "DCR signature: neutral"
    """
    sig = dcr_signature or "unknown"
    if recent_dcr_avg is not None:
        return f"DCR signature: {sig} (recent close-in-range avg {recent_dcr_avg * 100:.0f}%)"
    return f"DCR signature: {sig}"


def regime_phrase(regime: Optional[str]) -> str:
    """context.regime -> prose phrase.

    "bull"        -> "a bull regime"
    "bear"        -> "a bear regime"
    "choppy"      -> "a choppy/range-bound regime"
    "transition"  -> "a transitional regime"
    None / other  -> "the current market regime"
    """
    if regime == "bull":
        return "a bull regime"
    if regime == "bear":
        return "a bear regime"
    if regime == "choppy":
        return "a choppy/range-bound regime"
    if regime == "transition":
        return "a transitional regime"
    return "the current market regime"


def volume_signature_phrase(volume_signature: Optional[str]) -> str:
    """context.volume_signature -> prose phrase.

    "contracting" -> "contracting volume (institutional absorption signature)"
    "expanding"   -> "expanding volume (active participation)"
    "neutral"     -> "neutral volume action"
    """
    if volume_signature == "contracting":
        return "contracting volume (institutional absorption signature)"
    if volume_signature == "expanding":
        return "expanding volume (active participation)"
    return "neutral volume action"


def position_in_range_phrase(value: float, low: float, high: float) -> str:
    """Render a price's position within a [low, high] range as a prose phrase.

    Examples:
      value=50, low=0, high=100  -> "50% of the way from $0.00 (low) to $100.00 (high)"
      value=50, low=50, high=50  -> "at $50.00"  (zero-range edge case)
    """
    if high <= low:
        return f"at ${value:.2f}"
    pos_pct = (value - low) / (high - low) * 100
    return f"{pos_pct:.0f}% of the way from ${low:.2f} (low) to ${high:.2f} (high)"


def dcr_interpretation(context: dict, direction: str) -> str:
    """Return a 1-2 sentence interpretation of DCR for the given trade direction.

    Used by detectors to weave a DCR read into the why_it_matters narrative field.

    direction: "bullish" or "bearish" (anything other than "bullish" is treated as bearish).

    Examples:
      direction="bullish", dcr_signature="accumulation" ->
        "Institutional buyers are closing positions strong (DCR signature: accumulation) -
         supportive of the bullish thesis."
      direction="bearish", dcr_signature="distribution" ->
        "Sellers in control through close (DCR signature: distribution) -
         supportive of the bearish thesis."
    """
    dcr_sig = context.get("dcr_signature", "neutral")
    is_bullish = direction == "bullish"

    if is_bullish:
        if dcr_sig == "accumulation":
            return (
                "Institutional buyers are closing positions strong (DCR signature: "
                "accumulation) - supportive of the bullish thesis."
            )
        if dcr_sig == "distribution":
            return (
                "Sellers controlling closes (DCR signature: distribution) - bullish "
                "pattern faces headwind, demand follow-through critical."
            )
        return (
            "DCR signal is neutral - neither tailwind nor headwind from close-in-range "
            "positioning."
        )

    # bearish
    if dcr_sig == "distribution":
        return (
            "Sellers in control through close (DCR signature: distribution) - "
            "supportive of the bearish thesis."
        )
    if dcr_sig == "accumulation":
        return (
            "Buyers absorbing into close (DCR signature: accumulation) - bearish "
            "pattern may struggle without selling follow-through."
        )
    return (
        "DCR signal is neutral - neither tailwind nor headwind from close-in-range "
        "positioning."
    )
