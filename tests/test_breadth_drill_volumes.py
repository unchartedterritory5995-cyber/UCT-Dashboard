"""A recorded drill list gets each name's raw session volume from that day's bars.

The stored *_list rows carry RVOL (`vr`) but not shares, so the drill window's Vol
column was all dashes on every past day. Synthetic bars only.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import bars_sqlite
from api.services import breadth_monitor as bm


@pytest.fixture()
def bars(monkeypatch):
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, c REAL, v REAL,"
              " PRIMARY KEY (ticker, tf, ts))")
    rows = [("AAA", "D", 20260910, 10.0, 1234567), ("BBB", "D", 20260910, 5.0, 900),
            ("AAA", "D", 20260909, 9.0, 1), ("CCC", "D", 20260909, 2.0, 77)]
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?)", rows)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: c)
    bm._DAY_VOL_CACHE.clear()
    yield c
    bm._DAY_VOL_CACHE.clear()


def test_fills_volume_from_that_days_bar(bars):
    items = [{"t": "AAA", "pct": 5.0}, {"t": "BBB", "pct": 4.0}, {"t": "CCC", "pct": 3.0}]
    out = bm.fill_drill_volumes("2026-09-10", items)
    assert out[0]["v"] == 1234567       # the 09-10 bar, not 09-09's
    assert out[1]["v"] == 900
    assert "v" not in out[2]            # no bar that day stays empty, never a neighbour's
    assert "v" not in items[0]          # the stored list is not mutated


def test_an_existing_v_is_kept(bars):
    out = bm.fill_drill_volumes("2026-09-10", [{"t": "AAA", "v": 42}])
    assert out[0]["v"] == 42


def test_a_failure_returns_the_list_unchanged(monkeypatch):
    def boom():
        raise RuntimeError("bars.db unavailable")
    monkeypatch.setattr(bars_sqlite, "_conn", boom)
    bm._DAY_VOL_CACHE.clear()
    items = [{"t": "AAA"}]
    assert bm.fill_drill_volumes("2026-09-10", items) == items


def test_a_half_empty_answer_is_not_cached(bars):
    bm.fill_drill_volumes("2026-09-10", [{"t": "AAA"}, {"t": "ZZZ"}, {"t": "YYY"}])
    assert not bm._DAY_VOL_CACHE
    bm.fill_drill_volumes("2026-09-10", [{"t": "AAA"}, {"t": "BBB"}])
    assert len(bm._DAY_VOL_CACHE) == 1
