"""Raw broker-activity ledger.

Every SnapTrade activity is stored here exactly once (deduped by its
external id). This ledger is the source-of-record: reconstruction always
runs over the FULL ledger for an account (FIFO needs complete buy history
to match a sell), and idempotent trade fingerprints prevent duplicates.

Keeping the raw payload also lets us reprocess history later when option /
corporate-action handling improves, without re-fetching from the broker.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import snaptrade_adapter as adapter


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def store_activities(
    user_id: str,
    broker_account_id: str,
    raw_activities: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, int]:
    """Insert new activities, skipping any whose external id we've already
    stored. Returns {"new": n, "dup": m, "invalid": k}."""
    owned = conn is None
    conn = conn or get_connection()
    new = dup = invalid = 0
    try:
        conn.execute("BEGIN")
        for act in raw_activities:
            if not isinstance(act, dict) or not act.get("id"):
                invalid += 1
                continue
            ext = str(act["id"])
            exists = conn.execute(
                "SELECT 1 FROM j2_broker_activities WHERE user_id = ? AND external_id = ?",
                (user_id, ext),
            ).fetchone()
            if exists:
                dup += 1
                continue
            conn.execute(
                """
                INSERT INTO j2_broker_activities
                    (id, user_id, broker_account_id, external_id, activity_type,
                     symbol, occurred_at, raw_json, processed, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    str(uuid.uuid4()), user_id, broker_account_id, ext,
                    str(act.get("type") or ""),
                    adapter.extract_symbol(act),
                    adapter.normalize_date(act),
                    json.dumps(act),
                    _now_iso(),
                ),
            )
            new += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"new": new, "dup": dup, "invalid": invalid}


def get_activities(
    user_id: str,
    broker_account_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict]:
    """All stored raw activities for an account, oldest first (the order
    reconstruction expects). occurred_at NULLs sort last via created_at."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT raw_json FROM j2_broker_activities
             WHERE user_id = ? AND broker_account_id = ?
             ORDER BY (occurred_at IS NULL), occurred_at ASC, created_at ASC
            """,
            (user_id, broker_account_id),
        ).fetchall()
        out = []
        for r in rows:
            try:
                out.append(json.loads(r["raw_json"]))
            except (TypeError, json.JSONDecodeError):
                continue
        return out
    finally:
        if owned:
            conn.close()


def latest_occurred_at(
    user_id: str,
    broker_account_id: str,
    conn: sqlite3.Connection | None = None,
) -> str | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT MAX(occurred_at) AS m FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ?",
            (user_id, broker_account_id),
        ).fetchone()
        return row["m"] if row else None
    finally:
        if owned:
            conn.close()


def count(user_id: str, broker_account_id: str, conn: sqlite3.Connection | None = None) -> int:
    owned = conn is None
    conn = conn or get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ?",
            (user_id, broker_account_id),
        ).fetchone()["n"]
    finally:
        if owned:
            conn.close()
