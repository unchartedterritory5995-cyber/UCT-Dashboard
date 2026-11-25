"""A voice session's post-processing, made DURABLE (2026-11-21).

When a Mode C session ends (`POST /api/voice/session/end`), four steps run after the response, in this
order: the session summary (a model call, `voice_session_summaries`), the hallucination audit
(`voice_hallucinations`), the Compass thread bridge (one message in the member's Compass thread,
`j2_chat_messages`) and the trader-profile auto-populate (Haiku, `j2_profile_suggestions`).

⛔ THEY USED TO BE FOUR STARLETTE BackgroundTasks AND NOTHING ELSE. A BackgroundTask lives only in
the process that answered: a deploy (every master merge redeploys `web`) or a crash in that window
lost whichever steps had not finished, for good. No marker, no sweep, and the bridge and the
suggestions were not deduplicated, so simply running them again could double them.

Now:
  * `run` runs the steps in the same order and records each one that RETURNED in
    `voice_session_post` (session_id, step). A step that never returned (the process died inside it)
    has no row.
  * `sweep` (APScheduler, ~60 s after boot and then every 5 minutes, `register`) runs the missing steps
    for every session that ended more than `SWEEP_AFTER_S` ago, inside `SWEEP_WINDOW_DAYS`, and after
    this table was first created (`armed_at`): sessions that ended before this code shipped are never
    re-processed, so it never spends model calls on history.
  * IDEMPOTENT PER (session_id, step): before a step runs, `already_written` looks for what that step
    writes for this session (the summary row; an audit row; the bridge message, whose metadata carries
    the session id; a suggestion with `source_type='voice_session'` and this `source_id`). Found: the
    step is marked done and not run again. So a process that died between the write and the marker
    does not double anything.
  * One process runs one session at a time (`_claims`): the after-response run and a sweep never run
    the same session together. `web` is one process; across a restart nothing is in flight.

The steps themselves (and what they write) are unchanged: `api/routers/voice.py` `POST_SESSION_STEPS`.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Optional, Sequence

_log = logging.getLogger(__name__)

#: the steps, in the order they run (the names `voice_session_post.step` holds)
STEPS = ("summary", "audit", "bridge", "profile")
SWEEP_AFTER_S = 120              # a session ended this long ago with steps missing is the sweep's
SWEEP_WINDOW_DAYS = 7            # never older than this
SWEEP_MAX_SESSIONS = 20          # per sweep: a backlog drains over a few runs, never in one burst
SWEEP_EVERY_MIN = 5
SWEEP_FIRST_AFTER_S = 60

_DDL = """
CREATE TABLE IF NOT EXISTS voice_session_post (
    session_id INTEGER NOT NULL,
    step       TEXT NOT NULL,
    done_at    TEXT NOT NULL,
    PRIMARY KEY (session_id, step)
);
CREATE TABLE IF NOT EXISTS voice_session_post_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""

_claims: set = set()
_claims_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()       # the format voice_sessions.ended_at is stored in


def _conn():
    from api.services.auth_db import get_connection
    return get_connection()


def ensure_schema(conn, now: Optional[datetime] = None) -> str:
    """Create the marker tables; return `armed_at` (when this code first ran on this store)."""
    conn.executescript(_DDL)
    conn.execute("INSERT OR IGNORE INTO voice_session_post_meta (k, v) VALUES ('armed_at', ?)",
                 (_iso(now or _now()),))
    conn.commit()
    return conn.execute("SELECT v FROM voice_session_post_meta WHERE k = 'armed_at'").fetchone()[0]


def done_steps(conn, session_id: int) -> set:
    return {r[0] for r in conn.execute("SELECT step FROM voice_session_post WHERE session_id = ?",
                                       (int(session_id),))}


def _mark(conn, session_id: int, step: str) -> None:
    conn.execute("INSERT OR IGNORE INTO voice_session_post (session_id, step, done_at) VALUES (?, ?, ?)",
                 (int(session_id), step, _iso(_now())))
    conn.commit()


#: what each step writes for one session, as (sql, parameters(session_id, user_id))
_WRITTEN = {
    "summary": ("SELECT 1 FROM voice_session_summaries WHERE session_id = ? LIMIT 1",
                lambda s, u: (s,)),
    "audit": ("SELECT 1 FROM voice_hallucinations WHERE session_id = ? LIMIT 1",
              lambda s, u: (s,)),
    "bridge": ("SELECT 1 FROM j2_chat_messages WHERE user_id = ?"
               " AND json_extract(metadata, '$.source') = 'voice_session'"
               " AND json_extract(metadata, '$.session_id') = ? LIMIT 1",
               lambda s, u: (u, s)),
    "profile": ("SELECT 1 FROM j2_profile_suggestions WHERE user_id = ?"
                " AND source_type = 'voice_session' AND source_id = ? LIMIT 1",
                lambda s, u: (u, str(s))),
}


def already_written(conn, session_id: int, user_id: str, step: str) -> bool:
    """Did `step` already write its output for this session (the idempotency key (session_id, step))?
    A table that does not exist yet holds nothing."""
    sql, params = _WRITTEN[step]
    try:
        return conn.execute(sql, params(int(session_id), str(user_id))).fetchone() is not None
    except Exception:  # noqa: BLE001 - e.g. no such table: nothing was written
        return False


def run(session_id: int, user_id: str, steps: Sequence[tuple[str, Callable[[int, str], None]]]) -> dict:
    """Run every step this session has not done, in order, marking each that returns. Never raises."""
    sid, uid = int(session_id), str(user_id)
    with _claims_lock:
        if sid in _claims:
            return {"session_id": sid, "ran": [], "skipped": [], "busy": True}
        _claims.add(sid)
    ran, skipped = [], []
    try:
        conn = _conn()
        try:
            ensure_schema(conn)
            done = done_steps(conn, sid)
            for name, fn in steps:
                if name in done:
                    continue
                if already_written(conn, sid, uid, name):
                    _mark(conn, sid, name)
                    skipped.append(name)
                    continue
                try:
                    fn(sid, uid)
                except Exception as e:  # noqa: BLE001 - the steps swallow their own errors; a raise is a bug
                    _log.warning("[voice-post] %s for session %s raised: %s", name, sid, e)
                    continue             # not marked: the sweep tries it again
                _mark(conn, sid, name)
                ran.append(name)
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 - post-processing must never break the caller
        _log.warning("[voice-post] session %s: %s", sid, e)
    finally:
        with _claims_lock:
            _claims.discard(sid)
    return {"session_id": sid, "ran": ran, "skipped": skipped}


def due_sessions(conn, now: Optional[datetime] = None, *, limit: int = SWEEP_MAX_SESSIONS) -> list[tuple[int, str]]:
    """(session_id, user_id) of ended sessions with a step missing: ended at least SWEEP_AFTER_S ago,
    within SWEEP_WINDOW_DAYS, and not before `armed_at`."""
    now = now or _now()
    armed = ensure_schema(conn, now)
    newest = _iso(now - timedelta(seconds=SWEEP_AFTER_S))
    oldest = max(_iso(now - timedelta(days=SWEEP_WINDOW_DAYS)), armed)
    rows = conn.execute(
        "SELECT s.id, s.user_id FROM voice_sessions s"
        " WHERE s.ended_at IS NOT NULL AND s.ended_at <= ? AND s.ended_at >= ?"
        " AND (SELECT count(*) FROM voice_session_post p WHERE p.session_id = s.id) < ?"
        " ORDER BY s.ended_at LIMIT ?",
        (newest, oldest, len(STEPS), int(limit))).fetchall()
    return [(int(r[0]), str(r[1])) for r in rows]


def _default_steps():
    from api.routers.voice import POST_SESSION_STEPS
    return POST_SESSION_STEPS


def sweep(steps: Optional[Iterable] = None, now: Optional[datetime] = None) -> int:
    """Finish every due session's missing steps. Returns how many sessions it ran. Never raises."""
    try:
        conn = _conn()
        try:
            due = due_sessions(conn, now)
        finally:
            conn.close()
        if not due:
            return 0
        steps = tuple(steps if steps is not None else _default_steps())
        for sid, uid in due:
            run(sid, uid, steps)
        _log.info("[voice-post] sweep finished %d session(s)", len(due))
        return len(due)
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice-post] sweep failed: %s", e)
        return 0


def register(scheduler, interval_trigger) -> None:
    """The sweep: first ~60 s after boot (a session cut by the deploy that started this pod), then
    every SWEEP_EVERY_MIN minutes."""
    scheduler.add_job(sweep, interval_trigger(minutes=SWEEP_EVERY_MIN), id="voice_post_session_sweep",
                      next_run_time=datetime.now(timezone.utc) + timedelta(seconds=SWEEP_FIRST_AFTER_S),
                      max_instances=1, coalesce=True, replace_existing=True)
