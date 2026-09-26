"""Durable per-ET-day counters in auth.db — ONE authority for the daily caps
that bound LLM and vendor spend (wave 7 whole-branch fix round, ruling D-H5b).

⚰️ WHY THIS EXISTS. Ask Notebook's shared dollar cap (`note_ask`'s $25/day),
Ask's 40 questions a member a day and editor writing help's 60 drafts were
module dicts. Every web deploy -- several a day -- starts a fresh process, so
each "daily" cap was really a cap per UPTIME: a day with four deploys allowed
four times the spend. The email-in limits of the same wave were already
durable in auth.db (`inbound_email.admit`); this is that pattern, shared.

THE SHAPE. One row per (scope, subject, ET day) holding a number: a count
(`notebook_ask`, `notebook_writing_help`, `notebook_semantic_query_embed`,
subject = the member's id) or dollars (`notebook_llm_spend_usd`, subject
`GLOBAL`). The day is the caller's ET day string -- part of the KEY, so a new
day starts at zero by construction and nothing has to "roll over". Rows older
than yesterday are pruned on every write, so the table holds two days at most.

THE RULES.
  * `take` checks every charge's cap and adds every charge, or adds NONE, in
    ONE `BEGIN IMMEDIATE`: two requests racing for the last slot get exactly
    one (the read and the write cannot be split by another writer).
  * ⛔ A DATABASE ERROR FAILS OPEN, WITH ONE LOG LINE, and never raises into the
    caller: a cost cap that fails closed refuses every member on a busy
    database, which is an outage, while the spend it would have prevented is
    bounded by the other valves (concurrency slots, timeouts). `take` answers
    "admitted", `value` answers 0.
  * Waits at most `BUSY_TIMEOUT_MS` for the write lock (auth.db's own 3 s is
    the whole request path's budget; a counter is not worth that).
  * Counts only -- never a note, a query or a prompt.

IN THE ACCOUNT PURGE since ruling D-H10 (`1b8eff1cd`): an account deletion
deletes the member's rows by `subject`, and docs/account-deletion-manifest.md
is regenerated from that line. A row carries a member id and a count and nothing
else, and is pruned within two ET days of its day regardless.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, NamedTuple

from api.services import auth_db

log = logging.getLogger(__name__)

TABLE = "daily_usage_counters"
GLOBAL = "*"                 # the subject of a counter that is nobody's own
BUSY_TIMEOUT_MS = 1000
KEEP_DAYS = 2                # today and yesterday

_DDL = (f"CREATE TABLE IF NOT EXISTS {TABLE} ("
        " scope TEXT NOT NULL,"
        " subject TEXT NOT NULL,"
        " day TEXT NOT NULL,"
        " value REAL NOT NULL DEFAULT 0,"
        " updated_at TEXT NOT NULL,"
        " PRIMARY KEY (scope, subject, day))")

_READ = f"SELECT value FROM {TABLE} WHERE scope = ? AND subject = ? AND day = ?"
_ADD = (f"INSERT INTO {TABLE} (scope, subject, day, value, updated_at) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT (scope, subject, day) DO UPDATE SET"
        " value = value + excluded.value, updated_at = excluded.updated_at")
_SUBTRACT = (f"UPDATE {TABLE} SET value = MAX(0, value - ?), updated_at = ?"
             " WHERE scope = ? AND subject = ? AND day = ?")


class Charge(NamedTuple):
    """`amount` added to (scope, subject)'s counter for the day, refused when
    it would take the counter past `cap` (None: counted, never refused)."""
    scope: str
    subject: str
    amount: float
    cap: float | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    # `auth_db.get_connection` is looked up at CALL time, so the database a
    # test (or a sandbox boot) points auth_db at is the one counted in.
    conn = auth_db.get_connection()
    conn.execute(f"PRAGMA busy_timeout = {int(BUSY_TIMEOUT_MS)}")
    conn.execute(_DDL)
    return conn


def _fail_open(op: str, err: BaseException) -> None:
    """ONE line per failed call, naming the error's class only."""
    log.warning("[daily-counters] %s failed (%s); failing OPEN", op, type(err).__name__)


def _prune(conn: sqlite3.Connection, day: str) -> None:
    try:
        cutoff = (date.fromisoformat(day) - timedelta(days=KEEP_DAYS - 1)).isoformat()
    except (TypeError, ValueError):
        return
    conn.execute(f"DELETE FROM {TABLE} WHERE day < ?", (cutoff,))


def _read(conn: sqlite3.Connection, scope: str, subject: str, day: str) -> float:
    row = conn.execute(_READ, (scope, str(subject), day)).fetchone()
    return float(row[0]) if row else 0.0


def take(day: str, charges: Iterable[Charge]) -> str | None:
    """Admit and count ALL of `charges` for `day`, or none of them.

    → None when admitted (and counted), or the `scope` of the first charge
    whose cap refused (nothing counted). A database error admits (fails open)
    with one log line."""
    charges = list(charges)
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001 -- failing open IS the contract
        _fail_open("take", e)
        return None
    try:
        conn.execute("BEGIN IMMEDIATE")
        _prune(conn, day)
        for c in charges:
            if c.cap is not None and _read(conn, c.scope, c.subject, day) + c.amount > c.cap:
                conn.rollback()
                return c.scope
        stamp = _now()
        for c in charges:
            conn.execute(_ADD, (c.scope, str(c.subject), day, float(c.amount), stamp))
        conn.commit()
        return None
    except Exception as e:  # noqa: BLE001
        try:
            if conn.in_transaction:
                conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        _fail_open("take", e)
        return None
    finally:
        conn.close()


def give_back(day: str, charges: Iterable[Charge]) -> None:
    """Subtract each charge's amount for `day`, never below zero. Never raises."""
    charges = list(charges)
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        _fail_open("give_back", e)
        return
    try:
        conn.execute("BEGIN IMMEDIATE")
        stamp = _now()
        for c in charges:
            conn.execute(_SUBTRACT, (float(c.amount), stamp, c.scope, str(c.subject), day))
        conn.commit()
    except Exception as e:  # noqa: BLE001
        try:
            if conn.in_transaction:
                conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        _fail_open("give_back", e)
    finally:
        conn.close()


def value(day: str, scope: str, subject: str) -> float:
    """The counter's value for `day` (0 when there is none, and on an error)."""
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        _fail_open("value", e)
        return 0.0
    try:
        return _read(conn, scope, subject, day)
    except Exception as e:  # noqa: BLE001
        _fail_open("value", e)
        return 0.0
    finally:
        conn.close()


def clear() -> None:
    """Delete every counter row. For tests and for an operator resetting a
    day by hand; nothing in the product calls it."""
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        _fail_open("clear", e)
        return
    try:
        conn.execute(f"DELETE FROM {TABLE}")
        conn.commit()
    finally:
        conn.close()
