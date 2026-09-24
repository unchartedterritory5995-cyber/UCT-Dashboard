"""Tasks across notes + the daily in-app reminder (wave 6, Phase 2).

Extraction is held to `tests/fixtures_note_tasks.json` — the SAME file the
editor-side rail (`lib/noteTasks.test.js`) reads — so the server and the editor
cannot disagree about which task is number N.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

# Imported at COLLECTION, while AUTH_DB_PATH is still the conftest sandbox: this
# module captures its path at import, and a first import inside a test would
# pin it to that test's temp file for the rest of the session.
from api.services import alert_durability  # noqa: F401
from api.services.journal_two.timeutil import ET

FIXTURE = json.loads(Path("tests/fixtures_note_tasks.json").read_text(encoding="utf-8"))
NOW = datetime(2026, 9, 23, 7, 0, tzinfo=ET)          # "today" is 2026-09-23 ET


# ── Extraction over real TipTap shapes (shared fixture) ─────────────────────

@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_extraction_matches_the_shared_fixture(case):
    from api.services.journal_two import note_tasks as nt
    got = [
        {"index": t["index"], "checked": t["checked"], "due": t["due"], "depth": t["depth"],
         "text": nt._finish_text(t["text"], {})}
        for t in nt.extract_tasks(case["doc"])
    ]
    assert got == case["expected"]


def test_the_fixture_is_not_vacuous():
    # A fixture of empty expectations would make the parametrised rail pass
    # over nothing. These are the shapes the brief names.
    names = " ".join(c["name"] for c in FIXTURE["cases"])
    assert "nested" in names and "checked" in names
    dated = [t for c in FIXTURE["cases"] for t in c["expected"] if t["due"]]
    undated = [t for c in FIXTURE["cases"] for t in c["expected"] if not t["due"]]
    assert dated and undated


def test_a_malformed_body_never_raises():
    from api.services.journal_two import note_tasks as nt
    assert nt.extract_tasks(None) == []
    assert nt.extract_tasks({"type": "doc", "content": [{"type": "taskItem", "attrs": "x",
                                                        "content": "nope"}]})[0]["checked"] is False


@pytest.mark.parametrize("value,expected", [
    ("2026-09-25", "2026-09-25"), ("2026-02-29", None), ("2028-02-29", "2028-02-29"),
    ("2026-9-5", None), ("2026-09-25T10:00", None), (20260925, None), (None, None),
])
def test_parse_due_is_strict(value, expected):
    from api.services.journal_two import note_tasks as nt
    assert nt.parse_due(value) == expected


# ── list_tasks over a real DB ────────────────────────────────────────────────

@pytest.fixture
def svc(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.delenv("NOTEBOOK_TASK_REMINDERS_ENABLED", raising=False)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import notes as notes_service
    from api.services.journal_two import note_tasks
    yield notes_service, note_tasks
    os.unlink(tmp.name)


def _task(checked, text, due=None, link=None):
    para = [{"type": "text", "text": text}]
    if due:
        para += [{"type": "text", "text": " "}, {"type": "dateMention", "attrs": {"date": due}}]
    if link:
        para += [{"type": "text", "text": " see "}, {"type": "noteLink", "attrs": {"noteId": link}}]
    return {"type": "taskItem", "attrs": {"checked": checked},
            "content": [{"type": "paragraph", "content": para}]}


def _note_with(ns, uid, title, *tasks):
    body = {"type": "doc", "content": [{"type": "taskList", "content": list(tasks)}]}
    return ns.create_note(uid, {"title": title, "bodyJson": body})["id"]


def test_open_tasks_are_listed_with_their_note_and_bucket(svc):
    ns, nt = svc
    nid = _note_with(ns, "u1", "Plan",
                     _task(False, "Overdue item", "2026-09-20"),
                     _task(False, "Due today", "2026-09-23"),
                     _task(False, "Next week", "2026-09-26"),
                     _task(False, "No date"),
                     _task(True, "Finished", "2026-09-22"))
    out = nt.list_tasks("u1", status="open", now=NOW)
    assert out["today"] == "2026-09-23"
    assert [(t["text"], t["bucket"]) for t in out["tasks"]] == [
        ("Overdue item", "overdue"), ("Due today", "today"),
        ("Next week", "upcoming"), ("No date", "none")]
    assert {t["noteId"] for t in out["tasks"]} == {nid}
    assert [t["index"] for t in out["tasks"]] == [0, 1, 2, 3]


def test_status_and_due_filters(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan",
               _task(False, "Overdue item", "2026-09-20"),
               _task(False, "Due today", "2026-09-23"),
               _task(False, "In six days", "2026-09-29"),
               _task(False, "In seven days", "2026-09-30"),
               _task(False, "No date"),
               _task(True, "Finished", "2026-09-22"))
    texts = lambda **kw: [t["text"] for t in nt.list_tasks("u1", now=NOW, **kw)["tasks"]]
    assert texts(status="done") == ["Finished"]
    assert texts(status="open", due="overdue") == ["Overdue item"]
    assert texts(status="open", due="today") == ["Due today"]
    assert texts(status="open", due="week") == ["Due today", "In six days"]
    assert texts(status="open", due="none") == ["No date"]
    assert len(texts(status="all")) == 6
    with pytest.raises(ValueError):
        nt.list_tasks("u1", status="nope")


def test_a_linked_note_reads_as_its_title_in_the_task_text(svc):
    ns, nt = svc
    target = ns.create_note("u1", {"title": "NVDA thesis"})["id"]
    _note_with(ns, "u1", "Plan", _task(False, "Re-read", link=target))
    [t] = nt.list_tasks("u1", now=NOW)["tasks"]
    assert t["text"] == "Re-read see NVDA thesis"
    assert "\u0000" not in t["text"]


def test_trash_archive_and_other_members_are_excluded(svc):
    ns, nt = svc
    from api.services import auth_db
    keep = _note_with(ns, "u1", "Keep", _task(False, "Kept"))
    gone = _note_with(ns, "u1", "Trash", _task(False, "Trashed"))
    arch = _note_with(ns, "u1", "Archive", _task(False, "Archived"))
    _note_with(ns, "u2", "Theirs", _task(False, "Not mine"))
    ns.delete_note("u1", gone)
    assert {t["text"] for t in nt.list_tasks("u1", now=NOW)["tasks"]} == {"Kept", "Archived"}
    conn = auth_db.get_connection()
    conn.execute("ALTER TABLE j2_notes ADD COLUMN archived_at TEXT")
    conn.execute("UPDATE j2_notes SET archived_at = '2026-09-22' WHERE id = ?", (arch,))
    conn.commit()
    conn.close()
    assert [t["noteId"] for t in nt.list_tasks("u1", now=NOW)["tasks"]] == [keep]


# ── Reminders ────────────────────────────────────────────────────────────────

class _Recorder:
    def __init__(self, fail_for=()):
        self.calls, self.fail_for = [], set(fail_for)

    def __call__(self, user_id, title, message, data):
        if user_id in self.fail_for:
            raise RuntimeError("bell unavailable")
        self.calls.append((user_id, title, message, data))


def test_reminder_dedupe_holds_across_two_runs_on_one_day(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"),
               _task(False, "Overdue", "2026-09-01"))
    rec = _Recorder()
    first = nt.run_task_reminders(now=NOW, deliver=rec)
    second = nt.run_task_reminders(now=NOW.replace(hour=9), deliver=rec)
    assert first["delivered"] == 1 and second["delivered"] == 0
    assert second["already_sent"] == 1
    assert len(rec.calls) == 1
    user_id, title, message, data = rec.calls[0]
    assert user_id == "u1"
    assert message == "You have 1 task due today and 1 overdue task in your Notebook."
    assert data["research_url"] == nt.TASKS_VIEW_URL and data["day"] == "2026-09-23"


def test_the_dedupe_is_a_TABLE_so_a_fresh_process_still_remembers(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    nt.run_task_reminders(now=NOW, deliver=_Recorder())
    importlib.reload(nt)          # a redeploy: every module-level variable is gone
    rec = _Recorder()
    assert nt.run_task_reminders(now=NOW, deliver=rec)["delivered"] == 0
    assert rec.calls == []


def test_the_next_day_reminds_again(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Overdue", "2026-09-20"))
    rec = _Recorder()
    nt.run_task_reminders(now=NOW, deliver=rec)
    nt.run_task_reminders(now=NOW.replace(day=24), deliver=rec)
    assert len(rec.calls) == 2


def test_only_open_tasks_due_today_or_overdue_remind(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(True, "Done yesterday", "2026-09-22"),
               _task(False, "Next week", "2026-09-30"), _task(False, "No date"))
    rec = _Recorder()
    out = nt.run_task_reminders(now=NOW, deliver=rec)
    assert out["members"] == 0 and rec.calls == []


def test_a_failed_delivery_releases_the_claim_so_a_later_run_retries(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    _note_with(ns, "u2", "Plan", _task(False, "Due today", "2026-09-23"))
    out = nt.run_task_reminders(now=NOW, deliver=_Recorder(fail_for={"u1"}))
    assert out["failed"] == 1 and out["delivered"] == 1
    rec = _Recorder()
    retry = nt.run_task_reminders(now=NOW, deliver=rec)
    assert [c[0] for c in rec.calls] == ["u1"] and retry["already_sent"] == 1


def test_the_kill_switch_stops_the_run(svc, monkeypatch):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    monkeypatch.setenv(nt.KILL_SWITCH, "0")
    rec = _Recorder()
    out = nt.run_task_reminders(now=NOW, deliver=rec)
    assert out["enabled"] is False and rec.calls == []


def test_the_real_delivery_is_the_in_app_bell_at_info_and_never_email(svc, monkeypatch):
    ns, nt = svc
    import api.services.email_service as email_service
    import api.services.watchlist_alert_service as was
    from api.services import alerts

    def _no_email(*a, **k):
        raise AssertionError("a task reminder must never send email")

    monkeypatch.setattr(email_service, "send_email", _no_email)
    monkeypatch.setattr(was, "send_email", _no_email)
    monkeypatch.setattr(was, "deliver_alert_payload", _no_email)   # the multi-channel door
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    # The durable mirror is another module's store; keep this test to the bell.
    monkeypatch.setattr(alert_durability, "record_alert", lambda alert: None)
    monkeypatch.setattr(alert_durability, "list_durable_alerts", lambda uid, limit: [])
    monkeypatch.setattr(alerts, "_s7_durable_alerts", lambda uid, limit: [])
    seen = []
    real_add = alerts.add_alert
    monkeypatch.setattr(alerts, "add_alert", lambda *a, **k: seen.append((a, k)) or real_add(*a, **k))
    _note_with(ns, "u7", "Plan", _task(False, "Due today", "2026-09-23"))
    try:
        assert nt.run_task_reminders(now=NOW)["delivered"] == 1
        [(args, kwargs)] = seen
        assert args[0] == nt.REMINDER_SOURCE and kwargs["severity"] == "info"
        assert kwargs["user_id"] == "u7"
        mine = [a for a in alerts.get_alerts(user_id="u7") if a["type"] == nt.REMINDER_SOURCE]
        assert mine and mine[0]["title"] == "A task is due today"
    finally:
        alerts.clear_alerts(user_id="u7")


def test_the_reminder_job_registers_at_seven_ET_and_never_raises(monkeypatch):
    from api.services.journal_two import note_tasks as nt
    calls = []

    class _Sched:
        def add_job(self, fn, trigger, **kw):
            calls.append((fn, trigger, kw))

    assert nt.register_task_reminder_job(_Sched()) is True
    [(fn, trigger, kw)] = calls
    assert kw["id"] == "notebook_task_reminders"
    assert kw["max_instances"] == 1
    assert str(trigger) == "cron[hour='7', minute='0']"
    assert str(trigger.timezone) == "America/New_York"
    # The job body is the scheduler's boundary: a failing run is printed, not raised.
    monkeypatch.setattr(nt, "run_task_reminders", lambda: (_ for _ in ()).throw(RuntimeError("db gone")))
    fn()


def test_reminder_copy_is_plain_and_pluralised():
    from api.services.journal_two import note_tasks as nt
    assert nt.reminder_copy(2, 0) == ("Tasks due today", "You have 2 tasks due today in your Notebook.")
    assert nt.reminder_copy(0, 1) == ("An overdue task", "You have 1 overdue task in your Notebook.")
    assert nt.reminder_copy(0, 3) == ("Overdue tasks", "You have 3 overdue tasks in your Notebook.")
