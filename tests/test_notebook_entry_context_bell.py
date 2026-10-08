"""Wave 13 lane 13E-2 -- the one-a-day "new fill" bell (`entry_context.notify_new_fill`).

  * EXACTLY ONE A DAY: however many entries freeze for one member on one ET day, the claim
    table (`j2_entry_context_bell_log`, keyed (user_id, day)) lets only the first one deliver.
  * A FRESH FREEZE ONLY: `capture_at_entry` rings it on "frozen", never on "already_frozen" --
    and `backfill_open_positions` never calls `capture_at_entry` at all, so an older position's
    catch-up never rings it.
  * CLAIM, THEN DELIVER: a delivery that raises releases the claim, so a LATER freeze the same
    day retries that member instead of losing the day's bell outright.
  * THE CHANNEL: `api.services.alerts.add_alert` at severity "info" -- the in-app bell, never
    email (the same channel `note_tasks._deliver_in_app` uses for task reminders).
  * PURGE takes the claim table, and only the deleted member's rows.

Reuses the fixtures and fakes from `tests/test_notebook_entry_context.py` rather than
re-deriving them -- a second authority over the same sources is the defect this wave keeps
railing against.
"""
from __future__ import annotations

from api.services.journal_two import entry_context as ectx
from tests.test_notebook_entry_context import (  # noqa: F401 -- fixtures
    AT_1030_ET,
    TODAY,
    YESTERDAY_1030_ET,
    conn,
    on,
    src,
)


class _Recorder:
    def __init__(self, fail_for=()):
        self.calls, self.fail_for = [], set(fail_for)

    def __call__(self, user_id, day):
        if user_id in self.fail_for:
            raise RuntimeError("bell unavailable")
        self.calls.append((user_id, day))


# ── notify_new_fill: the claim itself ────────────────────────────────────────────────────────

def test_one_bell_line_a_day_however_many_entries_freeze(conn, src, on):
    rec = _Recorder()
    ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                          today=TODAY, notify_deliver=rec)
    ectx.capture_at_entry("u1", "AMD", AT_1030_ET, trigger="sweep", conn=conn,
                          today=TODAY, notify_deliver=rec)
    assert rec.calls == [("u1", TODAY)]


def test_a_second_member_gets_their_own_bell_the_same_day(conn, src, on):
    rec = _Recorder()
    ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                          today=TODAY, notify_deliver=rec)
    ectx.capture_at_entry("u2", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                          today=TODAY, notify_deliver=rec)
    assert sorted(rec.calls) == [("u1", TODAY), ("u2", TODAY)]


def test_the_claim_is_a_table_so_a_fresh_process_still_remembers(conn, src, on):
    import importlib
    ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                          today=TODAY, notify_deliver=_Recorder())
    importlib.reload(ectx)                 # a redeploy: every module-level variable is gone
    rec = _Recorder()
    ok = ectx.notify_new_fill("u1", TODAY, conn=conn, deliver=rec)
    assert ok is False and rec.calls == []


def test_the_next_day_rings_again(conn, src, on):
    rec = _Recorder()
    ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                          today=TODAY, notify_deliver=rec)
    ectx.capture_at_entry("u1", "AMD", YESTERDAY_1030_ET, trigger="manual_add", conn=conn,
                          today="2026-10-01", notify_deliver=rec)
    assert sorted(rec.calls) == [("u1", "2026-10-01"), ("u1", TODAY)]


def test_an_already_frozen_entry_never_rings_a_second_bell(conn, src, on):
    rec = _Recorder()
    ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                          today=TODAY, notify_deliver=rec)
    out = ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="on_demand", conn=conn,
                                today=TODAY, notify_deliver=rec)
    assert out["status"] == "already_frozen"
    assert rec.calls == [("u1", TODAY)]


def test_backfill_never_rings_the_bell(conn, src, on):
    """`backfill_open_positions` calls `freeze` directly -- never `capture_at_entry` -- so an
    older position's catch-up must never reach the notifier at all."""
    calls = []
    import api.services.alerts as alerts
    import pytest

    def _boom(*a, **k):
        calls.append((a, k))
        raise AssertionError("backfill must never ring the bell")

    mp = pytest.MonkeyPatch()
    mp.setattr(alerts, "add_alert", _boom)
    try:
        from tests.test_notebook_entry_context import _position
        _position(conn, uid="u1", symbol="NVDA", entry=YESTERDAY_1030_ET, closed=None)
        out = ectx.backfill_open_positions("u1", conn=conn, today=TODAY)
        assert out["frozen"] >= 1
        assert calls == []
    finally:
        mp.undo()


def test_a_failed_delivery_releases_the_claim_so_a_later_freeze_retries(conn, src, on):
    rec = _Recorder(fail_for={"u1"})
    out1 = ectx.capture_at_entry("u1", "NVDA", AT_1030_ET, trigger="manual_add", conn=conn,
                                 today=TODAY, notify_deliver=rec)
    assert out1["status"] == "frozen" and rec.calls == []     # delivered nothing: it raised
    rec2 = _Recorder()
    ectx.capture_at_entry("u1", "AMD", AT_1030_ET, trigger="sweep", conn=conn,
                          today=TODAY, notify_deliver=rec2)
    assert rec2.calls == [("u1", TODAY)]                      # the released claim is retried


def test_notify_new_fill_never_raises_even_when_the_store_is_unreadable(conn, src, on):
    import sqlite3
    conn.execute("DROP TABLE j2_entry_context_bell_log")

    class _Boom:
        def __enter__(self):
            raise sqlite3.OperationalError("disk I/O error")

        def __exit__(self, *a):
            return False

    import api.services.journal_two.entry_context as mod
    import pytest
    mp = pytest.MonkeyPatch()
    mp.setattr(mod, "_Conn", lambda c: _Boom())
    try:
        ok = mod.notify_new_fill("u1", TODAY, conn=conn)
        assert ok is False
    finally:
        mp.undo()


# ── the real delivery channel ─────────────────────────────────────────────────────────────

def test_the_real_delivery_is_the_in_app_bell_at_info_and_never_email(conn, src, on, monkeypatch):
    import api.services.email_service as email_service
    from api.services import alerts

    def _no_email(*a, **k):
        raise AssertionError("the new-fill bell must never send email")

    monkeypatch.setattr(email_service, "send_email", _no_email)

    seen = {}

    def _spy(alert_type, title, message, severity=None, data=None, user_id=None, channels=None):
        seen.update(alert_type=alert_type, title=title, message=message, severity=severity,
                    data=data, user_id=user_id)
        return {"ok": True}

    monkeypatch.setattr(alerts, "add_alert", _spy)
    ok = ectx.notify_new_fill("u1", TODAY, conn=conn)
    assert ok is True
    assert seen["alert_type"] == ectx.BELL_SOURCE
    assert seen["severity"] == "info"
    assert seen["user_id"] == "u1"
    assert seen["data"]["day"] == TODAY


# ── purge ─────────────────────────────────────────────────────────────────────────────────

def test_account_purge_also_takes_the_bell_log_and_only_that_member(conn, src, on):
    from api.services.journal_two import account_purge
    ectx.notify_new_fill("u1", TODAY, conn=conn)
    ectx.notify_new_fill("u2", TODAY, conn=conn)
    report = account_purge.purge_user_rows("u1", conn)
    assert report["rows_deleted"]["j2_entry_context_bell_log"] == 1
    remaining = [r["user_id"] for r in
                conn.execute("SELECT user_id FROM j2_entry_context_bell_log")]
    assert remaining == ["u2"]
