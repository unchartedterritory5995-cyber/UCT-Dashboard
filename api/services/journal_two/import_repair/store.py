"""Plan F Task 5: the import repair's progress, per-note log and notice tables.

Every function takes an open connection. None commits except where its docstring says so: the
runner owns the transaction, and the three that commit do so because their effect must be
durable on its own (a member finished; the undo copy before a write; a dismissal).

Tables (`db._J2_SCHEMA`, purged with the account):
  * `j2_import_repair_progress`: one row per (run, member), so a stopped run resumes;
  * `j2_import_repair_log`: one row per note outcome. `before_body_json` keeps the pre-repair
    body of a note the run wrote: the undo source, applied ONLY through
    `engine._apply_resolved_body` and only while the note is unedited since (the plan's Task 8
    runbook, step 9; never a raw UPDATE of `j2_notes`). It is never a
    `j2_note_versions` row, which would surface in the member's History and change what
    `legacy_finalize_shape` reads;
  * `j2_import_repair_notices`: the member's one loss notice; dismissing it is an UPDATE, and
    a later run never re-arms it.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

#: A lease not renewed for this long belongs to a runner that died or hung (`claim_member`).
LEASE_STALE_S = 600.0

#: The brief's six, then C12's `unchanged` (counted in the report, never logged: log volume) and
#: C7's `repair_started` (the undo copy, committed BEFORE the write; the outcome row supersedes it).
OUTCOMES = ("repaired", "kept_edited", "race_lost", "failed", "fetch_failed", "relist_requested",
            "unchanged", "repair_started")
UNCHANGED = "unchanged"
STARTED = "repair_started"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def member_done(conn: sqlite3.Connection, run_id: str, user_id: str) -> bool:
    """True once `finish_member` ran for this member in this run."""
    row = conn.execute(
        "SELECT status FROM j2_import_repair_progress WHERE run_id = ? AND user_id = ?",
        (run_id, user_id)).fetchone()
    return row is not None and row[0] == "done"


def start_member(conn: sqlite3.Connection, run_id: str, user_id: str) -> None:
    """Mark the member in progress. INSERT OR IGNORE: a resumed run keeps the first start."""
    conn.execute(
        "INSERT OR IGNORE INTO j2_import_repair_progress (run_id, user_id, status, started_at)"
        " VALUES (?, ?, 'in_progress', ?)", (run_id, user_id, _now()))


class MemberBusy(Exception):
    """Another live runner holds this member (`claim_member`)."""


def claim_member(conn: sqlite3.Connection, run_id: str, user_id: str, holder: str, *,
                 stale_after_s: float = LEASE_STALE_S) -> list[tuple[str, str]]:
    """Take the member for this runner (`holder`, a per-process token) and mark it in progress.
    COMMITS. Fix round 1, M-4: the repair's write is timestamp-neutral, so its optimistic lock
    cannot stop a second runner; this lease does, at the database, for every path (the CLI's
    flock is a second layer on the pod).

    Under BEGIN IMMEDIATE (one claimer at a time): a member whose lease another holder renewed
    within `stale_after_s`, in any run, raises `MemberBusy`. An older lease is taken over (its
    holder died or hung); each take-over is logged and returned as `(run_id, old holder)`. The
    same holder may claim again (a resume)."""
    conn.commit()  # BEGIN IMMEDIATE needs no transaction open on this connection
    conn.execute("BEGIN IMMEDIATE")
    try:
        now = datetime.now(timezone.utc)
        taken: list[tuple[str, str]] = []
        for row in conn.execute(
                "SELECT run_id, lease_holder, lease_at FROM j2_import_repair_progress"
                " WHERE user_id = ? AND status = 'in_progress' AND lease_holder IS NOT NULL"
                " AND lease_holder != ?", (user_id, holder)).fetchall():
            other_run, other_holder, lease_at = row[0], row[1], row[2]
            if (now - _parse(lease_at)).total_seconds() < stale_after_s:
                raise MemberBusy(f"member {user_id!r} is held by runner {other_holder!r} (run {other_run!r})")
            logger.warning("import repair: taking over the stale lease of runner %r on member %r"
                           " (run %r, last renewed %s)", other_holder, user_id, other_run, lease_at)
            conn.execute("UPDATE j2_import_repair_progress SET lease_holder = NULL, lease_at = NULL"
                         " WHERE run_id = ? AND user_id = ?", (other_run, user_id))
            taken.append((other_run, other_holder))
        start_member(conn, run_id, user_id)
        conn.execute("UPDATE j2_import_repair_progress SET lease_holder = ?, lease_at = ?"
                     " WHERE run_id = ? AND user_id = ?", (holder, now.isoformat(), run_id, user_id))
        conn.commit()
        return taken
    except BaseException:
        conn.rollback()
        raise


def release_lease(conn: sqlite3.Connection, run_id: str, user_id: str, holder: str) -> None:
    """Give the member back without finishing it (a batch limit stopped the run), so the next
    run resumes it at once instead of waiting for the lease to go stale. COMMITS."""
    conn.execute(
        "UPDATE j2_import_repair_progress SET lease_holder = NULL, lease_at = NULL"
        " WHERE run_id = ? AND user_id = ? AND lease_holder = ?", (run_id, user_id, holder))
    conn.commit()


def renew_lease(conn: sqlite3.Connection, run_id: str, user_id: str, holder: str) -> bool:
    """Keep this runner's lease fresh (call it every few notes). COMMITS. False when the lease
    was taken over: the runner must stop working on this member."""
    cur = conn.execute(
        "UPDATE j2_import_repair_progress SET lease_at = ? WHERE run_id = ? AND user_id = ?"
        " AND lease_holder = ?", (_now(), run_id, user_id, holder))
    conn.commit()
    return cur.rowcount == 1


def _parse(stamp: str | None) -> datetime:
    """A lease stamp as an aware datetime; an unreadable one is as old as can be (stale)."""
    try:
        parsed = datetime.fromisoformat(stamp) if isinstance(stamp, str) else None
    except ValueError:
        parsed = None
    if parsed is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def finish_member(conn: sqlite3.Connection, run_id: str, user_id: str, *, checked: int,
                  repaired: int, holder: str | None = None) -> None:
    """Mark the member done with its counts and release its lease. COMMITS. A member never
    started raises ValueError (fix round 1, M-2): updating no row would leave it not-done,
    re-processed next run. Given `holder` (Task 7 review M-8), only a member this runner still
    holds is finished; one whose lease was taken over raises `MemberBusy` and stays as it is."""
    holder_clause, params = ("", ()) if holder is None else (" AND lease_holder = ?", (holder,))
    cur = conn.execute(
        "UPDATE j2_import_repair_progress SET status = 'done', notes_checked = ?, notes_repaired = ?,"
        " finished_at = ?, lease_holder = NULL, lease_at = NULL WHERE run_id = ? AND user_id = ?"
        + holder_clause, (checked, repaired, _now(), run_id, user_id, *params))
    if cur.rowcount != 1:
        conn.rollback()
        if holder is not None and conn.execute(
                "SELECT 1 FROM j2_import_repair_progress WHERE run_id = ? AND user_id = ?",
                (run_id, user_id)).fetchone():
            raise MemberBusy(f"member {user_id!r} is no longer held by runner {holder!r}")
        raise ValueError(f"finish_member: member {user_id!r} was never started in run {run_id!r}")
    conn.commit()


def _insert_log(conn: sqlite3.Connection, run_id: str, user_id: str, note_id: str, outcome: str,
                shapes: dict, actions: list, before_body_json: str | None) -> None:
    conn.execute(
        "INSERT INTO j2_import_repair_log (run_id, user_id, note_id, outcome, shapes_json, actions_json,"
        " before_body_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (run_id, user_id, note_id, outcome, json.dumps(shapes, sort_keys=True), json.dumps(list(actions)),
         before_body_json, _now()))


def log_note(conn: sqlite3.Connection, run_id: str, user_id: str, note_id: str, outcome: str,
             shapes: dict, actions: list, before_body_json: str | None) -> None:
    """One outcome row. `unchanged` writes NOTHING (C12: the report counts it). An outcome not
    in `OUTCOMES` raises ValueError."""
    if outcome not in OUTCOMES:
        raise ValueError(f"unknown repair outcome {outcome!r}")
    if outcome == UNCHANGED:
        return
    _insert_log(conn, run_id, user_id, note_id, outcome, shapes, actions, before_body_json)


def log_started(conn: sqlite3.Connection, run_id: str, user_id: str, note_id: str, shapes: dict,
                actions: list, before_body_json: str) -> None:
    """C7: the `repair_started` row holding the body about to be replaced. COMMITS, so the undo
    copy is durable before the write; the note's outcome row, logged after, supersedes it.
    Without a body there is no undo copy: ValueError (fix round 1, M-3)."""
    if not isinstance(before_body_json, str) or not before_body_json.strip():
        raise ValueError("log_started needs the body about to be replaced")
    _insert_log(conn, run_id, user_id, note_id, STARTED, shapes, actions, before_body_json)
    conn.commit()


def latest_outcome(conn: sqlite3.Connection, run_id: str, note_id: str) -> str | None:
    """The note's newest outcome in this run. `repair_started` means the run stopped between the
    undo copy and the outcome: the body may or may not have been replaced."""
    row = conn.execute(
        "SELECT outcome FROM j2_import_repair_log WHERE run_id = ? AND note_id = ?"
        " ORDER BY id DESC LIMIT 1", (run_id, note_id)).fetchone()
    return row[0] if row is not None else None


#: The action a `fetch_failed` row carries for each hotlink URL that failed (round 2 S-5).
FAILED_URL_ACTION = "fetch_failed_url:"


def failed_hotlinks(conn: sqlite3.Connection, run_id: str, note_id: str) -> tuple[set[str], dict[str, int]]:
    """(the hotlink URLs of this note that failed to copy in THIS run, URL -> in how many runs it
    failed in all). Task 7 re-review I-6 and round 2 S-5: a dead hotlink is done for its run and
    retried by at most one more, PER URL, so a live hotlink beside it in the same note is not."""
    this_run: set[str] = set()
    runs_by_url: dict[str, set[str]] = {}
    for row in conn.execute(
            "SELECT run_id, actions_json FROM j2_import_repair_log WHERE note_id = ? AND outcome = 'fetch_failed'",
            (note_id,)).fetchall():
        try:
            actions = json.loads(row[1]) if isinstance(row[1], str) else []
        except ValueError:
            actions = []
        for action in actions if isinstance(actions, list) else []:
            if isinstance(action, str) and action.startswith(FAILED_URL_ACTION):
                url = action[len(FAILED_URL_ACTION):]
                runs_by_url.setdefault(url, set()).add(row[0])
                if row[0] == run_id:
                    this_run.add(url)
    return this_run, {url: len(runs) for url, runs in runs_by_url.items()}


def record_notice(conn: sqlite3.Connection, user_id: str, loss_notes: int) -> None:
    """The member's loss notice. While it is pending it shows the MOST loss notes any run found
    (fix round 1, I-1); a dismissed notice is never re-armed or changed; `created_at` keeps the
    first time. No loss (`loss_notes <= 0`) records nothing (fix round 1, M-6)."""
    if not isinstance(loss_notes, int) or loss_notes <= 0:
        return
    conn.execute(
        "INSERT INTO j2_import_repair_notices (user_id, loss_notes, created_at) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET loss_notes = MAX(loss_notes, excluded.loss_notes)"
        " WHERE dismissed_at IS NULL",
        (user_id, loss_notes, _now()))


def pending_notice(conn: sqlite3.Connection, user_id: str) -> int | None:
    """`loss_notes` while the notice is not dismissed, else None."""
    row = conn.execute(
        "SELECT loss_notes FROM j2_import_repair_notices WHERE user_id = ? AND dismissed_at IS NULL",
        (user_id,)).fetchone()
    return row[0] if row is not None else None


def dismiss_notice(conn: sqlite3.Connection, user_id: str) -> bool:
    """Dismiss the member's notice: an UPDATE; the row is never removed. True when a pending notice was
    dismissed. COMMITS."""
    cur = conn.execute(
        "UPDATE j2_import_repair_notices SET dismissed_at = ? WHERE user_id = ? AND dismissed_at IS NULL",
        (_now(), user_id))
    conn.commit()
    return cur.rowcount > 0
