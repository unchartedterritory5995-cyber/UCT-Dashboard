"""Spend recording that fails closed (Studio plan, section 8, launch-readiness).

A call that was paid for and then failed to reach the ledger used to advance no cap, so the
next call was admitted as if it had never happened; and a ledger that could not be read made
the gate raise instead of answering. Now an unrecorded spend is counted by every cap reader,
and an unreadable ledger answers "no room".
"""
from __future__ import annotations

import importlib

import pytest

DAY = "2026-11-16"


@pytest.fixture
def guard(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    for k in ("CATALYST_COST_HARD_CAP", "INTERACTIVE_AI_RESERVE_USD"):
        monkeypatch.delenv(k, raising=False)
    from api.services.catalyst import store as _store
    importlib.reload(_store)
    _store._init_db()
    from api.services.catalyst import cost_guard
    cost_guard._HARD_CAP_TRIPPED = False
    cost_guard._UNRECORDED.clear()
    yield cost_guard
    cost_guard._UNRECORDED.clear()
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(_store)


def _fail_writes(monkeypatch, guard):
    def boom(**_kw):
        raise OSError("disk I/O error")
    monkeypatch.setattr(guard.store, "log_cost", boom)


def test_a_spend_that_cannot_be_written_is_still_counted(guard, monkeypatch):
    model = "claude-opus-5"
    _fail_writes(monkeypatch, guard)
    cost = guard.record(DAY, "concierge:u1", model, 200_000, 20_000)
    assert cost > 0                                        # the caller is told what it cost
    s = guard.spend_by_kind(DAY)
    assert s[guard.INTERACTIVE] == pytest.approx(cost)
    assert s["total"] == pytest.approx(cost)


def test_unrecorded_member_spend_closes_the_member_gate(guard, monkeypatch):
    monkeypatch.setenv("INTERACTIVE_AI_RESERVE_USD", "1.00")
    assert guard.may_member_spend(DAY) is True
    _fail_writes(monkeypatch, guard)
    spent = 0.0
    while spent < 1.0:
        spent += guard.record(DAY, "concierge:u1", "claude-opus-5", 200_000, 20_000)
    assert guard.may_member_spend(DAY) is False
    # and background work is not charged for a member's unrecorded spend (its own lane)
    s = guard.spend_by_kind(DAY)
    assert s[guard.BACKGROUND] == 0.0


def test_the_written_and_the_unwritten_add_up(guard, monkeypatch):
    a = guard.record(DAY, "concierge:u1", "claude-opus-5", 10_000, 1_000)   # written
    _fail_writes(monkeypatch, guard)
    b = guard.record(DAY, "concierge:u1", "claude-opus-5", 10_000, 1_000)   # not written
    assert guard.spend_by_kind(DAY)[guard.INTERACTIVE] == pytest.approx(a + b)


def test_only_the_day_in_hand_is_kept_and_another_day_never_sees_it(guard, monkeypatch):
    _fail_writes(monkeypatch, guard)
    guard.record("2026-11-15", "concierge:u1", "claude-opus-5", 10_000, 1_000)
    guard.record(DAY, "concierge:u1", "claude-opus-5", 10_000, 1_000)
    assert {k[0] for k in guard._UNRECORDED} == {DAY}
    assert guard.spend_by_kind("2026-11-17")["total"] == 0.0


def test_an_unreadable_ledger_answers_no_room_for_both_gates(guard, monkeypatch):
    assert guard.may_member_spend(DAY) is True and guard.may_synthesize(DAY) is True    # control
    def boom(_d):
        raise OSError("database is locked")
    monkeypatch.setattr(guard.store, "spend_by_ticker", boom)
    assert guard.may_member_spend(DAY) is False
    assert guard.may_synthesize(DAY) is False
