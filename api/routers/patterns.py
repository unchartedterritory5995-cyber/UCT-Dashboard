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
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.registry import list_pattern_ids
from api.services.auth_db import get_connection
from api.services.cache import cache
import json
import time


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


_SCAN_TTL = 300  # 5 minutes
_RECENT_WINDOW_SECS = 7 * 24 * 60 * 60  # 7 days


def _slim_detection(row) -> dict:
    """Return a slim detection payload for scanner results.

    Includes only the fields the scanner UI needs — full levels (trimmed),
    narrative headline (no body), CAN SLIM grade, and core identifiers.
    """
    try:
        levels = json.loads(row["levels_json"] or "{}")
    except Exception:
        levels = {}
    try:
        narrative = json.loads(row["narrative_json"] or "{}")
    except Exception:
        narrative = {}
    try:
        context = json.loads(row["context_json"] or "{}")
    except Exception:
        context = {}
    try:
        geometry = json.loads(row["geometry_json"] or "{}")
    except Exception:
        geometry = {}

    pattern_id = row["pattern_id"]
    meta = _PATTERN_METADATA.get(pattern_id, {})
    pattern_name = meta.get("name", pattern_id.replace("_", " ").title())

    extras = geometry.get("extras") if isinstance(geometry, dict) else None
    from_leader_universe = bool((extras or {}).get("from_leader_universe", False))

    return {
        "id": row["id"],
        "sym": row["sym"],
        "tf": row["tf"],
        "pattern_id": pattern_id,
        "pattern_name": pattern_name,
        "category": row["category"],
        "direction": row["direction"],
        "confidence": row["confidence"],
        "status": row["status"],
        "levels": {
            "entry": levels.get("entry"),
            "stop": levels.get("stop"),
            "target": levels.get("target_primary"),
            "target_primary": levels.get("target_primary"),
            "risk_reward": levels.get("risk_reward"),
        },
        "narrative": {"headline": narrative.get("headline", "")},
        "can_slim_grade": context.get("can_slim_grade"),
        "can_slim_score": context.get("can_slim_score"),
        "from_leader_universe": from_leader_universe,
        "detected_at": row["detected_at"],
        "last_seen_at": row["last_seen_at"],
    }


def _load_leader_tickers() -> set[str]:
    """Load the curated leader-universe tickers (best-effort)."""
    import os as _os
    leader_path = _os.path.join(
        _os.path.dirname(__file__), "..", "data", "leader_universe.json"
    )
    leader_path = _os.path.abspath(leader_path)
    if not _os.path.exists(leader_path):
        return set()
    try:
        with open(leader_path) as f:
            data = json.load(f)
        tickers = data.get("tickers", []) if isinstance(data, dict) else []
        return {t.upper() for t in tickers if isinstance(t, str)}
    except Exception:
        return set()


@router.get("/scan")
def scan_universe(
    types: Optional[str] = Query(default=None, description="comma-separated pattern_ids"),
    tf: str = Query(default="D"),
    min_conf: float = Query(default=70.0, ge=50.0, le=100.0),
    category: Optional[str] = Query(default=None, description="filter to classical/candlestick/uct/structure"),
    leaders_only: bool = Query(default=False, description="restrict results to curated leader-universe tickers"),
    limit: int = Query(default=100, le=500),
):
    """Universe scan for active detections matching filters.

    Returns detections from ``pattern_detections`` where:
      - status in ("forming", "ready", "triggered")
      - confidence >= min_conf
      - tf matches
      - pattern_id in types (if specified)
      - category matches (if specified)
      - sym in leader_universe.tickers (if leaders_only)
      - detected_at >= now - 7 days (recent only)
    Ordered by detected_at DESC, confidence DESC. Capped at limit.
    """
    cache_key = (
        f"pattern_scan:{tf}:{types or 'all'}:{min_conf}:"
        f"{category or 'all'}:{int(bool(leaders_only))}:{limit}"
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    pattern_ids = [t.strip() for t in types.split(",") if t.strip()] if types else None
    recent_cutoff = int(time.time()) - _RECENT_WINDOW_SECS

    leader_set: set[str] = set()
    if leaders_only:
        leader_set = _load_leader_tickers()

    # If leaders_only requested but no leaders configured → empty result rather than scanning all.
    if leaders_only and not leader_set:
        payload = {
            "detections": [],
            "count": 0,
            "filters": {
                "tf": tf,
                "types": pattern_ids,
                "min_conf": min_conf,
                "category": category,
                "leaders_only": True,
                "limit": limit,
            },
            "leader_universe_size": 0,
            "cached_at": int(time.time()),
        }
        cache.set(cache_key, payload, _SCAN_TTL)
        return payload

    conn = get_connection()
    try:
        sql = """
            SELECT * FROM pattern_detections
            WHERE tf = ?
              AND status IN ('forming', 'ready', 'triggered')
              AND confidence >= ?
              AND detected_at >= ?
        """
        params: list = [tf, min_conf, recent_cutoff]
        if pattern_ids:
            placeholders = ",".join(["?"] * len(pattern_ids))
            sql += f" AND pattern_id IN ({placeholders})"
            params.extend(pattern_ids)
        if category:
            sql += " AND category = ?"
            params.append(category)
        if leaders_only and leader_set:
            placeholders = ",".join(["?"] * len(leader_set))
            sql += f" AND sym IN ({placeholders})"
            params.extend(sorted(leader_set))
        sql += " ORDER BY detected_at DESC, confidence DESC LIMIT ?"
        params.append(int(limit))

        rows = conn.execute(sql, params).fetchall()
        detections = [_slim_detection(r) for r in rows]
    finally:
        conn.close()

    payload = {
        "detections": detections,
        "count": len(detections),
        "filters": {
            "tf": tf,
            "types": pattern_ids,
            "min_conf": min_conf,
            "category": category,
            "leaders_only": bool(leaders_only),
            "limit": limit,
        },
        "leader_universe_size": len(leader_set) if leaders_only else None,
        "cached_at": int(time.time()),
    }
    cache.set(cache_key, payload, _SCAN_TTL)
    return payload


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
