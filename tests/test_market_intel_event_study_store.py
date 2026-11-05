"""`history.eventStudy` against a REAL on-disk store: the production deadline, a cold page cache, shared jobs.

Every other event-study test replaces `_load_bars` or passes `deadline_s=30`, so the 5 s production deadline never met
a real store, and `history.eventStudy` shipped answering "still loading" every time. This file runs the real read path
over a production-schema SQLite file with 60,000 daily rows per symbol, one row per page, as a symbol written a session
at a time lies on disk. The slow volume is simulated at the sqlite3 connection, not by replacing the read.

Synthetic data only. No real market value.
"""
from __future__ import annotations

import concurrent.futures as cf
import ctypes
import datetime as dt
import os
import random
import sqlite3
import sys
import threading
import time
import types

import pytest

from api.services import bars_sqlite as bs
from api.services.market_intel import event_study as es, event_study_answer as esa
from api.services.uct_agent.marketdata import history_event_study as hes

ROWS = 60_000
SYMBOLS = ("AAA", "BBB", "CCC", "DDD", "EEE", "FFF")
TICK_OPS = 200


def _sessions(n: int) -> list[int]:
    d, out = dt.date(2026, 10, 30), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d -= dt.timedelta(days=1)
    return out[::-1]


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("event_study_store") / "bars.db")
    c = sqlite3.connect(path)
    c.execute("PRAGMA journal_mode=OFF")
    c.execute("PRAGMA synchronous=OFF")
    c.execute("""CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,
                 o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))""")
    c.execute(bs.BARS_INDEX_DDL[bs.LOOKUP_INDEX])
    c.execute(bs.BARS_INDEX_DDL[bs.DAILY_BYDATE_INDEX])
    r = random.Random(5)
    px = dict.fromkeys(SYMBOLS, 50.0)
    pad = b"\0" * 3800
    for i, ts in enumerate(_sessions(ROWS)):
        rows = []
        for s in SYMBOLS:
            px[s] = min(max(px[s] * (1 + r.gauss(0.0003, 0.012)), 1.0), 4000.0)
            rows.append((s, "D", ts, px[s] * 0.999, px[s] * 1.01, px[s] * 0.99, px[s], 1000 + i))
        rows.append(("ZZFILL", "5", i, 1.0, 1.0, 1.0, 1.0, pad))       # other traffic between one symbol's sessions
        c.executemany("INSERT INTO ohlcv VALUES(?,?,?,?,?,?,?,?)", rows)
    c.commit()
    c.execute("PRAGMA journal_mode=WAL")
    c.close()
    return path


def _drop_os_cache(path: str) -> None:
    """Best effort: the store's pages leave the OS page cache. Every connection to it must be closed first."""
    if sys.platform == "win32":
        k = ctypes.WinDLL("kernel32")
        k.CreateFileW.restype = ctypes.c_void_p
        k.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                                  ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        k.CloseHandle.argtypes = [ctypes.c_void_p]
        h = k.CreateFileW(path, 0x80000000, 7, None, 3, 0x20000000, None)     # GENERIC_READ, FILE_FLAG_NO_BUFFERING
        if h not in (None, ctypes.c_void_p(-1).value):
            k.CloseHandle(h)
    elif hasattr(os, "posix_fadvise"):
        fd = os.open(path, os.O_RDONLY)
        try:
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        finally:
            os.close(fd)


class Disk:
    """The network volume. `cold` read steps remain unread; each costs `step_s`. Progress SURVIVES a stopped read and
    a new connection, exactly as the OS page cache does: what was read once is cheap for everyone afterwards."""

    def __init__(self, cold: int = 0, step_s: float = 0.0):
        self.cold, self.step_s, self.lock = cold, step_s, threading.Lock()

    def step(self) -> None:
        with self.lock:
            if self.cold <= 0:
                return
            self.cold -= 1
        time.sleep(self.step_s)


def _slow_conn_factory(disk: Disk):
    class SlowConn(sqlite3.Connection):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.set_progress_handler(None, 0)

        def set_progress_handler(self, fn, n):
            def tick():
                disk.step()
                return fn() if fn else 0
            super().set_progress_handler(tick, TICK_OPS)
    return SlowConn


@pytest.fixture
def real_store(store, monkeypatch):
    """`bars_sqlite` pointed at the file, every connection (pool threads included) reopened through the slow volume."""
    disk = Disk()
    factory = _slow_conn_factory(disk)
    real_connect = sqlite3.connect
    fake = types.SimpleNamespace(connect=lambda *a, **k: real_connect(*a, factory=factory, **k),
                                 OperationalError=sqlite3.OperationalError, Connection=sqlite3.Connection)
    monkeypatch.setattr(bs, "sqlite3", fake)
    monkeypatch.setattr(bs, "_DB_PATH", store)
    bs.bump_db_epoch()
    es._reset_for_test()
    yield disk
    disk.cold = 0                                                     # nothing is left sleeping for the next test
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and any(not j.fut.done() for j in list(es._jobs.values())):
        time.sleep(0.02)
    es._reset_for_test()
    bs.bump_db_epoch()


def req(symbol="AAA", indicator="rsi", period=14, op="cross_below", threshold=30.0):
    series = {"kind": "technical", "symbol": symbol, "indicator": indicator}
    if period:
        series["period"] = period
    return {"condition": {"series": series, "op": op, "threshold": threshold}, "symbol": symbol,
            "horizons": [{"sessions": 1}, {"sessions": 5}, {"sessions": 21}], "episodes": "first",
            "entry": "event_close", "non_overlapping": False, "baseline": True, "start": None, "end": None}


def count_reads(monkeypatch) -> list:
    calls, real = [], bs.get_bars_table_order

    def spy(*a, **k):
        calls.append(a[0])
        return real(*a, **k)
    monkeypatch.setattr(bs, "get_bars_table_order", spy)
    return calls


def finish(body, tries=800):
    """Polls as a member would, until the shared job has answered."""
    for _ in range(tries):
        out = es.run(body, deadline_s=0.05)
        if out.get("reason") != "warming":
            return out
        time.sleep(0.05)
    raise AssertionError("the study never finished")


# ── the read itself ──────────────────────────────────────────────────────────

def test_the_store_is_realistic_each_row_on_its_own_page(store):
    c = sqlite3.connect(store)
    ids = [r[0] for r in c.execute("SELECT rowid FROM ohlcv WHERE ticker='AAA' AND tf='D' ORDER BY ts")]
    page, count = c.execute("PRAGMA page_size").fetchone()[0], c.execute("PRAGMA page_count").fetchone()[0]
    c.close()
    assert len(ids) >= ROWS and all(b - a == 7 for a, b in zip(ids, ids[1:]))
    assert page * count >= ROWS * 3800                                 # one symbol's sessions never share a page


def test_query_plan_reads_rowids_from_the_index_then_the_table_in_rowid_order(store):
    c = sqlite3.connect(store)
    plan = [r[3] for r in c.execute("""EXPLAIN QUERY PLAN SELECT ts,o,h,l,c,v FROM ohlcv WHERE rowid IN (
        SELECT rowid FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts DESC LIMIT ?)""", ("AAA", "D", ROWS))]
    c.close()
    assert any("INTEGER PRIMARY KEY (rowid=?)" in p for p in plan), plan
    assert any("COVERING INDEX" in p and "ticker=? AND tf=?" in p for p in plan), plan
    assert not any("SCAN" in p or "TEMP B-TREE" in p for p in plan), plan


def test_table_order_returns_exactly_the_rows_get_bars_returns(real_store):
    assert bs.get_bars_table_order("AAA", "D", ROWS) == bs.get_bars("AAA", "D", ROWS)
    assert bs.get_bars_table_order("AAA", "D", 500) == bs.get_bars("AAA", "D", 500)      # the NEWEST 500
    assert bs.get_bars_table_order("NOPE", "D", 500) == []


def test_a_past_stop_time_interrupts_the_read_and_clears_the_handler(real_store):
    with pytest.raises(sqlite3.OperationalError, match="interrupted"):
        bs.get_bars_table_order("AAA", "D", ROWS, stop_at=time.monotonic() - 1)
    assert len(bs.get_bars_table_order("AAA", "D", ROWS)) == ROWS


def test_one_study_reads_a_symbol_once(real_store, monkeypatch):
    calls = count_reads(monkeypatch)
    assert es.run(req(), deadline_s=60)["status"] == "ok"
    assert calls == ["AAA"]


@pytest.mark.parametrize("indicator,period,op,threshold", [("rsi", 14, "cross_below", 30.0),
                                                           ("gap_pct", None, "above", 0.05),
                                                           ("pct_from_sma", 50, "cross_above", 0.0)])
def test_a_studys_returns_do_not_change(real_store, monkeypatch, indicator, period, op, threshold):
    """The old read (get_bars, read twice) and the new one (table order, once) give the identical result."""
    body = req("BBB", indicator, period, op, threshold)
    new = es.run(body, deadline_s=60)
    assert new["status"] == "ok" and new["counts"]["events_used"] > 0
    monkeypatch.setattr(bs, "get_bars_table_order", lambda t, tf, n, stop_at=None: bs.get_bars(t, tf, n))
    v, err = es.validate(body)
    assert err is None
    assert es._study(v) == new


def test_a_since_study_needs_the_history_before_it(real_store):
    """Why the read is not bounded by `start`: RSI is seeded from the first bar, so a shorter history moves the values
    a study tests. If this ever fails, a window-bounded read becomes possible."""
    from api.services import indicator_compute as ic
    closes = [r[4] for r in bs.get_bars("CCC", "D", ROWS)][-6000:]
    full, cut = ic.compute_rsi_raw(closes, 14), ic.compute_rsi_raw(closes[-1000:], 14)
    assert max(abs(a - b) for a, b in zip(full[-985:-700], cut[15:300])) > 0.5


# ── the production deadline ──────────────────────────────────────────────────

def test_production_deadline_on_a_60k_store_with_the_os_cache_dropped(real_store, store):
    c = getattr(bs._local, "conn", None)
    if c is not None:
        c.close()
        bs._local.conn = None
    bs.bump_db_epoch()
    _drop_os_cache(store)
    t0 = time.monotonic()
    out = es.run(req("DDD"))                                          # the production default
    assert out["status"] == "ok" and out["coverage"]["price_first"] < "1900-01-01"
    assert time.monotonic() - t0 < es.DEADLINE_S


def test_production_deadline_on_a_slow_cold_volume_first_loads_then_returns(real_store, monkeypatch):
    """Cold read longer than the production deadline: the request answers in time and honestly, the job finishes
    behind it, and the next request returns the answer without reading again."""
    calls = count_reads(monkeypatch)
    real_store.step_s, real_store.cold = 0.05, int((es.DEADLINE_S + 2.0) / 0.05)
    t0 = time.monotonic()
    first = es.run(req("EEE"))
    took = time.monotonic() - t0
    assert first["status"] == "unavailable" and first["reason"] == "warming"
    assert es.DEADLINE_S - 0.5 <= took <= es.DEADLINE_S + 1.5
    assert esa.answer(first)["text"] == "The history is still loading. Run the study again in a moment."
    second = es.run(req("EEE"))
    assert second["status"] == "ok" and calls == ["EEE"]
    t1 = time.monotonic()
    assert es.run(req("EEE"))["status"] == "ok" and time.monotonic() - t1 < 0.5   # kept: instant, no read
    assert calls == ["EEE"]


# ── concurrency ──────────────────────────────────────────────────────────────

def test_repeats_of_one_study_share_one_job_and_do_not_hog_the_pool(real_store, monkeypatch):
    calls = count_reads(monkeypatch)
    real_store.step_s, real_store.cold = 0.02, 150                    # ~3 s of cold store
    with cf.ThreadPoolExecutor(8) as ex:
        out = list(ex.map(lambda _: es.run(req("FFF"), deadline_s=0.2), range(8)))
    assert {o.get("reason") for o in out} == {"warming"}
    assert sum(1 for j in es._jobs.values() if not j.fut.done()) == 1  # eight requests, one job, one worker
    real_store.cold = 0                                                # another study still gets the other worker
    assert es.run(req("AAA", "pct_from_sma", 20, "cross_above", 0.0), deadline_s=20)["status"] == "ok"
    assert finish(req("FFF"))["status"] == "ok"
    assert calls.count("FFF") == 1


def test_an_abandoned_job_ends_at_its_budget_and_a_later_job_resumes(real_store, monkeypatch):
    calls = count_reads(monkeypatch)
    monkeypatch.setattr(es, "JOB_BUDGET_S", 0.5)
    real_store.step_s, real_store.cold = 0.02, 60                     # ~1.2 s: two budgets of cold store
    t0 = time.monotonic()
    assert es.run(req("AAA"), deadline_s=0.05)["reason"] == "warming"
    job = next(iter(es._jobs.values()))
    assert job.fut.result(timeout=5)["reason"] == "warming"            # nobody is waiting; it stopped by itself
    assert 0.4 <= time.monotonic() - t0 < 2.0
    assert 0 < real_store.cold < 60                                    # what it read stays read
    out = finish(req("AAA"))                                           # a stopped job is not kept: a new one starts
    assert out["status"] == "ok" and len(calls) >= 2


def test_active_jobs_are_capped_and_the_overflow_says_busy(real_store):
    real_store.step_s, real_store.cold = 0.05, 200
    outs = [es.run(req(s), deadline_s=0.01) for s in SYMBOLS]
    assert [o["reason"] for o in outs].count("warming") == es.MAX_ACTIVE_JOBS
    busy = [o for o in outs if o["reason"] == "busy"]
    assert len(busy) == len(SYMBOLS) - es.MAX_ACTIVE_JOBS
    assert esa.answer(busy[0])["text"] == "Too many studies are running. Run this one again in a moment."


def test_a_read_failure_is_reported_and_retried_not_kept(real_store, monkeypatch):
    def boom(*_a, **_k):
        raise sqlite3.OperationalError("disk I/O error")
    real = bs.get_bars_table_order
    monkeypatch.setattr(bs, "get_bars_table_order", boom)
    out = es.run(req(), deadline_s=20)
    assert out["status"] == "unavailable" and out["reason"] == "read_failed"
    assert "could not be read" in esa.answer(out)["text"]
    monkeypatch.setattr(bs, "get_bars_table_order", real)
    assert es.run(req(), deadline_s=60)["status"] == "ok"


def test_kept_answers_expire_are_bounded_and_are_copies(real_store, monkeypatch):
    calls = count_reads(monkeypatch)
    first = es.run(req(), deadline_s=60)
    first["horizons"].clear()                                          # a caller's edit never reaches the next caller
    assert es.run(req(), deadline_s=60)["horizons"] and calls == ["AAA"]
    monkeypatch.setattr(es, "RESULT_KEEP_S", -1.0)
    assert es.run(req(), deadline_s=60)["status"] == "ok" and calls == ["AAA", "AAA"]
    monkeypatch.setattr(es, "RESULT_KEEP_S", 300.0)
    monkeypatch.setattr(es, "MAX_KEPT_RESULTS", 2)
    for n in (20, 21, 22, 23):
        assert es.run(req("BBB", "pct_from_sma", n, "cross_above", 0.0), deadline_s=60)["status"] == "ok"
    assert len(es._jobs) <= 3


# ── what the Agent receives ──────────────────────────────────────────────────

GATE = {"symbol": "AAA", "indicator": "rsi", "period": 14, "op": "cross_below", "threshold": 30}


def test_the_kind_carries_the_real_reason_in_notes0(real_store, monkeypatch):
    monkeypatch.setitem(es.run.__kwdefaults__, "deadline_s", 0.05)
    real_store.step_s, real_store.cold = 0.02, 200
    env = hes.read_event_study(dict(GATE), {})
    assert env["status"] == "unavailable" and env["data"] is None and "still loading" in env["notes"][0]
    real_store.cold = 0
    monkeypatch.setitem(es.run.__kwdefaults__, "deadline_s", 30)
    env = hes.read_event_study({**GATE, "symbol": "NOPE"}, {})
    assert env["status"] == "unavailable" and "no stored daily history" in env["notes"][0]
