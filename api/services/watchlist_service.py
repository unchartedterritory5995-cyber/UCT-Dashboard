"""
Watchlist service — user-created watchlists with optional public sharing.
All data in auth.db (watchlists + watchlist_items tables).
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def create_watchlist(user_id: str, name: str, description: str = "", is_public: bool = False) -> dict:
    wl_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO watchlists (id, user_id, name, description, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (wl_id, user_id, name, description, int(is_public), now, now),
        )
        conn.commit()
        return get_watchlist(wl_id, user_id)
    finally:
        conn.close()


def get_watchlist(wl_id: str, user_id: str = None) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM watchlists WHERE id = ?", (wl_id,)).fetchone()
        if not row:
            return None
        wl = dict(row)
        # Only owner or public lists are visible
        if user_id and wl["user_id"] != user_id and not wl["is_public"]:
            return None
        wl["items"] = _get_items(conn, wl_id)
        wl["owner_name"] = _get_display_name(conn, wl["user_id"])
        return wl
    finally:
        conn.close()


def list_user_watchlists(user_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? ORDER BY updated_at DESC", (user_id,)
        ).fetchall()
        results = []
        for r in rows:
            wl = dict(r)
            wl["items"] = _get_items(conn, wl["id"])
            wl["item_count"] = len(wl["items"])
            results.append(wl)
        return results
    finally:
        conn.close()


def list_public_watchlists(limit: int = 50) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE is_public = 1 ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        results = []
        for r in rows:
            wl = dict(r)
            wl["items"] = _get_items(conn, wl["id"])
            wl["item_count"] = len(wl["items"])
            wl["owner_name"] = _get_display_name(conn, wl["user_id"])
            results.append(wl)
        return results
    finally:
        conn.close()


def update_watchlist(user_id: str, wl_id: str, data: dict) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return None
        allowed = {"name", "description", "is_public"}
        updates = {k: v for k, v in data.items() if k in allowed}
        if "is_public" in updates:
            updates["is_public"] = int(updates["is_public"])
        if not updates:
            return get_watchlist(wl_id, user_id)
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [wl_id, user_id]
        conn.execute(f"UPDATE watchlists SET {set_clause} WHERE id = ? AND user_id = ?", values)
        conn.commit()
        return get_watchlist(wl_id, user_id)
    finally:
        conn.close()


def delete_watchlist(user_id: str, wl_id: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute("DELETE FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id))
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def add_item(user_id: str, wl_id: str, sym: str, notes: str = "") -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return None
        item_id = str(uuid.uuid4())[:12]
        conn.execute(
            "INSERT INTO watchlist_items (id, watchlist_id, sym, notes) VALUES (?,?,?,?)",
            (item_id, wl_id, sym.upper(), notes),
        )
        conn.execute(
            "UPDATE watchlists SET updated_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), wl_id),
        )
        conn.commit()
        return {"id": item_id, "watchlist_id": wl_id, "sym": sym.upper(), "notes": notes}
    finally:
        conn.close()


def remove_item(user_id: str, wl_id: str, item_id: str) -> bool:
    conn = get_connection()
    try:
        # Verify ownership
        row = conn.execute("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return False
        result = conn.execute("DELETE FROM watchlist_items WHERE id = ? AND watchlist_id = ?", (item_id, wl_id))
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def _get_items(conn, wl_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at DESC", (wl_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def _get_display_name(conn, user_id: str) -> str:
    row = conn.execute("SELECT display_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return "Unknown"
    return row["display_name"] or row["email"].split("@")[0]
