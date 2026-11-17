"""Account deletion for member rows in the small stores outside auth.db that are not alerts.

⛔⛔ THE GAP THIS CLOSES (the account-deletion census, `tests/test_alert_erasure.py`, red on
master 2026-11-17). `journal_two.account_purge.purge_user_data` runs its SQL on the auth.db
connection it is handed. These member tables live in their OWN SQLite files, so no statement on
that connection reaches them, and an account deletion left every row behind:
  * `chart_iq_feedback.db` -- `chart_iq_feedback`: the member's vote (useful / partly / noise)
    and free-text note on each Chart IQ chart they rated (`api/services/chart_iq/feedback.py`,
    since 1aae50c14e, 2026-11-01);
  * `uct_agent.db` -- `agent_conversation_state`: per-conversation state the UCT Agent keeps for
    the member: the last screen's spec and result tickers (`lastScreen`) and their consent to the
    coach reading their journal (`coachConsent`) (`api/services/uct_agent/store.py`, since
    574afbfea6, 2026-11-02);
  * `study.db` -- `study_game_runs`: every Study game run the member finished, with their score
    and the XP it granted (`api/services/study_store.py`, since 09bd189b59, 2026-11-08).
Naming any of these in `account_purge._DIRECT_USER_TABLES` would have matched nothing on auth.db
and read as covered -- the trap `user_definitions_erasure.py` and `alert_erasure.py` closed.

The pattern is `alert_erasure`'s, and so is the database half (`alert_erasure.purge_store_rows`,
one `DELETE ... WHERE user_id = ?` per member table, one commit): each store is opened through ITS
OWN module's connection function, under ITS OWN write lock, with its path read from that module
at CALL time. A store file that does not exist holds nobody and is never created (opening it
would create it). Best effort per store: one bad store never aborts the others, and every failure
is in `errors`.

⚠️ NOT HERE, ON PURPOSE: the rest of `uct_agent.db` (`agent_conversations`, `agent_turns`,
`agent_telemetry`) and of `study.db` (`study_profile`, `study_attempts`, ...). Both stores' other
member tables are named in the census ledger (`tests/test_alert_erasure.py::KNOWN_UNPURGED`) as
awaiting an owner ruling per store, and this module does not take that ruling. None of the three
stores is in `store_backup.STORES`, so no restore can bring these rows back and no tombstone
replay is registered for them.

The literal tuples below are read by AST (`tools/account_deletion_manifest.py`): they are the ONE
list of what each store's purge deletes.
"""
from __future__ import annotations

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

#: uct_agent.db -- the UCT Agent's per-conversation state for the member.
UCT_AGENT_TABLES = (
    "agent_conversation_state",
)

#: study.db -- the member's finished Study game runs.
STUDY_TABLES = (
    "study_game_runs",
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
    Store("uct_agent", "uct_agent.db", UCT_AGENT_TABLES, (),
          _uct_agent_path, _uct_agent_connect, _uct_agent_lock),
    Store("study", "study.db", STUDY_TABLES, (),
          _study_path, _study_connect, _study_lock),
)
BY_NAME = {s.name: s for s in STORES}


def _purge_live_store(store: Store, user_id: str) -> dict[str, Any]:
    """One store, through its own connection under its own lock. An absent file is reported
    `absent` and NOT created."""
    empty = {t: 0 for t in store.tables}
    try:
        path = store.path()
        if not path or not os.path.exists(path):
            return {"ok": True, "absent": True, "rows_deleted": empty, "errors": []}
        with store.lock():
            conn = store.connect(path)
            try:
                return purge_store_rows(store, user_id, conn)
            finally:
                conn.close()
    except Exception as e:  # noqa: BLE001 -- one store never aborts the others; reported
        log.warning("member store purge could not open %s for %s: %s", store.db, user_id, e)
        return {"ok": False, "rows_deleted": empty, "errors": [f"{store.db}: {type(e).__name__}: {e}"]}


def purge_user(user_id: str) -> dict[str, Any]:
    """Every store in `STORES` for one member. Never raises; every failure is in `errors`.

    `rows_deleted` is flat, table -> count, over every store (no table name repeats across
    them); `stores` keeps the per-database reports."""
    if not user_id:
        return {"ok": False, "rows_deleted": {}, "stores": {}, "errors": ["no user id"]}
    uid = str(user_id)
    stores: dict[str, Any] = {}
    errors: list[str] = []
    flat: dict[str, int] = {}
    for store in STORES:
        rep = _purge_live_store(store, uid)
        stores[store.db] = rep
        errors.extend(rep["errors"])
        flat.update(rep["rows_deleted"])
    return {"ok": not errors, "rows_deleted": flat, "stores": stores, "errors": errors}
