"""F4 — the canonical dividend-adjusted basis (breadth_dividend_basis)."""
import numpy as np
import pytest

from api.services import breadth_dividend_basis as bdb

CAL = ["2024-02-%02d" % d for d in (20, 21, 22, 23, 26, 27, 28, 29)]


def _raw(table):
    return lambda iso, t: table.get((iso, t))


def _div(t, ex, cash, typ="CD", cur="USD"):
    return {"ticker": t, "ex_dividend_date": ex, "cash_amount": cash, "dividend_type": typ, "currency": cur}


def test_ratio_is_taken_in_raw_units_even_after_a_later_split():
    """WMT-shape: $0.57 paid on a $165 raw share that later split 3:1 (split-adjusted $55).
    The live store divided by the adjusted $55 (r = 0.98964); the canonical ratio uses the
    raw close of the same session (r = 0.99655)."""
    raw = _raw({("2024-02-22", "WMT"): 165.0})
    t = bdb.build_events([_div("WMT", "2024-02-23", 0.57)], CAL, raw)
    (sess, r), = t["applied"]["WMT"]
    assert sess == "2024-02-23" and r == pytest.approx(1 - 0.57 / 165.0)


def test_a_same_day_ex_date_is_not_applied_and_the_last_bar_stays_raw():
    b = bdb.DividendBasis({"version": "v", "applied": {"KO": [("2024-02-28", 0.99)]},
                           "withheld_boundaries": {}})
    frame = CAL[:6]                                    # D = 2024-02-28 is NOT in its frame
    assert np.all(b.factors(["KO"], frame) == 1.0)
    F = b.factors(["KO"], CAL[:7])                     # D = 02-29: ex 02-28 is the frame's last bar
    assert list(F[0]) == [0.99] * 6 + [1.0]


def test_types_on_one_ex_date_are_summed_and_identical_duplicates_collapse():
    raw = _raw({("2024-02-22", "COST"): 700.0})
    t = bdb.build_events([_div("COST", "2024-02-23", 1.02), _div("COST", "2024-02-23", 1.02),
                          _div("COST", "2024-02-23", 15.0, "SC")], CAL, raw)
    (_, r), = t["applied"]["COST"]
    assert r == pytest.approx(1 - 16.02 / 700.0) and t["counts"]["multi_type_summed"] == 1


@pytest.mark.parametrize("recs,why", [
    ([_div("X", "2024-02-23", 1.0), _div("X", "2024-02-23", 1.5)], "conflicting"),
    ([_div("X", "2024-02-23", 1.0, cur="CAD")], "non-USD"),
    ([_div("X", "2024-02-23", 60.0)], ">="),
])
def test_unprovable_events_are_withheld_never_guessed(recs, why):
    t = bdb.build_events(recs, CAL, _raw({("2024-02-22", "X"): 100.0}))
    assert "X" not in t["applied"] and t["withheld_boundaries"]["X"] == ["2024-02-23"]
    assert why in t["withheld_detail"][0]["reason"]


def test_no_prior_raw_close_is_withheld_and_a_weekend_ex_date_maps_to_the_next_session():
    t = bdb.build_events([_div("Y", "2024-02-24", 0.1)], CAL, _raw({}))
    assert t["withheld_boundaries"]["Y"] == ["2024-02-26"]
    t = bdb.build_events([_div("Y", "2024-02-24", 0.1)], CAL, _raw({("2024-02-23", "Y"): 10.0}))
    assert t["applied"]["Y"] == [("2024-02-26", pytest.approx(0.99))]


def test_withholding_covers_frames_containing_the_ex_session_but_not_the_ex_day_itself():
    b = bdb.DividendBasis({"version": "v", "applied": {}, "withheld_boundaries": {"Z": ["2024-02-26"]}})
    assert not b.withheld_in("Z", "2024-02-20", "2024-02-26")     # same-day: not in the frame
    assert b.withheld_in("Z", "2024-02-20", "2024-02-27")
    assert not b.withheld_in("Z", "2024-02-26", "2024-02-29")     # frame starts at/after it
