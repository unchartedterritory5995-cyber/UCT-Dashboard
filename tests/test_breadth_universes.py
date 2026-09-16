"""The universe registry: identity, venue sets, and the 2011 exchange floor.

These are POLICY rails. The floors encode a product decision taken on measured
evidence (Phase 1 gate, 2026-09-14) and a future edit that quietly lowers one
should fail here rather than in a published series.
"""
import pytest

from api.services import breadth_universes as bu


def test_the_four_universes_exist_and_uct_is_the_default():
    assert bu.UNIVERSE_IDS == ["uct", "us", "nasdaq", "nyse"]
    assert bu.DEFAULT_UNIVERSE == "uct"
    # Every pre-universe row belongs to UCT — that is what makes the migration a
    # key widening rather than a reinterpretation.
    assert bu.normalize(None) == "uct"
    assert bu.normalize("") == "uct"
    assert bu.normalize("  NASDAQ ") == "nasdaq"


def test_an_unknown_universe_raises_and_never_falls_back_to_uct():
    # ⛔ The whole point: a typo must not silently write into UCT's series.
    with pytest.raises(bu.UnknownUniverse):
        bu.get("nasdaq100")
    with pytest.raises(bu.UnknownUniverse):
        bu.get("NYSE_ARCA")
    assert bu.exists("nyse") and not bu.exists("amex")


def test_nasdaq_matches_every_tier_not_just_the_composite():
    # XNGS/XNMS/XNCM are the Global Select / Global Market / Capital Market tiers;
    # matching only XNAS would drop a tier's worth of listings.
    assert bu.venues("nasdaq") == frozenset({"XNAS", "XNGS", "XNMS", "XNCM"})
    assert bu.venues("nyse") == frozenset({"XNYS"})


def test_us_is_a_superset_of_both_exchanges_but_not_their_union():
    us = bu.venues("us")
    assert bu.venues("nasdaq") < us and bu.venues("nyse") < us
    # ARCX/BATS/XASE/IEXG belong to US and to NEITHER exchange universe.
    assert us - (bu.venues("nasdaq") | bu.venues("nyse")) == {"XASE", "ARCX", "BATS", "IEXG"}


def test_uct_selects_no_venue_because_the_collector_owns_its_membership():
    assert bu.venues("uct") is None
    assert bu.is_pit("uct") is False
    assert all(bu.is_pit(u) for u in ("us", "nasdaq", "nyse"))
    assert bu.PIT_UNIVERSE_IDS == ["us", "nasdaq", "nyse"]


def test_the_exchange_floors_are_2011_and_us_is_2008():
    assert bu.floor("us") == "2008-01-02"
    assert bu.floor("nasdaq") == "2011-01-01"
    assert bu.floor("nyse") == "2011-01-01"
    assert bu.floor("uct") is None       # this project never recomputes UCT


def test_a_sweep_below_an_exchange_floor_is_REFUSED_not_clamped():
    # ⛔ Clamping would let a downward backfill loop spin without progress and look
    # finished. Refusing surfaces the bug.
    for uni in ("nasdaq", "nyse"):
        with pytest.raises(bu.BelowHistoryFloor) as ei:
            bu.sweepable_range(uni, "2008-01-02", "2008-12-31")
        assert "2011-01-01" in str(ei.value)
        # and the boundary itself is allowed
        assert bu.sweepable_range(uni, "2011-01-01", "2011-12-31")[0] == "2011-01-01"
    with pytest.raises(bu.BelowHistoryFloor):
        bu.sweepable_range("us", "2007-12-31")
    assert bu.sweepable_range("us", "2008-01-02")[0] == "2008-01-02"


def test_the_floor_reason_points_at_the_evidence_not_at_a_preference():
    # A future reader must be able to find out WHY from the code.
    with pytest.raises(bu.BelowHistoryFloor) as ei:
        bu.sweepable_range("nasdaq", "2010-06-01")
    msg = str(ei.value)
    assert "attribution" in msg and "breadth_universes" in msg
