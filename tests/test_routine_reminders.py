"""Task 9.9 - optional routine reminders through the alert bell, once a day, with a claim log.

Real auth.db schema in a tmp dir and an injected `now`: nothing sleeps. Dates are real 2026
sessions (ET): Mon 2026-11-02 is an ordinary session, Thu 11-26 is Thanksgiving, Fri 11-27 is
the half day (13:00 close), Sat 11-28 is a weekend.
"""
from __future__ import annotations

import ast
import importlib
import pathlib
from datetime import date, datetime

import pytest

from api.services.journal_two.timeutil import ET

A, B = "u-rem-a", "u-rem-b"
DAY = "2026-11-02"
EVERY = {"kind": "every"}
ITEMS = [{"text": "Read the wire"}, {"text": "Set max loss"}]
_MAIN = pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py"
_MODULE = pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "journal_two" / "routine_reminders.py"


def et(day: str, h: int, m: int = 0, s: int = 0) -> datetime:
    y, mo, d = (int(x) for x in day.split("-"))
    return datetime(y, mo, d, h, m, s, tzinfo=ET)


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED", raising=False)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import routine_reminders, routines
    yield type("Env", (), {"RR": routine_reminders, "R": routines, "auth_db": auth_db})
    importlib.reload(auth_db)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")


@pytest.fixture
def bell(monkeypatch):
    """Spies the one delivery: records each add_alert call and fills the `channels` out-dict from
    the REAL add_alert, so the test reads what the alerts module itself reports."""
    from api.services import alerts
    real = alerts.add_alert
    calls: list[dict] = []

    def spy(alert_type, title, message, severity=None, data=None, user_id=None, channels=None):
        ch: dict = {}
        out = real(alert_type, title, message, severity=severity, data=data, user_id=user_id,
                   channels=ch)
        calls.append({"type": alert_type, "title": title, "message": message,
                      "severity": severity, "data": data, "user_id": user_id,
                      "channels": ch, "alert": out})
        return out

    monkeypatch.setattr(alerts, "add_alert", spy)
    return calls


def make(env, user=A, *, name="Morning", time_et="09:00", on_=True, schedule=None, day=DAY,
         items=None, reminder=True):
    settings = {"reminder": {"on": on_, "time_et": time_et}} if reminder else None
    return env.R.create(user, name=name, items=items or ITEMS, schedule=schedule or EVERY,
                        settings=settings, now=et(day, 8))


def claims(env) -> list[tuple]:
    with env.auth_db.get_connection() as c:
        return [tuple(r) for r in c.execute(
            "SELECT user_id, routine_id, day FROM j2_routine_reminder_claims")]


# ── the flag ───────────────────────────────────────────────────────────────────────────────────

def test_off_by_default_sends_nothing(env, bell):
    make(env)
    assert env.RR.run_due(et(DAY, 9, 0, 5)) == {"skipped": "flag off"}
    assert bell == [] and claims(env) == []


def test_flag_off_reads_nothing(env, monkeypatch):
    """Off, `run_due` never opens a connection. The spy must be able to fire: with the flag on
    the same call does reach it."""
    seen: list[int] = []
    real = env.auth_db.get_connection

    def spy(*a, **k):
        seen.append(1)
        return real(*a, **k)

    monkeypatch.setattr(env.auth_db, "get_connection", spy)
    assert env.RR.run_due(et(DAY, 9, 0, 5)) == {"skipped": "flag off"}
    assert seen == []
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    env.RR.run_due(et(DAY, 9, 0, 5))
    assert seen, "control: with the flag on, the spy sees the read"


# ── once a day ─────────────────────────────────────────────────────────────────────────────────

def test_fires_once_per_routine_per_day(env, on, bell):
    r = make(env)
    assert env.RR.run_due(et(DAY, 9, 0, 10)) == {"claimed": 1, "sent": 1}
    assert env.RR.run_due(et(DAY, 9, 3)) == {"claimed": 0, "sent": 0}      # same slot, second run
    assert len(bell) == 1
    call = bell[0]
    assert call["type"] == env.RR.ALERT_TYPE == "routine_reminder"
    assert call["title"] == "Morning" and call["message"] == "Your routine for today is ready."
    assert call["severity"] == "info" and call["user_id"] == A
    assert call["data"] == {"routineId": r["id"], "day": DAY}
    assert claims(env) == [(A, r["id"], DAY)]


def test_the_copy_carries_no_number(env, on, bell):
    """W9-R7: no zeros (no count of any kind) in the sentence."""
    make(env, name="Pre-market")
    env.RR.run_due(et(DAY, 9, 0, 10))
    assert not any(ch.isdigit() for ch in bell[0]["message"])


def test_a_failed_alert_is_logged_and_not_retried(env, on, monkeypatch):
    from api.services import alerts
    r = make(env)

    def boom(*a, **k):
        raise RuntimeError("bell down")

    monkeypatch.setattr(alerts, "add_alert", boom)
    assert env.RR.run_due(et(DAY, 9, 0, 10)) == {"claimed": 1, "sent": 0}
    sent: list = []
    monkeypatch.setattr(alerts, "add_alert", lambda *a, **k: sent.append(a))
    assert env.RR.run_due(et(DAY, 9, 3)) == {"claimed": 0, "sent": 0}
    assert sent == [] and claims(env) == [(A, r["id"], DAY)]


def test_the_next_day_is_a_new_claim(env, on, bell):
    make(env)
    env.RR.run_due(et(DAY, 9, 0, 10))
    assert env.RR.run_due(et("2026-11-03", 9, 0, 10)) == {"claimed": 1, "sent": 1}
    assert len({c[2] for c in claims(env)}) == 2


# ── the slot ───────────────────────────────────────────────────────────────────────────────────

def test_holiday_and_weekend_no_slot(env, on, bell):
    for d in (date(2026, 11, 26), date(2026, 11, 28), date(2026, 11, 29)):   # Thanksgiving, Sat, Sun
        assert env.RR.slot_for("09:00", d) is None
    assert env.RR.slot_for("09:00", date(2026, 11, 27)) is not None            # the half day is a session
    make(env)
    assert env.RR.run_due(et("2026-11-26", 9, 0, 10)) == {"claimed": 0, "sent": 0}
    assert env.RR.run_due(et("2026-11-28", 9, 0, 10)) == {"claimed": 0, "sent": 0}
    assert bell == []


def test_early_close_moves_the_slot(env):
    d = date(2026, 11, 27)
    assert env.RR.slot_for("15:45", d) == et("2026-11-27", 12, 45)
    assert env.RR.slot_for("16:00", d) == et("2026-11-27", 13, 0)
    # at or before the close, the stated time
    assert env.RR.slot_for("13:00", d) == et("2026-11-27", 13, 0)
    assert env.RR.slot_for("09:30", d) == et("2026-11-27", 9, 30)
    # a regular session never moves
    assert env.RR.slot_for("15:45", date(2026, 11, 2)) == et("2026-11-02", 15, 45)
    # discriminator: the result is ET-aware
    assert env.RR.slot_for("15:45", d).utcoffset().total_seconds() == -5 * 3600


def test_early_close_slot_fires_at_the_moved_time(env, on, bell):
    make(env, time_et="15:45", day="2026-11-27")
    assert env.RR.run_due(et("2026-11-27", 15, 45, 10)) == {"claimed": 0, "sent": 0}   # the stated time
    assert env.RR.run_due(et("2026-11-27", 12, 45, 10)) == {"claimed": 1, "sent": 1}


def test_missed_slot_is_skipped_not_late(env, on, bell):
    make(env)
    assert env.RR.run_due(et(DAY, 9, 12)) == {"claimed": 0, "sent": 0}        # a deploy ate 09:00
    assert bell == [] and claims(env) == []


def test_the_window_is_five_minutes_open_at_the_old_end(env):
    r = make(env)
    for hh, mm, ss, expect in ((9, 0, 0, True), (9, 4, 59, True), (9, 5, 0, False),
                               (8, 59, 59, False)):
        got = env.RR.due(env.auth_db.get_connection(), et(DAY, hh, mm, ss))
        assert (got == [(A, r["id"], DAY, "Morning")]) is expect, (hh, mm, ss)


# ── which routines ─────────────────────────────────────────────────────────────────────────────

def test_done_or_skipped_today_sends_nothing(env, on, bell):
    done = make(env, name="Done")
    skipped = make(env, name="Skipped")
    partial = make(env, name="Partial")
    for item in done["items"]:
        env.R.set_tick(A, done["id"], DAY, item["id"], True, now=et(DAY, 8, 30))
    env.R.set_skipped(A, skipped["id"], DAY, True, now=et(DAY, 8, 30))
    env.R.set_tick(A, partial["id"], DAY, partial["items"][0]["id"], True, now=et(DAY, 8, 30))
    got = env.RR.due(env.auth_db.get_connection(), et(DAY, 9, 0, 10))
    assert [g[3] for g in got] == ["Partial"]       # one of two ticks is not done
    env.RR.run_due(et(DAY, 9, 0, 10))
    assert [c["title"] for c in bell] == ["Partial"]


def test_reminder_off_or_unset_sends_nothing(env, on, bell):
    make(env, name="Off", on_=False)
    make(env, name="Unset", reminder=False)
    assert env.RR.run_due(et(DAY, 9, 0, 10)) == {"claimed": 0, "sent": 0}
    assert bell == []


def test_archived_and_deleted_routines_are_not_reminded(env, on, bell):
    arch = make(env, name="Archived")
    gone = make(env, name="Deleted")
    keep = make(env, name="Kept")
    env.R.archive(A, arch["id"], now=et(DAY, 8, 30))
    env.R.archive(A, gone["id"], now=et(DAY, 8, 30))
    env.R.soft_delete(A, gone["id"], typed_name="Deleted", now=et(DAY, 8, 31))
    got = env.RR.due(env.auth_db.get_connection(), et(DAY, 9, 0, 10))
    assert [g[1] for g in got] == [keep["id"]]


def test_a_deleted_routine_is_not_reminded_even_if_it_was_never_archived(env, on, bell):
    """Each filter stands alone: a row deleted without an archive stamp is still absent."""
    gone = make(env, name="Deleted only")
    with env.auth_db.get_connection() as c:
        c.execute("UPDATE j2_routines SET deleted_at = ? WHERE id = ?", ("2026-11-02T12:00:00+00:00", gone["id"]))
    assert env.RR.due(env.auth_db.get_connection(), et(DAY, 9, 0, 10)) == []


def test_a_routine_not_scheduled_today_is_not_reminded(env, on, bell):
    # 2026-11-02 is a Monday (weekday 0): a Tue/Thu routine does not run
    make(env, name="TueThu", schedule={"kind": "weekdays", "days": [1, 3]})
    make(env, name="Mon", schedule={"kind": "weekdays", "days": [0]})
    got = env.RR.due(env.auth_db.get_connection(), et(DAY, 9, 0, 10))
    assert [g[3] for g in got] == ["Mon"]


def test_a_traded_schedule_is_open_before_the_first_trade(env, on, bell):
    """W9-R8: on a traded schedule today is open, so the reminder fires before any trade."""
    make(env, name="Traded", schedule={"kind": "traded"})
    assert env.RR.run_due(et(DAY, 9, 0, 10)) == {"claimed": 1, "sent": 1}


def test_each_member_is_reminded_for_their_own_routine_only(env, on, bell):
    ra = make(env, A, name="Mine")
    rb = make(env, B, name="Theirs")
    # a tick written under ANOTHER member's id for this routine does not count toward A's day
    with env.auth_db.get_connection() as c:
        for item in ra["items"]:
            c.execute("INSERT INTO j2_routine_ticks (user_id, routine_id, day, item_id, ticked,"
                      " updated_at) VALUES (?, ?, ?, ?, 1, 'x')", (B, ra["id"], DAY, item["id"]))
    env.RR.run_due(et(DAY, 9, 0, 10))
    by_user = {c["user_id"]: c["data"]["routineId"] for c in bell}
    assert by_user == {A: ra["id"], B: rb["id"]}


# ── bell only ──────────────────────────────────────────────────────────────────────────────────

def test_bell_only_never_discord_or_email(env, on, bell, monkeypatch):
    from api.services import watchlist_alert_service
    crossed: list = []
    monkeypatch.setattr(watchlist_alert_service, "deliver_alert_payload",
                        lambda *a, **k: crossed.append((a, k)))
    make(env)
    env.RR.run_due(et(DAY, 9, 0, 10))
    assert len(bell) == 1
    assert bell[0]["channels"] == {"in_app": "ok", "discord": "skipped"}
    assert crossed == []


def test_the_module_imports_no_discord_or_mail_path():
    tree = ast.parse(_MODULE.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.add(node.module or "")
            names.update(a.name for a in node.names)
    joined = " ".join(sorted(names)).lower()
    assert "alerts" in names or "api.services.alerts" in names, "control: the bell is imported"
    for banned in ("watchlist_alert_service", "discord", "resend", "email", "smtp"):
        assert banned not in joined, banned


# ── not N+1 ────────────────────────────────────────────────────────────────────────────────────

def _statements_for(env, members: int) -> tuple[int, int]:
    for i in range(members):
        make(env, f"u-bulk-{members}-{i}", name=f"R{i}")
    conn = env.auth_db.get_connection()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    got = env.RR.due(conn, et(DAY, 9, 0, 10))
    conn.set_trace_callback(None)
    return len(got), len(seen)


def test_due_is_not_n_plus_one_across_members(env):
    few_n, few = _statements_for(env, 3)
    many_n, many = _statements_for(env, 40)
    assert few_n == 3 and many_n == 43           # non-vacuity: every member's routine was returned
    assert many == few, f"statements grew with members: {few} -> {many}"
    assert many <= 6


# ── the registration ───────────────────────────────────────────────────────────────────────────

def _calls_in_main(attr: str) -> list[ast.Call]:
    tree = ast.parse(_MAIN.read_text(encoding="utf-8"))
    return [n for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attr]


def _enclosing_block(attr: str):
    """The statement list (a `try` body) that holds the registration call."""
    tree = ast.parse(_MAIN.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Try):
            for sub in ast.walk(ast.Module(body=node.body, type_ignores=[])):
                if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
                        and sub.func.attr == attr):
                    return node
    return None


def test_registered_job_shape(env, monkeypatch):
    assert len(_calls_in_main("register_task_reminder_job")) == 1, "control: the sibling is seen"
    mine = _calls_in_main("register_routine_reminder_job")
    assert len(mine) == 1
    # beside it: the same registration block shape (a try whose handler is non-fatal), and the
    # two blocks sit in the same enclosing function
    block_mine = _enclosing_block("register_routine_reminder_job")
    block_task = _enclosing_block("register_task_reminder_job")
    assert block_mine is not None and block_task is not None and block_mine is not block_task
    assert block_mine.handlers and block_task.handlers
    assert abs(block_mine.lineno - block_task.lineno) < 20

    # the registration itself, over a recording scheduler; the flag is not read here
    from api.services.journal_two import notebook_widgets
    read: list[int] = []
    monkeypatch.setattr(notebook_widgets, "notebook_widgets_wave_on",
                        lambda wave: read.append(wave) or True)
    jobs: list[tuple] = []

    class Sched:
        def add_job(self, fn, trigger, **kw):
            jobs.append((fn, trigger, kw))

    assert env.RR.register_routine_reminder_job(Sched()) is True
    assert read == [], "registration must not read the wave flag"
    (fn, trigger, kw), = jobs
    assert kw == {"id": "notebook_routine_reminders", "max_instances": 1, "coalesce": True,
                  "misfire_grace_time": 60, "replace_existing": True}
    assert env.RR.JOB_ID == "notebook_routine_reminders" and env.RR.SLOT_MINUTES == 5
    fields = {f.name: str(f) for f in trigger.fields}
    assert fields["minute"] == "*/5" and str(trigger.timezone) == "America/New_York"


def test_the_job_body_looks_run_due_up_at_call_time_and_never_raises(env, monkeypatch):
    jobs: list = []

    class Sched:
        def add_job(self, fn, trigger, **kw):
            jobs.append(fn)

    env.RR.register_routine_reminder_job(Sched())
    called: list = []
    monkeypatch.setattr(env.RR, "run_due", lambda: called.append(1) or {"claimed": 0, "sent": 0})
    jobs[0]()
    assert called == [1], "the body must resolve run_due at call time"

    def boom():
        raise RuntimeError("x")

    monkeypatch.setattr(env.RR, "run_due", boom)
    jobs[0]()          # must not raise into the scheduler


def test_the_flag_is_read_at_run_time_not_registration(env, monkeypatch, bell):
    jobs: list = []

    class Sched:
        def add_job(self, fn, trigger, **kw):
            jobs.append(fn)

    env.RR.register_routine_reminder_job(Sched())      # flag unset here
    make(env)
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")       # flipped AFTER registration
    assert env.RR.run_due(et(DAY, 9, 0, 10)) == {"claimed": 1, "sent": 1}
