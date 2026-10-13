"""Rule versions (Notebook P2 Tier 1, spec §P2 item 2; R-P2b-1, R-P2b-2).

A version is recorded when a rule's WORDS change (label or evidence); v1 when it is made. Marking a rule
"before entry" changes where it shows, not what it says, and records no version. ⛔ Rules are not notes:
nothing here touches j2_notes. Every query is scoped by user_id.

A wrong type in a patch is a RuleEditError (the route's 400, R-PF-N5), never a silent coercion: a string
"true" for beforeEntry would otherwise turn the switch OFF, and a non-text label would be a 500.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

_LABEL_MAX = 200
_NOTE_MAX = 500

#: The 400 sentence for a blank label (the client's rulesApi.editRule shows it as written).
BLANK_LABEL_SENTENCE = "A rule needs words."


class RuleEditError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rule_row(conn: sqlite3.Connection, user_id: str, rule_id: str):
    return conn.execute("SELECT * FROM j2_journal_rules WHERE id = ? AND user_id = ?", (rule_id, user_id)).fetchone()


def _ensure_v1(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """R-P2b-2: a rule made before this release gets its v1, dated its creation."""
    conn.execute("INSERT OR IGNORE INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                 " changed_at, change_note) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)",
                 (uuid.uuid4().hex, row["user_id"], row["id"], row["label"], row["evidence"], row["created_at"]))


def record_v1(conn: sqlite3.Connection, user_id: str, rule_id: str, label: str, evidence: str | None, at: str) -> None:
    conn.execute("INSERT OR IGNORE INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                 " changed_at, change_note) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)",
                 (uuid.uuid4().hex, user_id, rule_id, label, evidence, at))


def current_changed_at(conn: sqlite3.Connection, row: sqlite3.Row) -> str | None:
    """The CURRENT version's changed_at, read from its version row (R-PF-N4): a later before-entry
    toggle moves the rule's updated_at, never the day its words changed. None when the row is absent
    (a rule from before this release whose v1 has not been written yet)."""
    keys = row.keys()
    version = int(row["version"]) if "version" in keys and row["version"] is not None else 1
    got = conn.execute("SELECT changed_at FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                       " AND version = ?", (row["user_id"], row["id"], version)).fetchone()
    return got[0] if got is not None else None


def list_versions(user_id: str, rule_id: str, conn: sqlite3.Connection | None = None) -> list[dict] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _rule_row(conn, user_id, rule_id)
        if row is None:
            return None
        _ensure_v1(conn, row)
        conn.commit()
        rows = conn.execute("SELECT * FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                            " ORDER BY version DESC", (user_id, rule_id)).fetchall()
        return [{"version": r["version"], "label": r["label"], "evidence": r["evidence"],
                 "changedAt": r["changed_at"], "changeNote": r["change_note"]} for r in rows]
    finally:
        if owned:
            conn.close()


def _check_types(patch: dict[str, Any]) -> None:
    """R-PF-N5: 400 on wrong types, before any lock is taken or any row read."""
    if not isinstance(patch, dict):
        raise RuleEditError("Send a JSON object")
    if "label" in patch and not isinstance(patch["label"], str):
        raise RuleEditError("label must be text")
    if "evidence" in patch and patch["evidence"] is not None and not isinstance(patch["evidence"], str):
        raise RuleEditError("evidence must be text")
    if "changeNote" in patch and patch["changeNote"] is not None and not isinstance(patch["changeNote"], str):
        raise RuleEditError("changeNote must be text")
    if "beforeEntry" in patch and not isinstance(patch["beforeEntry"], bool):
        raise RuleEditError("beforeEntry must be true or false")


def edit_rule(user_id: str, rule_id: str, patch: dict[str, Any], conn: sqlite3.Connection | None = None) -> dict | None:
    from api.services.journal_two import journal_rules
    from api.services.journal_two import notes as notes_service
    _check_types(patch)
    owned = conn is None
    conn = conn or get_connection()
    try:
        notes_service._begin_immediate(conn)
        row = _rule_row(conn, user_id, rule_id)
        if row is None:
            conn.rollback()
            return None
        _ensure_v1(conn, row)
        label, evidence = row["label"], row["evidence"]
        if "label" in patch:
            label = patch["label"].strip()
            if not label:
                raise RuleEditError(BLANK_LABEL_SENTENCE)
            label = label[:_LABEL_MAX]
        if "evidence" in patch:
            evidence = patch["evidence"]
        now = _now()
        sets, params = ["updated_at = ?"], [now]
        if (label, evidence) != (row["label"], row["evidence"]):
            version = int(row["version"] or 1) + 1
            note = patch.get("changeNote")
            conn.execute("INSERT INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                         " changed_at, change_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         (uuid.uuid4().hex, user_id, rule_id, version, label, evidence, now,
                          (note or "").strip()[:_NOTE_MAX] or None))
            sets += ["label = ?", "evidence = ?", "version = ?"]
            params += [label, evidence, version]
        if "beforeEntry" in patch:
            sets.append("before_entry = ?")
            params.append(1 if patch["beforeEntry"] else 0)
        conn.execute(f"UPDATE j2_journal_rules SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                     (*params, rule_id, user_id))
        conn.commit()
        return journal_rules._row_to_dict(_rule_row(conn, user_id, rule_id), conn)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
