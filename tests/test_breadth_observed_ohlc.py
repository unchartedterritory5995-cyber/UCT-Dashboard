"""The observed-OHLC mark on served breadth bars (`ohlc: 1`).

⭐ A breadth bar's CLOSE is the number of record; its O/H/L is EITHER an observation of the
metric through the session (a store row from `OBSERVED_OHLC_SOURCES`) OR a close-to-close
body. The chart draws Candles/Bars only from the first, so the server marks it — additively,
never moving a value. These rails pin: which sources mark, that bodies never do, that a
period is marked only when every day in it is, that the developing candle never is, and that
`history()` keeps its exact shape unless a caller opts in.
"""
from unittest.mock import patch

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_symbols as bs


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.setenv("BREADTH_AUTHORITY", "v1")
    store._INIT_DONE = False
    bs._breadth_cache.delete_prefix("breadthdaily_")
    yield
    bs._breadth_cache.delete_prefix("breadthdaily_")
    store._INIT_DONE = False


M = "pct_above_5sma"


def _seed():
    # Mon..Fri of one week + Mon..Tue of the next.
    store.write_bulk([("2026-08-03", M, 40.0, 55.0, 38.0, 50.0),
                      ("2026-08-04", M, 51.0, 60.0, 49.0, 58.0),
                      ("2026-08-05", M, 57.0, 59.0, 41.0, 44.0),
                      ("2026-08-06", M, 45.0, 52.0, 43.0, 47.0),
                      ("2026-08-07", M, 48.0, 61.0, 47.5, 60.0),
                      ("2026-08-11", M, 59.0, 63.0, 55.0, 62.0)], source="intraday_recon")
    # a BODY row (close_recon) — four finite numbers, no observation
    store.write_bulk([("2026-08-10", M, 60.0, 61.0, 60.0, 61.0)], source="close_recon")


def _build(tf="D"):
    from api.services import breadth_monitor, breadth_live
    with patch.object(breadth_monitor, "get_history", return_value=[]), \
         patch.object(breadth_live, "enabled", return_value=False), \
         patch.object(bs, "_live_map", return_value={}):
        return bs.build_breadth_bars("UCTA5", tf, 400)["bars"]


def test_only_observed_sources_mark_a_bar(fresh_store):
    _seed()
    bars = {b["t"]: b for b in _build()}
    for d in ("2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-11"):
        assert bars[d].get("ohlc") == 1, d
    assert "ohlc" not in bars["2026-08-10"]           # close_recon is a body


def test_the_mark_moves_no_value(fresh_store):
    _seed()
    marked = _build()
    with patch.object(store, "OBSERVED_OHLC_SOURCES", frozenset()), \
         patch.object(bs, "_OBSERVED_OHLC_SOURCES", frozenset()):
        bs._breadth_cache.delete_prefix("breadthdaily_")
        plain = _build()
    strip = [{k: v for k, v in b.items() if k != "ohlc"} for b in marked]
    assert strip == plain
    assert all("ohlc" not in b for b in plain)


def test_observed_bar_values_equal_the_store_row(fresh_store):
    _seed()
    b = {x["t"]: x for x in _build()}["2026-08-05"]
    assert (b["o"], b["h"], b["l"], b["c"]) == (57.0, 59.0, 41.0, 44.0)


def test_a_week_is_marked_only_when_every_day_is(fresh_store):
    _seed()
    weeks = {b["t"]: b for b in _build("W")}
    full = weeks["2026-08-07"]
    assert full.get("ohlc") == 1
    assert (full["o"], full["h"], full["l"], full["c"]) == (40.0, 61.0, 38.0, 60.0)
    mixed = weeks["2026-08-14"]                        # contains the 08-10 body
    assert "ohlc" not in mixed
    assert (mixed["o"], mixed["c"]) == (60.0, 62.0)    # values still served (body row's own o)


def test_the_developing_candle_is_never_marked(fresh_store):
    _seed()
    from api.services import breadth_monitor, breadth_live
    with patch.object(breadth_monitor, "get_history", return_value=[]), \
         patch.object(breadth_live, "enabled", return_value=False), \
         patch.object(bs, "_et_today", return_value="2026-08-12"), \
         patch.object(bs, "_live_map", return_value={M: 64.0}):
        bars = bs.build_breadth_bars("UCTA5", "D", 400)["bars"]
    assert bars[-1]["t"] == "2026-08-12" and bars[-1]["c"] == 64.0
    assert "ohlc" not in bars[-1]


def test_a_day_with_no_store_row_is_a_body(fresh_store):
    _seed()
    from api.services import breadth_monitor, breadth_live
    hist = [{"date": "2026-08-12", M: 66.0}]           # collector-only session
    with patch.object(breadth_monitor, "get_history", return_value=hist), \
         patch.object(breadth_live, "enabled", return_value=False), \
         patch.object(bs, "_live_map", return_value={}):
        bars = {b["t"]: b for b in bs.build_breadth_bars("UCTA5", "D", 400)["bars"]}
    assert "ohlc" not in bars["2026-08-12"]
    assert bars["2026-08-12"]["o"] == 62.0             # yesterday's close: the body


def test_history_shape_is_unchanged_unless_asked(fresh_store):
    _seed()
    assert store.history(M)["2026-08-05"] == {"o": 57.0, "h": 59.0, "l": 41.0, "c": 44.0}
    assert store.history(M, with_source=True)["2026-08-05"]["src"] == "intraday_recon"
    assert store.history(M, with_source=True)["2026-08-10"]["src"] == "close_recon"


def test_the_observed_set_is_exactly_the_sampled_sources():
    assert store.OBSERVED_OHLC_SOURCES == {"live", "intraday_recon", "intraday_recon_1m"}
    assert "close_recon" not in store.OBSERVED_OHLC_SOURCES
    assert "intraday_recon_1m_body" not in store.OBSERVED_OHLC_SOURCES


def test_v2_rows_mark_by_their_own_source(fresh_store, monkeypatch):
    """Under the V2 authority a session's OHLC comes from `chart_bars`; the mark follows the
    row's own V2 source — a 1-minute observation marks, a `_body` row does not."""
    from api.services import breadth_authority as ba
    from api.services import breadth_monitor, breadth_live
    auth = {"2026-09-25": (50.0, 58.0, 47.0, 55.0, ba.V2_LIVE),
            "2026-09-26": (55.0, 55.0, 55.0, 55.0, ba.V2_LIVE)}
    rows = {"2026-09-25": {M: (50.0, 58.0, 47.0, 55.0, "intraday_recon_1m")},
            "2026-09-26": {M: (55.0, 55.0, 55.0, 55.0, "intraday_recon_1m_body")}}
    monkeypatch.setattr(ba, "chart_bars", lambda *a, **k: auth)
    monkeypatch.setattr(ba, "v2_rows", lambda d: rows.get(d, {}))
    with patch.object(breadth_monitor, "get_history", return_value=[]), \
         patch.object(breadth_live, "enabled", return_value=False), \
         patch.object(bs, "_live_map", return_value={}):
        bars = {b["t"]: b for b in bs.build_breadth_bars("UCTA5", "D", 400)["bars"]}
    assert bars["2026-09-25"].get("ohlc") == 1
    assert (bars["2026-09-25"]["o"], bars["2026-09-25"]["h"]) == (50.0, 58.0)
    assert "ohlc" not in bars["2026-09-26"]
