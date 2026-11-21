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


def _drain_background_writers(timeout_s: float = 10.0) -> None:
    """Wait until no earlier test's background bars job is still in flight. ⛔ A job outlives its test: it writes
    into whatever `bars_sqlite._DB_PATH` names WHEN IT WRITES, and once this fixture re-points the path that is
    OUR store. Gate run 44892182587 (2026-11-21) served ['2026-11-20'] for a store this test had just written
    06-10..06-16 into: another test's AAPL D series had landed in it between the write and the read."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        with bars_fetch._cold_bg_lock:
            cold = len(bars_fetch._cold_bg_inflight)
        with bars_fetch._inflight_lock:
            heals = len(bars_fetch._inflight)
        if not cold and not heals:
            return
        time.sleep(0.02)
    raise AssertionError(f"background bars jobs still in flight after {timeout_s}s: cold={cold} heals={heals}")


def _drain_warm_pool(timeout_s: float = 10.0) -> None:
    """The warm pool keeps no in-flight registry, so wait for it the only exact way a FIFO pool allows: one barrier
    task per worker. They can all run at once only when every task accepted BEFORE them has finished."""
    import threading
    pool = bars_fetch._bars_warm_pool
    n = pool._max_workers
    barrier = threading.Barrier(n + 1, timeout=timeout_s)
    futs = [pool.submit(barrier.wait) for _ in range(n)]
    barrier.wait()                                  # raises BrokenBarrierError on timeout: a stuck task is a red
    for f in futs:
        f.result(timeout_s)


class _WarmRecorder:
    """Stands in for the warm pool while a test owns the store: records what would have run, runs nothing."""
    def __init__(self):
        self.submitted = []

    def submit(self, fn, *a, **k):
        from concurrent.futures import Future
        self.submitted.append((fn, a, k))
        f = Future()
        f.set_result(None)
        return f


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    from api.services.cache import cache as _cache
    _drain_background_writers()                    # BEFORE re-pointing: a late job lands in the OLD store
    _drain_warm_pool()
    monkeypatch.setattr(bars_fetch, "_bars_warm_pool", _WarmRecorder())
    # ...and nothing new may start while this test owns the store (these tests read; none needs a kick).
    monkeypatch.setattr(bars_fetch, "_kick_cold_fetch", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_enqueue_since_bg_heal", lambda *a, **k: None)
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    try:
        _cache._store.clear()
    except Exception:
        pass
    yield tmp_path
    bars_sqlite.bump_db_epoch()


def _own_rows(tmp_path, ticker, tf):
    """The rows in THIS test's file, read directly (not through the store's connection)."""
    import sqlite3
    c = sqlite3.connect(f"file:{tmp_path / 'bars.db'}?mode=ro", uri=True)
    try:
        return [r[0] for r in c.execute("SELECT ts FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts", (ticker, tf))]
    finally:
        c.close()


def _body(resp):
    return orjson.loads(bytes(resp.body))


def test_intraday_since_reads_only_new_rows(fresh_db):
    now = int(time.time()) // 60 * 60   # 1m bucket starts (the store's grid invariant)
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
    got = [b["t"] for b in body["bars"]]
    # The store it read is the one it wrote: name it on a mismatch instead of a bare list compare.
    assert bars_sqlite._DB_PATH == str(fresh_db / "bars.db"), f"read another store: {bars_sqlite._DB_PATH}"
    assert got == ["2026-06-15", "2026-06-16"], (got, "own file holds", _own_rows(fresh_db, "AAPL", "D"))


def test_a_late_background_writer_cannot_land_in_this_tests_store(tmp_path, monkeypatch, request):
    """The leak, reproduced: a job an EARLIER test started (in the cold pool's in-flight set) replaces AAPL D a
    moment later, in whatever store `_DB_PATH` names then. Without the drain it lands in this test's store and the
    poll serves ['2026-11-20']; with it, the job finishes in the store it started in."""
    import threading
    first = tmp_path / "earlier"
    first.mkdir()
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(first / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    key = "AAPL_D_late"
    with bars_fetch._cold_bg_lock:
        bars_fetch._cold_bg_inflight.add(key)

    def _late_job():                              # the leaked job: wakes up, replaces the series, leaves
        time.sleep(0.3)
        try:
            bars_sqlite.replace_ticker_tf_rows("AAPL", "D", [{"t": 20261120, "o": 9, "h": 9.5, "l": 8.5, "c": 9, "v": 1}])
        finally:
            with bars_fetch._cold_bg_lock:
                bars_fetch._cold_bg_inflight.discard(key)
    threading.Thread(target=_late_job, daemon=True).start()

    own = request.getfixturevalue("fresh_db")      # the hardened fixture: drains, then re-points
    daily = [{"t": f"2026-06-{d:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for d in (10, 11, 12, 15, 16)]
    bars_sqlite.put_bars("AAPL", "D", daily, date_tf=True)
    time.sleep(0.4)                                # the window the leaked job would land in
    with patch.object(bars_fetch, "_needs_fresh", return_value=False):
        body = _body(bars_fetch._get_bars_since_response("AAPL", "D", 5000, "2026-06-12"))
    assert [b["t"] for b in body["bars"]] == ["2026-06-15", "2026-06-16"], _own_rows(own, "AAPL", "D")


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


def test_a_late_warm_pool_job_cannot_land_in_this_tests_store(tmp_path, monkeypatch, request):
    """The same leak through the warm pool, which keeps no in-flight registry: a task it accepted earlier replaces
    AAPL D a moment later. The barrier drain waits it out before the store is re-pointed."""
    first = tmp_path / "earlier"
    first.mkdir()
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(first / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()

    def _late_task():
        time.sleep(0.3)
        bars_sqlite.replace_ticker_tf_rows("AAPL", "D", [{"t": 20261120, "o": 9, "h": 9.5, "l": 8.5, "c": 9, "v": 1}])
    bars_fetch._bars_warm_pool.submit(_late_task)

    own = request.getfixturevalue("fresh_db")
    daily = [{"t": f"2026-06-{d:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for d in (10, 11, 12, 15, 16)]
    bars_sqlite.put_bars("AAPL", "D", daily, date_tf=True)
    time.sleep(0.4)
    with patch.object(bars_fetch, "_needs_fresh", return_value=False):
        body = _body(bars_fetch._get_bars_since_response("AAPL", "D", 5000, "2026-06-12"))
    assert [b["t"] for b in body["bars"]] == ["2026-06-15", "2026-06-16"], _own_rows(own, "AAPL", "D")
    assert isinstance(bars_fetch._bars_warm_pool, _WarmRecorder)    # and nothing new runs while the test owns it
