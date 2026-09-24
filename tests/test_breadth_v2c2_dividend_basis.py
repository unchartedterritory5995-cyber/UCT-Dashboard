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


# ── v4: dividends the provider's split-adjusted series already carries ──
def _adj(table):
    return lambda iso, t: table.get((iso, t))


def test_a_scrip_dividend_the_provider_absorbed_is_not_applied_twice():
    # BP 2018-11-08 shape: raw 43.11 -> 41.27 on a $0.615 ex-date; the provider's adj/raw factor
    # steps 0.9548 -> 0.9692 = 1/r — it already carries the distribution as a small split
    raw = _raw({("2024-02-22", "BP"): 43.11, ("2024-02-23", "BP"): 41.27})
    adj = _adj({("2024-02-22", "BP"): 43.11 * 0.9548, ("2024-02-23", "BP"): 41.27 * 0.9548 / (1 - 0.615 / 43.11)})
    t = bdb.build_events([_div("BP", "2024-02-23", 0.615)], CAL, raw, adj_close=adj, splits=[])
    assert "BP" not in t["applied"] and "BP" not in t["withheld_boundaries"]
    assert t["absorbed_by_provider"]["BP"][0][0] == "2024-02-23" and t["counts"]["absorbed_by_provider"] == 1


def test_an_ordinary_dividend_with_a_flat_factor_is_applied():
    raw = _raw({("2024-02-22", "KO"): 60.0, ("2024-02-23", "KO"): 59.6})
    adj = _adj({("2024-02-22", "KO"): 60.0, ("2024-02-23", "KO"): 59.6})
    t = bdb.build_events([_div("KO", "2024-02-23", 0.485)], CAL, raw, adj_close=adj, splits=[])
    assert t["applied"]["KO"] == [("2024-02-23", pytest.approx(1 - 0.485 / 60.0))]


def test_a_small_stock_dividend_beside_cash_is_applied_units_immaterial():
    # CBSH shape: 5 % stock dividend (a real split the provider applied: f steps by 1.05) and a
    # 0.6 % cash dividend the same session — unit ambiguity 0.006 * (1 - 1/1.05) = 0.03 %
    raw = _raw({("2024-02-22", "CBSH"): 55.0, ("2024-02-23", "CBSH"): 52.0})
    adj = _adj({("2024-02-22", "CBSH"): 55.0 / 1.05, ("2024-02-23", "CBSH"): 52.0})
    sp = [{"ticker": "CBSH", "execution_date": "2024-02-23", "split_from": 1, "split_to": 1.05}]
    t = bdb.build_events([_div("CBSH", "2024-02-23", 0.33)], CAL, raw, adj_close=adj, splits=sp)
    assert t["applied"]["CBSH"] == [("2024-02-23", pytest.approx(1 - 0.33 / 55.0))]
    assert t["counts"]["split_session_units_immaterial"] == 1


def test_a_cash_dividend_on_a_two_for_one_split_session_is_withheld():
    raw = _raw({("2024-02-22", "CIG"): 10.0, ("2024-02-23", "CIG"): 4.9})
    adj = _adj({("2024-02-22", "CIG"): 5.0, ("2024-02-23", "CIG"): 4.9})
    sp = [{"ticker": "CIG", "execution_date": "2024-02-23", "split_from": 1, "split_to": 2}]
    t = bdb.build_events([_div("CIG", "2024-02-23", 0.25)], CAL, raw, adj_close=adj, splits=sp)
    assert "CIG" not in t["applied"] and "cash units unprovable" in t["withheld_detail"][0]["reason"]


# ── v5: non-USD cash, converted at the ECB reference rate — only where the listing IS the share ──
ECB = {"USD": {"2024-02-21": 1.08, "2024-02-22": 1.0800}, "CAD": {"2024-02-21": 1.46, "2024-02-22": 1.4600},
       "GBP": {"2024-02-22": 0.855}}


def test_cad_cash_on_an_interlisted_share_is_converted_at_the_prior_session_rate():
    # BMO shape: CAD 1.59 per share, USD-priced NYSE line — Yahoo: cash_usd / prev close
    raw = _raw({("2024-02-22", "BMO"): 95.0})
    fx = bdb.FxRates(ECB)
    t = bdb.build_events([_div("BMO", "2024-02-23", 1.59, cur="CAD")], CAL, raw, fx=fx,
                         sec_type=lambda tk, iso: "CS")
    usd = 1.59 * 1.08 / 1.46
    assert t["applied"]["BMO"] == [("2024-02-23", pytest.approx(1 - usd / 95.0))]
    assert t["counts"]["fx_converted"] == 1


def test_foreign_cash_on_an_adr_stays_withheld():
    raw = _raw({("2024-02-22", "BP"): 35.0})
    t = bdb.build_events([_div("BP", "2024-02-23", 0.2, cur="GBP")], CAL, raw, fx=bdb.FxRates(ECB),
                         sec_type=lambda tk, iso: "ADRC")
    assert "BP" not in t["applied"] and "per-share basis unprovable" in t["withheld_detail"][0]["reason"]


def test_a_stale_or_missing_rate_is_withheld_never_carried():
    raw = _raw({("2024-02-22", "DB"): 15.0})
    fx = bdb.FxRates({"USD": {"2024-02-01": 1.08}, "CAD": {"2024-02-01": 1.46}})      # 21 days old
    t = bdb.build_events([_div("DB", "2024-02-23", 0.45, cur="CAD")], CAL, raw, fx=fx, sec_type=lambda tk, iso: "CS")
    assert "DB" not in t["applied"] and "no ECB CAD rate" in t["withheld_detail"][0]["reason"]
    t = bdb.build_events([_div("DB", "2024-02-23", 0.45, cur="XAU")], CAL, raw, fx=bdb.FxRates(ECB), sec_type=lambda tk, iso: "CS")
    assert "DB" not in t["applied"]


def test_eur_uses_the_usd_per_eur_rate_and_mixed_currency_is_withheld():
    raw = _raw({("2024-02-22", "DB"): 15.0})
    t = bdb.build_events([_div("DB", "2024-02-23", 0.45, cur="EUR")], CAL, raw, fx=bdb.FxRates(ECB), sec_type=lambda tk, iso: "CS")
    assert t["applied"]["DB"] == [("2024-02-23", pytest.approx(1 - 0.45 * 1.08 / 15.0))]
    t = bdb.build_events([_div("DB", "2024-02-23", 0.45, cur="EUR"), _div("DB", "2024-02-23", 0.49, cur="USD")],
                         CAL, raw, fx=bdb.FxRates(ECB), sec_type=lambda tk, iso: "CS")
    assert "DB" not in t["applied"] and "mixed" in t["withheld_detail"][0]["reason"]
