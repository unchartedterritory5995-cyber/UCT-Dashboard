"""Pattern recognition REST endpoints.

Phase 0 surfaces three endpoints:
  - GET /api/patterns/types
  - GET /api/patterns/{sym}?tf=&types=&min_conf=
  - POST /api/patterns/{detection_id}/feedback

Note: detectors must be imported at module load so they register themselves.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

# Importing the detector modules triggers self-registration with the registry.
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
from api.services.pattern_engine.detectors.uct import vcp as _vcp  # noqa: F401
from api.services.pattern_engine.detectors.uct import high_tight_flag as _high_tight_flag  # noqa: F401
from api.services.pattern_engine.detectors.uct import episodic_pivot as _episodic_pivot  # noqa: F401
from api.services.pattern_engine.detectors.uct import power_earnings_gap as _power_earnings_gap  # noqa: F401
from api.services.pattern_engine.detectors.uct import flat_base as _flat_base  # noqa: F401
from api.services.pattern_engine.detectors.uct import u_and_r as _u_and_r  # noqa: F401
from api.services.pattern_engine.detectors.uct import remount as _remount  # noqa: F401
from api.services.pattern_engine.detectors.uct import cup_handle_uct as _cup_handle_uct  # noqa: F401
from api.services.pattern_engine.detectors.structure import swing_pivots as _swing_pivots  # noqa: F401
from api.services.pattern_engine.detectors.structure import support_resistance as _support_resistance  # noqa: F401
from api.services.pattern_engine.detectors.structure import major_trendlines as _major_trendlines  # noqa: F401
from api.services.pattern_engine.detectors.structure import stage_analysis as _stage_analysis  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import doji as _doji  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import hammer as _hammer  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import hanging_man as _hanging_man  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import shooting_star as _shooting_star  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import bullish_engulfing as _bullish_engulfing  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import bearish_engulfing as _bearish_engulfing  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import piercing as _piercing  # noqa: F401
from api.services.pattern_engine.detectors.candlestick import dark_cloud_cover as _dark_cloud_cover  # noqa: F401
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.registry import list_pattern_ids


router = APIRouter(prefix="/api/patterns", tags=["patterns"])


_PATTERN_METADATA = {
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
}


@router.get("/types")
def list_types():
    """Return all registered pattern types with metadata."""
    ids = list_pattern_ids()
    out = []
    for pid in ids:
        meta = _PATTERN_METADATA.get(pid, {})
        out.append({
            "id": pid,
            "name": meta.get("name", pid.replace("_", " ").title()),
            "category": meta.get("category", "uncategorized"),
            "direction": meta.get("direction", "neutral"),
            "description": meta.get("description", ""),
        })
    return {"patterns": out}


@router.get("/{sym}")
def get_detections(
    sym: str,
    tf: str = Query(default="D"),
    types: Optional[str] = Query(default=None, description="comma-separated pattern_ids to filter"),
    min_conf: float = Query(default=50.0, ge=0.0, le=100.0),
):
    """Return active detections for a symbol (status NOT in completed/failed/expired)."""
    pattern_ids = [t.strip() for t in types.split(",")] if types else None
    rows = memory.get_active_detections(sym.upper(), tf, pattern_ids=pattern_ids, min_conf=min_conf)
    return {"sym": sym.upper(), "tf": tf, "detections": rows, "count": len(rows)}


class FeedbackBody(BaseModel):
    rating: str
    user_id: str
    note: Optional[str] = None


@router.post("/{detection_id}/feedback")
def post_feedback(detection_id: str, body: FeedbackBody):
    """Record user feedback on a detection. Returns the new feedback row id."""
    try:
        fb_id = memory.record_feedback(detection_id, body.user_id, body.rating, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "feedback_id": fb_id}
