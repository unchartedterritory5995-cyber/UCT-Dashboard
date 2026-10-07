"""Breadth finishing pass (2026-10-07): the derived breadth ratios and the sign-safe quote.

A/D Ratio, A/D Percent, Unchanged, Record High Percent and the High-Low Index are arithmetic
over counts the authorities already publish. These rails pin the formulas, the zero-denominator
rule (a HOLE, never a zero), the High-Low Index window, and that the registry only offers a
series whose inputs exist for that universe.
"""
from __future__ import annotations

import math

import pytest

from api.services.market_indicators import producers as P
from api.services.market_indicators import registry as reg


def test_ad_ratio_and_percent_formulas_and_zero_denominators():
    adv = [600, 1000, 0, 500, None]
    dec = [400, 0, 0, 500, 300]
    assert P.ad_ratio_values(adv, dec) == [1.5, None, None, 1.0, None]
    pct = P.ad_percent_values(adv, dec)
    assert pct[0] == pytest.approx(20.0)          # (600-400)/(1000) × 100
    assert pct[1] == pytest.approx(100.0)         # all advancers
    assert pct[2] is None                         # 0 + 0: undefined, a hole
    assert pct[3] == pytest.approx(0.0)
    assert pct[4] is None                         # missing input


def test_record_high_percent_and_its_hole():
    assert P.record_high_percent_values([30, 0, 0, None], [10, 5, 0, 4]) == [75.0, 0.0, None, None]


def test_high_low_index_needs_a_full_window_of_defined_sessions():
    rhp = [float(i) for i in range(1, 13)]                     # 12 sessions, all defined
    hli = P.high_low_index_values(rhp, window=10)
    assert hli[:9] == [None] * 9
    assert hli[9] == pytest.approx(sum(range(1, 11)) / 10)
    assert hli[11] == pytest.approx(sum(range(3, 13)) / 10)
    holed = rhp[:]
    holed[10] = None
    h2 = P.high_low_index_values(holed, window=10)
    assert h2[10] is None and h2[11] is None                   # a hole poisons its window, never shrinks it
    assert h2[9] == hli[9]


def test_the_registry_offers_exactly_the_derivable_series():
    ids = {s.id for s in reg._ROWS if s.id.split(":")[-1] in reg.RATIO_KINDS}
    assert ids == {"US:ADR", "US:ADP", "US:RHP", "US:HLI",
                   "NYSE:ADR", "NYSE:ADP", "NYSE:UNCH", "NYSE:RHP", "NYSE:HLI",
                   "NASDAQ:ADR", "NASDAQ:ADP", "NASDAQ:UNCH", "NASDAQ:RHP", "NASDAQ:HLI"}
    assert "US:UNCH" not in reg.SERIES                         # US V2 stores no `unchanged`
    for sid in ids:
        s = reg.SERIES[sid]
        assert s.source_type == reg.SRC_BREADTH_DERIVED and not s.ohlc_capable
        assert s.methodology and s.history_start
        # exchange rows are dormant in the table — published only while the authority serves
        assert (s.status == reg.ST_DORMANT) is (s.universe in ("nyse", "nasdaq")), sid
        assert sid in reg.EXCHANGE_SERIES_IDS or s.universe == "us"


def test_us_ratios_are_computed_from_the_store_with_holes_kept(monkeypatch):
    hist = {
        "advancing": {"2026-01-02": {"c": 600}, "2026-01-05": {"c": 700}, "2026-01-06": {"c": 800}},
        "declining": {"2026-01-02": {"c": 400}, "2026-01-05": {"c": 0}},          # 01-06 missing
        "new_52w_highs": {"2026-01-02": {"c": 0}, "2026-01-05": {"c": 9}},
        "new_52w_lows": {"2026-01-02": {"c": 0}, "2026-01-05": {"c": 1}},
    }
    from api.services import breadth_daily_ohlc as store
    monkeypatch.setattr(store, "history", lambda metric, limit=0, universe="uct", with_source=False:
                        dict(hist.get(metric, {})) if universe == "us" else {})
    P.invalidate()
    adr = P.build("US:ADR")
    assert adr.dates == ["2026-01-02", "2026-01-05", "2026-01-06"]
    assert adr.values == [1.5, None, None]                    # zero and missing denominators are holes
    rhp = P.build("US:RHP")
    assert rhp.values == [None, 90.0]                          # 0 highs + 0 lows: undefined
    assert P.build("US:ADP").values[0] == pytest.approx(20.0)
    P.invalidate()


def test_a_signed_breadth_quote_has_no_percent(monkeypatch):
    from api.services import breadth_symbols as bs
    from api.services import breadth_monitor
    monkeypatch.setattr(breadth_monitor, "get_history", lambda n=0: [
        {"date": "2026-10-06", "mcclellan_osc": -25.0, "pct_above_50sma": 30.0},
        {"date": "2026-10-05", "mcclellan_osc": -50.0, "pct_above_50sma": 20.0},
    ])
    monkeypatch.setattr(bs, "_live_map", lambda: {})
    q = bs.latest_quotes(["UCTMC", "UCTA50"])
    assert q["UCTMC"]["change"] == pytest.approx(25.0) and q["UCTMC"]["change_pct"] is None
    assert q["UCTA50"]["change_pct"] == pytest.approx(50.0)
    assert all(math.isfinite(v["change"]) for v in q.values())


def test_us_data_through_is_the_v2_authority_not_the_v1_store(monkeypatch):
    """⛔ The library's "data through" line is a promise about the SERVED series. Under V2 the old
    V1 store can hold a session members do not have yet — it must not leak into availability."""
    from api.services import breadth_symbols as bs
    from api.services import breadth_authority as ba
    from api.services import breadth_daily_ohlc as store
    monkeypatch.setattr(ba, "universe_dates", lambda u, since="": ["2008-01-02", "2026-10-05"] if u == "us" else None)
    monkeypatch.setattr(store, "stats", lambda u="uct": {"rows": 9, "first": "2008-01-02", "last": "2026-10-06"})
    bs._avail_cache.update(at=0.0, value=None)
    av = bs.availability()
    assert av["us"]["last"] == "2026-10-05" and av["us"]["authority"] == "breadth-v2"
    assert av["uct"]["last"] == "2026-10-06"           # UCT is not V2-owned here: unchanged path
    bs._avail_cache.update(at=0.0, value=None)
