"""Tests for Journal 2.0 celebration moments (P6-7).

detect() is a pure orchestrator over already-loaded aggregates; only the
`calendar_seen` once-per gate needs a real DB, so the fixture points
calendar_seen at an isolated temp SQLite file (mirroring the sibling
test_overview db isolation).
"""
from __future__ import annotations

import os
import tempfile

import pytest


@pytest.fixture
def seen_db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    from api.services import calendar_seen
    # Point the once-per gate at the temp DB + force a fresh lazy-init there.
    monkeypatch.setattr(calendar_seen, "_DB_PATH", tmp.name)
    monkeypatch.setattr(calendar_seen, "_INIT_DONE", False)
    yield tmp.name
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


def _goal(**periods):
    """Build a goal_progress-shaped dict; each kwarg is period->progress float."""
    base = {p: {"pnl": 0.0, "target": None, "progress": None}
            for p in ("daily", "weekly", "monthly", "yearly")}
    for pkey, prog in periods.items():
        base[pkey] = {"pnl": 540.0, "target": 100, "progress": prog}
    return {"accountId": "a1", "periods": base}


# ── goal ──────────────────────────────────────────────────────────────────────

def test_goal_progress_ge_1_emits_period_keyed_goal(seen_db):
    from api.services.journal_two import celebrations
    out = celebrations.detect(
        "u1", "a1", goal=_goal(daily=1.2), today_date="2026-07-11",
    )
    goals = [c for c in out if c["kind"] == "goal"]
    assert len(goals) == 1
    assert goals[0]["key"] == "goal_daily_2026-07-11"
    assert "goal hit" in goals[0]["message"].lower()
    assert "$540" in goals[0]["message"]


def test_weekly_goal_keyed_by_iso_week(seen_db):
    from api.services.journal_two import celebrations
    out = celebrations.detect(
        "u1", "a1", goal=_goal(weekly=1.0), today_date="2026-07-11",
    )
    # 2026-07-11 is ISO week 28
    assert any(c["key"] == "goal_weekly_2026-W28" for c in out)


def test_goal_below_target_does_not_emit(seen_db):
    from api.services.journal_two import celebrations
    out = celebrations.detect(
        "u1", "a1", goal=_goal(daily=0.9), today_date="2026-07-11",
    )
    assert all(c["kind"] != "goal" for c in out)


# ── win streak ────────────────────────────────────────────────────────────────

def test_win_streak_ge_threshold_emits_streak(seen_db):
    from api.services.journal_two import celebrations
    nudges = {"winStreakCount": 6, "thresholds": {"win": 5, "loss": 3, "staleDays": 30}}
    out = celebrations.detect("u1", "a1", nudges=nudges, today_date="2026-07-11")
    streak = [c for c in out if c["kind"] == "streak"]
    assert len(streak) == 1
    assert streak[0]["key"] == "winstreak_6"
    assert "6 wins in a row" in streak[0]["message"]


def test_win_streak_below_threshold_does_not_emit(seen_db):
    from api.services.journal_two import celebrations
    nudges = {"winStreakCount": 4, "thresholds": {"win": 5}}
    out = celebrations.detect("u1", "a1", nudges=nudges, today_date="2026-07-11")
    assert out == []


# ── once-per (mark_seen dedupe) ───────────────────────────────────────────────

def test_same_key_not_returned_twice(seen_db):
    from api.services.journal_two import celebrations
    nudges = {"winStreakCount": 6, "thresholds": {"win": 5}}
    first = celebrations.detect("u1", "a1", nudges=nudges, today_date="2026-07-11")
    assert any(c["key"] == "winstreak_6" for c in first)
    # Second call for the SAME achievement returns nothing new.
    second = celebrations.detect("u1", "a1", nudges=nudges, today_date="2026-07-11")
    assert second == []


def test_once_per_is_per_user(seen_db):
    from api.services.journal_two import celebrations
    nudges = {"winStreakCount": 6, "thresholds": {"win": 5}}
    celebrations.detect("u1", "a1", nudges=nudges, today_date="2026-07-11")
    # A different user hasn't seen it yet → still fires for them.
    other = celebrations.detect("u2", "a1", nudges=nudges, today_date="2026-07-11")
    assert any(c["key"] == "winstreak_6" for c in other)


# ── clean discipline day ──────────────────────────────────────────────────────

def test_clean_day_emits_when_traded_unlocked_and_complete(seen_db):
    from api.services.journal_two import celebrations
    disc = {"locked": False, "reasons": []}
    out = celebrations.detect(
        "u1", "a1", discipline=disc, traded_today=True, day_complete=True,
        today_date="2026-07-11",
    )
    clean = [c for c in out if c["kind"] == "discipline"]
    assert len(clean) == 1
    assert clean[0]["key"] == "cleanday_2026-07-11"


def test_locked_day_no_clean_day_celebration(seen_db):
    from api.services.journal_two import celebrations
    disc = {"locked": True, "reasons": [{"type": "daily_loss"}]}
    out = celebrations.detect(
        "u1", "a1", discipline=disc, traded_today=True, day_complete=True,
        today_date="2026-07-11",
    )
    assert all(c["kind"] != "discipline" for c in out)


def test_clean_day_requires_day_complete_optin(seen_db):
    from api.services.journal_two import celebrations
    disc = {"locked": False, "reasons": []}
    # traded + unlocked but caller did NOT opt in (day not done) → no emit.
    out = celebrations.detect(
        "u1", "a1", discipline=disc, traded_today=True, day_complete=False,
        today_date="2026-07-11",
    )
    assert all(c["kind"] != "discipline" for c in out)


def test_clean_day_requires_a_trade(seen_db):
    from api.services.journal_two import celebrations
    disc = {"locked": False, "reasons": []}
    out = celebrations.detect(
        "u1", "a1", discipline=disc, traded_today=False, day_complete=True,
        today_date="2026-07-11",
    )
    assert all(c["kind"] != "discipline" for c in out)


def test_clean_day_derives_traded_from_overview(seen_db):
    from api.services.journal_two import celebrations
    disc = {"locked": False, "reasons": []}
    overview = {"today": {"trade_count": 2}}
    out = celebrations.detect(
        "u1", "a1", discipline=disc, overview=overview, day_complete=True,
        today_date="2026-07-11",
    )
    assert any(c["kind"] == "discipline" for c in out)


# ── 100%-adherence ────────────────────────────────────────────────────────────

def test_full_adherence_trade_emits_keyed_by_ref(seen_db):
    from api.services.journal_two import celebrations
    adherence = {
        "id:t1": {"adherencePct": 1.0},
        "id:t2": {"adherencePct": 0.5},
    }
    out = celebrations.detect(
        "u1", "a1", adherence=adherence, today_date="2026-07-11",
    )
    keys = {c["key"] for c in out if c["kind"] == "adherence"}
    assert "adherence100_id:t1" in keys
    assert "adherence100_id:t2" not in keys


# ── defensive: missing inputs never crash / never emit ────────────────────────

def test_missing_inputs_no_crash_no_emit(seen_db):
    from api.services.journal_two import celebrations
    assert celebrations.detect("u1", "a1") == []
    assert celebrations.detect(
        "u1", "a1", goal=None, nudges=None, discipline=None, adherence=None,
    ) == []


def test_malformed_inputs_do_not_crash(seen_db):
    from api.services.journal_two import celebrations
    # Garbage shapes for every input — should be swallowed defensively.
    out = celebrations.detect(
        "u1", "a1",
        goal={"periods": {"daily": {"progress": "notanumber"}}},
        nudges={"winStreakCount": None, "thresholds": None},
        discipline={},
        adherence={"id:x": None},
        today_date="not-a-date",
    )
    assert isinstance(out, list)
