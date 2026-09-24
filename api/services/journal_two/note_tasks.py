"""Tasks across notes, and the daily in-app reminder (wave 6, Phase 2).

Every `taskItem` in every live note, as one list: checked state, the item's own
text, and a due date read from a `dateMention` inside the item.

The contract with the editor lane
---------------------------------
Node `dateMention`, attr `date` = `YYYY-MM-DD` (agent D). ⚠️ That node is NOT
BUILT in this branch yet; everything here is built and railed against fixture
documents carrying it (`tests/fixtures_note_tasks.json`). A `date` that is not
a real calendar day in that exact form is ignored, never guessed at — a task
with a malformed date is a task with no date, and it still appears.

What counts as the task's own text, and its own date
----------------------------------------------------
A `taskItem`'s content is its paragraph(s) plus, when nested, a child list.
The text and the due date come from the item's OWN paragraphs only: a nested
sub-task's date is the sub-task's, and a parent inherits nothing from it.

The ordinal
-----------
`index` is the task's position among ALL `taskItem` nodes in the document, in
document order (pre-order: a parent before its children). The client opens the
note at `?task=<index>` and the editor finds the same node by counting the same
way — `app/src/pages/journal-2-0/lib/noteTasks.js::findTaskItemPos`. Both sides
are held to ONE fixture file, so they cannot disagree about which task is
number three.

READ-ONLY. Nothing here toggles a task: a write into a note from outside that
note's editor is a second writer, and the offline layer forks it.

Reminders
---------
`run_task_reminders()` — THE PASS. One IN-APP notification per member per day
when they have open tasks due today or overdue. ⛔ NEVER EMAIL: the Resend
quota is exhausted daily. It goes through `api.services.alerts.add_alert` at
severity `info`, which is the in-app bell and nothing else (info is below the
Discord threshold). Deduped per member per day in a TABLE,
`j2_task_reminder_log`, claimed before delivery — a module dict would forget on
every deploy, and this pod deploys several times a day. Kill switch
`NOTEBOOK_TASK_REMINDERS_ENABLED`: unset = on, `0` = off, read per run.

When the pass runs (S-2, R1-6)
------------------------------
`register_task_reminder_job` registers THREE jobs, all from one call:
  * 07:00 ET daily — the pass. `misfire_grace_time=3600`: api/main.py's
    `job_defaults` grace is ONE SECOND, and a run the check loop reaches late
    is skipped outright (`EVENT_JOB_MISSED`, the function never called).
  * 09:00 ET daily — the pass again, the ruled second trigger. The claim table
    makes it a no-op for every member already reminded; it reaches a member
    whose 07:00 delivery failed, and anyone 07:00 never reached (a deploy
    spanning 07:00 never SCHEDULES that fire — the job store is in memory).
  * a one-shot BOOT CATCH-UP (`catch_up_task_reminders`), the net for a day
    the process never had a 09:00 tick either (down at 09:00, up at 11:00):
    after 07:00 ET, if the day is not marked done, it runs the pass.

Two passes can therefore run at once (a boot at 08:58:45 fires its catch-up
at 09:00:15, beside the 09:00 job), and two rules make that safe:
  * ⛔ THE CLAIM IS ONE ATOMIC STATEMENT. `INSERT OR IGNORE` on the primary key
    (user_id, day) writes a row with status `claimed`, or is refused; rowcount
    0 means another pass holds the member. No read decides it, so two passes
    can never both deliver one member's reminder. A delivered claim becomes
    `sent`; a failed one is released (deleted), so a later pass retries it.
  * ⛔ A DAY IS MARKED DONE ONLY WHEN EVERY MEMBER THE PASS FOUND DUE HOLDS A
    `sent` CLAIM, read from the store — never from the pass's own counters. A member another pass has claimed and not
    yet delivered, or claimed and then released on a failed delivery, keeps
    the day open, so the next pass reaches them. (Measured before this rule:
    pass B skipped u1 as taken, had no failure of its own and marked the day;
    A's delivery to u1 then failed, and the next catch-up saw the marker.)
"Marked done" is `j2_task_reminder_runs` — NOT the claims, which a pass that
found nobody due never writes.

⚠️ Residual, stated: a process that dies between a claim and its delivery
leaves the claim `claimed` — no later pass re-sends it (it cannot tell a dead
claimant from a slow one) and the day stays unmarked. That member loses that
day's reminder; the next day is a new day.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from api.services import auth_db
from api.services.journal_two.note_mentions import has_column
from api.services.journal_two.timeutil import ET

STATUSES = ("open", "done", "all")
DUE_FILTERS = ("overdue", "today", "week", "none")
WEEK_DAYS = 7          # "week" = today through the next six days
MAX_TASKS = 2000
TASKS_VIEW_URL = "/journal/notebook?view=tasks"
REMINDER_SOURCE = "notebook_task_reminder"
REMINDER_HOUR_ET = 7
SECOND_PASS_HOUR_ET = 9    # the ruled second daily trigger (S-2)
MISFIRE_GRACE_S = 3600     # a late run still runs; the pass is idempotent per ET day
CATCH_UP_DELAY_S = 90      # the boot catch-up waits for the process to settle
KILL_SWITCH = "NOTEBOOK_TASK_REMINDERS_ENABLED"
_OFF_VALUES = {"0", "false", "no", "off"}

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NESTED_LISTS = ("taskList", "bulletList", "orderedList")

_REMINDER_SCHEMA = """
CREATE TABLE IF NOT EXISTS j2_task_reminder_log (
    user_id     TEXT NOT NULL,
    day         TEXT NOT NULL,
    due_today   INTEGER NOT NULL DEFAULT 0,
    overdue     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'sent',
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS j2_task_reminder_runs (
    day         TEXT PRIMARY KEY,
    ran_at      TEXT NOT NULL,
    members     INTEGER NOT NULL DEFAULT 0,
    delivered   INTEGER NOT NULL DEFAULT 0
);
"""


def parse_due(value: Any) -> str | None:
    """`YYYY-MM-DD` that is a real calendar day, else None."""
    if not isinstance(value, str) or not _DATE_RE.match(value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def _now() -> datetime:
    """The module's clock. Looked up at CALL time, so a test can pin it and
    drive the registered job bodies, which take no arguments."""
    return datetime.now(tz=ET)


def today_et(now: datetime | None = None) -> str:
    now = now or _now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=ET)
    return now.astimezone(ET).date().isoformat()


def _own_text_and_due(item: dict) -> tuple[str, str | None, list[str]]:
    """The item's own text, its due date, and the note ids its links point at.
    Nested lists belong to the sub-tasks and are not read."""
    parts: list[str] = []
    due: str | None = None
    links: list[str] = []

    def walk(node: Any) -> None:
        nonlocal due
        if not isinstance(node, dict):
            return
        t = node.get("type")
        if t in _NESTED_LISTS:
            return
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        if t == "text" and isinstance(node.get("text"), str):
            parts.append(node["text"])
        elif t == "dateMention":
            if due is None:
                due = parse_due(attrs.get("date"))
            parts.append(" ")
        elif t == "noteLink":
            nid = attrs.get("noteId")
            if isinstance(nid, str) and nid:
                links.append(nid)
                parts.append("\u0000" + nid + "\u0000")
        elif t == "hardBreak":
            parts.append(" ")
        for c in node.get("content") or []:
            walk(c)
        if t == "paragraph":
            parts.append(" ")

    for child in item.get("content") or []:
        walk(child)
    return "".join(parts), due, links


def extract_tasks(doc: Any) -> list[dict[str, Any]]:
    """Every `taskItem`, pre-order. `text` may hold `\\0<noteId>\\0` link
    placeholders; `list_tasks` resolves them to titles in one query."""
    out: list[dict[str, Any]] = []

    def walk(node: Any, depth: int) -> None:
        if not isinstance(node, dict):
            return
        is_task = node.get("type") == "taskItem"
        if is_task:
            attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
            text, due, links = _own_text_and_due(node)
            out.append({
                "index": len(out),
                "checked": attrs.get("checked") is True,
                "text": text,
                "due": due,
                "depth": depth,
                "links": links,
            })
        for c in node.get("content") or []:
            walk(c, depth + 1 if is_task else depth)

    walk(doc, 0)
    return out


def due_bucket(due: str | None, today: str) -> str:
    """none | overdue | today | upcoming — the four groups the view shows."""
    if not due:
        return "none"
    if due < today:
        return "overdue"
    if due == today:
        return "today"
    return "upcoming"


def _matches_due(due: str | None, today: str, want: str | None) -> bool:
    if want is None:
        return True
    if want == "none":
        return due is None
    if due is None:
        return False
    if want == "overdue":
        return due < today
    if want == "today":
        return due == today
    last = (date.fromisoformat(today) + timedelta(days=WEEK_DAYS - 1)).isoformat()
    return today <= due <= last          # "week"


def _live_clause(conn: sqlite3.Connection, alias: str = "") -> str:
    p = f"{alias}." if alias else ""
    clause = f" AND {p}deleted_at IS NULL"
    if has_column(conn, "j2_notes", "archived_at"):
        clause += f" AND {p}archived_at IS NULL"
    return clause


_WS = re.compile(r"\s+")
_LINK_TOKEN = re.compile("\u0000([^\u0000]*)\u0000")


def _finish_text(text: str, titles: dict[str, str]) -> str:
    text = _LINK_TOKEN.sub(lambda m: titles.get(m.group(1), "a note"), text)
    return _WS.sub(" ", text).strip()


def list_tasks(
    user_id: str,
    status: str = "open",
    due: str | None = None,
    now: datetime | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    if due is not None and due not in DUE_FILTERS:
        raise ValueError(f"due must be one of {DUE_FILTERS}")
    today = today_et(now)
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT id, title, updated_at, body_json FROM j2_notes"
            " WHERE user_id = ?" + _live_clause(conn) +
            " AND body_json LIKE '%taskItem%' ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        tasks: list[dict[str, Any]] = []
        link_ids: set[str] = set()
        for r in rows:
            try:
                doc = json.loads(r["body_json"] or "{}")
            except (ValueError, TypeError):
                continue
            for t in extract_tasks(doc):
                if status == "open" and t["checked"]:
                    continue
                if status == "done" and not t["checked"]:
                    continue
                if not _matches_due(t["due"], today, due):
                    continue
                link_ids.update(t["links"])
                tasks.append({
                    "noteId": r["id"],
                    "noteTitle": r["title"] or "Untitled",
                    "noteUpdatedAt": r["updated_at"],
                    "index": t["index"],
                    "checked": t["checked"],
                    "text": t["text"],
                    "due": t["due"],
                    "bucket": due_bucket(t["due"], today),
                    "depth": t["depth"],
                })
        titles: dict[str, str] = {}
        if link_ids:
            ids = sorted(link_ids)
            marks = ",".join("?" for _ in ids)
            for lr in conn.execute(
                f"SELECT id, title FROM j2_notes WHERE user_id = ? AND id IN ({marks})"
                " AND deleted_at IS NULL",
                (user_id, *ids),
            ).fetchall():
                titles[lr["id"]] = lr["title"] or "Untitled"
        for t in tasks:
            t["text"] = _finish_text(t["text"], titles)
        # Soonest first, undated last; within a day, the most recently edited
        # note first; within a note, document order.
        tasks.sort(key=lambda t: (t["due"] is None, t["due"] or ""))
        truncated = len(tasks) > MAX_TASKS
        return {
            "today": today,
            "count": len(tasks),
            "tasks": tasks[:MAX_TASKS],
            "truncated": truncated,
        }
    finally:
        if owned:
            conn.close()


# ── Reminders ───────────────────────────────────────────────────────────────

def reminders_enabled() -> bool:
    raw = os.environ.get(KILL_SWITCH)
    return raw is None or raw.strip().lower() not in _OFF_VALUES


def ensure_reminder_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_REMINDER_SCHEMA)
    # A claim table written before claims carried a status: its rows were
    # written only by delivering (or by crashing before the delivery), so they
    # read as `sent` — never as `claimed`, which would hold the day open.
    if not has_column(conn, "j2_task_reminder_log", "status"):
        conn.execute("ALTER TABLE j2_task_reminder_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'")
        conn.commit()


def reminder_copy(due_today: int, overdue: int) -> tuple[str, str]:
    """Title and message for the bell. Plain, specific, no task text."""
    def n(k: int, word: str) -> str:
        return f"{k} {word}" + ("" if k == 1 else "s")

    if due_today and overdue:
        title = "Tasks due today"
        msg = (f"You have {n(due_today, 'task')} due today and "
               f"{n(overdue, 'overdue task')} in your Notebook.")
    elif due_today:
        title = "Tasks due today" if due_today > 1 else "A task is due today"
        msg = f"You have {n(due_today, 'task')} due today in your Notebook."
    else:
        title = "Overdue tasks" if overdue > 1 else "An overdue task"
        msg = f"You have {n(overdue, 'overdue task')} in your Notebook."
    return title, msg


def _due_counts_by_member(conn: sqlite3.Connection, today: str) -> dict[str, dict[str, int]]:
    rows = conn.execute(
        "SELECT user_id, body_json FROM j2_notes WHERE 1=1" + _live_clause(conn) +
        " AND body_json LIKE '%taskItem%' AND body_json LIKE '%dateMention%'",
    ).fetchall()
    counts: dict[str, dict[str, int]] = {}
    for r in rows:
        try:
            doc = json.loads(r["body_json"] or "{}")
        except (ValueError, TypeError):
            continue
        for t in extract_tasks(doc):
            if t["checked"] or not t["due"] or t["due"] > today:
                continue
            c = counts.setdefault(r["user_id"], {"due_today": 0, "overdue": 0})
            c["due_today" if t["due"] == today else "overdue"] += 1
    return counts


def run_task_reminders(now: datetime | None = None, conn: sqlite3.Connection | None = None,
                       deliver=None) -> dict[str, Any]:
    """One in-app reminder per member per ET day. Safe to run twice, and safe
    to run twice AT ONCE (see the module docstring, "When the pass runs").

    ⛔ CLAIM, THEN DELIVER. The claim is one atomic INSERT the primary key
    refuses for a member someone already holds (`already_sent` when that claim
    is delivered, `in_flight` when it is not). A delivery that raises releases
    its claim, so a later run the same day retries that member instead of
    losing the day. `marked` says whether this pass closed the day.

    `deliver(user_id, title, message, data)` is the seam a test replaces; the
    default is the in-app bell and nothing else."""
    today = today_et(now)
    result = {"day": today, "enabled": reminders_enabled(), "members": 0, "delivered": 0,
              "already_sent": 0, "in_flight": 0, "failed": 0, "marked": False}
    if not result["enabled"]:
        return result
    deliver = deliver or _deliver_in_app
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        ensure_reminder_schema(conn)
        counts = _due_counts_by_member(conn, today)
        result["members"] = len(counts)
        for user_id, c in sorted(counts.items()):
            cur = conn.execute(
                "INSERT OR IGNORE INTO j2_task_reminder_log"
                " (user_id, day, due_today, overdue, created_at, status)"
                " VALUES (?, ?, ?, ?, ?, 'claimed')",
                (user_id, today, c["due_today"], c["overdue"],
                 datetime.now(tz=ET).isoformat(timespec="seconds")),
            )
            conn.commit()
            if cur.rowcount == 0:
                # Another pass holds this member. Only the COUNTER reads the
                # row; whether the day may close is decided from the store.
                held = conn.execute(
                    "SELECT status FROM j2_task_reminder_log WHERE user_id = ? AND day = ?",
                    (user_id, today),
                ).fetchone()
                result["already_sent" if held and held[0] == "sent" else "in_flight"] += 1
                continue
            title, message = reminder_copy(c["due_today"], c["overdue"])
            data = {"source": REMINDER_SOURCE, "research_url": TASKS_VIEW_URL,
                    "due_today": c["due_today"], "overdue": c["overdue"], "day": today}
            try:
                deliver(user_id, title, message, data)
            except Exception:  # noqa: BLE001 — one member must not stop the rest
                conn.execute("DELETE FROM j2_task_reminder_log WHERE user_id = ? AND day = ?",
                             (user_id, today))
                conn.commit()
                result["failed"] += 1
                continue
            conn.execute("UPDATE j2_task_reminder_log SET status = 'sent' WHERE user_id = ? AND day = ?",
                         (user_id, today))
            conn.commit()
            result["delivered"] += 1
        result["marked"] = _close_day_if_everyone_reached(conn, today, set(counts), result)
        return result
    finally:
        if owned:
            conn.close()


def _close_day_if_everyone_reached(conn: sqlite3.Connection, day: str, due: set[str],
                                   result: dict[str, Any]) -> bool:
    """⛔ Mark the day done ONLY when every member this pass found due holds a
    `sent` claim, read from the STORE — never from this pass's own counters: a
    member another pass holds (still in flight, or released on a failed
    delivery) keeps the day open.

    No transaction is needed between the read and the write: within a day the
    set of `sent` claims only GROWS — a claim is changed only by the pass that
    holds it, from `claimed` to `sent` or deleted while still `claimed` — so a
    read that finds every due member reached stays true."""
    sent = {r[0] for r in conn.execute(
        "SELECT user_id FROM j2_task_reminder_log WHERE day = ? AND status = 'sent'", (day,))}
    if not due <= sent:
        return False
    conn.execute(
        "INSERT OR REPLACE INTO j2_task_reminder_runs (day, ran_at, members, delivered)"
        " VALUES (?, ?, ?, ?)",
        (day, datetime.now(tz=ET).isoformat(timespec="seconds"), result["members"], result["delivered"]),
    )
    conn.commit()
    return True


def catch_up_task_reminders(now: datetime | None = None, conn: sqlite3.Connection | None = None,
                            deliver=None) -> dict[str, Any]:
    """The boot catch-up: after 07:00 ET, run today's pass if the day is not
    marked done.

    Safe on any boot at any hour — before 07:00 it does nothing (the cron will
    fire), and on a day already marked in `j2_task_reminder_runs` it does
    nothing (the claims would dedupe anyway; the marker saves the scan)."""
    when = (now or _now()).astimezone(ET)
    day = today_et(when)
    if when.hour < REMINDER_HOUR_ET:
        return {"ran": False, "reason": "before-seven", "day": day}
    if not reminders_enabled():
        return {"ran": False, "reason": "disabled", "day": day}
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        ensure_reminder_schema(conn)
        done = conn.execute("SELECT 1 FROM j2_task_reminder_runs WHERE day = ?", (day,)).fetchone()
        if done:
            return {"ran": False, "reason": "already-ran", "day": day}
        return {"ran": True, **run_task_reminders(now=when, conn=conn, deliver=deliver)}
    finally:
        if owned:
            conn.close()


def register_task_reminder_job(scheduler) -> bool:
    """Schedule THE PASS for 07:00 and again for 09:00 ET daily, each with a
    one-hour misfire grace, and a one-shot boot catch-up `CATCH_UP_DELAY_S`
    after registration (see the module docstring, "When the pass runs"). For
    the controller to call ONCE from api/main.py's scheduler block, beside
    `register_trash_purge_job` — that one call wires all three.

    ⛔ The kill switch is NOT read here. It is read at the start of every run,
    so `NOTEBOOK_TASK_REMINDERS_ENABLED=0` stops the next reminder with no
    restart — a switch read at registration would need a redeploy to flip.
    ⛔ Each job body looks `run_task_reminders` / `catch_up_task_reminders` up
    at CALL time (a lambda over the module global), never binds it here."""
    from datetime import timezone
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.date import DateTrigger

    def _boundary(label: str, run) -> Any:
        def body() -> None:
            try:
                print(f"[notebook-task-reminders] {label}: {run()}")
            except Exception as e:  # noqa: BLE001 — a failed run must never break the scheduler
                print(f"[notebook-task-reminders] {label} failed: {e}")
        return body

    for job_id, hour in (("notebook_task_reminders", REMINDER_HOUR_ET),
                         ("notebook_task_reminders_nine", SECOND_PASS_HOUR_ET)):
        scheduler.add_job(
            _boundary(f"{hour:02d}:00 pass", lambda: run_task_reminders()),
            CronTrigger(hour=hour, minute=0, timezone=ZoneInfo("America/New_York")),
            id=job_id,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=MISFIRE_GRACE_S,
            replace_existing=True,
        )
    scheduler.add_job(
        _boundary("boot catch-up", lambda: catch_up_task_reminders()),
        DateTrigger(run_date=datetime.now(tz=timezone.utc) + timedelta(seconds=CATCH_UP_DELAY_S)),
        id="notebook_task_reminders_catch_up",
        max_instances=1,
        misfire_grace_time=MISFIRE_GRACE_S,
        replace_existing=True,
    )
    return True


def _deliver_in_app(user_id: str, title: str, message: str, data: dict) -> None:
    """The in-app bell ONLY. `info` is below the Discord threshold, and this
    path never touches email."""
    from api.services.alerts import add_alert
    add_alert(REMINDER_SOURCE, title, message, severity="info", data=data, user_id=user_id)
