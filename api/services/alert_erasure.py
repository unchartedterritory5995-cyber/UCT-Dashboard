"""Account deletion for a member's ALERTS in the stores outside auth.db.

⛔⛔ THE GAP THIS CLOSES. `journal_two.account_purge.purge_user_data` runs its SQL on the
auth.db connection it is handed. A member's alerts do not all live there. Until this module a
deleted member kept, in five other databases:
  * `alert_taxonomy.db` -- every S7 alert rule (`alert_predicates`), every fire of each
    (`alert_fires`), their OUTBOUND webhook endpoints with the signing secret
    (`alert_webhooks`), every payload queued or sent to them (`alert_webhook_deliveries`), and
    their routing rule (`alert_routing_rule`);
  * `screener.db` -- their screen and standing-screen alert subscriptions and fire records;
  * `calendar_alerts.db` -- which earnings alerts were sent to them;
  * `transcript_alerts.db` -- the keywords they watch in earnings calls, and every hit;
  * `catalysts.db` -- the catalyst alerts sent to them, and the feedback they gave on catalysts.
Naming any of these tables in `account_purge._DIRECT_USER_TABLES` would have matched nothing
on auth.db and read as covered -- the same trap `user_definitions_erasure.py` closed.

The pattern is that module's: each store is opened through ITS OWN module's connection
function, under ITS OWN write lock where it has one, and its path is read from that module at
CALL time (so a test, or a restore drill, never reaches a path it did not mean).

What one member's deletion does in each database (`STORES`):
  * the JOIN deletes first -- the rows that carry no member id and hang off a member row
    (a fire's read-state and reminder rows, a rule's dark-vs-legacy comparison spans, a
    standing screen's snapshots and fires) -- while the parent rows they key off still exist;
  * then one `DELETE ... WHERE user_id = ?` per member table;
  * one commit per store. Best effort per table: one bad table never aborts the rest, every
    failure is in `errors`, and a table that does not exist is a counted no-op.

⭐ CREDENTIALS FIRST (`revoke_credentials`). A member's alert credentials are the two things
that can still MOVE DATA while the rest of the purge runs: their inbound TradingView receiver
token (auth.db `inbound_alert_tokens` -- the URL is the password) and their outbound webhook
endpoints (`alert_webhooks`, which the drain job posts to). `purge_user_data` calls this
straight after the tombstone, before any other delete, and each half commits on its own.
(The inbound receiver ALSO refuses a tombstoned member from the instant the tombstone is
written -- `inbound_alerts.verify` -- so even the broker purge that runs before
`purge_user_data` cannot be raced by a webhook.)

`purge_store_rows(store, user_id, conn)` is the DATABASE half and touches nothing else: it is
what a restore replays on a restored copy (`replay_on_store`, registered in
`account_tombstones.STORE_REPLAYS`). `purge_user(user_id)` is the live half: every store, then
the member's alerts dropped from this process's alert cache.

⚠️ NOT HERE, ON PURPOSE: an evaluator cycle that loaded a member's rule a moment BEFORE the
purge can still write one fire row a moment AFTER it. Every evaluator tolerates the vanished
rule (`tests/test_alert_erasure.py` rails the ones that read a rule back), but a late write is
a residue for the live tombstone sweep, which re-runs `STORE_REPLAYS` -- not a reason to put a
membership check on every hot write path.
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
from dataclasses import dataclass
from typing import Any, Callable, ContextManager, Iterable

log = logging.getLogger("alert_erasure")


# ── what is deleted, per database (literal tuples: tools/account_deletion_manifest.py reads
#    them by AST, and tests/test_alert_erasure.py fails by name on a member table in one of
#    these databases that is not listed) ─────────────────────────────────────────────────

#: alert_taxonomy.db -- every table holding a member's `user_id`. `alert_webhooks` FIRST: an
#: endpoint is a credential (see `revoke_credentials`).
ALERT_TAXONOMY_TABLES = (
    "alert_webhooks",
    "alert_webhook_deliveries",
    "alert_routing_rule",
    "alert_fires",
    "alert_predicates",
)
#: alert_taxonomy.db -- (table, its key column, the member table that key points into). No
#: member id of their own; each row hangs off one of the member's fires or rules.
ALERT_TAXONOMY_JOINS = (
    ("alert_fire_channel_reads", "fire_id", "alert_fires"),
    ("alert_fire_reminders", "fire_id", "alert_fires"),
    ("rating_change_shadow_state", "predicate_id", "alert_predicates"),
    ("catalyst_match_comparison_spans", "predicate_id", "alert_predicates"),
    ("event_proximity_comparison_spans", "predicate_id", "alert_predicates"),
    ("indicator_condition_comparison_spans", "predicate_id", "alert_predicates"),
    ("position_risk_comparison_spans", "predicate_id", "alert_predicates"),
    ("price_level_comparison_spans", "predicate_id", "alert_predicates"),
    ("rating_change_comparison_spans", "predicate_id", "alert_predicates"),
    ("regime_change_comparison_spans", "predicate_id", "alert_predicates"),
    ("scan_membership_comparison_spans", "predicate_id", "alert_predicates"),
)

#: screener.db -- the screen-alert subscriptions and their fire (dedup) rows, and the
#: standing-screen (spec) alert subscriptions.
SCREENER_TABLES = (
    "screen_alert_subs",
    "screen_alerts_fired",
    "spec_alert_subs",
)
SCREENER_JOINS = (
    ("spec_alert_snapshots", "sub_id", "spec_alert_subs"),
    ("spec_alerts_fired", "sub_id", "spec_alert_subs"),
)

#: calendar_alerts.db -- which pre-report earnings alerts were sent to the member.
CALENDAR_ALERTS_TABLES = (
    "calendar_alerts_fired",
)

#: transcript_alerts.db -- the member's earnings-call keywords, and every hit sent to them.
TRANSCRIPT_ALERTS_TABLES = (
    "keyword_subs",
    "keyword_fired",
)

#: catalysts.db -- the catalyst alerts sent to the member, and their own 👍/👎 + notes on
#: catalyst rows. (`catalyst_learned_rules` is text DISTILLED from many members' notes, keyed
#: by no member; it stays -- see the census ledger in tests/test_alert_erasure.py.)
CATALYSTS_TABLES = (
    "catalyst_alerts_fired",
    "catalyst_feedback",
)


# ── the stores ──────────────────────────────────────────────────────────────────────────────

def _no_lock() -> ContextManager:
    return contextlib.nullcontext()


def _alert_taxonomy_path() -> str:
    from api.services.alert_taxonomy import db as _db
    return _db.DB_PATH


def _alert_taxonomy_connect(path: str) -> sqlite3.Connection:
    from api.services.alert_taxonomy import db as _db
    return _db.connect(path)


def _screener_path() -> str:
    from api.services.screener import snapshot_db
    return snapshot_db.get_db_path()


def _screener_connect(path: str) -> sqlite3.Connection:
    from api.services.screener import snapshot_db
    return snapshot_db.connect()


def _screener_lock() -> ContextManager:
    from api.services.screener import snapshot_db
    return snapshot_db._WRITE_LOCK


def _calendar_path() -> str:
    from api.services import calendar_alerts
    return calendar_alerts._DB_PATH


def _calendar_connect(path: str) -> sqlite3.Connection:
    from api.services import calendar_alerts
    return calendar_alerts._connect()


def _calendar_lock() -> ContextManager:
    from api.services import calendar_alerts
    return calendar_alerts._WRITE_LOCK


def _transcript_path() -> str:
    from api.services import transcript_keyword_alerts as tka
    return tka.DB_PATH


def _transcript_connect(path: str) -> sqlite3.Connection:
    from api.services import transcript_keyword_alerts as tka
    return tka._connect()


def _transcript_lock() -> ContextManager:
    from api.services import transcript_keyword_alerts as tka
    return tka._WRITE_LOCK


def _catalysts_path() -> str:
    from api.services.catalyst import store
    return store._DB_PATH


def _catalysts_connect(path: str) -> sqlite3.Connection:
    from api.services.catalyst import store
    return store._connect()


def _catalysts_lock() -> ContextManager:
    from api.services.catalyst import store
    return store._WRITE_LOCK


@dataclass(frozen=True)
class Store:
    """One database outside auth.db that holds a member's alerts.

    `name` is the name a restore knows the store by (`store_backup.STORES`, else the file's
    stem -- `tools/store_restore.py --to <path>`), and the key in
    `account_tombstones.STORE_REPLAYS`. `path`/`connect`/`lock` are the store module's OWN,
    resolved at call time."""
    name: str
    db: str
    tables: tuple
    joins: tuple
    path: Callable[[], str]
    connect: Callable[[str], sqlite3.Connection]
    lock: Callable[[], ContextManager]


STORES: tuple[Store, ...] = (
    # ⛔ alert_taxonomy has no process write lock: every writer opens its own WAL connection
    # with busy_timeout=5000 (`alert_taxonomy/db.connect`), and so does this.
    Store("alert_taxonomy", "alert_taxonomy.db", ALERT_TAXONOMY_TABLES, ALERT_TAXONOMY_JOINS,
          _alert_taxonomy_path, _alert_taxonomy_connect, _no_lock),
    Store("screener", "screener.db", SCREENER_TABLES, SCREENER_JOINS,
          _screener_path, _screener_connect, _screener_lock),
    Store("calendar_alerts", "calendar_alerts.db", CALENDAR_ALERTS_TABLES, (),
          _calendar_path, _calendar_connect, _calendar_lock),
    Store("transcript_alerts", "transcript_alerts.db", TRANSCRIPT_ALERTS_TABLES, (),
          _transcript_path, _transcript_connect, _transcript_lock),
    Store("catalysts", "catalysts.db", CATALYSTS_TABLES, (),
          _catalysts_path, _catalysts_connect, _catalysts_lock),
)
BY_NAME = {s.name: s for s in STORES}


def _rowcount(cur) -> int:
    return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0


# ── the database half (what a restore replays) ─────────────────────────────────────────────

def purge_store_rows(store: Store, user_id: str, conn: sqlite3.Connection) -> dict[str, Any]:
    """Delete the member's rows from ONE store on `conn`, joins first, and commit. Nothing on
    disk, nothing in memory. Every table is in `rows_deleted` (0 for a table this copy never
    had), so the report names what the purge covers whether or not the store holds data."""
    uid = str(user_id)
    errors: list[str] = []
    deleted: dict[str, int] = {}

    def _run(table: str, sql: str) -> int:
        try:
            return _rowcount(conn.execute(sql, (uid,)))
        except sqlite3.Error as e:
            if "no such table" not in str(e).lower():
                errors.append(f"{store.db} {table}: {e}")
                log.warning("alert purge failed on %s.%s for %s: %s", store.db, table, uid, e)
            return 0

    for table, fk, parent in store.joins:
        deleted[table] = _run(table, f"DELETE FROM {table} WHERE {fk} IN "
                                     f"(SELECT id FROM {parent} WHERE user_id = ?)")
    for table in store.tables:
        deleted[table] = _run(table, f"DELETE FROM {table} WHERE user_id = ?")
    try:
        conn.commit()
    except sqlite3.Error as e:
        errors.append(f"{store.db} commit: {e}")
    return {"ok": not errors, "rows_deleted": deleted, "errors": errors}


def still_present(store: Store, conn: sqlite3.Connection, user_ids: Iterable[str]) -> list[str]:
    """The ids that still own a row in any of the store's member tables."""
    out = set()
    for uid in user_ids:
        for table in store.tables:
            try:
                if conn.execute(f"SELECT 1 FROM {table} WHERE user_id = ? LIMIT 1", (uid,)).fetchone():
                    out.add(uid)
                    break
            except sqlite3.Error:
                continue                                  # a table this copy never had
    return sorted(out)


def replay_on_store(name: str) -> Callable[[sqlite3.Connection, Iterable[str]], dict[str, Any]]:
    """The tombstone replay for one store, in `account_tombstones.STORE_REPLAYS`'s shape:
    `(conn, user_ids) -> {replayed, errors, rows_deleted, authors_scrubbed, still_present}`.
    EVERY tombstoned id -- none of these files has a `users` table, and a member's rows here
    outlive their account row. Idempotent. A restore refuses on `errors` or `still_present`."""
    store = BY_NAME[name]

    def replay(conn: sqlite3.Connection, user_ids: Iterable[str]) -> dict[str, Any]:
        ids = sorted({str(u) for u in user_ids if u})
        replayed, errors, deleted = [], [], 0
        for uid in ids:
            try:
                rep = purge_store_rows(store, uid, conn)
            except Exception as e:  # noqa: BLE001 -- reported; still_present says what it means
                errors.append(f"{uid}: {type(e).__name__}: {e}")
                continue
            errors.extend(f"{uid}: {e}" for e in rep["errors"])
            deleted += sum(rep["rows_deleted"].values())
            replayed.append(uid)
        return {"replayed": replayed, "errors": errors, "rows_deleted": deleted,
                "authors_scrubbed": 0, "still_present": still_present(store, conn, ids)}

    replay.__name__ = f"replay_on_{name}_db"
    return replay


def members_on_store(name: str) -> Callable[[sqlite3.Connection], list[str]]:
    """`account_tombstones.STORE_MEMBERS`'s shape for one store: every member id that owns a
    row in its member tables on `conn` (a restored copy's population)."""
    store = BY_NAME[name]

    def members(conn: sqlite3.Connection) -> list[str]:
        out: set[str] = set()
        for table in store.tables:
            try:
                out.update(r[0] for r in conn.execute(
                    f"SELECT DISTINCT user_id FROM {table} WHERE user_id IS NOT NULL"))
            except sqlite3.Error:
                continue
        return sorted(str(u) for u in out)

    members.__name__ = f"members_on_{name}_db"
    return members


# ── the live half ────────────────────────────────────────────────────────────────────────

@contextlib.contextmanager
def live_connection(name: str):
    """The LIVE store's own connection, under its own write lock. Yields None when the file
    does not exist: the store was never created on this pod, so it holds nobody -- and opening
    it would CREATE it."""
    store = BY_NAME[name]
    path = store.path()
    if not path or not os.path.exists(path):
        yield None
        return
    with store.lock():
        conn = store.connect(path)
        try:
            yield conn
        finally:
            conn.close()


def live_path(name: str) -> str:
    return BY_NAME[name].path()


def _purge_live_store(store: Store, user_id: str) -> dict[str, Any]:
    try:
        with live_connection(store.name) as conn:
            if conn is None:
                return {"ok": True, "absent": True, "errors": [],
                        "rows_deleted": {t: 0 for t, _f, _p in store.joins}
                        | {t: 0 for t in store.tables}}
            return purge_store_rows(store, user_id, conn)
    except Exception as e:  # noqa: BLE001 -- one store never aborts the others; reported
        log.warning("alert purge could not open %s for %s: %s", store.db, user_id, e)
        return {"ok": False, "errors": [f"{store.db}: {type(e).__name__}: {e}"],
                "rows_deleted": {t: 0 for t, _f, _p in store.joins} | {t: 0 for t in store.tables}}


def revoke_credentials(user_id: str, auth_conn: sqlite3.Connection) -> dict[str, Any]:
    """Kill the member's alert CREDENTIALS before anything else is deleted, each half
    committed on its own: the inbound TradingView receiver token(s) in auth.db, and the
    outbound webhook endpoints in alert_taxonomy.db. Never raises."""
    uid = str(user_id)
    out: dict[str, Any] = {"inbound_alert_tokens": 0, "alert_webhooks": 0, "errors": []}
    try:
        out["inbound_alert_tokens"] = _rowcount(auth_conn.execute(
            "DELETE FROM inbound_alert_tokens WHERE user_id = ?", (uid,)))
        auth_conn.commit()
    except sqlite3.Error as e:
        if "no such table" not in str(e).lower():
            out["errors"].append(f"inbound_alert_tokens: {e}")
    try:
        with live_connection("alert_taxonomy") as conn:
            if conn is not None:
                out["alert_webhooks"] = _rowcount(conn.execute(
                    "DELETE FROM alert_webhooks WHERE user_id = ?", (uid,)))
                conn.commit()
    except sqlite3.Error as e:
        if "no such table" not in str(e).lower():
            out["errors"].append(f"alert_webhooks: {e}")
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"alert_webhooks: {type(e).__name__}: {e}")
    return out


def purge_user(user_id: str) -> dict[str, Any]:
    """The live half: every store in `STORES`, then the member's alerts dropped from this
    process's alert cache. Never raises; every failure is in `errors`.

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
    # The in-process alert feed (`alerts.py`'s cache) holds the member's recent alerts and
    # their read marks -- memory, not a table, but their alerts all the same. ⛔ The cache
    # keys only, never `alerts.clear_alerts`: that also opens a second auth.db connection for
    # the durable `user_alerts` mirror (which the auth.db purge has already emptied, on the
    # purge's own connection) and never closes it.
    cached = 0
    try:
        from api.services import alerts as _alerts
        key = _alerts._user_key(uid)
        cached = len(_alerts.cache.get(key) or [])
        _alerts.cache.invalidate(key)
        _alerts.cache.invalidate(_alerts._read_key(uid))
    except Exception as e:  # noqa: BLE001
        errors.append(f"alert cache: {type(e).__name__}: {e}")
    return {"ok": not errors, "rows_deleted": flat, "stores": stores,
            "cached_alerts_dropped": cached, "errors": errors}
