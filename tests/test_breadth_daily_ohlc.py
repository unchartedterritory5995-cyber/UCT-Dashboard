"""Breadth daily-OHLC store (candle wicks) + its use in build_breadth_bars."""
import os
from unittest.mock import patch

import pytest

from api.services import breadth_daily_ohlc as store


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    store._INIT_DONE = False        # force re-init against the tmp DB
    yield
    store._INIT_DONE = False


def test_update_intraday_accumulates_ohlc(fresh_store):
    # first sample seeds o=h=l=c
    store.update_intraday("2026-08-10", {"pct_above_50sma": 50.0})
    # a higher then a lower sample extend h/l; c tracks the latest
    store.update_intraday("2026-08-10", {"pct_above_50sma": 57.0})
    store.update_intraday("2026-08-10", {"pct_above_50sma": 44.0})
    store.update_intraday("2026-08-10", {"pct_above_50sma": 52.0})
    h = store.history("pct_above_50sma")
    row = h["2026-08-10"]
    assert row == {"o": 50.0, "h": 57.0, "l": 44.0, "c": 52.0}


def test_update_intraday_ignores_non_finite(fresh_store):
    store.update_intraday("2026-08-10", {"m": float("nan"), "n": None, "ok": 5})
    h = store.history("ok")
    assert h["2026-08-10"]["c"] == 5.0
    assert store.history("m") == {}


def test_set_ohlc_does_not_clobber_live(fresh_store):
    store.update_intraday("2026-08-07", {"x": 30.0})          # a 'live' row
    ok = store.set_ohlc("2026-08-07", "x", 10, 40, 5, 33)      # reconstruct must NOT overwrite
    assert ok is False
    assert store.history("x")["2026-08-07"]["c"] == 30.0
    # a PAST day with no live row is written
    assert store.set_ohlc("2026-08-06", "x", 20, 45, 18, 40) is True
    assert store.history("x")["2026-08-06"] == {"o": 20.0, "h": 45.0, "l": 18.0, "c": 40.0}


def test_build_breadth_bars_uses_store_for_wicks(fresh_store):
    from api.services import breadth_symbols as bs
    from api.services import breadth_monitor, breadth_live
    # one stored EOD day; give it an OHLC row whose high/low exceed the close-to-close body
    store.set_ohlc("2020-03-10", "pct_above_50sma", 45, 70, 30, 55)
    hist = [{"date": "2020-03-10", "pct_above_50sma": 55}]
    with patch.object(breadth_monitor, "get_history", return_value=list(reversed(hist))), \
         patch.object(breadth_live, "enabled", return_value=False):
        bars = bs.build_breadth_bars("UCTA50", "D", 400)["bars"]
    c = bars[-1]
    assert c["h"] == 70 and c["l"] == 30 and c["c"] == 55   # real wick from the store
