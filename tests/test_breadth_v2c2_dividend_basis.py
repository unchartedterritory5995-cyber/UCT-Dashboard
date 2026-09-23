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


def test_types_on_one_ex_date_are_summed():
    raw = _raw({("2024-02-22", "COST"): 700.0})
    t = bdb.build_events([_div("COST", "2024-02-23", 1.02), _div("COST", "2024-02-23", 15.0, "SC")], CAL, raw)
    (_, r), = t["applied"]["COST"]
    assert r == pytest.approx(1 - 16.02 / 700.0) and t["counts"]["multi_type_summed"] == 1


def test_several_distributions_of_one_type_are_summed():
    # LYB 2011-11-22: $0.25 regular + $4.50 special, both published as CD (Yahoo: 4.75)
    raw = _raw({("2024-02-22", "LYB"): 40.0})
    t = bdb.build_events([_div("LYB", "2024-02-23", 0.25), _div("LYB", "2024-02-23", 4.50)], CAL, raw)
    assert t["applied"]["LYB"] == [("2024-02-23", pytest.approx(1 - 4.75 / 40.0))]
    assert t["counts"]["multi_amount_summed"] == 1


def test_one_amount_published_twice_under_one_symbol_is_withheld():
    # duplicate publication or two equal payments — Yahoo measured both ways (17 vs 23)
    raw = _raw({("2024-02-22", "MAC"): 60.0})
    t = bdb.build_events([_div("MAC", "2024-02-23", 2.0), _div("MAC", "2024-02-23", 2.0)], CAL, raw)
    assert "MAC" not in t["applied"] and t["withheld_boundaries"]["MAC"] == ["2024-02-23"]
    assert "twice under one symbol" in t["withheld_detail"][0]["reason"]


def test_near_identical_amounts_are_a_restatement_and_withheld():
    raw = _raw({("2024-02-22", "ASR"): 250.0})
    t = bdb.build_events([_div("ASR", "2024-02-23", 3.358778), _div("ASR", "2024-02-23", 3.396091)], CAL, raw)
    assert "ASR" not in t["applied"] and "restatement" in t["withheld_detail"][0]["reason"]
    ok = bdb.build_events([_div("ASR", "2024-02-23", 3.30), _div("ASR", "2024-02-23", 3.40)], CAL, raw)
    assert ok["applied"]["ASR"] == [("2024-02-23", pytest.approx(1 - 6.70 / 250.0))]     # 2.9 % apart


@pytest.mark.parametrize("recs,why", [
    ([_div("X", "2024-02-23", 1.0), _div("X", "2024-02-23", 1.01)], "restatement"),
    ([_div("X", "2024-02-23", 1.0, cur=None)], "missing currency"),
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


# ── v2: dual-class spelling (the dividend ledger concatenates, the price files dot) ──
def test_a_concatenated_ledger_spelling_resolves_to_the_traded_dotted_class():
    raw = _raw({("2024-02-22", "BF.B"): 50.0, ("2024-02-22", "BF.A"): 52.0})
    t = bdb.build_events([_div("BFB", "2024-02-23", 0.2), _div("BFA", "2024-02-23", 0.2)], CAL, raw)
    assert t["applied"]["BF.B"] == [("2024-02-23", pytest.approx(1 - 0.2 / 50.0))]
    assert t["applied"]["BF.A"] == [("2024-02-23", pytest.approx(1 - 0.2 / 52.0))]
    assert "BFB" not in t["applied"] and t["respelled"] == {"BFA->BF.A": 1, "BFB->BF.B": 1}


def test_a_literal_ticker_that_trades_is_never_respelled():
    # FOXA trades as FOXA; there is no FOX.A — nothing to resolve
    t = bdb.build_events([_div("FOXA", "2024-02-23", 0.26)], CAL, _raw({("2024-02-22", "FOXA"): 30.0}))
    assert list(t["applied"]) == ["FOXA"] and t["respelled"] == {}


def test_both_spellings_trading_is_ambiguous_and_withholds_both():
    raw = _raw({("2024-02-22", "ABCD"): 10.0, ("2024-02-22", "ABC.D"): 20.0})
    t = bdb.build_events([_div("ABCD", "2024-02-23", 0.1)], CAL, raw)
    assert t["applied"] == {}
    assert t["withheld_boundaries"] == {"ABCD": ["2024-02-23"], "ABC.D": ["2024-02-23"]}
    assert t["counts"]["ambiguous_spelling"] == 1


def test_dotted_and_concatenated_records_merge_and_conflicts_fail_closed():
    raw = _raw({("2024-02-22", "WSO.B"): 400.0})
    same = bdb.build_events([_div("WSO.B", "2024-02-23", 2.7), _div("WSOB", "2024-02-23", 2.7)], CAL, raw)
    assert same["applied"]["WSO.B"] == [("2024-02-23", pytest.approx(1 - 2.7 / 400.0))]
    diff = bdb.build_events([_div("WSO.B", "2024-02-23", 2.7), _div("WSOB", "2024-02-23", 2.5)], CAL, raw)
    assert diff["applied"]["WSO.B"] == [("2024-02-23", pytest.approx(1 - 5.2 / 400.0))]     # two distributions
