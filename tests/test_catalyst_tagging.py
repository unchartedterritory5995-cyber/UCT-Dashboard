import pytest
from api.services.catalyst.tagging import assign_tag


def _c(**overrides):
    defaults = {
        "ticker": "TEST",
        "gap_pct": 2.0,
        "vol_x": 1.5,
        "tweet_mention_count": 0,
        "rss_headline_count": 0,
        "earnings_reported_recently": False,
    }
    defaults.update(overrides)
    return defaults


def test_earnings_wins_first():
    c = _c(earnings_reported_recently=True, tweet_mention_count=5,
           rss_headline_count=3, gap_pct=10.0)
    assert assign_tag(c) == "Earnings"


def test_catalyst_when_2_tweets():
    c = _c(tweet_mention_count=2)
    assert assign_tag(c) == "Catalyst"


def test_catalyst_when_1_rss():
    c = _c(rss_headline_count=1)
    assert assign_tag(c) == "Catalyst"


def test_gapper_when_big_gap_no_news():
    c = _c(gap_pct=8.0, vol_x=5.0)
    assert assign_tag(c) == "Gapper"


def test_gapper_requires_both_gap_and_volume():
    c = _c(gap_pct=8.0, vol_x=1.5)
    assert assign_tag(c) != "Gapper"


def test_news_when_1_tweet_and_small_gap():
    c = _c(tweet_mention_count=1, gap_pct=1.0)
    assert assign_tag(c) == "News"


def test_none_when_no_signals():
    c = _c()
    assert assign_tag(c) is None


def test_negative_gap_counts_for_gapper():
    c = _c(gap_pct=-8.0, vol_x=5.0)
    assert assign_tag(c) == "Gapper"


def test_gap_scan_mover_tags_gapper_without_volume_surge():
    """A gap-scan mover (already liquidity-qualified) tags Gapper on gap alone —
    even a modest +4% big-cap with low vol_x that the strict rule would drop."""
    c = _c(gap_pct=4.0, vol_x=1.2, from_gap_scan=True)
    assert assign_tag(c) == "Gapper"


def test_non_gap_scan_mover_still_needs_volume_surge():
    """Same numbers WITHOUT the gap-scan flag stay untagged — the strict rule
    is preserved for general candidates."""
    c = _c(gap_pct=4.0, vol_x=1.2, from_gap_scan=False)
    assert assign_tag(c) is None


def test_gap_scan_below_floor_not_gapper():
    c = _c(gap_pct=1.5, vol_x=1.2, from_gap_scan=True)
    assert assign_tag(c) is None
