"""Pattern recognition REST endpoints.

Read the router for the route set — this file has grown well past the three
endpoints the old header named, and a hand-typed list beside the source that
owns it is this repo's most-repeated defect.

🔴 FOUR ROUTES WERE ANONYMOUS until 2026-08-09 and they are the pattern engine's
whole output: `/scan` (**58,856 bytes** — a universe-wide scan of the 50-detector
engine), `/types` (**21,567 bytes** — the full detector registry with every
detector's definition and metadata, i.e. the engine's design), `/{sym}`, and
`POST /{detection_id}/feedback`, which WROTE rows into the training pool.

Now:
  * `/types`, `/scan`, `/{sym}` → `require_paid`. Their only consumers are
    `pages/Patterns.jsx` and `pages/patterns/PatternFilter.jsx`, both inside a
    page `AuthGuard` serves to paid/admin only.
  * `POST /{detection_id}/feedback` → `require_paid` **as of 2026-08-09**. The
    first pass gave it `get_current_user` and moved the author to the SESSION,
    which fixed *whose name* a row is filed under; it did not fix *who may
    write one*. Signup is open and free, so a free account that cannot read a
    single detection could still vote on the corpus that trains the engine. The
    write follows the read.
  * `POST /feedback` (the vision thumbs) and `GET /confirmed/{sym}` (the
    Opus-vision judge's confirmed verdicts + rationale) → `require_paid` on the
    same date and for the same reasons.

⛔ Do not re-type the route set or its gates here — read the decorators. The
list above is a record of one decision, not an index.

Note: detectors must be imported at module load so they register themselves.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)

# Importing the detector modules triggers self-registration with the registry.
from api.services.pattern_engine.detectors.classical import golden_cross as _golden_cross  # noqa: F401
from api.services.pattern_engine.detectors.classical import death_cross as _death_cross  # noqa: F401
from api.services.pattern_engine.detectors.classical import bull_flag as _bull_flag  # noqa: F401
from api.services.pattern_engine.detectors.classical import bear_flag as _bear_flag  # noqa: F401
from api.services.pattern_engine.detectors.classical import pennant as _pennant  # noqa: F401
from api.services.pattern_engine.detectors.classical import falling_wedge as _falling_wedge  # noqa: F401
from api.services.pattern_engine.detectors.classical import rising_wedge as _rising_wedge  # noqa: F401
from api.services.pattern_engine.detectors.classical import head_shoulders as _head_shoulders  # noqa: F401
from api.services.pattern_engine.detectors.classical import inverse_head_shoulders as _inverse_head_shoulders  # noqa: F401
from api.services.pattern_engine.detectors.classical import double_top as _double_top  # noqa: F401
from api.services.pattern_engine.detectors.classical import double_bottom as _double_bottom  # noqa: F401
from api.services.pattern_engine.detectors.classical import cup_handle as _cup_handle  # noqa: F401
from api.services.pattern_engine.detectors.classical import inverse_cup_handle as _inverse_cup_handle  # noqa: F401
from api.services.pattern_engine.detectors.classical import ascending_triangle as _ascending_triangle  # noqa: F401
from api.services.pattern_engine.detectors.classical import descending_triangle as _descending_triangle  # noqa: F401
from api.services.pattern_engine.detectors.classical import symmetrical_triangle as _symmetrical_triangle  # noqa: F401
from api.services.pattern_engine.detectors.classical import rectangle as _rectangle  # noqa: F401
from api.services.pattern_engine.detectors.classical import channel as _channel  # noqa: F401
from api.services.pattern_engine.detectors.classical import rounded_base as _rounded_base  # noqa: F401
from api.services.pattern_engine.detectors.classical import rounded_top as _rounded_top  # noqa: F401
from api.services.pattern_engine.detectors.classical import triple_top as _triple_top  # noqa: F401
from api.services.pattern_engine.detectors.classical import triple_bottom as _triple_bottom  # noqa: F401
from api.services.pattern_engine.detectors.uct import vcp as _vcp  # noqa: F401
from api.services.pattern_engine.detectors.uct import high_tight_flag as _high_tight_flag  # noqa: F401
from api.services.pattern_engine.detectors.uct import episodic_pivot as _episodic_pivot  # noqa: F401
from api.services.pattern_engine.detectors.uct import power_earnings_gap as _power_earnings_gap  # noqa: F401
from api.services.pattern_engine.detectors.uct import flat_base as _flat_base  # noqa: F401
from api.services.pattern_engine.detectors.uct import u_and_r as _u_and_r  # noqa: F401
from api.services.pattern_engine.detectors.uct import remount as _remount  # noqa: F401
from api.services.pattern_engine.detectors.uct import cup_handle_uct as _cup_handle_uct  # noqa: F401
from api.services.pattern_engine.detectors.uct import kell_cycle as _kell_cycle  # noqa: F401
from api.services.pattern_engine.detectors.uct import qullamaggie_setup as _qullamaggie_setup  # noqa: F401
from api.services.pattern_engine.detectors.uct import parabolic_short as _parabolic_short  # noqa: F401
from api.services.pattern_engine.detectors.uct import holy_grail as _holy_grail  # noqa: F401
from api.services.pattern_engine.detectors.uct import can_slim_composite as _can_slim_composite  # noqa: F401
from api.services.pattern_engine.detectors.uct import liquid_leader_filter as _liquid_leader_filter  # noqa: F401
from api.services.pattern_engine.detectors.classical import higher_low_continuation as _higher_low_continuation  # noqa: F401
from api.services.pattern_engine.detectors.classical import td_sequential_buy as _td_sequential_buy  # noqa: F401
from api.services.pattern_engine.detectors.classical import td_sequential_sell as _td_sequential_sell  # noqa: F401
from api.services.pattern_engine.detectors.uct import wyckoff_spring as _wyckoff_spring  # noqa: F401
from api.services.pattern_engine.detectors.uct import wyckoff_upthrust as _wyckoff_upthrust  # noqa: F401
from api.services.pattern_engine.detectors.uct import pullback_to_10ema as _pullback_to_10ema  # noqa: F401
from api.services.pattern_engine.detectors.uct import pullback_to_21ema as _pullback_to_21ema  # noqa: F401
from api.services.pattern_engine.detectors.uct import pullback_to_50sma as _pullback_to_50sma  # noqa: F401
from api.services.pattern_engine.detectors.uct import pullback_to_200sma as _pullback_to_200sma  # noqa: F401
from api.services.pattern_engine.detectors.classical import bollinger_squeeze as _bollinger_squeeze  # noqa: F401
from api.services.pattern_engine.detectors.classical import donchian_breakout as _donchian_breakout  # noqa: F401
from api.services.pattern_engine.detectors.classical import rsi_bullish_divergence as _rsi_bullish_divergence  # noqa: F401
from api.services.pattern_engine.detectors.classical import rsi_bearish_divergence as _rsi_bearish_divergence  # noqa: F401
from api.services.pattern_engine.detectors.classical import outside_bar as _outside_bar  # noqa: F401
from api.services.pattern_engine.detectors.classical import inside_bar_breakout as _inside_bar_breakout  # noqa: F401
from api.services.pattern_engine.detectors.classical import macd_bullish_cross as _macd_bullish_cross  # noqa: F401
from api.services.pattern_engine.detectors.classical import macd_bearish_cross as _macd_bearish_cross  # noqa: F401
from api.services.pattern_engine.detectors.classical import vsa_no_demand as _vsa_no_demand  # noqa: F401
from api.services.pattern_engine.detectors.classical import vsa_no_supply as _vsa_no_supply  # noqa: F401
from api.services.pattern_engine.detectors.uct import opening_range_breakout as _opening_range_breakout  # noqa: F401
from api.services.pattern_engine.detectors.uct import opening_range_breakdown as _opening_range_breakdown  # noqa: F401
from api.services.pattern_engine.detectors.uct import lance_opening_drive as _lance_opening_drive  # noqa: F401
from api.services.pattern_engine.detectors.uct import avwap_reclaim as _avwap_reclaim  # noqa: F401
from api.services.pattern_engine.detectors.structure import swing_pivots as _swing_pivots  # noqa: F401
from api.services.pattern_engine.detectors.structure import support_resistance as _support_resistance  # noqa: F401
from api.services.pattern_engine.detectors.structure import major_trendlines as _major_trendlines  # noqa: F401
from api.services.pattern_engine.detectors.structure import stage_analysis as _stage_analysis  # noqa: F401
from api.services.pattern_engine.detectors.structure import volume_profile_nodes as _volume_profile_nodes  # noqa: F401
from api.services.pattern_engine.detectors.structure import accumulation_distribution as _accumulation_distribution  # noqa: F401
from api.services.pattern_engine.detectors.structure import range_detection as _range_detection  # noqa: F401
from api.services.pattern_engine.detectors.structure import proximity_52w as _proximity_52w  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import doji as _doji  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import hammer as _hammer  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import hanging_man as _hanging_man  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import shooting_star as _shooting_star  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import tweezer_bottom as _tweezer_bottom  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import tweezer_top as _tweezer_top  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import bullish_engulfing as _bullish_engulfing  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import bearish_engulfing as _bearish_engulfing  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import piercing as _piercing  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import dark_cloud_cover as _dark_cloud_cover  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import bullish_harami as _bullish_harami  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import bearish_harami as _bearish_harami  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import morning_star as _morning_star  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import evening_star as _evening_star  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import three_white_soldiers as _three_white_soldiers  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import three_black_crows as _three_black_crows  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import marubozu as _marubozu  # noqa: F401
from api.services.pattern_engine.detectors.classical import nr7 as _nr7  # noqa: F401
from api.services.pattern_engine import memory


router = APIRouter(prefix="/api/patterns", tags=["patterns"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the pattern engine's output.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The pattern engine requires a paid plan")
    return user



_PATTERN_METADATA = {
    "golden_cross": {
        "name": "Golden Cross (50/200 SMA)",
        "category": "classical",
        "direction": "bullish",
        "description": "50-day SMA crosses ABOVE 200-day SMA with both MAs rising. Weinstein Stage 2 transition signal — institutional trend-change trigger (Dow Theory / Stan Weinstein 1988).",
    },
    "death_cross": {
        "name": "Death Cross (50/200 SMA)",
        "category": "classical",
        "direction": "bearish",
        "description": "50-day SMA crosses BELOW 200-day SMA with both MAs declining. Weinstein Stage 4 transition signal — bearish mirror of the Golden Cross; institutional long-to-short rotation trigger (Dow Theory / Stan Weinstein 1988).",
    },
    "bull_flag": {
        "name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "description": "Sharp advance (pole) followed by tight parallel-channel pullback (flag). Continuation pattern.",
    },
    "bear_flag": {
        "name": "Bear Flag",
        "category": "classical",
        "direction": "bearish",
        "description": "Sharp decline (pole) followed by tight parallel-channel rally (flag). Continuation pattern.",
    },
    "pennant": {
        "name": "Pennant",
        "category": "classical",
        "direction": "neutral",  # emits both bullish + bearish
        "description": "Sharp move (pole) followed by converging triangle consolidation. Continuation pattern in either direction.",
    },
    "falling_wedge": {
        "name": "Falling Wedge",
        "category": "classical",
        "direction": "bullish",
        "description": "Both trendlines slope down, converging downward. Bullish reversal/continuation pattern.",
    },
    "rising_wedge": {
        "name": "Rising Wedge",
        "category": "classical",
        "direction": "bearish",
        "description": "Both trendlines slope up, converging upward. Bearish reversal pattern.",
    },
    "head_shoulders": {
        "name": "Head and Shoulders",
        "category": "classical",
        "direction": "bearish",
        "description": "Three peaks with the middle (head) highest. Neckline connects the two troughs. Bearish reversal pattern.",
    },
    "inverse_head_shoulders": {
        "name": "Inverse Head and Shoulders",
        "category": "classical",
        "direction": "bullish",
        "description": "Three troughs with the middle (head) lowest. Neckline connects the two peaks. Bullish reversal pattern.",
    },
    "double_top": {
        "name": "Double Top",
        "category": "classical",
        "direction": "bearish",
        "description": "Two peaks at similar heights with a retrace trough between. Bearish reversal pattern.",
    },
    "double_bottom": {
        "name": "Double Bottom",
        "category": "classical",
        "direction": "bullish",
        "description": "Two troughs at similar lows with a rally peak between. Bullish reversal pattern.",
    },
    "cup_handle": {
        "name": "Cup with Handle",
        "category": "classical",
        "direction": "bullish",
        "description": "Rounded U-shaped consolidation (cup) followed by tight pullback (handle). Bullish continuation pattern (O'Neil).",
    },
    "inverse_cup_handle": {
        "name": "Inverse Cup with Handle",
        "category": "classical",
        "direction": "bearish",
        "description": "Inverted rounded dome followed by a small failing rally (handle). Bearish reversal pattern.",
    },
    "ascending_triangle": {
        "name": "Ascending Triangle",
        "category": "classical",
        "direction": "bullish",
        "description": "Flat resistance top + rising support trendline converging. Bullish continuation breakout pattern (Edwards & Magee).",
    },
    "descending_triangle": {
        "name": "Descending Triangle",
        "category": "classical",
        "direction": "bearish",
        "description": "Flat support bottom + falling resistance trendline. Bearish continuation breakdown pattern.",
    },
    "symmetrical_triangle": {
        "name": "Symmetrical Triangle",
        "category": "classical",
        "direction": "neutral",
        "description": "Both upper + lower trendlines converging toward apex. Direction follows breakout side.",
    },
    "rectangle": {
        "name": "Rectangle / Trading Range",
        "category": "classical",
        "direction": "neutral",
        "description": "Sideways consolidation bounded by flat support + flat resistance. Continuation in prior trend direction (Wyckoff / Schabacker).",
    },
    "channel": {
        "name": "Channel",
        "category": "classical",
        "direction": "neutral",
        "description": "Parallel trendlines defining a sustained sloped or horizontal channel. Direction follows slope (ascending=bullish, descending=bearish, horizontal=range).",
    },
    "rounded_base": {
        "name": "Rounded Base",
        "category": "classical",
        "direction": "bullish",
        "description": "Slow U-shaped consolidation over 30-120 bars without a handle. Wyckoff accumulation / O'Neil saucer with platform.",
    },
    "rounded_top": {
        "name": "Rounded Top",
        "category": "classical",
        "direction": "bearish",
        "description": "Slow inverted-U distribution pattern. Wyckoff distribution / O'Neil saucer top.",
    },
    "triple_top": {
        "name": "Triple Top",
        "category": "classical",
        "direction": "bearish",
        "description": "3 peaks at similar prices with 2 retrace troughs. Stronger version of double top - supply is overwhelming demand at the level.",
    },
    "triple_bottom": {
        "name": "Triple Bottom",
        "category": "classical",
        "direction": "bullish",
        "description": "3 troughs at similar prices with 2 rally peaks between. Stronger version of double bottom - demand absorbing supply at the level.",
    },
    "vcp": {
        "name": "Volatility Contraction Pattern (VCP)",
        "category": "uct",
        "direction": "bullish",
        "description": "Successive shallower pullbacks with drying volume into a tight pivot. Minervini's signature institutional accumulation pattern.",
    },
    "high_tight_flag": {
        "name": "High Tight Flag (Powerplay)",
        "category": "uct",
        "direction": "bullish",
        "description": "Near-vertical 90%+ advance followed by tight orderly consolidation. The rarest, most explosive continuation pattern (O'Neil / Bonde).",
    },
    "episodic_pivot": {
        "name": "Episodic Pivot",
        "category": "uct",
        "direction": "bullish",
        "description": "A single bar of 2x+ range and volume that breaks out of a multi-week base. Bonde's signature regime-change signal.",
    },
    "power_earnings_gap": {
        "name": "Power Earnings Gap (PEG)",
        "category": "uct",
        "direction": "bullish",
        "description": "Significant gap-up (>=4%) on 3x+ volume that holds with tight post-gap consolidation. Bonde's signature post-earnings continuation setup.",
    },
    "flat_base": {
        "name": "Flat Base Breakout",
        "category": "uct",
        "direction": "bullish",
        "description": "Tight horizontal consolidation (<=12% depth) after a 25%+ prior advance, with drying volume. O'Neil/Stockbee continuation pattern.",
    },
    "u_and_r": {
        "name": "Undercut & Rally",
        "category": "uct",
        "direction": "bullish",
        "description": "Brief close below key support followed by immediate rally back above + follow-through. Brian Shannon's bear-trap reversal setup.",
    },
    "remount": {
        "name": "Remount",
        "category": "uct",
        "direction": "bullish",
        "description": "Stock reclaims a key level (20EMA, 50SMA, or prior pivot) after 5-30 bars below + follow-through. Bonde's failed-breakdown reversal.",
    },
    "cup_handle_uct": {
        "name": "Cup-with-Handle (UCT Strict)",
        "category": "uct",
        "direction": "bullish",
        "description": "O'Neil CAN SLIM cup-with-handle with strict institutional filters: 30%+ prior advance, tight 30-65 bar cup <=35% depth, tight handle. Highest-conviction continuation.",
    },
    "swing_pivots": {
        "name": "Swing Pivot Map",
        "category": "structure",
        "direction": "neutral",
        "description": "Significant swing-high and swing-low pivots in the recent 60-bar window. Structural reference levels for entries, stops, and analysis.",
    },
    "support_resistance": {
        "name": "Support / Resistance Level",
        "category": "structure",
        "direction": "neutral",
        "description": "Horizontal price level confirmed by >=2 swing-pivot touches within a 2% band. Emit one Detection per active level.",
    },
    "major_trendlines": {
        "name": "Major Trendline",
        "category": "structure",
        "direction": "neutral",
        "description": "Auto-detected rising support or falling resistance trendline with >=3 touches + validity >=0.6. Emit one Detection per active trendline.",
    },
    "stage_analysis": {
        "name": "Weinstein Stage Analysis",
        "category": "structure",
        "direction": "neutral",
        "description": "Classifies the chart's current stage in Weinstein's 4-stage cycle (basing, advance, distribution, decline). Foundational context for every other pattern.",
    },
    "volume_profile_nodes": {
        "name": "Volume Profile Node",
        "category": "structure",
        "direction": "neutral",
        "description": "High-volume (HVN) or low-volume (LVN) price levels from the 60-bar volume profile. Magnetic reference levels (HVN) and acceleration zones (LVN). Steidlmayer Market Profile.",
    },
    "accumulation_distribution": {
        "name": "Accumulation/Distribution Phase",
        "category": "structure",
        "direction": "neutral",
        "description": "Williams A/D classification: accumulation (bullish institutional buying) / distribution (bearish selling) / neutral. Includes price-A/D divergence detection. Wyckoff cycle analysis.",
    },
    "range_detection": {
        "name": "Trading Range",
        "category": "structure",
        "direction": "neutral",
        "description": "Active consolidation range with bounded high + low. Wyckoff trading-range structure. Pre-breakout coiling.",
    },
    "52w_proximity": {
        "name": "52-Week Proximity",
        "category": "structure",
        "direction": "neutral",
        "description": "Distance from 52-week high/low. Top-level momentum filter (O'Neil CAN SLIM 'N' = new highs). Near-high = strong stock; near-low = weak / potential reversal.",
    },
    "doji": {
        "name": "Doji",
        "category": "candlestick",
        "direction": "neutral",
        "description": "A candle where open ~= close (body <5% of total range). Signals indecision; 4 variants (standard/long_legged/dragonfly/gravestone) identify directional bias from wick anatomy.",
    },
    "hammer": {
        "name": "Hammer",
        "category": "candlestick",
        "direction": "bullish",
        "description": "Long lower wick (>=2x body) + small body at a swing low. Bullish reversal signal requiring next-bar confirmation.",
    },
    "hanging_man": {
        "name": "Hanging Man",
        "category": "candlestick",
        "direction": "bearish",
        "description": "Same anatomy as hammer but at a swing high after advance. Bearish reversal warning requiring next-bar bearish confirmation.",
    },
    "shooting_star": {
        "name": "Shooting Star",
        "category": "candlestick",
        "direction": "bearish",
        "description": "Long upper wick (>=2x body) + small body at a swing high after advance. Bearish reversal signal requiring next-bar bearish confirmation.",
    },
    "tweezer_bottom": {
        "name": "Tweezer Bottom",
        "category": "candlestick",
        "direction": "bullish",
        "description": "2-bar pattern: two consecutive candles with virtually identical lows (within 0.15% of price) at a swing low, below the 50-bar SMA, or after a recent decline (>=5%). Strongest when bar A is bearish + bar B bullish (reversal handoff). Bullish reversal requiring next-bar close above pattern high.",
    },
    "tweezer_top": {
        "name": "Tweezer Top",
        "category": "candlestick",
        "direction": "bearish",
        "description": "2-bar pattern: two consecutive candles with virtually identical highs (within 0.15% of price) at a swing high, above the 50-bar SMA, or after a recent advance (>=5%). Strongest when bar A is bullish + bar B bearish (reversal handoff). Bearish reversal requiring next-bar close below pattern low.",
    },
    "bullish_engulfing": {
        "name": "Bullish Engulfing",
        "category": "candlestick",
        "direction": "bullish",
        "description": "2-bar pattern: a red bar fully engulfed by a larger green bar that closes above the prior open. Bullish reversal at swing lows.",
    },
    "bearish_engulfing": {
        "name": "Bearish Engulfing",
        "category": "candlestick",
        "direction": "bearish",
        "description": "2-bar pattern: a green bar fully engulfed by a larger red bar that closes below the prior open. Bearish reversal at swing highs.",
    },
    "piercing": {
        "name": "Piercing Pattern",
        "category": "candlestick",
        "direction": "bullish",
        "description": "2-bar pattern: a long red bar followed by a green bar that gaps down on open but closes above the midpoint of the prior body. Less aggressive bullish reversal than engulfing.",
    },
    "dark_cloud_cover": {
        "name": "Dark Cloud Cover",
        "category": "candlestick",
        "direction": "bearish",
        "description": "2-bar pattern: a long green bar followed by a red bar that gaps up on open but closes below the midpoint of the prior body. Less aggressive bearish reversal than engulfing.",
    },
    "bullish_harami": {
        "name": "Bullish Harami",
        "category": "candlestick",
        "direction": "bullish",
        "description": "2-bar pattern: a long red bar followed by a small-body bar inside the red bar's range. Indecision after decline - bullish reversal signal at swing lows.",
    },
    "bearish_harami": {
        "name": "Bearish Harami",
        "category": "candlestick",
        "direction": "bearish",
        "description": "2-bar pattern: a long green bar followed by a small-body bar inside the green bar's range. Indecision after advance - bearish reversal signal at swing highs.",
    },
    "morning_star": {
        "name": "Morning Star",
        "category": "candlestick",
        "direction": "bullish",
        "description": "3-bar pattern: long red + small body (the 'star') + long green closing above bar 1's midpoint. Bullish reversal at swing lows. Named for Venus at dawn.",
    },
    "evening_star": {
        "name": "Evening Star",
        "category": "candlestick",
        "direction": "bearish",
        "description": "3-bar pattern: long green + small body (the 'star') + long red closing below bar 1's midpoint. Bearish reversal at swing highs. Named for Venus at dusk.",
    },
    "three_white_soldiers": {
        "name": "Three White Soldiers",
        "category": "candlestick",
        "direction": "bullish",
        "description": "3 consecutive long green bars, each opening within prior body and closing near its high. Institutional accumulation signal - bullish continuation from base or reversal at swing lows.",
    },
    "three_black_crows": {
        "name": "Three Black Crows",
        "category": "candlestick",
        "direction": "bearish",
        "description": "3 consecutive long red bars, each opening within prior body and closing near its low. Distribution signal - bearish reversal at swing highs or continuation from top.",
    },
    "marubozu": {
        "name": "Marubozu",
        "category": "candlestick",
        "direction": "neutral",  # emits both bullish and bearish variants
        "description": "Full-body conviction candle (Nison 1991): body >= 90% of range, both wicks <= 5%, above-average range (1.2x) and volume (1.3x), DCR >= 0.95 (bull) or <= 0.05 (bear). The 'bald' candle — pure directional control for the entire session.",
    },
    "nr7": {
        "name": "NR7 — Narrow Range 7",
        "category": "classical",
        "direction": "neutral",  # pre-breakout; both long + short levels emitted
        "description": "Current bar's range is strictly narrowest of the past 7 bars (Toby Crabel 1990 / Linda Raschke 1995). Volatility contraction signal preceding a directional expansion. NEUTRAL — dual long + short breakout levels encoded; NR4 bonus and inside-bar confluence boost confidence.",
    },
    "kell_cycle": {
        "name": "Kell Cycle of Price Action",
        "category": "uct",
        "direction": "neutral",
        "description": "Oliver Kell's 5-stage Cycle of Price Action: reversal extension -> wedge pop -> exhaustion extension -> wedge drop -> base & breakout. From 'Victorious Stock Operator'.",
    },
    "qullamaggie_setup": {
        "name": "Qullamaggie Setup",
        "category": "uct",
        "direction": "bullish",
        "description": "Kristjan Kullamägi's signature: 4-week consolidation + ATR-relative thrust + low-volume retracement on liquid leader near 52w high. The 'monster move' trigger.",
    },
    "parabolic_short": {
        "name": "Parabolic Short",
        "category": "uct",
        "direction": "bearish",
        "description": "Kullamägi's blow-off detector: parabolic 100%+ run + climactic bar with gap-up failure + 3x volume + DCR <0.3. High-RR short setup at trend exhaustion.",
    },
    "holy_grail": {
        "name": "Holy Grail (Raschke)",
        "category": "uct",
        "direction": "bullish",
        "description": "Linda Raschke's pullback setup: ADX > 30 strong trend + pullback to rising 20EMA + close above EMA. From 'Street Smarts' (Raschke + Connors 1995).",
    },
    "higher_low_continuation": {
        "name": "Higher Low Continuation",
        "category": "classical",
        "direction": "bullish",
        "description": "Classical Dow Theory uptrend confirmation: most recent swing low is higher than prior swing low + price reclaims above. Structural continuation signal.",
    },
    "can_slim_composite": {
        "name": "CAN SLIM Composite",
        "category": "uct",
        "direction": "neutral",
        "description": "William O'Neil's CAN SLIM 7-pillar framework score (C/A/N/S/L/I/M). Meta-detector - always emits with grade A-D + per-pillar breakdown.",
    },
    "liquid_leader_filter": {
        "name": "Liquid Leader Eligibility",
        "category": "uct",
        "direction": "bullish",
        "description": "Universe-eligibility detector: within 5% of 52w high + avg volume >=500K + Stage 2 + stacked bullish + RS up. The 'this stock is worth trading' signal (Kullamägi/Minervini/O'Neil criteria).",
    },
    "td_sequential_buy": {
        "name": "TD Sequential Buy (TD9)",
        "category": "classical",
        "direction": "bullish",
        "description": "Tom DeMark's TD9 setup — 9 consecutive bars closing below the close 4 bars prior. Downside exhaustion signal used by institutional desks.",
    },
    "td_sequential_sell": {
        "name": "TD Sequential Sell (TD9)",
        "category": "classical",
        "direction": "bearish",
        "description": "DeMark's TD9 mirror — 9 consecutive bars closing above the close 4 bars prior. Upside exhaustion signal.",
    },
    "wyckoff_spring": {
        "name": "Wyckoff Spring",
        "category": "uct",
        "direction": "bullish",
        "description": "Wyckoff Phase C accumulation: false breakdown below trading range support + immediate reclaim on Sign of Strength volume. Highest-conviction long entry.",
    },
    "wyckoff_upthrust": {
        "name": "Wyckoff Upthrust",
        "category": "uct",
        "direction": "bearish",
        "description": "Wyckoff Phase C distribution mirror: false breakout above trading range resistance + immediate reject on Sign of Weakness volume.",
    },
    "pullback_to_10ema": {
        "name": "Pullback to 10-EMA",
        "category": "uct",
        "direction": "bullish",
        "description": "Fast-pullback entry to the rising 10-EMA in a Stage 2 uptrend. Raschke + Bonde framework — tightest stop, highest reward-to-risk.",
    },
    "pullback_to_21ema": {
        "name": "Pullback to 21-EMA (Minervini SEPA)",
        "category": "uct",
        "direction": "bullish",
        "description": "Mark Minervini's SEPA primary support — pullback to rising 21-EMA in confirmed Stage 2 trend. The 'natural support' of leading momentum stocks.",
    },
    "pullback_to_50sma": {
        "name": "Pullback to 50-SMA (O'Neil 2nd Buy Point)",
        "category": "uct",
        "direction": "bullish",
        "description": "William O'Neil's 'second buy point' from CAN SLIM — test of rising 50-day average in a confirmed leader after ≥30% prior advance. Classic institutional re-entry.",
    },
    "pullback_to_200sma": {
        "name": "Pullback to 200-SMA (Weinstein Stage 2 Retest)",
        "category": "uct",
        "direction": "bullish",
        "description": "Major-trend retest of rising 200-day SMA in a confirmed Stage 2 advance. Weinstein's institutional reentry zone after ≥40% prior gain.",
    },
    "bollinger_squeeze": {
        "name": "Bollinger Squeeze",
        "category": "classical",
        "direction": "neutral",
        "description": "Bollinger Bands inside Keltner Channels = compression precedes directional breakout. John Bollinger + John Carter TTM Squeeze framework.",
    },
    "donchian_breakout": {
        "name": "Donchian Breakout (Turtle)",
        "category": "classical",
        "direction": "neutral",
        "description": "Close beyond 20-bar (System 1) or 55-bar (System 2) Donchian channel high/low. Richard Donchian + Turtle Traders trend-following entry.",
    },
    "rsi_bullish_divergence": {
        "name": "RSI Bullish Divergence",
        "category": "classical",
        "direction": "bullish",
        "description": "Price makes new low but RSI fails to confirm (higher RSI at new low). Welles Wilder + Cardwell + Constance Brown momentum exhaustion signal.",
    },
    "rsi_bearish_divergence": {
        "name": "RSI Bearish Divergence",
        "category": "classical",
        "direction": "bearish",
        "description": "Price makes new high but RSI doesn't confirm. Mirror of bullish divergence — upward momentum exhausting.",
    },
    "outside_bar": {
        "name": "Outside Bar / Key Reversal",
        "category": "classical",
        "direction": "neutral",
        "description": "Bar's range fully engulfs the prior bar + volume expansion. Larry Williams' 'key reversal' — direction inferred from close.",
    },
    "inside_bar_breakout": {
        "name": "Inside Bar Breakout",
        "category": "classical",
        "direction": "neutral",
        "description": "Bar fully INSIDE the prior bar's range = compression/coil. Breakout direction = trade direction. Linda Raschke + modern day-trader staple.",
    },
    "macd_bullish_cross": {
        "name": "MACD Bullish Crossover",
        "category": "classical",
        "direction": "bullish",
        "description": "MACD line crosses above signal line. Gerald Appel's momentum trigger — stronger when crossover happens below zero (oversold reversal).",
    },
    "macd_bearish_cross": {
        "name": "MACD Bearish Crossover",
        "category": "classical",
        "direction": "bearish",
        "description": "MACD line crosses below signal line. Stronger when crossover happens above zero (overbought reversal).",
    },
    "opening_range_breakout": {
        "name": "Opening Range Breakout (ORB)",
        "category": "uct",
        "direction": "bullish",
        "description": "First-30-min range break to upside on volume. Toby Crabel framework + Lance Breitstein modern intraday adaptation.",
    },
    "opening_range_breakdown": {
        "name": "Opening Range Breakdown",
        "category": "uct",
        "direction": "bearish",
        "description": "First-30-min range break to downside. Mirror of ORB.",
    },
    "lance_opening_drive": {
        "name": "Lance Opening Drive",
        "category": "uct",
        "direction": "bullish",
        "description": "Lance Breitstein's highest-edge intraday momentum continuation: gap-up >=1% on first bar + DCR >=0.70 + two consecutive higher closes + bar3 DCR >=0.60 + bar3 == session high + first-3-bar volume >=2x trailing avg. Lance's specific claim: 'the single highest-edge intraday pattern in liquid US equities.'",
    },
    "vsa_no_demand": {
        "name": "VSA No Demand",
        "category": "classical",
        "direction": "bearish",
        "description": "Narrow-range up bar on declining volume = institutions not buying = distribution signature. Tom Williams' Volume Spread Analysis.",
    },
    "vsa_no_supply": {
        "name": "VSA No Supply",
        "category": "classical",
        "direction": "bullish",
        "description": "Narrow-range down bar on declining volume = institutions not selling = absorption signature. Mirror of No Demand.",
    },
    "avwap_reclaim": {
        "name": "AVWAP Reclaim",
        "category": "uct",
        "direction": "bullish",
        "description": "Anchored VWAP from a key pivot reclaimed on volume after being below. Brian Shannon's AVWAP framework — anchor-aware level reclaim.",
    },
}


# -- /scan and /types: REMOVED 2026-08-26 with the Patterns page ------------
#
# The universe-scan endpoint served the RAW rule-engine firehose to the page;
# the Opus-vision judge (built after the owner's June ruling that the raw
# output was untrustworthy) confirmed only ~16% of those candidates, and the
# page never switched to confirmed verdicts. The page is gone; universe-wide
# reads live in the screener's pattern_join and the voice tools, both of which
# query the store directly. /types' only consumers were the page's filters.
# The engine itself (detectors, per-symbol reads below, chart overlay,
# admin/Gate-5, feedback) is unchanged.


@router.get("/{sym}")
def get_detections(
    sym: str,
    _user: dict = Depends(require_paid),
    tf: str = Query(default="D"),
    types: Optional[str] = Query(default=None, description="comma-separated pattern_ids to filter"),
    min_conf: float = Query(default=50.0, ge=0.0, le=100.0),
    confirmed_only: bool = Query(default=True, description="only Opus-vision-confirmed verdicts"),
):
    """Return detections for a symbol.

    Default (confirmed_only) returns Opus-vision-confirmed verdicts with rationale.
    Set confirmed_only=false to get the raw rule-engine active detections.
    """
    if confirmed_only:
        from api.services.pattern_vision import store as pv_store
        pv_store.init_db()
        verdicts = pv_store.get_confirmed(sym, tf)
        return {"sym": sym.upper(), "tf": tf, "verdicts": verdicts, "count": len(verdicts)}
    pattern_ids = [t.strip() for t in types.split(",")] if types else None
    rows = memory.get_active_detections(sym.upper(), tf, pattern_ids=pattern_ids, min_conf=min_conf)
    return {"sym": sym.upper(), "tf": tf, "detections": rows, "count": len(rows)}


class FeedbackBody(BaseModel):
    rating: str
    #: ⚠️ ACCEPTED AND IGNORED. The author is taken from the session (see
    #: `post_feedback`). Kept optional rather than removed so an older caller
    #: still sending it gets its feedback recorded instead of a 422 — but it can
    #: no longer decide WHOSE feedback this is.
    user_id: Optional[str] = None
    note: Optional[str] = None


@router.post("/{detection_id}/feedback")
def post_feedback(detection_id: str, body: FeedbackBody,
                  user: dict = Depends(require_paid)):
    """Record user feedback on a detection. Returns the new feedback row id.

    ⛔ The author is the SESSION, not `body.user_id`. While this route was
    anonymous a caller could file feedback under any id they typed — including
    `admin_operator`, the id `api/routers/admin_patterns.py` reserves for the
    Gate-5 operator review whose accept-rate decides whether the engine ships.

    🔴 PAID since 2026-08-09 (was `get_current_user`). Fixing the AUTHOR did not
    fix WHO MAY WRITE: this row lands in the engine's training pool, and the
    detections it grades are `require_paid` reads. A free account could not see a
    detection but could still vote on one — an open write into the corpus that
    decides which detectors ship. The write follows the read.
    """
    try:
        fb_id = memory.record_feedback(detection_id, str(user["id"]), body.rating, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "feedback_id": fb_id}


# ---- Opus-vision pattern judge (confirmed-only surface) -------------------

@router.get("/confirmed/{sym}")
def patterns_confirmed(sym: str, tf: str = "D", user=Depends(require_paid)):
    """Confirmed vision verdicts for a symbol (with rationale).

    🔴 PAID since 2026-08-09 (was `get_current_user`). Its siblings `/scan`,
    `/types` and `/{sym}` were paywalled on the same day; this one serves the
    Opus-vision judge's CONFIRMED verdicts **with their rationale** — a
    higher-conviction output than the raw detections, reached through a
    different door. Leaving it open would have made the sibling gates decorative.
    """
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    return {"sym": sym.upper(), "tf": tf, "verdicts": pv_store.get_confirmed(sym, tf)}


@router.post("/judge/{sym}")
def patterns_judge(sym: str, tf: str = "D", user=Depends(require_admin)):
    """Admin: run the Opus-vision judge for a symbol in the background."""
    import threading
    from api.services.pattern_vision import orchestrator as pv_orch
    threading.Thread(
        target=lambda: pv_orch.judge_ticker(sym, tf, force=True),
        daemon=True, name=f"pv-judge-{sym}",
    ).start()
    return {"started": True}


@router.get("/admin/vision-stats")
def patterns_vision_stats(user=Depends(require_admin)):
    """Admin: today's vision-judge spend + cap state."""
    import datetime
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    day = datetime.date.today().isoformat()
    return {"cost_today": pv_store.cost_today(day), "may_judge": pv_store.may_judge(day)}


@router.get("/admin/eval")
def patterns_eval(max_rows: int = 40, user=Depends(require_admin)):
    """Admin: per-setup recall vs the Model Book. max_rows bounds Opus cost;
    omit (pass a large value) to judge the full Model Book."""
    from api.services.pattern_vision import eval as pv_eval
    return pv_eval.evaluate(max_rows=max_rows)


# ---- Phase 3: feedback loop + annotated teaching examples -----------------

class VisionFeedbackBody(BaseModel):
    ticker: str
    tf: str = "D"
    setup: str
    asof_date: Optional[str] = None  # defaults to today (inline thumbs from any surface)
    rating: str  # "up" | "down"
    note: Optional[str] = None
    source: Optional[str] = None  # "chart" | "pattern-scan" | "scanner" | None (review page)


class ExemplarBody(BaseModel):
    setup: str
    image: str  # base64 PNG (data-URL prefix allowed)
    ticker: Optional[str] = None
    asof_date: Optional[str] = None
    note: Optional[str] = None
    drawings_json: Optional[str] = None


@router.post("/feedback")
def patterns_vision_feedback(body: VisionFeedbackBody, user=Depends(require_paid)):
    """Record a 👍/👎 + note on a pattern/scanner item (paid members).
    Inline thumbs from chart/scan/scanner pass a `source`; the review page omits it.

    🔴 PAID since 2026-08-09 (was `get_current_user`), for the same reason as
    `/{detection_id}/feedback`: it writes into the corpus the vision judge is
    tuned against, and every surface that shows a member the thing they are
    voting on is already paid.
    """
    import datetime
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    asof = body.asof_date or datetime.date.today().isoformat()
    fid = pv_store.record_feedback(body.ticker, body.tf, body.setup, asof,
                                   body.rating, body.note, by_user=str(user.get("id")),
                                   source=body.source)
    return {"ok": True, "feedback_id": fid}


@router.get("/admin/feedback")
def patterns_feedback_list(source: Optional[str] = None, limit: int = 200,
                           user=Depends(require_admin)):
    """Admin: raw feedback log (optionally filtered by source, e.g. 'scanner')."""
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    return {"feedback": pv_store.list_feedback(source=source, limit=limit)}


@router.get("/admin/review")
def patterns_review(limit: int = 100, user=Depends(require_admin)):
    """Admin: recent verdicts (confirmed AND rejected) + latest feedback, for review."""
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    return {"verdicts": pv_store.get_recent_verdicts(limit=limit)}


@router.post("/exemplar")
def patterns_add_exemplar(body: ExemplarBody, user=Depends(require_admin)):
    """Admin: save a drawn annotated chart as a gold-standard example for a setup
    (auto-used as a top reference by the judge)."""
    import base64
    from api.services.pattern_vision import store as pv_store
    raw = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
    try:
        png = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="image must be valid base64 PNG")
    if not png:
        raise HTTPException(status_code=400, detail="empty image")
    pv_store.init_db()
    eid = pv_store.add_exemplar(body.setup, png, ticker=body.ticker, asof_date=body.asof_date,
                                note=body.note, drawings_json=body.drawings_json,
                                by_user=str(user.get("id")))
    return {"ok": True, "exemplar_id": eid}


@router.get("/admin/exemplars")
def patterns_list_exemplars(setup: Optional[str] = None, user=Depends(require_admin)):
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    return {"exemplars": pv_store.list_exemplars(setup)}


@router.delete("/exemplar/{exemplar_id}")
def patterns_delete_exemplar(exemplar_id: int, user=Depends(require_admin)):
    from api.services.pattern_vision import store as pv_store
    pv_store.init_db()
    pv_store.delete_exemplar(exemplar_id)
    return {"ok": True}
