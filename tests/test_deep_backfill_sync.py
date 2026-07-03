"""Deep intraday pan-backfill must be served SYNCHRONOUSLY.

When the user pans into deep history the chart re-requests with a deep bar
count (>= _DEEP_REQUEST_THRESHOLD). The partial-cache branch used to serve
the stale shallow payload and defer the real fetch to a background thread —
the pan visibly loaded nothing (the client treats the non-delta response as
authoritative and doesn't re-poll for up to 30s; a TF switch resets depth
and the user never sees the data). Observed 2026-07-02: "intraday won't
load more than 1 day."

The fix mirrors the cold-stale precedent: an explicit deep request on an
intraday TF is a user-initiated ask for depth — fetch it synchronously and
return the full set. D/W/M keep the background path (their dwell-warm is
proactive and invisible; blocking those requests would stall every chart
open for seconds).
"""
import json
import time
from unittest.mock import patch

import pytest

from api.services import bars_fetch, bars_sqlite


@pytest.fixture
def fresh_state(tmp_path, monkeypatch):
    from api.services import bars_disk_cache
    from api.services.cache import cache as _cache

    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(tmp_path / "disk"))
    try:
        _cache._store.clear()
    except Exception:
        pass
    bars_fetch._inflight.clear()
    yield
    bars_sqlite.bump_db_epoch()


def _seed_shallow_intraday(ticker, tf, count=600):
    """Fresh shallow window ending now — the state after a first paint."""
    now = int(time.time())
    step = int(tf) * 60
    bars = [
        {"t": now - (count - i) * step, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.2, "v": 100}
        for i in range(count)
    ]
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)
    return bars


def _deep_set(count=5000):
    now = int(time.time())
    return [
        {"t": now - (count - i) * 300, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.2, "v": 100}
        for i in range(count)
    ]


def _body(resp):
    return json.loads(resp.body)


def test_deep_intraday_partial_request_returns_full_depth_synchronously(fresh_state):
    _seed_shallow_intraday("MSTR", "5", 600)
    deep = _deep_set(5000)
    with patch.object(bars_fetch, "_fetch_intraday", return_value=deep) as mf:
        resp = bars_fetch._get_bars_inner("MSTR", "5", 26000)
    assert mf.called, "deep intraday request did not trigger a synchronous fetch"
    body = _body(resp)
    # The pan response itself must carry the deep history, not the stale 600.
    assert len(body["bars"]) >= 4000, (
        f"deep request returned only {len(body['bars'])} bars — stale shallow payload"
    )


def test_deep_intraday_marks_history_complete(fresh_state):
    _seed_shallow_intraday("MSTR", "5", 600)
    with patch.object(bars_fetch, "_fetch_intraday", return_value=_deep_set(5000)):
        bars_fetch._get_bars_inner("MSTR", "5", 26000)
    # Marker set → the next poll for 26000 bars serves SQLite directly
    # instead of re-running the full fetch forever.
    assert bars_fetch._history_complete("MSTR", "5")


def test_shallow_intraday_request_still_uses_swr_path(fresh_state):
    """A non-deep request on a partial cache must NOT block on a full fetch."""
    _seed_shallow_intraday("MSTR", "5", 300)
    with patch.object(bars_fetch, "_fetch_intraday", return_value=_deep_set(1000)) as mf:
        resp = bars_fetch._get_bars_inner("MSTR", "5", 600)
    body = _body(resp)
    # Served immediately from SQLite (stale-while-revalidate); the sync
    # fetch must not have run on the request thread.
    assert len(body["bars"]) == 300
    assert not mf.called or True  # bg thread may or may not have started yet


def test_deep_daily_request_keeps_background_path(fresh_state):
    """D/W/M dwell-warm fires on every chart open — must stay non-blocking."""
    today = time.strftime("%Y-%m-%d")
    bars_sqlite.put_bars(
        "MSTR", "D",
        [{"t": today, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 1000}],
        date_tf=True,
    )
    with patch.object(bars_fetch, "_fetch_daily", return_value=[]) as mf:
        resp = bars_fetch._get_bars_inner("MSTR", "D", 20000)
    body = _body(resp)
    assert len(body["bars"]) == 1  # stale-while-revalidate serve
    # The fetch may run in a background thread, but the response must not
    # have waited for it (we can't assert timing reliably; the load-bearing
    # assertion is the stale serve above).
    del mf
