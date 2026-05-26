"""Deterministic tag assignment for a candidate. Runs BEFORE scoring.
Order matters — Earnings wins, then Catalyst, then Gapper, then News."""
from typing import Optional


def assign_tag(c: dict) -> Optional[str]:
    if c.get("earnings_reported_recently"):
        return "Earnings"
    if c.get("tweet_mention_count", 0) >= 2 or c.get("rss_headline_count", 0) >= 1:
        return "Catalyst"
    if abs(c.get("gap_pct", 0.0)) >= 5.0 and c.get("vol_x", 0.0) >= 3.0:
        return "Gapper"
    if c.get("tweet_mention_count", 0) >= 1:
        return "News"
    return None
