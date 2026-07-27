"""F3 (audit 2026-07-07): high-premium escape from the volume floor.

The volume floor and premium floor were an AND, so an expensive low-lot
institutional print (large in dollars, small in contract count) was dropped
entirely. The escape keeps a below-volume print when its premium is
genuinely large, while the absolute premium floor still kills dollar-noise.
"""
from api.massive_processor import CANCEL_CONDITIONS, TradeAggregator, RawTrade

# A real OCC option symbol the aggregator's parse_occ accepts.
OCC = "O:SPXW260717C05000000"


def _drain_one(agg):
    if hasattr(agg, "flush_all"):
        agg.flush_all()
    return agg.drain()


def _feed(agg, price, lots, base_ns, conditions=()):
    # `conditions` is the full OPRA condition tuple. It was a single int until
    # 2026-07-26, when add_trade started iterating it to catch cancel codes in
    # any position -- the old `conditions=-1` form made every test here raise
    # TypeError. Empty = an ordinary print with no special codes.
    for i in range(lots):
        agg.add_trade(RawTrade(ticker=OCC, price=price, size=1, exchange=1,
                               conditions=conditions, ts_ns=base_ns + i))


def test_high_premium_low_volume_print_is_kept():
    # 20 lots of a $60 option = $120,000 premium, volume 20 (< 50 floor).
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    _feed(agg, 60.0, 20, 1_000_000_000)
    evts = _drain_one(agg)
    assert len(evts) == 1
    assert evts[0].premium == 120_000.0 and evts[0].total_size == 20
    assert agg._stats["kept_high_premium_low_volume"] == 1


def test_low_premium_low_volume_still_dropped():
    # 20 lots of a $1 option = $2,000 premium — below the absolute floor.
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    _feed(agg, 1.0, 20, 2_000_000_000)
    assert _drain_one(agg) == []
    assert agg._stats["dropped_below_premium"] == 1


def test_below_escape_low_volume_dropped():
    # 20 lots of a $7.50 option = $15,000 premium: clears the $10k floor but
    # NOT the $25k escape, and is below the volume floor → dropped.
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    _feed(agg, 7.5, 20, 3_000_000_000)
    assert _drain_one(agg) == []
    assert agg._stats["dropped_below_volume"] == 1


def test_normal_high_volume_print_unaffected():
    # 100 lots of a $2 option = $20,000 premium, volume 100 (>= floor) →
    # kept the normal way (escape not involved).
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    _feed(agg, 2.0, 100, 4_000_000_000)
    evts = _drain_one(agg)
    assert len(evts) == 1 and evts[0].total_size == 100
    assert agg._stats["kept_high_premium_low_volume"] == 0


def test_escape_default_from_env(monkeypatch):
    monkeypatch.setenv("MASSIVE_HIGH_PREMIUM_ESCAPE", "50000")
    agg = TradeAggregator(min_premium=10_000, min_volume=50)  # no explicit escape
    assert agg.high_premium_escape == 50_000.0
    # $30k premium 10-lot: above $10k floor, below $50k escape, below vol → drop
    _feed(agg, 30.0, 10, 5_000_000_000)
    assert _drain_one(agg) == []


# --- Cancel-condition filtering (added 2026-07-26 alongside the tuple widening)
# The change that widened RawTrade.conditions from a single int to the full OPRA
# tuple shipped with no test of its own -- and it silently broke every test above
# until 2026-07-27. These pin the behaviour it was written to deliver.

def test_cancelled_print_is_dropped():
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    # Same shape as test_high_premium_low_volume_print_is_kept, which asserts
    # this IS kept without a cancel code -- so the drop below is the code's doing.
    _feed(agg, 60.0, 20, 6_000_000_000, conditions=(201,))
    assert _drain_one(agg) == []
    assert agg._stats["dropped_cancelled"] == 20


def test_cancel_code_is_caught_in_any_position():
    """A cancel code outside position 0 must still drop the print.

    This is the actual defect the tuple widening fixed: `conditions` used to
    carry only the FIRST OPRA code, so a cancel sitting behind another code was
    invisible and its premium was counted as real flow.
    """
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    # Precondition: the leading code is genuinely NOT a cancel, so the drop can
    # only come from reading past position 0.
    assert 227 not in CANCEL_CONDITIONS and 203 in CANCEL_CONDITIONS
    _feed(agg, 60.0, 20, 7_000_000_000, conditions=(227, 203))
    assert _drain_one(agg) == []
    assert agg._stats["dropped_cancelled"] == 20


def test_non_cancel_conditions_do_not_drop():
    agg = TradeAggregator(min_premium=10_000, min_volume=50,
                          high_premium_escape=25_000)
    _feed(agg, 60.0, 20, 8_000_000_000, conditions=(227, 219))
    evts = _drain_one(agg)
    assert len(evts) == 1 and evts[0].total_size == 20
    assert agg._stats.get("dropped_cancelled", 0) == 0
