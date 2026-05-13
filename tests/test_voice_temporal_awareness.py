"""Temporal awareness — session state, freshness, user routine."""

import uuid
from datetime import datetime, date, timedelta, timezone
from unittest.mock import patch

import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_temporal_awareness as vta


# ── Holiday + weekend detection ─────────────────────────────────────────────

def test_is_market_holiday_known_dates():
    assert vta._is_market_holiday(date(2026, 1, 1))    # New Year's
    assert vta._is_market_holiday(date(2026, 12, 25))  # Christmas
    assert not vta._is_market_holiday(date(2026, 6, 1))  # Random Monday


def test_next_market_open_skips_weekend():
    # Saturday afternoon — next open should be Monday 9:30
    sat = datetime(2026, 5, 16, 15, 0)  # 5/16 is a Saturday
    n = vta._next_market_open(sat)
    assert n.weekday() == 0  # Monday
    assert n.hour == 9 and n.minute == 30


def test_next_market_open_skips_holiday():
    # Friday before Memorial Day weekend — next open is Tuesday
    fri = datetime(2026, 5, 22, 18, 0)  # Fri after close
    n = vta._next_market_open(fri)
    # Saturday + Sunday + Memorial Day (Mon May 25) = next open Tue May 26
    assert n.date() == date(2026, 5, 26)


# ── Session state ───────────────────────────────────────────────────────────

def test_session_state_premarket():
    # Tuesday 8:00am ET — pre-market
    et = datetime(2026, 5, 19, 8, 0)
    s = vta._session_state(et)
    assert s["state"] == "premarket"
    assert "open in" in s["detail"]
    assert s["minutes_to_open"] == 90


def test_session_state_opening_drive():
    # Tuesday 9:45am ET
    et = datetime(2026, 5, 19, 9, 45)
    s = vta._session_state(et)
    assert s["state"] == "rth"
    assert "opening drive" in s["label"].lower()


def test_session_state_lunch_chop():
    et = datetime(2026, 5, 19, 12, 30)
    s = vta._session_state(et)
    assert s["state"] == "rth"
    assert "lunch" in s["label"].lower()


def test_session_state_after_hours():
    et = datetime(2026, 5, 19, 17, 30)
    s = vta._session_state(et)
    assert s["state"] == "after_hours"


def test_session_state_weekend():
    et = datetime(2026, 5, 16, 11, 0)  # Saturday
    s = vta._session_state(et)
    assert s["state"] == "closed"
    assert "weekend" in s["detail"].lower()


def test_session_state_holiday():
    et = datetime(2026, 5, 25, 11, 0)  # Memorial Day
    s = vta._session_state(et)
    assert s["state"] == "closed"
    assert "holiday" in s["detail"].lower()


# ── Data freshness ──────────────────────────────────────────────────────────

def test_data_freshness_no_wire():
    with patch("api.services.cache.cache.get", return_value=None):
        f = vta._data_freshness()
    assert f["is_fresh"] is False
    assert f["wire_date"] is None


def test_data_freshness_today():
    # _data_freshness uses _et_now().date() — match it so the test isn't
    # timezone-sensitive (failed across local-midnight when system is in
    # CT but ET is one day ahead).
    today_iso = vta._et_now().date().isoformat()
    with patch("api.services.cache.cache.get",
               return_value={"date": today_iso}):
        f = vta._data_freshness()
    assert f["is_fresh"] is True
    assert "today" in f["label"].lower()


def test_data_freshness_old():
    old = (vta._et_now().date() - timedelta(days=5)).isoformat()
    with patch("api.services.cache.cache.get",
               return_value={"date": old}):
        f = vta._data_freshness()
    assert f["is_fresh"] is False
    assert "5" in f["label"]


# ── User routine ────────────────────────────────────────────────────────────

def test_user_routine_no_sessions():
    init_db()
    uid = create_user(f"tr_{uuid.uuid4()}@x.com", "p")["id"]
    r = vta._user_routine(uid)
    assert r["session_count_30d"] == 0
    assert r["typical_hour_et"] is None
    assert r["common_days"] == []


def test_user_routine_with_sessions():
    init_db()
    uid = create_user(f"tr_{uuid.uuid4()}@x.com", "p")["id"]
    from api.services.voice_session_service import create_session
    # Create 3 sessions; they default to current time
    for _ in range(3):
        create_session(user_id=uid, mode="c", source="orb",
                       page_context="global")
    r = vta._user_routine(uid)
    assert r["session_count_30d"] == 3
    assert r["typical_hour_et"] is not None


# ── get_market_context end-to-end ───────────────────────────────────────────

def test_get_market_context_full_shape(monkeypatch):
    monkeypatch.setattr(vta, "_et_now",
                         lambda: datetime(2026, 5, 19, 10, 30))  # Tue 10:30am
    with patch("api.services.cache.cache.get",
               return_value={"date": "2026-05-19"}):
        ctx = vta.get_market_context()
    assert ctx["ok"] is True
    assert ctx["session_state"]["state"] == "rth"
    assert ctx["data_freshness"]["is_fresh"] is True
    assert "Market is" in ctx["narration"]


def test_build_temporal_prompt_line_includes_warning_when_stale(monkeypatch):
    monkeypatch.setattr(vta, "_et_now",
                         lambda: datetime(2026, 5, 19, 10, 30))
    with patch("api.services.cache.cache.get",
               return_value={"date": "2026-05-12"}):  # week-old
        line = vta.build_temporal_prompt_line()
    assert "TEMPORAL" in line
    assert "⚠" in line


def test_build_temporal_prompt_line_no_warning_when_fresh(monkeypatch):
    monkeypatch.setattr(vta, "_et_now",
                         lambda: datetime(2026, 5, 19, 10, 30))
    with patch("api.services.cache.cache.get",
               return_value={"date": "2026-05-19"}):
        line = vta.build_temporal_prompt_line()
    assert "⚠" not in line


def test_build_temporal_prompt_line_handles_errors(monkeypatch):
    monkeypatch.setattr(vta, "get_market_context",
                         lambda **kw: (_ for _ in ()).throw(RuntimeError("boom")))
    assert vta.build_temporal_prompt_line() == ""
