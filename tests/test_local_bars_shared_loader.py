"""The scan engine and the alert lane read other symbols through ONE local loader.

`local_bars.read_bars` was the scan engine's private `_read_bars` until 2026-11-15, when
the alert lane's import of it put `scan_evaluator` inside two member routes' reach (the
request-path census refused it). These rails keep the two readers on one function, so a
scan and an alert can never disagree about a symbol's bars.
"""
from __future__ import annotations


def test_the_scan_engine_reads_through_the_shared_loader(monkeypatch):
    from api.services import local_bars
    from api.services.screener import scan_evaluator
    seen = []
    monkeypatch.setattr(local_bars, "read_bars", lambda s, tf, want: seen.append((s, tf, want)) or ["x"])
    assert scan_evaluator._read_bars("SPY", "D", 10) == ["x"]
    assert seen == [("SPY", "D", 10)]


def test_the_alert_lane_reads_through_the_shared_loader(monkeypatch):
    from api.services import alert_user_series as aus
    from api.services import local_bars
    seen = []
    monkeypatch.setattr(local_bars, "read_bars", lambda s, tf, want: seen.append(s) or [])
    aus._SYMBOL_CACHE.clear()
    aus._symbol_bars("QQQ", "D", 5)
    assert seen == ["QQQ"]


def test_daily_bars_are_cut_to_the_current_listing_and_others_are_not(monkeypatch):
    from api.services import bars_sqlite, listing_break, local_bars
    rows = [(20260101, 1, 2, 0.5, 1.5, 100)]
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, want: rows)
    cut = []
    monkeypatch.setattr(listing_break, "current_listing", lambda bars: cut.append(1) or bars)
    assert local_bars.read_bars("X", "D", 5) == [{"t": 20260101, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}]
    assert cut == [1]
    local_bars.read_bars("X", "5", 5)
    assert cut == [1]
