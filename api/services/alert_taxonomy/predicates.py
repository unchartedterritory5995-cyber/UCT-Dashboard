"""Predicate registration + lifecycle (SPEC-S7 §5.2).

Entity resolution (readiness-review correction, preserved per the owner's
explicit instruction): SPEC-S7 §8 was written before S3 (Entity Master)
existed and designed `entity_scope.id` as an interim raw ticker string. S3
is now real -- `resolve_entity_scope()` below resolves through it, storing
a resolved entity_id when available and falling back to the raw symbol
(honestly reported) when it isn't. The `entity_scope` SHAPE itself
(`{kind, id, asOf}`) is unchanged from SPEC's own design, so no predicate
needs reshaping later -- only the value inside `id` improves.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import registry as _registry
from api.services.research.entity_resolution import resolve_entity


class PredicateRegistrationError(ValueError):
    """A named, synchronous registration failure (SPEC §5.2/§9's "rejected
    synchronously with a named reason -- never silently accepted")."""


def resolve_entity_scope(alias: str, *, vendor: str | None = None, as_of: str | None = None) -> dict[str, Any]:
    """SPEC-S7 §5.2's `entity_scope` shape (`{kind, id, asOf}`), built from a
    real S3 resolution rather than SPEC §8's now-obsolete "raw ticker,
    validated against cap_universe.json" interim plan. `id` holds the
    resolved entity_id when Entity Master knows this symbol, or the
    uppercased raw symbol when it doesn't -- both are valid, honestly
    reported outcomes (`entity_status` records which)."""
    entity_info, effective_symbol = resolve_entity(alias, vendor=vendor)
    scope_id = entity_info["entityId"] if entity_info["status"] == "resolved" else effective_symbol
    return {
        "kind": "entity",
        "id": scope_id,
        "asOf": as_of,
        "entity_status": entity_info["status"],   # additive to SPEC's {kind,id,asOf} -- not a
                                                    # reshape, just carries the honest resolution
                                                    # fact alongside it for registration-time UI/API use
        "symbol": effective_symbol,                # the vendor-effective symbol actually used
    }


def register_predicate(
    type_id: str,
    entity_scope: dict[str, Any],
    params: dict[str, Any],
    user_id: str,
    channels: Optional[list[str]] = None,
    *,
    db_path: str | None = None,
) -> str:
    """Register a predicate. Raises PredicateRegistrationError (never a bare
    exception) on a named validation failure -- SPEC §5.2/§9's synchronous,
    named-reason rejection requirement."""
    if not type_id or not isinstance(type_id, str):
        raise PredicateRegistrationError("type_id is required")
    if not _registry.is_registered(type_id, db_path=db_path):
        raise PredicateRegistrationError(f"unregistered trigger type: {type_id!r}")
    if not user_id or not isinstance(user_id, str):
        raise PredicateRegistrationError("user_id is required")
    if not isinstance(entity_scope, dict) or not entity_scope.get("id"):
        raise PredicateRegistrationError("entity_scope.id is required")
    if not isinstance(params, dict):
        raise PredicateRegistrationError("params must be an object")

    predicate_id = f"pred_{uuid.uuid4().hex[:16]}"
    now = time.time()
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        conn.execute(
            "INSERT INTO alert_predicates "
            "(id, type_id, user_id, entity_scope, params, channels, created_at, updated_at, "
            "suspended_at, last_seen_state) VALUES (?,?,?,?,?,?,?,?,NULL,NULL)",
            (predicate_id, type_id, user_id, json.dumps(entity_scope), json.dumps(params),
             json.dumps(channels) if channels else None, now, now),
        )
        conn.commit()
    finally:
        conn.close()
    return predicate_id


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r["id"], "type_id": r["type_id"], "user_id": r["user_id"],
        "entity_scope": json.loads(r["entity_scope"]), "params": json.loads(r["params"]),
        "channels": json.loads(r["channels"]) if r["channels"] else None,
        "created_at": r["created_at"], "updated_at": r["updated_at"],
        "suspended_at": r["suspended_at"],
        "last_seen_state": json.loads(r["last_seen_state"]) if r["last_seen_state"] else None,
    }


def list_predicates(*, type_id: str | None = None, user_id: str | None = None,
                    active_only: bool = True, db_path: str | None = None) -> list[dict[str, Any]]:
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        q = "SELECT * FROM alert_predicates WHERE 1=1"
        params: list[Any] = []
        if type_id:
            q += " AND type_id = ?"
            params.append(type_id)
        if user_id:
            q += " AND user_id = ?"
            params.append(user_id)
        if active_only:
            q += " AND suspended_at IS NULL"
        q += " ORDER BY created_at DESC"
        rows = conn.execute(q, params).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_predicate(predicate_id: str, *, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        row = conn.execute("SELECT * FROM alert_predicates WHERE id = ?", (predicate_id,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def suspend_predicate(predicate_id: str, user_id: str, *, db_path: str | None = None) -> bool:
    """Suspend, never delete (PRD §8). Ownership-scoped -- a member can only
    suspend their own predicate. Returns True iff a row was actually
    suspended (idempotent: suspending an already-suspended predicate returns
    False, matching delete_alert's own rowcount-based contract)."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        result = conn.execute(
            "UPDATE alert_predicates SET suspended_at = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ? AND suspended_at IS NULL",
            (time.time(), time.time(), predicate_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def update_last_seen_state(predicate_id: str, state: dict[str, Any] | None, *, db_path: str | None = None) -> None:
    """The evaluator's own watermark write (SPEC §12: "stored on the
    alert_predicates row"). Never raises on a missing predicate_id -- a
    predicate deleted/suspended mid-cycle is not this function's problem to
    surface."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        conn.execute(
            "UPDATE alert_predicates SET last_seen_state = ?, updated_at = ? WHERE id = ?",
            (json.dumps(state) if state is not None else None, time.time(), predicate_id),
        )
        conn.commit()
    finally:
        conn.close()
