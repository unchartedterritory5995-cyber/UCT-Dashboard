"""Tasks across notes + the daily in-app reminder (wave 6, Phase 2).

Extraction is held to `tests/fixtures_note_tasks.json` — the SAME file the
editor-side rail (`lib/noteTasks.test.js`) reads — so the server and the editor
cannot disagree about which task is number N.
"""
from __future__ import annotations

import collections
import importlib
import json
import os
import tempfile
import threading
import time
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
    # ⚰️ Wave 6 fix round 5, R5-3: this ALTERed `archived_at` onto j2_notes
    # itself — written on lane F's base, before lane E's Archive
    # (3d838c0e8) made the column part of the real schema. Merged, the ALTER
    # died on "duplicate column name". The column is real now, so the test
    # says so instead of adding it.
    from api.services.journal_two.note_mentions import has_column
    conn = auth_db.get_connection()
    try:
        assert has_column(conn, "j2_notes", "archived_at"), "the real schema no longer carries archived_at"
        conn.execute("UPDATE j2_notes SET archived_at = '2026-09-22' WHERE id = ?", (arch,))
        conn.commit()
    finally:
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


class _Sched:
    def __init__(self):
        self.calls = []

    def add_job(self, fn, trigger, **kw):
        self.calls.append((fn, trigger, kw))

    def jobs(self):
        return {kw["id"]: (fn, trigger, kw) for fn, trigger, kw in self.calls}


def test_the_reminder_jobs_register_at_seven_and_NINE_ET_plus_a_boot_catch_up_and_never_raise(monkeypatch):
    """R1-6 — the ruled 09:00 ET trigger (S-2) is a real daily CronTrigger, not
    only the boot catch-up, which fires solely on a day the process restarts."""
    from api.services.journal_two import note_tasks as nt
    sched = _Sched()
    assert nt.register_task_reminder_job(sched) is True
    jobs = sched.jobs()
    assert set(jobs) == {"notebook_task_reminders", "notebook_task_reminders_nine",
                         "notebook_task_reminders_catch_up"}
    for job_id, hour in (("notebook_task_reminders", 7), ("notebook_task_reminders_nine", 9)):
        fn, trigger, kw = jobs[job_id]
        assert type(trigger).__name__ == "CronTrigger"
        assert str(trigger) == f"cron[hour='{hour}', minute='0']"
        assert str(trigger.timezone) == "America/New_York"
        assert kw["max_instances"] == 1
        # api/main.py's job_defaults grace is ONE SECOND: a run the check loop
        # reaches late would be skipped outright and nothing would say so.
        assert kw["misfire_grace_time"] == 3600
    # The boot catch-up is a one-shot, a moment after the scheduler starts.
    assert type(jobs["notebook_task_reminders_catch_up"][1]).__name__ == "DateTrigger"
    # Both daily jobs run THE PASS; the boot job runs the catch-up.
    ran = []
    monkeypatch.setattr(nt, "run_task_reminders", lambda *a, **k: ran.append("pass") or {})
    monkeypatch.setattr(nt, "catch_up_task_reminders", lambda *a, **k: ran.append("catch-up") or {})
    for job_id in ("notebook_task_reminders", "notebook_task_reminders_nine", "notebook_task_reminders_catch_up"):
        jobs[job_id][0]()
    assert ran == ["pass", "pass", "catch-up"]
    # Every job body is the scheduler's boundary: a failing run is printed, not raised.
    boom = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db gone"))  # noqa: E731
    monkeypatch.setattr(nt, "run_task_reminders", boom)
    monkeypatch.setattr(nt, "catch_up_task_reminders", boom)
    for fn, _, _ in jobs.values():
        fn()


def _at(nt, monkeypatch, hour, minute=0):
    """Pin the module's clock: the registered job bodies take no arguments."""
    monkeypatch.setattr(nt, "_now", lambda: NOW.replace(hour=hour, minute=minute))


def test_a_boot_catch_up_on_a_day_the_nine_oclock_job_ran_cleanly_does_nothing(svc, monkeypatch):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    rec = _Recorder()
    monkeypatch.setattr(nt, "_deliver_in_app", rec)
    jobs = _Sched()
    nt.register_task_reminder_job(jobs)
    jobs = jobs.jobs()
    # The pod was down at 07:00; the 09:00 job runs the pass cleanly …
    _at(nt, monkeypatch, 9)
    jobs["notebook_task_reminders_nine"][0]()
    assert [c[0] for c in rec.calls] == ["u1"]
    # … so a boot at 11:00 finds the day done and sends nothing more.
    _at(nt, monkeypatch, 11)
    jobs["notebook_task_reminders_catch_up"][0]()
    assert [c[0] for c in rec.calls] == ["u1"]


def test_a_boot_catch_up_on_a_day_the_pod_was_down_at_nine_still_delivers(svc, monkeypatch):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    rec = _Recorder()
    monkeypatch.setattr(nt, "_deliver_in_app", rec)
    jobs = _Sched()
    nt.register_task_reminder_job(jobs)
    # Down at 07:00 AND at 09:00 — neither cron job ever fired. Up at 11:00.
    _at(nt, monkeypatch, 11)
    jobs.jobs()["notebook_task_reminders_catch_up"][0]()
    assert [c[0] for c in rec.calls] == ["u1"]


def test_two_passes_racing_on_one_day_deliver_every_member_exactly_once_between_them(svc):
    """The 09:00 pass and a boot catch-up can fire together. The per-member
    claim is ONE atomic statement (an INSERT the primary key refuses), so no
    interleaving lets both passes send one member's reminder."""
    ns, nt = svc
    members = [f"m{i:02d}" for i in range(24)]
    for uid in members:
        _note_with(ns, uid, "Plan", _task(False, "Due today", "2026-09-23"))
    start = threading.Barrier(2)

    class _Slow(_Recorder):
        def __call__(self, *a):
            time.sleep(0.002)          # yield mid-pass, so the two interleave
            super().__call__(*a)

    recs, outs = [_Slow(), _Slow()], [None, None]

    def run(i):
        start.wait(5)
        outs[i] = nt.run_task_reminders(now=NOW.replace(hour=9), deliver=recs[i])

    threads = [threading.Thread(target=run, args=(i,)) for i in (0, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    sent = collections.Counter(c[0] for r in recs for c in r.calls)
    assert set(sent) == set(members)                         # no member skipped
    assert set(sent.values()) == {1}                         # no member twice
    assert outs[0]["delivered"] + outs[1]["delivered"] == len(members)
    # The later of the two sees every claim delivered, so the day is closed.
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        assert conn.execute("SELECT 1 FROM j2_task_reminder_runs WHERE day = '2026-09-23'").fetchone()
    finally:
        conn.close()


def test_a_racing_pass_cannot_close_the_day_over_a_claim_still_in_flight(svc):
    """R1-6 (b), measured by the re-review: pass A claims u1; pass B skips u1 as
    taken, delivers u2 and — with no failure of its OWN — marked the day done;
    then A's delivery to u1 failed and released the claim. The next catch-up
    saw the marker and u1 lost the day. A day is now closed only when every
    member due holds a DELIVERED claim, read from the store."""
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    _note_with(ns, "u2", "Plan", _task(False, "Due today", "2026-09-23"))
    a_claimed, b_done, a_out = threading.Event(), threading.Event(), {}

    def a_deliver(user_id, title, message, data):
        if user_id == "u1":
            a_claimed.set()
            b_done.wait(10)                                  # B runs its whole pass in here
            raise RuntimeError("bell unavailable")

    a = threading.Thread(target=lambda: a_out.update(nt.run_task_reminders(now=NOW, deliver=a_deliver)))
    a.start()
    assert a_claimed.wait(10)
    b_rec = _Recorder()
    b = nt.run_task_reminders(now=NOW.replace(minute=1), deliver=b_rec)
    b_done.set()
    a.join(10)
    # The day is still open, so the next pass — here a boot catch-up — reaches u1.
    rec = _Recorder()
    out = nt.catch_up_task_reminders(now=NOW.replace(hour=11), deliver=rec)
    assert out["ran"] is True and [c[0] for c in rec.calls] == ["u1"]
    assert [c[0] for c in b_rec.calls] == ["u2"]
    assert b["in_flight"] == 1 and b["marked"] is False      # B saw u1 claimed, not delivered
    assert a_out["failed"] == 1 and a_out["marked"] is False
    assert out["marked"] is True                             # now everyone due has been reached


def test_a_claim_table_from_before_the_status_column_still_dedupes(svc):
    """A `j2_task_reminder_log` written before claims carried a status: its
    rows are DELIVERED claims (that code marked a row only by delivering or
    crashing), so they read as sent — not as in flight, which would hold the
    day open forever."""
    ns, nt = svc
    from api.services import auth_db
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    conn = auth_db.get_connection()
    try:
        conn.executescript(
            "CREATE TABLE j2_task_reminder_log (user_id TEXT NOT NULL, day TEXT NOT NULL,"
            " due_today INTEGER NOT NULL DEFAULT 0, overdue INTEGER NOT NULL DEFAULT 0,"
            " created_at TEXT NOT NULL, PRIMARY KEY (user_id, day));"
            "INSERT INTO j2_task_reminder_log VALUES ('u1', '2026-09-23', 1, 0, '2026-09-23T07:00:00');")
        conn.commit()
    finally:
        conn.close()
    rec = _Recorder()
    out = nt.run_task_reminders(now=NOW.replace(hour=9), deliver=rec)
    assert rec.calls == [] and out["already_sent"] == 1 and out["marked"] is True


def test_the_boot_catch_up_runs_the_pass_when_seven_has_passed_and_today_has_not_run(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    rec = _Recorder()
    out = nt.catch_up_task_reminders(now=NOW.replace(hour=9, minute=40), deliver=rec)
    assert out["ran"] is True and out["delivered"] == 1
    assert [c[0] for c in rec.calls] == ["u1"]


def test_the_boot_catch_up_does_nothing_before_seven(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    rec = _Recorder()
    out = nt.catch_up_task_reminders(now=NOW.replace(hour=6, minute=59), deliver=rec)
    assert out == {"ran": False, "reason": "before-seven", "day": "2026-09-23"}
    assert rec.calls == []


def test_the_boot_catch_up_skips_a_day_whose_pass_already_ran_even_with_nobody_due(svc):
    """The marker is the RUN, not the claims: a 07:00 pass that found nobody
    due writes no claim row, and a catch-up keyed on claims would re-run it."""
    ns, nt = svc
    first = nt.run_task_reminders(now=NOW, deliver=_Recorder())
    assert first["members"] == 0
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    rec = _Recorder()
    out = nt.catch_up_task_reminders(now=NOW.replace(hour=11), deliver=rec)
    assert out == {"ran": False, "reason": "already-ran", "day": "2026-09-23"}
    assert rec.calls == []
    # The next ET day is a new day.
    nxt = nt.catch_up_task_reminders(now=NOW.replace(day=24, hour=8), deliver=rec)
    assert nxt["ran"] is True and [c[0] for c in rec.calls] == ["u1"]


def test_a_pass_with_a_failed_delivery_is_not_marked_so_the_next_boot_retries(svc):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    nt.run_task_reminders(now=NOW, deliver=_Recorder(fail_for={"u1"}))
    rec = _Recorder()
    out = nt.catch_up_task_reminders(now=NOW.replace(hour=10), deliver=rec)
    assert out["ran"] is True and [c[0] for c in rec.calls] == ["u1"]


def test_the_boot_catch_up_respects_the_kill_switch(svc, monkeypatch):
    ns, nt = svc
    _note_with(ns, "u1", "Plan", _task(False, "Due today", "2026-09-23"))
    monkeypatch.setenv(nt.KILL_SWITCH, "0")
    rec = _Recorder()
    out = nt.catch_up_task_reminders(now=NOW.replace(hour=10), deliver=rec)
    assert out["ran"] is False and rec.calls == []


def test_reminder_copy_is_plain_and_pluralised():
    from api.services.journal_two import note_tasks as nt
    assert nt.reminder_copy(2, 0) == ("Tasks due today", "You have 2 tasks due today in your Notebook.")
    assert nt.reminder_copy(0, 1) == ("An overdue task", "You have 1 overdue task in your Notebook.")
    assert nt.reminder_copy(0, 3) == ("Overdue tasks", "You have 3 overdue tasks in your Notebook.")


def _connection_sites(tree):
    """`(enclosing test, line, closed_in_finally)` for every `x = <...>.get_connection()`."""
    import ast
    sites = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for block in ast.walk(fn):
            body = getattr(block, "body", None)
            if not isinstance(body, list):
                continue
            for i, stmt in enumerate(body):
                if not (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1
                        and isinstance(stmt.targets[0], ast.Name)
                        and isinstance(stmt.value, ast.Call)
                        and isinstance(stmt.value.func, ast.Attribute)
                        and stmt.value.func.attr == "get_connection"):
                    continue
                name = stmt.targets[0].id
                nxt = body[i + 1] if i + 1 < len(body) else None
                closed = isinstance(nxt, ast.Try) and any(
                    isinstance(s, ast.Expr) and isinstance(s.value, ast.Call)
                    and isinstance(s.value.func, ast.Attribute) and s.value.func.attr == "close"
                    and isinstance(s.value.func.value, ast.Name) and s.value.func.value.id == name
                    for s in nxt.finalbody)
                sites.append((fn.name, stmt.lineno, closed))
    return sites


def test_every_connection_this_file_opens_is_closed_in_a_finally():
    """Wave 7 lane J, J2. A connection opened and then closed on a later line is
    LEAKED by any raise in between, and on Windows the leaked handle holds the WAL
    sidecars open -- so the NEXT test's teardown fails, on the wrong file, naming
    the wrong test. Every `get_connection()` here is followed by a `try:` whose
    `finally:` closes it. Parsed from this file's own source, so a site added
    tomorrow is covered the day it lands."""
    import ast
    sites = _connection_sites(ast.parse(Path(__file__).read_text(encoding="utf-8")))
    # Non-vacuity, by name: the walk must SEE the three sites this file has today.
    seen = {s[0] for s in sites}
    for known in ("test_trash_archive_and_other_members_are_excluded",
                  "test_two_passes_racing_on_one_day_deliver_every_member_exactly_once_between_them",
                  "test_a_claim_table_from_before_the_status_column_still_dedupes"):
        assert known in seen, f"the walk did not see {known}: {sorted(seen)}"
    leaked = [f"{fn}:{line}" for fn, line, closed in sites if not closed]
    assert not leaked, "opened a connection without a try/finally that closes it: " + ", ".join(leaked)
