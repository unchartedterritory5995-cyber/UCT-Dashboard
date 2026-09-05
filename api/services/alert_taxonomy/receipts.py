"""The shared fire-receipt store (SPEC-S7 §5.3/§9) -- generalizes
`alert_fired_log.py`'s SHAPE (insert-once dedup, `claim_delivery`
compare-and-set lease, bounded retry) against the new `alert_fires` table.
Per SPEC §3's own reuse ledger: "the *pattern* is reused, the *table* is
new" -- this module reimplements the invariants, it does not call
`alert_fired_log.py`'s functions directly (which remain hardcoded to
`indicator_alert_fires` until that subsystem's own migration, explicitly
out of scope this pass).
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Optional

from api.services.alert_taxonomy import db as _db

MAX_DELIVERY_ATTEMPTS = 3  # same bound alert_fired_log.py uses


def record_fire(
    predicate_id: str,
    trigger_type: str,
    user_id: Optional[str],
    entity_ref: Optional[str],
    fire_key: str,
    *,
    triggering_value: Optional[float] = None,
    detail: Optional[dict[str, Any]] = None,
    source_data_class: Optional[str] = None,
    freshness_class: Optional[str] = None,
    as_of: float,
    fired_at: Optional[float] = None,
    db_path: str | None = None,
) -> Optional[int]:
    """Insert-once fire record. Returns the new fire's id, or None if this
    exact (predicate_id, fire_key) was already recorded -- the SAME
    UNIQUE-constraint-as-dedup contract `alert_fired_log.record_fire` uses
    (an IntegrityError on the unique pair is the only thing that produces
    the "already recorded" outcome; every other validation failure raises).

    `freshness_class`, if given, MUST be one of D1's real 5 values or None
    -- never the stale 4-value set. This is asserted here, not just
    documented, so a caller cannot silently reintroduce the old enum."""
    if freshness_class is not None and freshness_class not in _db.KNOWN_D1_FRESHNESS_VALUES:
        raise ValueError(
            f"record_fire: unrecognized freshness_class {freshness_class!r}. "
            f"Must be one of {_db.KNOWN_D1_FRESHNESS_VALUES} or None (D1's own "
            "'not established' state) -- never a value outside D1's real enum."
        )
    if not fire_key:
        raise ValueError("record_fire: fire_key is required")

    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        try:
            cur = conn.execute(
                "INSERT INTO alert_fires "
                "(predicate_id, trigger_type, user_id, entity_ref, fire_key, triggering_value, "
                " detail, source_data_class, freshness_class, as_of, fired_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (predicate_id, trigger_type, user_id, entity_ref, fire_key, triggering_value,
                 json.dumps(detail) if detail is not None else None,
                 source_data_class, freshness_class, as_of, fired_at if fired_at is not None else time.time()),
            )
            conn.commit()
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None
    finally:
        conn.close()


def claim_delivery(fire_id: int, *, delivered_at: Optional[float] = None, db_path: str | None = None) -> bool:
    """Atomic compare-and-set delivery lease -- exactly-once delivery per
    fire. True = this call owns the delivery attempt; False = already
    claimed (or previously exhausted -- see release_delivery)."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        result = conn.execute(
            "UPDATE alert_fires SET delivered_at = ?, delivery_attempts = delivery_attempts + 1 "
            "WHERE id = ? AND delivered_at IS NULL",
            (delivered_at if delivered_at is not None else time.time(), fire_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def release_delivery(fire_id: int, *, error: str = "", db_path: str | None = None) -> dict[str, Any]:
    """Inverse compare-and-set -- releases a claimed-but-failed lease so a
    later cycle may retry, up to MAX_DELIVERY_ATTEMPTS. Terminal past that
    bound (never releases again -- the fire stays in the "failed" state
    permanently, visible via list_fires, matching alert_fired_log.py's own
    'never sweep an undelivered/failed row' rule)."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        row = conn.execute(
            "SELECT delivery_attempts FROM alert_fires WHERE id = ? AND delivered_at IS NOT NULL",
            (fire_id,),
        ).fetchone()
        if not row:
            return {"released": False, "terminal": False, "attempts": 0, "found": False}
        attempts = row["delivery_attempts"]
        if attempts >= MAX_DELIVERY_ATTEMPTS:
            conn.execute(
                "UPDATE alert_fires SET delivery_failed_at = ? WHERE id = ?",
                (time.time(), fire_id),
            )
            conn.commit()
            return {"released": False, "terminal": True, "attempts": attempts, "found": True}
        conn.execute(
            "UPDATE alert_fires SET delivered_at = NULL, delivery_failed_at = ? WHERE id = ?",
            (time.time(), fire_id),
        )
        conn.commit()
        return {"released": True, "terminal": False, "attempts": attempts, "found": True}
    finally:
        conn.close()


def record_delivery_channels(fire_id: int, channels: dict[str, str], *, db_path: str | None = None) -> bool:
    if not isinstance(channels, dict):
        return False
    failed = sum(1 for v in channels.values() if v == "failed")
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        conn.execute(
            "UPDATE alert_fires SET delivery_channels = ?, channels_failed = ? WHERE id = ?",
            (json.dumps(channels), failed, fire_id),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def _fire_row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r["id"], "predicate_id": r["predicate_id"], "trigger_type": r["trigger_type"],
        "user_id": r["user_id"], "entity_ref": r["entity_ref"], "fire_key": r["fire_key"],
        "triggering_value": r["triggering_value"],
        "detail": json.loads(r["detail"]) if r["detail"] else None,
        "source_data_class": r["source_data_class"], "freshness_class": r["freshness_class"],
        "as_of": r["as_of"], "fired_at": r["fired_at"], "delivered_at": r["delivered_at"],
        "delivery_attempts": r["delivery_attempts"], "delivery_failed_at": r["delivery_failed_at"],
        "delivery_channels": json.loads(r["delivery_channels"]) if r["delivery_channels"] else None,
        "channels_failed": r["channels_failed"],
        "read_at": r["read_at"] if "read_at" in r.keys() else None,
    }


def list_fires(user_id: str, limit: int = 50, *, db_path: str | None = None) -> list[dict[str, Any]]:
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        rows = conn.execute(
            "SELECT * FROM alert_fires WHERE user_id = ? ORDER BY fired_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_fire_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def fires_for_predicate(predicate_id: str, limit: int = 50, *, db_path: str | None = None) -> list[dict[str, Any]]:
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        rows = conn.execute(
            "SELECT * FROM alert_fires WHERE predicate_id = ? ORDER BY id DESC LIMIT ?",
            (predicate_id, limit),
        ).fetchall()
        return [_fire_row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ── S7 durable in-app notification bridge (owner authorization) ────────────
#
# GET /api/alerts's ephemeral TTLCache does not survive a process restart or
# redeploy (api/services/alerts.py's own docstring). These three functions
# let that endpoint additionally serve a caller's own S7 fires straight from
# THIS already-durable table, so a fire a member was told about stays visible
# after the ephemeral copy is gone -- no new database, no new table.
#
# Ownership is enforced by JOINING through the fire's own predicate
# (alert_predicates.user_id), never by trusting the denormalized
# alert_fires.user_id column alone, even though that column is set correctly
# at fire time -- the predicate's own owner is the authoritative source.

def list_fires_for_feed(user_id: str, limit: int = 50, *, db_path: str | None = None) -> list[dict[str, Any]]:
    """A caller's own fires across every S7 trigger type, newest first."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        rows = conn.execute(
            "SELECT af.* FROM alert_fires af "
            "JOIN alert_predicates ap ON af.predicate_id = ap.id "
            "WHERE ap.user_id = ? "
            "ORDER BY af.fired_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_fire_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def mark_fire_read(fire_id: int, user_id: str, *, read_at: Optional[float] = None, db_path: str | None = None) -> bool:
    """Ownership-scoped, idempotent read-mark. True iff the caller owns a fire
    with this id (whether or not this call is what marked it read) -- a
    second mark-read is a no-op success, never an error or a double-state."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        cur = conn.execute(
            "UPDATE alert_fires SET read_at = COALESCE(read_at, ?) "
            "WHERE id = ? AND predicate_id IN (SELECT id FROM alert_predicates WHERE user_id = ?)",
            (read_at if read_at is not None else time.time(), fire_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def mark_all_fires_read(user_id: str, *, read_at: Optional[float] = None, db_path: str | None = None) -> int:
    """Mark every one of the caller's own currently-unread fires read.
    Returns the count newly marked (mirrors alerts.mark_all_read's contract)."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        cur = conn.execute(
            "UPDATE alert_fires SET read_at = ? "
            "WHERE read_at IS NULL "
            "AND predicate_id IN (SELECT id FROM alert_predicates WHERE user_id = ?)",
            (read_at if read_at is not None else time.time(), user_id),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()
