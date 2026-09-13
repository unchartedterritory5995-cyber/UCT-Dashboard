import pytest
from api.services.catalyst.scoring import score


def _c(**overrides):
    """Build a candidate dict with safe defaults."""
    defaults = {
        "ticker": "TEST",
        "price": 50.0,
        "gap_pct": 5.0,
        "vol_x": 2.0,
        "tweet_mention_count": 0,
        "rss_headline_count": 0,
        "earnings_just_reported": False,
        "scanner_setup": None,
        "sector_momentum_count": 0,
    }
    defaults.update(overrides)
    return defaults


def test_gap_dominates_baseline():
    low = score(_c(gap_pct=1.0))
    high = score(_c(gap_pct=20.0))
    assert high > low


def test_vol_x_increases_score():
    flat = score(_c(vol_x=1.0))
    surge = score(_c(vol_x=10.0))
    assert surge > flat


def test_vol_x_is_logarithmic_not_linear():
    # Linear would mean equal abs delta per equal abs vol_x step (1→10 vs 91→100).
    # Logarithmic means equal delta per equal RATIO step (1→10 vs 10→100),
    # AND smaller delta per equal ABS step at higher inputs.
    s_1, s_10, s_100 = score(_c(vol_x=1.0)), score(_c(vol_x=10.0)), score(_c(vol_x=100.0))
    s_91 = score(_c(vol_x=91.0))
    # Equal-ratio steps produce equal increments under natural log (concave globally)
    assert (s_10 - s_1) == pytest.approx(s_100 - s_10)
    # Equal-abs steps produce diminishing increments (1→10 abs delta > 91→100 abs delta)
    assert (s_10 - s_1) > (s_100 - s_91)


def test_tweet_mentions_add_score():
    quiet = score(_c(tweet_mention_count=0))
    loud = score(_c(tweet_mention_count=5))
    assert loud > quiet


def test_rss_headline_weight_higher_than_tweets():
    s_tweet = score(_c(tweet_mention_count=1))
    s_rss = score(_c(rss_headline_count=1))
    assert s_rss > s_tweet


def test_earnings_just_reported_big_bonus():
    no_er = score(_c(earnings_just_reported=False))
    er = score(_c(earnings_just_reported=True))
    assert (er - no_er) >= 20


def test_scanner_setup_bonus():
    no_setup = score(_c(scanner_setup=None))
    has_setup = score(_c(scanner_setup="PB"))
    assert (has_setup - no_setup) >= 12


def test_penny_stock_penalty():
    mid = score(_c(price=10.0, gap_pct=10.0))
    sub5 = score(_c(price=3.0, gap_pct=10.0))
    sub2 = score(_c(price=1.5, gap_pct=10.0))
    assert sub5 < mid
    assert sub2 < sub5


def test_negative_gap_uses_abs():
    up = score(_c(gap_pct=10.0))
    down = score(_c(gap_pct=-10.0))
    assert up == pytest.approx(down)


def test_zero_safe():
    s = score(_c(gap_pct=0, vol_x=0, tweet_mention_count=0,
                 rss_headline_count=0))
    assert isinstance(s, float)
    assert s == s  # not NaN


def test_market_cap_bonus_lifts_big_caps():
    """A megacap should score higher than a micro-cap with identical signals."""
    micro = score(_c(market_cap=3e8))    # ~$300M (universe floor) -> ~0 bonus
    mega = score(_c(market_cap=3e12))    # ~$3T -> meaningful bonus
    assert mega > micro


def test_market_cap_bonus_can_outrank_bigger_gap():
    """A +5% liquid megacap (news mover) should be able to beat a +12% micro-cap
    — the whole point of the cap bonus for a big-cap-news-mover tool."""
    megacap_small_move = score(_c(gap_pct=5.0, vol_x=1.5, price=140.0, market_cap=3e12))
    microcap_big_move = score(_c(gap_pct=12.0, vol_x=1.5, price=8.0, market_cap=2e8))
    assert megacap_small_move > microcap_big_move


def test_market_cap_missing_is_neutral():
    """Unknown cap = no bonus, no penalty (fail-neutral) — must not crash."""
    s = score(_c(market_cap=None))
    assert isinstance(s, float)


def test_52w_high_breakout_bonus():
    """A name at/near its 52-week high gets a breakout bonus over an identical
    name that isn't — surfaces the swing setup the news feeds miss."""
    base = score(_c(near_52w_high=False))
    breakout = score(_c(near_52w_high=True))
    assert breakout - base >= 8


# ── Regional-bank earnings de-weight ─────────────────────────────────────
def test_regional_bank_earnings_penalized():
    """A small regional bank on earnings scores below an identical non-bank
    earnings mover — the mid-July bank-season noise gets pushed down."""
    bank = score(_c(earnings_just_reported=True, industry="Banks—Regional",
                    market_cap=2e9))
    non_bank = score(_c(earnings_just_reported=True, industry="Software—Application",
                        market_cap=2e9))
    assert (non_bank - bank) >= 15


def test_money_center_bank_not_penalized():
    """A money-center giant (cap above the floor) keeps its full earnings score
    — we only de-weight small/mid regionals."""
    giant = score(_c(earnings_just_reported=True, industry="Banks—Diversified",
                     market_cap=6e11))            # ~$600B, above $50B floor
    non_bank = score(_c(earnings_just_reported=True, industry="Software—Application",
                        market_cap=6e11))
    assert giant == pytest.approx(non_bank)


def test_bank_not_penalized_without_earnings():
    """A regional bank gapping on non-earnings news is a legit catalyst and
    keeps its full score."""
    news_mover = score(_c(earnings_just_reported=False, industry="Banks—Regional",
                          market_cap=2e9))
    non_bank = score(_c(earnings_just_reported=False, industry="Software—Application",
                        market_cap=2e9))
    assert news_mover == pytest.approx(non_bank)


def test_bank_deweight_env_tunable(monkeypatch):
    monkeypatch.setenv("CATALYST_SCORE_W_REGIONAL_BANK", "-40")
    bank = score(_c(earnings_just_reported=True, industry="Banks—Regional",
                    market_cap=2e9))
    non_bank = score(_c(earnings_just_reported=True, industry="Software—Application",
                        market_cap=2e9))
    assert (non_bank - bank) == pytest.approx(40)
