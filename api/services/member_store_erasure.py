"""Account deletion for member rows in the small stores outside auth.db that are not alerts.

⛔⛔ THE GAP THIS CLOSES (the account-deletion census, `tests/test_alert_erasure.py`, red on
master 2026-11-17). `journal_two.account_purge.purge_user_data` runs its SQL on the auth.db
connection it is handed. These member tables live in their OWN SQLite files, so no statement on
that connection reaches them, and an account deletion left every row behind:
  * `chart_iq_feedback.db` -- `chart_iq_feedback`: the member's vote (useful / partly / noise)
    and free-text note on each Chart IQ chart they rated (`api/services/chart_iq/feedback.py`,
    since 1aae50c14e, 2026-11-01);
  * `uct_agent.db` -- the member's UCT Agent history: their conversations and every turn of them
    (what they typed or said, the Agent's replies, what UCT did), the per-conversation state
    (last screen, coach consent), the per-turn telemetry, and the request ledger keyed by a hash
    of their message (`api/services/uct_agent/store.py`, `budget.py`, `limits.py`);
  * `study.db` -- the member's Study record: profile (display name, reminder time and zone),
    attempts and answers, due ladder, skills, sessions, badges, game runs, checkpoints, weekly XP,
    reminder log and the feedback they wrote (`api/services/study_store.py`).
Naming any of these in `account_purge._DIRECT_USER_TABLES` would have matched nothing on auth.db
and read as covered -- the trap `user_definitions_erasure.py` and `alert_erasure.py` closed.

⭐ THE RULING (owner decision 2026-11-17, delegated to and taken by the coordinator): deleting an
account ERASES the member's Agent conversation history (conversations, turns, and any
member-keyed telemetry or state in uct_agent.db) and the rest of their Study data (every
member-keyed table in study.db). Rows that carry no member identifier may stay; the rail
(`tests/test_member_store_erasure.py`) proves they carry none.

What one member's deletion does in each store (`STORES`, `ANONYMISED`):
  * DELETE: the JOIN deletes first (a conversation's turns, by its id, whatever `user_id` a turn
    row carries -- `store.add_turn` does not check who owns the conversation; the routes do),
    then one `DELETE ... WHERE user_id = ?` per member table;
  * ANONYMISE: a row that is also a term in a limit SHARED across members keeps its amount and
    time and loses the member's id, so no shared limit loosens when an account goes: the Agent's
    dollar ledger (`agent_spend`, summed per ET day for the daily cap), the global 60-second
    request window (`agent_rate_events`) and the global in-flight count (`agent_inflight`). The
    last two prune themselves within the hour. In study.db the shared bank's reviewer columns
    (`study_items.reviewed_by`, `study_corrections.by_user`, `study_feedback.handled_by` -- the
    admin who reviewed) are cleared the same way, so an admin's deletion leaves no id behind.
    NULL, or '' where the column is NOT NULL (the `account_purge._ANONYMISED` convention);
  * the frozen weekly leaderboards (`study_weekly_close.rows_json`) carry display names and XP,
    no member id: the member's own entries, found by their display name AND that week's XP (both
    read before their rows go), are shown as "Member", the name the board gives anyone who never
    set one (`_scrub_frozen_boards`).

The pattern is `alert_erasure`'s, and so is the database half (`alert_erasure.purge_store_rows`,
one commit): each store is opened through ITS OWN module's connection function, under ITS OWN
write lock, with its path read from that module at CALL time. A store file that does not exist
holds nobody and is never created (opening it would create it). Best effort per store: one bad
store never aborts the others, and every failure is in `errors`. None of the three stores is in
`store_backup.STORES`, so no restore can bring these rows back and no tombstone replay is
registered for them.

The literal tuples below are read by AST (`tools/account_deletion_manifest.py`): they are the ONE
list of what each store's purge deletes and clears.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from typing import Any, ContextManager

from api.services.alert_erasure import Store, purge_store_rows

log = logging.getLogger("member_store_erasure")


#: chart_iq_feedback.db -- the member's vote and note on each Chart IQ chart.
CHART_IQ_FEEDBACK_TABLES = (
    "chart_iq_feedback",
)

#: uct_agent.db -- the member's Agent history. `agent_conversations` last (the joins below read it,
#: and they run first anyway).
UCT_AGENT_TABLES = (
    "agent_conversation_state",
    "agent_turns",
    "agent_telemetry",
    "agent_requests",
    "agent_conversations",
)
#: uct_agent.db -- (table, key column, the member table that key points into): a conversation's
#: transcript goes with the conversation.
UCT_AGENT_JOINS = (
    ("agent_turns", "conversation_id", "agent_conversations"),
)
#: uct_agent.db -- (table, column holding the member's id): rows that are terms in a limit shared
#: across members. The row stays, the id is cleared.
UCT_AGENT_ANONYMISED = (
    ("agent_spend", "user_id"),
    ("agent_rate_events", "user_id"),
    ("agent_inflight", "user_id"),
)

#: study.db -- the member's Study record. `study_profile` last: the frozen-board scrub reads it first.
STUDY_TABLES = (
    "study_game_runs",
    "study_attempts",
    "study_item_state",
    "study_skill",
    "study_sessions",
    "study_badges",
    "study_checkpoints",
    "study_weekly_xp",
    "study_reminder_log",
    "study_feedback",
    "study_profile",
)
#: study.db -- (table, column holding a reviewer's id) on the shared bank: the row stays, the id is
#: cleared.
STUDY_ANONYMISED = (
    ("study_items", "reviewed_by"),
    ("study_corrections", "by_user"),
    ("study_feedback", "handled_by"),
)


# ── the stores: each module's OWN path, connection and write lock, resolved at call time ──────

def _chart_iq_path() -> str:
    from api.services.chart_iq import feedback
    return feedback.db_path()


def _chart_iq_connect(path: str) -> sqlite3.Connection:
    from api.services.chart_iq import feedback
    return feedback._conn()


def _chart_iq_lock() -> ContextManager:
    from api.services.chart_iq import feedback
    return feedback._LOCK


def _uct_agent_path() -> str:
    from api.services.uct_agent import store
    return store._DB_PATH


def _uct_agent_connect(path: str) -> sqlite3.Connection:
    from api.services.uct_agent import store
    return store._connect()


def _uct_agent_lock() -> ContextManager:
    from api.services.uct_agent import store
    return store._WRITE_LOCK


def _study_path() -> str:
    from api.services import study_store
    return study_store._DB_PATH


def _study_connect(path: str) -> sqlite3.Connection:
    from api.services import study_store
    return study_store._connect()


def _study_lock() -> ContextManager:
    from api.services import study_store
    return study_store._WRITE_LOCK


STORES: tuple[Store, ...] = (
    Store("chart_iq_feedback", "chart_iq_feedback.db", CHART_IQ_FEEDBACK_TABLES, (),
          _chart_iq_path, _chart_iq_connect, _chart_iq_lock),
    Store("uct_agent", "uct_agent.db", UCT_AGENT_TABLES, UCT_AGENT_JOINS,
          _uct_agent_path, _uct_agent_connect, _uct_agent_lock),
    Store("study", "study.db", STUDY_TABLES, (),
          _study_path, _study_connect, _study_lock),
)
BY_NAME = {s.name: s for s in STORES}
#: store name -> its (table, column) pairs to clear.
ANONYMISED = {"uct_agent": UCT_AGENT_ANONYMISED, "study": STUDY_ANONYMISED}

#: What a frozen leaderboard calls a member with no display name (`study_store.leaderboard`).
FROZEN_BOARD_NAME = "Member"


def _anonymise(store: Store, user_id: str, conn: sqlite3.Connection, errors: list[str]) -> dict[str, int]:
    """Clear the member's id from each of the store's `ANONYMISED` columns; the rows stay. A table
    this copy never had is a counted no-op."""
    out: dict[str, int] = {}
    for table, col in ANONYMISED.get(store.name, ()):
        out.setdefault(table, 0)
        try:
            notnull = {c[1] for c in conn.execute(f'PRAGMA table_info("{table}")') if c[3]}
            blank = "''" if col in notnull else "NULL"
            cur = conn.execute(f'UPDATE "{table}" SET "{col}" = {blank} WHERE "{col}" = ?', (user_id,))
            out[table] += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        except sqlite3.Error as e:
            if "no such table" not in str(e).lower():
                errors.append(f"{store.db} {table}.{col}: {e}")
                log.warning("member store anonymise failed on %s.%s.%s for %s: %s", store.db, table, col, user_id, e)
    return out


def _scrub_frozen_boards(user_id: str, conn: sqlite3.Connection, errors: list[str]) -> int:
    """study.db: rename the member's own entries in the frozen weekly leaderboards to
    FROZEN_BOARD_NAME. An entry is theirs when its display name is theirs AND its XP is what they
    earned that week; both are read here, BEFORE their profile and weekly-XP rows are deleted.
    Returns the entries renamed."""
    try:
        row = conn.execute("SELECT display_name FROM study_profile WHERE user_id = ?", (user_id,)).fetchone()
        name = row[0] if row else None
        if not name or name == FROZEN_BOARD_NAME:
            return 0
        earned = {w: int(xp) for w, xp in conn.execute(
            "SELECT week_et, xp FROM study_weekly_xp WHERE user_id = ?", (user_id,)).fetchall()}
        if not earned:
            return 0
        marks = ",".join("?" for _ in earned)
        boards = conn.execute(f"SELECT week_et, rows_json FROM study_weekly_close WHERE week_et IN ({marks})",
                              tuple(earned)).fetchall()
        renamed = 0
        for week, raw in boards:
            rows = json.loads(raw or "[]")
            hits = 0
            for entry in rows if isinstance(rows, list) else ():
                if (isinstance(entry, dict) and entry.get("display_name") == name
                        and entry.get("xp") == earned[week]):
                    entry["display_name"] = FROZEN_BOARD_NAME
                    hits += 1
            if hits:
                conn.execute("UPDATE study_weekly_close SET rows_json = ? WHERE week_et = ?",
                             (json.dumps(rows, separators=(",", ":"), sort_keys=True), week))
                renamed += hits
        return renamed
    except (sqlite3.Error, ValueError) as e:
        if "no such table" in str(e).lower():
            return 0
        errors.append(f"{BY_NAME['study'].db} study_weekly_close: {e}")
        log.warning("frozen leaderboard scrub failed for %s: %s", user_id, e)
        return 0


def _purge_live_store(store: Store, user_id: str) -> dict[str, Any]:
    """One store, through its own connection under its own lock. An absent file is reported
    `absent` and NOT created."""
    empty = {t: 0 for t in (*(j[0] for j in store.joins), *store.tables)}
    unchanged = {t: 0 for t, _c in ANONYMISED.get(store.name, ())}
    try:
        path = store.path()
        if not path or not os.path.exists(path):
            return {"ok": True, "absent": True, "rows_deleted": empty, "rows_anonymised": unchanged,
                    "boards_renamed": 0, "errors": []}
        with store.lock():
            conn = store.connect(path)
            try:
                pre: list[str] = []
                renamed = _scrub_frozen_boards(user_id, conn, pre) if store.name == "study" else 0
                anonymised = _anonymise(store, user_id, conn, pre)
                rep = purge_store_rows(store, user_id, conn)      # deletes, then ONE commit for all of it
                rep["errors"] = pre + rep["errors"]
                rep["ok"] = not rep["errors"]
                return {**rep, "rows_anonymised": anonymised, "boards_renamed": renamed}
            finally:
                conn.close()
    except Exception as e:  # noqa: BLE001 -- one store never aborts the others; reported
        log.warning("member store purge could not open %s for %s: %s", store.db, user_id, e)
        return {"ok": False, "rows_deleted": empty, "rows_anonymised": unchanged, "boards_renamed": 0,
                "errors": [f"{store.db}: {type(e).__name__}: {e}"]}


def purge_user(user_id: str) -> dict[str, Any]:
    """Every store in `STORES` for one member. Never raises; every failure is in `errors`.

    `rows_deleted` and `rows_anonymised` are flat, table -> count, over every store (no table name
    repeats across them); `stores` keeps the per-database reports."""
    if not user_id:
        return {"ok": False, "rows_deleted": {}, "rows_anonymised": {}, "stores": {}, "errors": ["no user id"]}
    uid = str(user_id)
    stores: dict[str, Any] = {}
    errors: list[str] = []
    deleted: dict[str, int] = {}
    anonymised: dict[str, int] = {}
    for store in STORES:
        rep = _purge_live_store(store, uid)
        stores[store.db] = rep
        errors.extend(rep["errors"])
        deleted.update(rep["rows_deleted"])
        anonymised.update(rep["rows_anonymised"])
    return {"ok": not errors, "rows_deleted": deleted, "rows_anonymised": anonymised,
            "stores": stores, "errors": errors}
