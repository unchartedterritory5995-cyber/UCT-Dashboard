"""A slow /api/bars answer names itself in the pod log (2026-11-27: a 5.1 s cold D2000 left no trace)."""
import logging

from api.routers import bars as bars_router


def test_a_slow_answer_is_logged_with_its_phases(monkeypatch, caplog):
    monkeypatch.setattr(bars_router, "SLOW_BARS_LOG_MS", -1)      # every answer counts as slow
    caplog.set_level(logging.WARNING)
    bars_router.serve_bars_http("UCTA50", "D", 30)                # breadth: served locally, no provider
    lines = [r.getMessage() for r in caplog.records if "[bars-slow]" in r.getMessage()]
    assert lines, "a slow answer left no [bars-slow] line"
    assert "UCTA50" in lines[0] and "tf=D" in lines[0] and "bars;desc=" in lines[0]


def test_CONTROL_a_fast_answer_is_not_logged(monkeypatch, caplog):
    monkeypatch.setattr(bars_router, "SLOW_BARS_LOG_MS", 10 ** 9)
    caplog.set_level(logging.WARNING)
    bars_router.serve_bars_http("UCTA50", "D", 30)
    assert not [r for r in caplog.records if "[bars-slow]" in r.getMessage()]
