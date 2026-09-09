"""Trigger-type registration (SPEC-S7 §5.1) -- persisted so the monitor can
answer "what types exist" without every application module having re-run
its registration this boot. Mirrors theme_db.py's hybrid pattern per
SPEC-S7 §9: a cold-start read, refreshed on each app's own
register_trigger_type() call at import time.
"""
from __future__ import annotations

import json
import time
from typing import Any

from api.services.alert_taxonomy import db as _db


def register_trigger_type(type_id: str, params_schema: dict[str, Any], module: str, *, db_path: str | None = None) -> None:
    """Idempotent upsert -- safe to call on every process boot (every owning
    module calls this at import time, the same "definition survives a
    redeploy, registration re-confirms it" shape SPEC-S7 names)."""
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        conn.execute(
            "INSERT INTO alert_trigger_registry (type_id, params_schema, module, registered_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(type_id) DO UPDATE SET params_schema=excluded.params_schema, "
            "module=excluded.module, registered_at=excluded.registered_at",
            (type_id, json.dumps(params_schema), module, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def list_trigger_types(*, db_path: str | None = None) -> list[dict[str, Any]]:
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        rows = conn.execute(
            "SELECT type_id, params_schema, module, registered_at FROM alert_trigger_registry ORDER BY type_id"
        ).fetchall()
        return [
            {"type_id": r["type_id"], "params_schema": json.loads(r["params_schema"]),
             "module": r["module"], "registered_at": r["registered_at"]}
            for r in rows
        ]
    finally:
        conn.close()


def is_registered(type_id: str, *, db_path: str | None = None) -> bool:
    conn = _db.connect(db_path)
    try:
        _db.init_db(conn)
        row = conn.execute(
            "SELECT 1 FROM alert_trigger_registry WHERE type_id = ?", (type_id,)
        ).fetchone()
        return row is not None
    finally:
        conn.close()
