"""flow_summary conviction board cache: limit-agnostic single-flight compute,
stale-while-revalidate, disk-backed — so the request path never cold-computes
in-band inside the busy flow-worker process (2026-07-23 pile-up fix)."""
import os
import time

import pytest

from api import flow_summary as fs


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    # Point disk persistence at a temp file + reset in-memory board each test.
    monkeypatch.setattr(fs, "_BOARD_FILE", str(tmp_path / "board.json"))
    monkeypatch.setattr(fs, "_BOARD", None)
    monkeypatch.setattr(fs, "_BOARD_REFRESHING", False)
    yield


def _board(n=30):
    items = [{"sym": f"T{i}", "netPremium": 1000 - i, "rank": i + 1} for i in range(n)]
    return (time.time(), "7/23/2026", items)


def test_limit_agnostic_single_compute(monkeypatch):
    calls = {"n": 0}

    def fake():
        calls["n"] += 1
        return _board()
    monkeypatch.setattr(fs, "_compute_board", fake)

    p10 = fs.get_top_conviction(10)
    p20 = fs.get_top_conviction(20)
    assert p10["count"] == 10
    assert p20["count"] == 20
    assert calls["n"] == 1                    # ONE compute serves both limits


def test_slice_preserves_rank_order(monkeypatch):
    monkeypatch.setattr(fs, "_compute_board", lambda: _board())
    p = fs.get_top_conviction(5)
    assert [i["sym"] for i in p["items"]] == ["T0", "T1", "T2", "T3", "T4"]


def test_persists_to_disk(monkeypatch):
    monkeypatch.setattr(fs, "_compute_board", lambda: _board())
    fs.get_top_conviction(10)
    assert os.path.exists(fs._BOARD_FILE)


def test_cold_process_loads_from_disk_without_computing(monkeypatch):
    # Prime disk via one compute, then simulate a fresh process (memory cleared).
    monkeypatch.setattr(fs, "_compute_board", lambda: _board())
    fs.get_top_conviction(10)
    monkeypatch.setattr(fs, "_BOARD", None)

    calls = {"n": 0}

    def boom():
        calls["n"] += 1
        raise AssertionError("should not compute in-band when disk board exists")
    monkeypatch.setattr(fs, "_compute_board", boom)
    # Block the background refresh from actually computing too.
    monkeypatch.setattr(fs, "_kick_background_refresh", lambda: None)

    p = fs.get_top_conviction(5)
    assert p["count"] == 5
    assert calls["n"] == 0                     # served from disk, no in-band compute


def test_stale_served_immediately(monkeypatch):
    monkeypatch.setattr(fs, "_BOARD",
                        (time.time() - 9999, "7/23/2026",
                         [{"sym": "OLD", "netPremium": 1, "rank": 1}]))
    monkeypatch.setattr(fs, "_kick_background_refresh", lambda: None)

    def boom():
        raise AssertionError("stale board must be served without in-band compute")
    monkeypatch.setattr(fs, "_compute_board", boom)

    p = fs.get_top_conviction(1)
    assert p["items"][0]["sym"] == "OLD"       # stale served, refresh deferred


def test_fresh_board_not_recomputed(monkeypatch):
    calls = {"n": 0}

    def fake():
        calls["n"] += 1
        return _board()
    monkeypatch.setattr(fs, "_compute_board", fake)
    fs.get_top_conviction(10)
    fs.get_top_conviction(10)                   # within TTL
    assert calls["n"] == 1
