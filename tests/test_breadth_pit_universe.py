"""Phase 2 point-in-time universe: eligibility selection + calibration metric."""
from api.services import breadth_pit_universe as pit


REF = {
    # common stock, listed 2005, still active
    "AAA": {"type": "CS", "list_date": "2005-01-01", "delisted_utc": None},
    # common stock, DELISTED 2008-09-15 (a Lehman-like casualty)
    "LEH": {"type": "CS", "list_date": "1994-05-01", "delisted_utc": "2008-09-15"},
    # common stock, IPO'd 2021 (not present in 2008)
    "NEW": {"type": "CS", "list_date": "2021-06-01", "delisted_utc": None},
    # an ETF — never breadth-eligible
    "SPY": {"type": "ETF", "list_date": "1993-01-29", "delisted_utc": None},
    # common stock but penny / illiquid
    "PNY": {"type": "CS", "list_date": "2000-01-01", "delisted_utc": None},
    # common stock with no reference row at all (unknown)
    # "ORPH" intentionally absent from REF
}


def _rows(**kv):
    # kv: TICKER=(close, dollarvol)
    return {t: {"c": c, "dv": dv} for t, (c, dv) in kv.items()}


def test_eligible_is_survivorship_free_and_point_in_time():
    rows = _rows(AAA=(50.0, 5e7), LEH=(30.0, 4e7), NEW=(40.0, 3e7),
                 SPY=(500.0, 9e9), PNY=(0.80, 1e4), ORPH=(20.0, 2e7))
    # In 2008, LEH is IN (still trading), NEW is OUT (not yet IPO'd)
    e2008 = pit.eligible("2008-06-30", rows, REF)
    assert e2008 == {"AAA", "LEH"}          # SPY(ETF) PNY(illiquid) NEW(future) ORPH(no ref) all excluded

    # In 2022, LEH is OUT (delisted 2008), NEW is IN
    e2022 = pit.eligible("2022-06-30", rows, REF)
    assert e2022 == {"AAA", "NEW"}


def test_eligible_price_and_liquidity_floors():
    rows = _rows(AAA=(4.99, 5e7),          # below $5 price floor
                 LEH=(30.0, 999_999.0))    # below $1M liquidity floor
    # date where both are otherwise active (2008): both fail their floor
    assert pit.eligible("2008-06-30", rows, REF, price_min=5.0, dollarvol_min=1e6) == set()
    # loosen floors → both pass
    assert pit.eligible("2008-06-30", rows, REF, price_min=1.0, dollarvol_min=1e4) == {"AAA", "LEH"}


def test_active_on_window():
    assert pit.active_on(REF["LEH"], "2008-09-14") is True    # day before delist
    assert pit.active_on(REF["LEH"], "2008-09-16") is False   # after delist
    assert pit.active_on(REF["NEW"], "2020-01-01") is False   # before IPO
    assert pit.active_on(REF["NEW"], "2021-06-01") is True    # on IPO day
    assert pit.active_on(None, "2008-01-01") is False


def test_compare_universe_metric():
    m = pit.compare_universe({"A", "B", "C", "D"}, {"A", "B", "C", "E"})
    assert m["proxy_size"] == 4 and m["actual_size"] == 4
    assert m["precision"] == 0.75 and m["recall"] == 0.75
    assert m["jaccard"] == round(3 / 5, 4)            # |∩|=3, |∪|=5
    assert m["size_delta"] == 0
    assert m["only_in_proxy"] == ["D"] and m["only_in_actual"] == ["E"]
    # empty-vs-empty is a clean pass; empty-vs-nonempty is NOT
    assert pit.compare_universe(set(), set())["jaccard"] == 1.0
    assert pit.compare_universe(set(), {"A"})["jaccard"] == 0.0
