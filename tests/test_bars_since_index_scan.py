"""The `?since=` delta poll reads only new rows via an index scan.

This is the browser's 30s SWR revalidation path — the highest-QPS bars
entrypoint during RTH. It used to read up to `bars` (5000) rows, format all
of them, then Python-filter to the 1-5 that are new. Now it uses
bars_sqlite.get_bars_since (WHERE ts > since, index range scan) so it reads
~(returned+1) rows. These tests pin the efficiency win AND that the delta is
identical (including the date-TF ISO->YYYYMMDD key conversion).
"""
import time
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


def test_intraday_since_reads_only_new_rows(fresh_db):
    now = int(time.time())
    step = 60
    bars = [{"t": now - (100 - i) * step, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}
            for i in range(100)]
    bars_sqlite.put_bars("MSTR", "1", bars, date_tf=False)
    since = bars[-3]["t"]  # expect the last 2 bars back

    with patch.object(bars_fetch, "_needs_fresh", return_value=False), \
         patch.object(bars_sqlite, "get_bars_since", wraps=bars_sqlite.get_bars_since) as spy_since, \
         patch.object(bars_sqlite, "get_bars", wraps=bars_sqlite.get_bars) as spy_full:
        resp = bars_fetch._get_bars_since_response("MSTR", "1", 5000, str(since))

    body = _body(resp)
    assert body["delta"] is True
    assert [b["t"] for b in body["bars"]] == [bars[-2]["t"], bars[-1]["t"]]
    # The efficiency win: the index-scan path ran, the full 5000-row read did NOT.
    assert spy_since.called
    assert not spy_full.called


def test_date_tf_since_iso_string_converts_to_int_key(fresh_db):
    daily = [{"t": f"2026-06-{d:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}
             for d in (10, 11, 12, 15, 16)]
    bars_sqlite.put_bars("AAPL", "D", daily, date_tf=True)

    with patch.object(bars_fetch, "_needs_fresh", return_value=False):
        resp = bars_fetch._get_bars_since_response("AAPL", "D", 5000, "2026-06-12")

    body = _body(resp)
    # Strictly newer than 2026-06-12.
    assert [b["t"] for b in body["bars"]] == ["2026-06-15", "2026-06-16"]


def test_no_new_bars_returns_empty_delta(fresh_db):
    now = int(time.time())
    bars = [{"t": now - (5 - i) * 60, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}
            for i in range(5)]
    bars_sqlite.put_bars("NVDA", "1", bars, date_tf=False)
    with patch.object(bars_fetch, "_needs_fresh", return_value=False):
        resp = bars_fetch._get_bars_since_response("NVDA", "1", 5000, str(bars[-1]["t"]))
    assert _body(resp)["bars"] == []


def test_degenerate_since_falls_back_to_bounded_window(fresh_db):
    now = int(time.time())
    bars = [{"t": now - (10 - i) * 60, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}
            for i in range(10)]
    bars_sqlite.put_bars("SPY", "1", bars, date_tf=False)
    with patch.object(bars_fetch, "_needs_fresh", return_value=False), \
         patch.object(bars_sqlite, "get_bars", wraps=bars_sqlite.get_bars) as spy_full:
        resp = bars_fetch._get_bars_since_response("SPY", "1", 5000, "")  # unparseable since
    # Degenerate since → bounded get_bars fallback (not the unbounded since-scan).
    assert spy_full.called
    assert len(_body(resp)["bars"]) == 10
