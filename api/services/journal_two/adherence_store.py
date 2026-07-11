"""Per-closed-trade rule adherence — persistence for the j2_trade_adherence
side table (Journal A+ Phase 5, Task A3).

Adherence records WHICH of a setup's rules (the per-setup checklist template
authored in P5-A2 → j2_accounts.setup_rules) the trader actually followed on a
given closed trade. It is persisted keyed on the STABLE `trade_ref`
(`ext:<external_id>` for broker rows, `id:<row id>` for manual — see
trade_refs.py), NOT the raw external_id (NULL for every manual trade). This
mirrors P1b's j2_trade_attachments and P2's j2_trade_excursions keying so a
stored record survives the broker purge+reinsert cycle that reissues j2_trades
uuids on every full resync.

CRUD idiom mirrors excursions_store.py: the module owns its connection via
`auth_db.get_connection`; the optional `conn` param lets callers (the A5
playbook-stats join, the router, tests) pass a live connection — we open/close
only when `conn is None`. Composite PK (user_id, trade_ref) makes INSERT OR
REPLACE naturally idempotent.

`adherence_pct` convention: min(len(checked_rule_ids) / total_rules, 1.0) when
total_rules > 0, else 0.0 (never None, so downstream aggregation never has to
special-case a divide-by-zero record; clamped to <= 1.0 so an over-long checked
list can never store > 100%).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """camelCase view of an adherence row for the frontend + analytics join."""
    raw = row["checked_rule_ids"]
    try:
        checked = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        checked = []
    return {
        "tradeRef": row["trade_ref"],
        "setup": row["setup"],
        "checkedRuleIds": checked,
        "totalRules": row["total_rules"],
        "adherencePct": row["adherence_pct"],
        "updatedAt": row["updated_at"],
    }


def upsert_adherence(
    user_id: str,
    trade_ref: str,
    setup: str | None,
    checked_rule_ids: list[str],
    total_rules: int,
    conn: sqlite3.Connection | None = None,
) -> dict:
    """INSERT OR REPLACE one adherence row and return the camelCase record.

    `adherence_pct` = min(len(checked_rule_ids) / total_rules, 1.0) when
    total_rules > 0, else 0.0 (no divide error; clamped so an over-long checked
    list can't store > 1.0). `checked_rule_ids` is stored as a JSON array.
    Stamps updated_at."""
    checked = list(checked_rule_ids or [])
    total = int(total_rules or 0)
    # Clamp to <= 1.0: a client posting more checkedRuleIds than totalRules must
    # never store adherence_pct > 1.0 (would corrupt the mean in playbook_stats).
    pct = min(len(checked) / total, 1.0) if total > 0 else 0.0
    updated_at = _now_iso()

    own = conn is None
    if own:
        conn = get_connection()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO j2_trade_adherence "
            "(user_id, trade_ref, setup, checked_rule_ids, total_rules, "
            "adherence_pct, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                trade_ref,
                setup,
                json.dumps(checked),
                total,
                pct,
                updated_at,
            ),
        )
        conn.commit()
    finally:
        if own:
            conn.close()

    return {
        "tradeRef": trade_ref,
        "setup": setup,
        "checkedRuleIds": checked,
        "totalRules": total,
        "adherencePct": pct,
        "updatedAt": updated_at,
    }


def get_adherence(
    user_id: str, trade_ref: str, conn: sqlite3.Connection | None = None,
) -> dict | None:
    """Return the camelCase adherence dict for one (user, trade_ref), or None."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_trade_adherence WHERE user_id = ? AND trade_ref = ?",
            (user_id, trade_ref),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None
    finally:
        if own:
            conn.close()


def list_adherence_for_user(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, dict]:
    """trade_ref → camelCase adherence dict, for the A5 playbook-stats join."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_trade_adherence WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {r["trade_ref"]: _row_to_dict(r) for r in rows}
    finally:
        if own:
            conn.close()


def existing_refs(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> set[str]:
    """Set of trade_refs that already have an adherence record — the idempotency
    skip mirror of excursions_store.existing_refs."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT trade_ref FROM j2_trade_adherence WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {r["trade_ref"] for r in rows}
    finally:
        if own:
            conn.close()
