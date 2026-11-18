"""The RS lane's bars reads are shared (2026-11-12).

One chart's RS pane fires five server definitions at once and each read the stock and its
benchmarks from bars.db separately: ~60 reads of SPY for a 12-chart board, measured at a
17.5 s median after a deploy. `_bars_rows_shared` gives concurrent identical reads one
database read and reuses rows for a few seconds.
"""
import threading
import time

import pytest

from api.routers import signature as sig
from api.services import bars_sqlite


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    sig._bars_share.clear()
    sig._bars_share_inflight.clear()
    yield
    sig._bars_share.clear()
    sig._bars_share_inflight.clear()


def _slow_reader(calls, delay=0.2):
    def reader(sym, tf, count):
        calls.append((sym, tf, count))
        time.sleep(delay)
        return [(20261110 + i, 1.0, 2.0, 0.5, 1.5, 100) for i in range(3)]
    return reader


def test_concurrent_identical_reads_hit_the_database_once(monkeypatch):
    calls = []
    monkeypatch.setattr(bars_sqlite, "get_bars", _slow_reader(calls))
    out = []
    threads = [threading.Thread(target=lambda: out.append(sig._fetch_bars_for_tf("SPY", "D", 600)))
               for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1
    assert len(out) == 8 and all(len(o) == 3 for o in out)


def test_each_caller_gets_its_own_dicts(monkeypatch):
    monkeypatch.setattr(bars_sqlite, "get_bars", _slow_reader([], delay=0))
    a = sig._fetch_bars_for_tf("SPY", "D", 600)
    b = sig._fetch_bars_for_tf("SPY", "D", 600)
    a[0]["c"] = -1.0
    assert b[0]["c"] == 1.5 and a is not b


def test_different_symbol_or_depth_reads_separately(monkeypatch):
    calls = []
    monkeypatch.setattr(bars_sqlite, "get_bars", _slow_reader(calls, delay=0))
    sig._fetch_bars_for_tf("SPY", "D", 600)
    sig._fetch_bars_for_tf("RSP", "D", 600)
    sig._fetch_bars_for_tf("SPY", "D", 1200)
    sig._fetch_bars_for_tf("SPY", "D", 600)
    assert calls == [("SPY", "D", 600), ("RSP", "D", 600), ("SPY", "D", 1200)]


def test_rows_expire_after_the_share_window(monkeypatch):
    calls = []
    monkeypatch.setattr(bars_sqlite, "get_bars", _slow_reader(calls, delay=0))
    monkeypatch.setattr(sig, "_BARS_SHARE_TTL_S", 0.05)
    sig._fetch_bars_for_tf("SPY", "D", 600)
    time.sleep(0.08)
    sig._fetch_bars_for_tf("SPY", "D", 600)
    assert len(calls) == 2


def test_a_failed_read_raises_to_its_caller_and_is_not_remembered(monkeypatch):
    state = {"n": 0}

    def flaky(sym, tf, count):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("disk")
        return [(20261110, 1.0, 2.0, 0.5, 1.5, 100)]
    monkeypatch.setattr(bars_sqlite, "get_bars", flaky)
    with pytest.raises(RuntimeError):
        sig._fetch_bars_for_tf("SPY", "D", 600)
    assert len(sig._fetch_bars_for_tf("SPY", "D", 600)) == 1
    assert not sig._bars_share_inflight


# ── the read itself: one sqlite step (2026-11-13) ────────────────────────────
#
# `bars_sqlite.get_bars` hands python one row per `sqlite3_step`, the GIL released and re-taken
# around each: `rs-bars` 0.9 to 3.4 s on the web pod for a ~5,000-bar series, a median 37 s per
# request with 44 in flight. The lane now asks `get_bars_packed` (the same tuples from ONE
# result row; `tests/test_bars_packed_read.py` holds it bit for bit) and falls back to the rows.

@pytest.fixture()
def real_store(tmp_path, monkeypatch):
    """A real bars.db behind the store's own readers (nothing swapped)."""
    import sqlite3
    path = str(tmp_path / "bars.db")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", path)
    monkeypatch.setattr(bars_sqlite, "_local", bars_sqlite.threading.local())
    monkeypatch.delenv("RS_PACKED_READS", raising=False)
    conn = sqlite3.connect(path)
    conn.execute(bars_sqlite.ohlcv_ddl())
    conn.executemany("INSERT INTO ohlcv(ticker, tf, ts, o, h, l, c, v) VALUES ('SPY','D',?,?,?,?,?,?)",
                     [(20260101 + i, 100.1 + i / 3, 101.7 + i / 7, 99.3 + i / 9, 100.9 + i / 11, 1000 + i)
                      for i in range(40)])
    conn.commit()

    def put(row):
        conn.execute("INSERT OR REPLACE INTO ohlcv(ticker, tf, ts, o, h, l, c, v) VALUES ('SPY','D',?,?,?,?,?,?)", row)
        conn.commit()
    yield put
    conn.close()
    held = getattr(bars_sqlite._local, "conn", None)
    if held is not None:
        held.close()


def _spy_readers(monkeypatch):
    """Count calls to the two readers WITHOUT swapping `get_bars` (a swap is its own case below)."""
    calls = {"packed": 0, "rows": 0}
    real_packed, real_conn = bars_sqlite.get_bars_packed, bars_sqlite._conn

    def packed(*a):
        calls["packed"] += 1
        return real_packed(*a)

    class Conn:
        def execute(self, sql, params=()):
            if "json_group_array" not in sql and "FROM ohlcv" in sql:
                calls["rows"] += 1
            return real_conn().execute(sql, params)
    monkeypatch.setattr(bars_sqlite, "get_bars_packed", packed)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: Conn())
    return calls


def test_the_lane_reads_its_rows_in_one_sqlite_step_and_they_are_the_row_readers(real_store, monkeypatch):
    want = bars_sqlite.get_bars("SPY", "D", 30)
    calls = _spy_readers(monkeypatch)
    got = sig._fetch_bars_for_tf("spy", "D", 30)
    assert calls == {"packed": 1, "rows": 0}, "no row-by-row statement ran"
    assert got == [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in want]
    assert len(got) == 30


def test_when_the_one_step_read_refuses_the_rows_are_read_the_old_way(real_store, monkeypatch):
    real_store((20260301, 5.0, 6.0, 4.0, 5.5, 10.5))            # a fractional volume: not exact as text
    want = bars_sqlite.get_bars("SPY", "D", 5)
    calls = _spy_readers(monkeypatch)
    got = sig._fetch_bars_for_tf("SPY", "D", 5)
    assert calls == {"packed": 1, "rows": 1}
    assert [g["t"] for g in got] == [r[0] for r in want] and got[-1]["c"] == 5.5 and got[-1]["v"] == 10


@pytest.mark.parametrize("value, packed_calls", [("0", 0), (" 0 ", 0), ("1", 1), ("", 1), ("off", 1)])
def test_the_knob_turns_the_one_step_read_off_and_only_zero_does(real_store, monkeypatch, value, packed_calls):
    calls = _spy_readers(monkeypatch)
    monkeypatch.setenv("RS_PACKED_READS", value)
    assert len(sig._fetch_bars_for_tf("SPY", "D", 12)) == 12
    assert calls == {"packed": packed_calls, "rows": 1 - packed_calls}


def test_a_swapped_reader_serves_every_row_itself_the_one_step_read_never_goes_around_it(real_store, monkeypatch):
    calls = _spy_readers(monkeypatch)
    served = []

    def swapped(sym, tf, count):
        served.append((sym, tf, count))
        return [(20270101, 1.0, 2.0, 0.5, 1.5, 7)]
    monkeypatch.setattr(bars_sqlite, "get_bars", swapped)
    assert sig._fetch_bars_for_tf("SPY", "D", 12) == [{"t": 20270101, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 7}]
    assert served == [("SPY", "D", 12)] and calls == {"packed": 0, "rows": 0}
