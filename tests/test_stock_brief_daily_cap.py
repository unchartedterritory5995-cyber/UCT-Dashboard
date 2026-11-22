"""The stock_brief daily generation cap survives a deploy. No model is called."""
from __future__ import annotations

import pytest

from api.services import daily_counters
from api.services.stock_brief import service as sb


@pytest.fixture
def counters(tmp_path, monkeypatch):
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(sb, "_gen_day", None)
    monkeypatch.setattr(sb, "_gen_count", 0)
    monkeypatch.setattr(sb, "_DAILY_CAP", 2)


def _restart(monkeypatch):
    monkeypatch.setattr(sb, "_gen_day", None)
    monkeypatch.setattr(sb, "_gen_count", 0)


def test_the_cap_number_is_unchanged():
    assert sb._DAILY_CAP == 300


def test_the_cap_holds_within_a_process(counters):
    assert [sb._cost_ok() for _ in range(3)] == [True, True, False]


def test_a_deploy_does_not_reset_the_cap(counters, monkeypatch):
    assert sb._cost_ok() is True
    assert sb._cost_ok() is True
    _restart(monkeypatch)
    assert sb._cost_ok() is False


def test_a_refused_generation_calls_nothing_and_stamps_the_attempt(counters, monkeypatch):
    from api.routers import modelbook
    calls, marks = [], []
    monkeypatch.setattr(sb, "_enabled", lambda: True)
    monkeypatch.setattr(sb, "_compute_stats", lambda _s: {})
    monkeypatch.setattr(modelbook, "_generate_descriptions", lambda *a: calls.append(a))
    monkeypatch.setattr(sb.store, "mark_attempt", lambda s, p: marks.append(s))
    monkeypatch.setattr(sb.store, "save_profile", lambda *_a: None)
    sb._cost_ok(), sb._cost_ok()
    _restart(monkeypatch)
    sb._generate_and_store("AAA")
    assert calls == []
    assert marks == ["AAA"]


def test_the_process_counter_still_bounds_a_counter_that_fails_open(counters, monkeypatch):
    def boom():
        raise OSError("database is locked")
    monkeypatch.setattr(daily_counters, "_connect", boom)
    assert [sb._cost_ok() for _ in range(3)] == [True, True, False]


def test_a_non_positive_cap_stays_unlimited(counters, monkeypatch):
    monkeypatch.setattr(sb, "_DAILY_CAP", -1)
    assert all(sb._cost_ok() for _ in range(5))
