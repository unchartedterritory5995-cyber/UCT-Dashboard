"""Replay Mode deep-intraday: the `?to=` cold-fetch branch for intraday.

`_get_bars_to_response` already deep-fetches + persists for D/W/M when SQLite is
cold at an old cutoff. These tests pin the NEW intraday branch: a cold intraday
cutoff (e.g. AAPL 5-min at a 2008 date) fetches the pre-cutoff window ONCE via
`_fetch_intraday_range` (split-adjusted, no lookback ceiling), persists it to
SQLite, serves only bars <= the cutoff, and serves from SQLite (no re-fetch) on
the second call.
"""
from datetime import datetime, timezone
from unittest.mock import patch

import orjson
import pytest

from api.services import bars_fetch, bars_sqlite


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    from api.services.cache import cache as _cache
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    try:
        _cache._store.clear()
    except Exception:
        pass
    yield
    bars_sqlite.bump_db_epoch()


def _body(resp):
    return orjson.loads(bytes(resp.body))


def _ts(y, mo, d, h, mi):
    return int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp())


# Three 5-min bars on/before the Jan-15-2008 cutoff + one the day AFTER (must be dropped).
_DEEP_2008 = [
    {"t": _ts(2008, 1, 14, 14, 30), "o": 6.90, "h": 6.95, "l": 6.88, "c": 6.92, "v": 1000},
    {"t": _ts(2008, 1, 14, 15, 0),  "o": 6.92, "h": 6.98, "l": 6.90, "c": 6.96, "v": 1200},
    {"t": _ts(2008, 1, 15, 20, 0),  "o": 6.96, "h": 7.02, "l": 6.94, "c": 7.00, "v": 1500},
    {"t": _ts(2008, 1, 16, 14, 30), "o": 7.00, "h": 7.05, "l": 6.99, "c": 7.03, "v": 900},  # after cutoff
]


def test_cold_intraday_to_fetches_persists_and_serves_below_cutoff(fresh_db):
    with patch.object(bars_fetch, "_fetch_intraday_range", return_value=list(_DEEP_2008)) as spy:
        resp = bars_fetch._get_bars_to_response("AAPL", "5", 6000, "2008-01-15")

    body = _body(resp)
    served = [b["t"] for b in body["bars"]]
    # The Jan-16 bar (after the cutoff) is filtered out; the three <= cutoff are served.
    assert served == [_DEEP_2008[0]["t"], _DEEP_2008[1]["t"], _DEEP_2008[2]["t"]]
    # Split-adjusted prices flowed through untouched (~$7, matching daily charts).
    assert body["bars"][-1]["c"] == pytest.approx(7.00)
    assert spy.called


def test_second_call_serves_from_sqlite_without_refetching(fresh_db):
    # First call populates SQLite.
    with patch.object(bars_fetch, "_fetch_intraday_range", return_value=list(_DEEP_2008)):
        bars_fetch._get_bars_to_response("AAPL", "5", 6000, "2008-01-15")

    # Second call: if the fetch is invoked at all, fail. It must serve from SQLite.
    def _boom(*a, **k):
        raise AssertionError("cold fetch must not run on a cache hit")

    with patch.object(bars_fetch, "_fetch_intraday_range", side_effect=_boom):
        resp = bars_fetch._get_bars_to_response("AAPL", "5", 6000, "2008-01-15")

    body = _body(resp)
    assert len(body["bars"]) == 3
    assert body["bars"][-1]["c"] == pytest.approx(7.00)


def test_partial_window_refetches_a_different_date(fresh_db):
    # Seed a 2008 window (as if a prior replay fetched it).
    with patch.object(bars_fetch, "_fetch_intraday_range", return_value=list(_DEEP_2008)):
        bars_fetch._get_bars_to_response("AAPL", "5", 6000, "2008-01-15")

    # Now request a 2015 date. The store has 2008 rows (all <= the 2015 key) but NOT the 2015
    # window — it must fetch 2015, not serve the stale 2008 rows as if they end at the cutoff.
    deep_2015 = [
        {"t": _ts(2015, 6, 10, 14, 30), "o": 130.0, "h": 130.5, "l": 129.8, "c": 130.2, "v": 1000},
        {"t": _ts(2015, 6, 10, 15, 0),  "o": 130.2, "h": 130.8, "l": 130.0, "c": 130.6, "v": 1200},
    ]
    with patch.object(bars_fetch, "_fetch_intraday_range", return_value=list(deep_2015)) as spy:
        resp = bars_fetch._get_bars_to_response("AAPL", "5", 6000, "2015-06-10")

    assert spy.called   # the 2015 window was re-fetched, not served stale from 2008
    body = _body(resp)
    # The NEWEST served bar is the 2015 one (the correct cutoff), not the 2008 stale window.
    assert body["bars"][-1]["t"] == deep_2015[-1]["t"]
    assert body["bars"][-1]["c"] == pytest.approx(130.6)


def test_replay_effective_symbol_maps_qqq_era():
    f = bars_fetch._replay_effective_symbol
    assert f("QQQ", "2010-05-06") == "QQQQ"   # QQQQ era (Nasdaq listing)
    assert f("QQQ", "2003-06-15") == "QQQ"     # before the change
    assert f("QQQ", "2015-01-01") == "QQQ"     # after the back-rename
    assert f("SPY", "2010-05-06") == "SPY"     # unaffected ticker


def test_qqq_replay_fetches_and_serves_under_qqqq(fresh_db):
    # A QQQ replay in the QQQQ era must read/fetch/persist under QQQQ, but label the response QQQ.
    deep = [
        {"t": _ts(2010, 5, 5, 14, 30), "o": 48.0, "h": 48.2, "l": 47.9, "c": 48.1, "v": 1000},
        {"t": _ts(2010, 5, 6, 20, 0),  "o": 47.0, "h": 47.1, "l": 46.5, "c": 46.6, "v": 2000},
    ]
    with patch.object(bars_fetch, "_fetch_intraday_range", return_value=list(deep)) as spy:
        resp = bars_fetch._get_bars_to_response("QQQ", "5", 6000, "2010-05-06")

    assert spy.call_args[0][0] == "QQQQ"                 # fetched under the era symbol
    assert bars_sqlite.get_bars("QQQQ", "5", 10)         # persisted under QQQQ
    body = _body(resp)
    assert body["ticker"] == "QQQ"                       # response labeled with the requested symbol
    assert body["bars"][-1]["c"] == pytest.approx(46.6)


def test_fetch_intraday_range_maps_ms_to_seconds_and_paginates():
    raw_p1 = {"results": [{"t": 1200322200000, "o": 6.9, "h": 6.95, "l": 6.88, "c": 6.92, "v": 1000}],
              "next_url": "https://api.massive.com/next?cursor=abc"}
    raw_p2 = {"results": [{"t": 1200322500000, "o": 6.92, "h": 6.98, "l": 6.9, "c": 6.96, "v": 1200}]}

    class _FakeClient:
        _api_key = "k"
        def __init__(self):
            self._pages = [raw_p1, raw_p2]
        def _get(self, url):
            return self._pages.pop(0)

    with patch.object(bars_fetch, "_get_client", return_value=_FakeClient()):
        out = bars_fetch._fetch_intraday_range("AAPL", "5", "2008-01-14", "2008-01-14")

    # Both pages followed; ms -> unix seconds; prices via _px.
    assert [b["t"] for b in out] == [1200322200, 1200322500]
    assert out[0]["o"] == bars_fetch._px(6.9)
    assert out[1]["c"] == bars_fetch._px(6.96)
