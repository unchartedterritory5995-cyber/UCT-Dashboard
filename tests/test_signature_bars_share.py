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
