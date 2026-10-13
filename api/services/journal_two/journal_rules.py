"""'Make this a rule' — the persisted, evidence-linked personal-rule store
(Journal A+ Phase 6, Task P6-5).

A journal rule is a PERSISTENT personal reminder the trader distills from a
psychology insight, a trade review, a coach chat, or types by hand. It is
stored, listed, and dismissed — and surfaced for DISPLAY only.

CRITICAL — suggestion/reminder store ONLY: this module is READ-ONLY to trading
behavior. It does NOT auto-arm any intervention, mutate any discipline
guardrail (interventions.py / discipline.py), or change how a trade is sized,
gated, or fired. There is no firing path here by design — the table has no
per-day `checked` column and no auto-arm columns. A rule is shown, never fired.

CRUD idiom mirrors adherence_store.py: the module owns its connection via
`auth_db.get_connection`; the optional `conn` param lets callers (the router,
tests) pass a live connection — we open/close only when `conn is None`. Every
query is user-scoped.

Conventions:
  - `label` is trimmed, must be non-empty (else `JournalRuleError`), and is
    capped at `_LABEL_MAX` (200) chars — an over-long label is TRUNCATED, not
    rejected, so a long free-form reminder is never lost.
  - `source_type` is coerced to 'manual' when absent/unknown (documented
    choice — a rule is always storable regardless of provenance), else kept
    from {'psychology','review','manual','chat'}.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

_VALID_SOURCE_TYPES = {"psychology", "review", "manual", "chat"}
_LABEL_MAX = 200


class JournalRuleError(ValueError):
    """Raised on invalid rule input (empty/blank label). The router maps it to
    a 400."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """camelCase view of a rule row for the frontend. Deliberately omits
    user_id (internal scoping key, never surfaced).

    Notebook P2 (spec §P2 item 2): `beforeEntry`, `version` and `changedAt`, the
    day the CURRENT version's words were written. With `conn` it is read from the
    version row (rule_versions.current_changed_at), because a later before-entry
    toggle moves updated_at but not the words (R-PF-N4); without one, the fallback
    is updated_at for a changed rule and created_at for v1."""
    out = {
        "id": row["id"],
        "accountId": row["account_id"],
        "label": row["label"],
        "evidence": row["evidence"],
        "sourceType": row["source_type"],
        "sourceId": row["source_id"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    keys = row.keys()
    out["beforeEntry"] = bool(row["before_entry"]) if "before_entry" in keys else False
    out["version"] = int(row["version"]) if "version" in keys and row["version"] is not None else 1
    changed = None
    if conn is not None:
        from api.services.journal_two import rule_versions
        changed = rule_versions.current_changed_at(conn, row)
    if changed is None:
        changed = row["updated_at"] if out["version"] > 1 else row["created_at"]
    out["changedAt"] = changed
    return out


def create_rule(
    user_id: str,
    account_id: str | None,
    label: str,
    evidence: str | None = None,
    source_type: str = "manual",
    source_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict:
    """Insert one active rule and return the camelCase record.

    `label` is trimmed + validated non-empty (raises `JournalRuleError`) +
    capped at 200 chars. `source_type` unknown/absent → 'manual'. Generates a
    uuid id and created_at/updated_at timestamps. status defaults 'active'."""
    clean_label = (label or "").strip()
    if not clean_label:
        raise JournalRuleError("label must be a non-empty string")
    if len(clean_label) > _LABEL_MAX:
        clean_label = clean_label[:_LABEL_MAX]

    st = source_type if source_type in _VALID_SOURCE_TYPES else "manual"
    rule_id = uuid.uuid4().hex
    now = _now_iso()

    own = conn is None
    if own:
        conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_journal_rules "
            "(id, user_id, account_id, label, evidence, source_type, "
            " source_id, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
            (
                rule_id, user_id, account_id, clean_label, evidence,
                st, source_id, now, now,
            ),
        )
        # Notebook P2 (R-P2b-1): the rule's words as made are its v1, in the same commit.
        from api.services.journal_two import rule_versions
        rule_versions.record_v1(conn, user_id, rule_id, clean_label, evidence, now)
        conn.commit()
    finally:
        if own:
            conn.close()

    return {
        "id": rule_id,
        "accountId": account_id,
        "label": clean_label,
        "evidence": evidence,
        "sourceType": st,
        "sourceId": source_id,
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
        "beforeEntry": False,
        "version": 1,
        "changedAt": now,
    }


def list_rules(
    user_id: str,
    account_id: str | None = None,
    status: str | None = "active",
    conn: sqlite3.Connection | None = None,
) -> list[dict]:
    """Rules for a user, filtered by account (when given) + status (when given),
    newest first. rowid DESC is the tiebreak so same-timestamp inserts still
    return in insertion order (newest first)."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        sql = "SELECT * FROM j2_journal_rules WHERE user_id = ?"
        params: list[Any] = [user_id]
        if account_id is not None:
            sql += " AND account_id = ?"
            params.append(account_id)
        if status is not None:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC, rowid DESC"
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_dict(r, conn) for r in rows]
    finally:
        if own:
            conn.close()


def dismiss_rule(
    user_id: str,
    rule_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict | None:
    """Set status='dismissed' + updated_at for (user_id, rule_id). Returns the
    updated camelCase record, or None when the rule doesn't exist / isn't owned
    by the user (no-op)."""
    updated_at = _now_iso()
    own = conn is None
    if own:
        conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_journal_rules SET status = 'dismissed', updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (updated_at, rule_id, user_id),
        )
        if cur.rowcount == 0:
            # Not found or not owned — nothing changed.
            return None
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_journal_rules WHERE id = ? AND user_id = ?",
            (rule_id, user_id),
        ).fetchone()
        return _row_to_dict(row, conn) if row is not None else None
    finally:
        if own:
            conn.close()


def count_active(
    user_id: str,
    account_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Count of active rules for a user, optionally scoped to one account."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        sql = (
            "SELECT COUNT(*) FROM j2_journal_rules "
            "WHERE user_id = ? AND status = 'active'"
        )
        params: list[Any] = [user_id]
        if account_id is not None:
            sql += " AND account_id = ?"
            params.append(account_id)
        return int(conn.execute(sql, params).fetchone()[0])
    finally:
        if own:
            conn.close()
