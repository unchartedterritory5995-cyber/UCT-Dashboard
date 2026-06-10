"""Deterministic tag assignment for a candidate. Runs BEFORE scoring.
Order matters — Earnings wins, then Catalyst, then Gapper, then News."""
import os
from typing import Optional


def _f(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def assign_tag(c: dict) -> Optional[str]:
    if c.get("earnings_reported_recently"):
        return "Earnings"
    if c.get("tweet_mention_count", 0) >= 2 or c.get("rss_headline_count", 0) >= 1:
        return "Catalyst"
    gap = abs(c.get("gap_pct", 0.0))
    # Strict Gapper (general candidates): big gap AND a volume surge.
    if gap >= 5.0 and c.get("vol_x", 0.0) >= 3.0:
        return "Gapper"
    # Gap-scan movers are already liquidity- and dollar-volume-qualified (they
    # ranked into the top-N most-traded names gapping >= the scan floor), so a
    # meaningful gap ALONE tags them Gapper. The vol_x>=3 surge requirement
    # structurally excludes big-caps — a megacap's baseline volume is so large
    # it rarely triples even on real news — which is exactly why big-cap NEWS
    # movers (MU/SIRI/NBIS) were falling through to tag=None. Env-tunable.
    if c.get("from_gap_scan") and gap >= _f("CATALYST_GAPSCAN_GAPPER_PCT", 3.0):
        return "Gapper"
    if c.get("tweet_mention_count", 0) >= 1:
        return "News"
    return None
