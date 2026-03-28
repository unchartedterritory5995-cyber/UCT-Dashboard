"""
Playbook service — CRUD for trade setup definitions with denormalized stats.
Stats (trade_count, win_rate, avg_r) are recomputed from linked journal_entries
whenever trades are linked/unlinked.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


_TEXT_FIELDS = [
    "name", "description", "market_condition", "trigger_criteria",
    "invalidations", "entry_model", "exit_model", "sizing_rules",
    "common_mistakes", "best_practices", "ideal_time", "ideal_volatility",
]

_WRITABLE_FIELDS = set(_TEXT_FIELDS) | {"is_active"}


def list_playbooks(user_id: str) -> list[dict]:
    """List all playbooks for a user, active first, then by name."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM playbooks WHERE user_id = ? ORDER BY is_active DESC, name",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_playbook(user_id: str, playbook_id: str) -> dict | None:
    """Get a single playbook by ID."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM playbooks WHERE id = ? AND user_id = ?",
            (playbook_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_playbook(user_id: str, data: dict) -> dict:
    """Create a new playbook."""
    pb_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        vals = {f: (data.get(f) or "")[:5000] for f in _TEXT_FIELDS}
        vals["name"] = vals["name"][:200] or "Untitled Playbook"
        cols = list(vals.keys()) + ["id", "user_id", "created_at", "updated_at"]
        all_vals = list(vals.values()) + [pb_id, user_id, now, now]
        placeholders = ",".join(["?"] * len(cols))
        conn.execute(
            f"INSERT INTO playbooks ({','.join(cols)}) VALUES ({placeholders})",
            all_vals,
        )
        conn.commit()
        return get_playbook(user_id, pb_id)
    finally:
        conn.close()


def update_playbook(user_id: str, playbook_id: str, data: dict) -> dict | None:
    """Update a playbook's editable fields."""
    existing = get_playbook(user_id, playbook_id)
    if not existing:
        return None

    updates = {k: v for k, v in data.items() if k in _WRITABLE_FIELDS}
    if not updates:
        return existing

    # Truncate text fields
    for f in _TEXT_FIELDS:
        if f in updates and isinstance(updates[f], str):
            updates[f] = updates[f][:5000]
    if "name" in updates:
        updates["name"] = (updates["name"] or "Untitled Playbook")[:200]

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [playbook_id, user_id]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE playbooks SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        return get_playbook(user_id, playbook_id)
    finally:
        conn.close()


def delete_playbook(user_id: str, playbook_id: str) -> bool:
    """Delete a playbook and unlink all associated trades."""
    conn = get_connection()
    try:
        # Clear playbook_id from linked trades
        conn.execute(
            "UPDATE journal_entries SET playbook_id = NULL WHERE playbook_id = ? AND user_id = ?",
            (playbook_id, user_id),
        )
        result = conn.execute(
            "DELETE FROM playbooks WHERE id = ? AND user_id = ?",
            (playbook_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def get_playbook_trades(user_id: str, playbook_id: str) -> list[dict]:
    """Get all trades linked to a playbook."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, sym, direction, entry_date, pnl_pct, realized_r,
                      process_score, review_status, status
               FROM journal_entries WHERE user_id = ? AND playbook_id = ?
               ORDER BY entry_date DESC""",
            (user_id, playbook_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def recompute_playbook_stats(user_id: str, playbook_id: str):
    """Recompute denormalized stats on a playbook from its linked trades.

    Called whenever a trade is linked/unlinked from a playbook (on journal
    entry create/update/delete when playbook_id changes).
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT pnl_pct, realized_r FROM journal_entries
               WHERE user_id = ? AND playbook_id = ? AND status = 'closed'""",
            (user_id, playbook_id),
        ).fetchall()
        trades = [dict(r) for r in rows]

        count = len(trades)
        if count == 0:
            conn.execute(
                "UPDATE playbooks SET trade_count = 0, win_rate = NULL, avg_r = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
                (datetime.now(timezone.utc).isoformat(), playbook_id, user_id),
            )
            conn.commit()
            return

        with_pnl = [t for t in trades if t.get("pnl_pct") is not None]
        wins = [t for t in with_pnl if t["pnl_pct"] > 0]
        wr = round(len(wins) / len(with_pnl) * 100, 1) if with_pnl else None

        with_r = [t for t in with_pnl if t.get("realized_r") is not None]
        avg_r = round(sum(t["realized_r"] for t in with_r) / len(with_r), 2) if with_r else None

        conn.execute(
            "UPDATE playbooks SET trade_count = ?, win_rate = ?, avg_r = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (count, wr, avg_r, datetime.now(timezone.utc).isoformat(), playbook_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()
