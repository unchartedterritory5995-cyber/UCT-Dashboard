"""Composite scoring formula. Pure function — easy to tune in isolation.

All weights are env-var overridable so live tuning doesn't need a redeploy.
"""
import math
import os


def _w(name: str, default: float) -> float:
    """Read a weight from env or return default."""
    raw = os.environ.get(f"CATALYST_SCORE_W_{name}")
    return float(raw) if raw else default


def score(c: dict) -> float:
    """Composite score for a candidate. Higher = more interesting."""
    s = 0.0

    # Raw gap — primary signal. abs() so big drops score same as big gains.
    s += abs(c.get("gap_pct", 0.0)) * _w("GAP", 1.0)

    # Log-volume bonus (plateaus past ~100x).
    vol_x = max(1.0, c.get("vol_x", 1.0))
    s += math.log(vol_x) * _w("VOLX", 15.0)

    # Social + news signals
    s += c.get("tweet_mention_count", 0) * _w("TWEET_MENTION", 5.0)
    s += c.get("rss_headline_count", 0) * _w("RSS_HEADLINE", 8.0)

    # Earnings — huge bonus for AMC/BMO reporters
    if c.get("earnings_just_reported"):
        s += _w("EARNINGS_REPORTED", 20.0)

    # UCT scanner already flagged this — credit it
    if c.get("scanner_setup"):
        s += _w("SCANNER_SETUP", 12.0)

    # Sector momentum: each peer in candidate pool adds a small bonus
    s += c.get("sector_momentum_count", 0) * _w("SECTOR_MOMENTUM", 5.0)

    # Penny stock penalties
    price = c.get("price", 100.0) or 100.0
    floor = float(os.environ.get("CATALYST_PRICE_FLOOR", "2.0"))
    if price < 5.0:
        s -= _w("PENNY_5_PENALTY", 20.0)
    if price < floor:
        s -= _w("PENNY_FLOOR_PENALTY", 30.0)

    return s
