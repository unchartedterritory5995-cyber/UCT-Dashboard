"""The bad-day guard (2026-10-11): a ring never revisits a date behind its newest, so an empty
provider answer on a real trading day, or a partial frame, must STOP the sweep (retried next
run) instead of being skipped or sealed. No network."""
from __future__ import annotations

import pytest

from api.services import breadth_nhnl_intraday as nhi
from api.services import massive


def _frame(n):
    return {f"T{i}": {"h": 10, "l": 9, "c": 9.5, "v": 1000} for i in range(n)}


COUNTS = {f"2026-09-{d:02d}": 10000 for d in range(1, 21)}


def test_empty_on_a_trading_day_is_a_failure_not_a_closure():
    assert nhi.check_frame("2026-10-09", {}, COUNTS) == "empty answer on a trading day"
    assert nhi.check_frame("2026-10-10", {}, COUNTS) == "closed"        # Saturday
    assert nhi.check_frame("2026-11-26", {}, COUNTS) == "closed"        # Thanksgiving


def test_a_partial_frame_is_refused_against_the_recent_median():
    assert nhi.check_frame("2026-10-09", _frame(7000), COUNTS).startswith("partial frame")
    assert nhi.check_frame("2026-10-09", _frame(9000), COUNTS) is None
    assert nhi.check_frame("2026-10-09", _frame(10), {}) is None        # no baseline yet


def test_the_owner_can_accept_a_date(monkeypatch):
    monkeypatch.setenv(nhi.ACCEPT_ENV, "2026-10-09")
    assert nhi.check_frame("2026-10-09", _frame(10), COUNTS) is None
    assert nhi.check_frame("2026-10-09", {}, COUNTS) == "closed"


def test_the_sweep_stops_at_an_empty_trading_day_and_does_not_advance(tmp_path, monkeypatch):
    monkeypatch.setattr(nhi, "STATE_PATH", str(tmp_path / "state.npz"))
    monkeypatch.setattr(nhi, "SERIES_PATH", str(tmp_path / "series.json"))
    monkeypatch.setattr(nhi, "PACE_SECONDS", 0)
    monkeypatch.setattr(nhi, "_settled_through", lambda: "2026-10-09")
    monkeypatch.setattr(nhi, "_sessions_after", lambda last, through: ["2026-10-08", "2026-10-09"])
    monkeypatch.setattr(nhi, "_write_series", lambda s, upload=False: "sha")
    from api.services import breadth_pit_frame as bpf
    monkeypatch.setattr(bpf, "reference_map", lambda: {})
    blocked = []
    monkeypatch.setattr(nhi, "report_block", lambda name, d, why: blocked.append((d, why)))
    monkeypatch.setattr(massive, "get_grouped_daily_frame",
                        lambda d, adjusted=True, store=False: {"rows": {}})
    out = nhi.sweep(max_sessions=None)
    assert out["sessions"] == 0 and out["failed"][0][0] == "2026-10-08"
    assert blocked == [("2026-10-08", "empty answer on a trading day")]


def test_the_provider_closure_marker_is_only_for_calendar_closures():
    assert massive._calendar_trading_day("2026-10-09") is True
    assert massive._calendar_trading_day("2026-10-10") is False
    assert massive._calendar_trading_day("not-a-date") is False
