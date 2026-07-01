"""Regression for the massive_ws color-refresh unpack bug (2026-07-01).

The OI color-backfill loop consumes `resolved` items shaped `(contract_key, oi,
source)`, where `contract_key` is a pipe-delimited string from `make_key()`. The
loop used to unpack that string as a 4-tuple `(sym, cp, strike, exp), oi, src`,
which raised "too many values to unpack (expected 4)" on every OI batch and
silently disabled the whole color backfill. It must `parse_key()` the string.
"""

from api.oi_snapshots import make_key, parse_key


def test_parse_key_round_trips_make_key_into_four_typed_fields():
    ck = make_key("NVDA", "CALL", 200, "6/19/2026")
    assert ck == "NVDA|C|200.0|6/19/2026"

    sym, cp_letter, strike, exp_mdy = parse_key(ck)
    assert sym == "NVDA"
    assert cp_letter == "C"            # single-letter, as the color loop expects
    assert isinstance(strike, float)   # `strike == int(strike)` downstream needs a number
    assert strike == 200.0
    assert exp_mdy == "6/19/2026"      # M/D/YYYY, matches the flow table


def test_resolved_item_is_a_three_tuple_not_a_nested_four_tuple():
    # This is the exact shape the worker builds: (ck, oi, source).
    resolved = [(make_key("AAPL", "P", 150, "7/18/2026"), 1234, "ondemand")]
    for ck, oi, src in resolved:            # must unpack as 3, not 4
        sym, cp_letter, strike, exp_mdy = parse_key(ck)
        assert (sym, cp_letter, strike, exp_mdy) == ("AAPL", "P", 150.0, "7/18/2026")
        assert oi == 1234 and src == "ondemand"
