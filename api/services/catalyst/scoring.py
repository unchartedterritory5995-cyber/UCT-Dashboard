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

    # Market-cap / liquidity bonus — a notable big-cap NEWS mover should rank
    # above a microcap with a bigger raw % gap. Scaled vs the ~$300M universe
    # floor (log10 3e8 ≈ 8.5), so $300M→0 and ~$3T→~24 at the default weight.
    # Fail-neutral when cap is unknown (no bonus, no penalty).
    mc = c.get("market_cap")
    if isinstance(mc, (int, float)) and mc > 0:
        s += max(0.0, math.log10(mc) - 8.5) * _w("MARKET_CAP", 6.0)

    # 52-week-high breakout bonus — a price at/near new highs on volume is a
    # core swing setup that pure news/gap signals miss.
    if c.get("near_52w_high"):
        s += _w("FIFTYTWO_WK_HIGH", 8.0)

    # Analyst rating / PT change — a clean upgrade with a modest gap should
    # still rank against bigger pure-% movers.
    if c.get("analyst_meta"):
        s += _w("ANALYST_ACTION", 12.0)

    # Freshness: a catalyst breaking TODAY (not ranked in the prior days) gets a
    # boost so 'new and sudden' surfaces above multi-day continuations. Multi-day
    # runners are NOT penalized — they simply don't get this bonus.
    if c.get("is_new"):
        s += _w("FRESHNESS", 6.0)

    # Penny stock penalties
    price = c.get("price", 100.0) or 100.0
    floor = float(os.environ.get("CATALYST_PRICE_FLOOR", "2.0"))
    if price < 5.0:
        s -= _w("PENNY_5_PENALTY", 20.0)
    if price < floor:
        s -= _w("PENNY_FLOOR_PENALTY", 30.0)

    return s
