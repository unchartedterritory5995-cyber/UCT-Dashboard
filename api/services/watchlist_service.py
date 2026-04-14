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
            "SELECT * FROM watchlists WHERE user_id = ? AND (is_flagged_list = 0 OR is_flagged_list IS NULL) ORDER BY updated_at DESC",
            (user_id,),
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
        row = conn.execute("SELECT is_flagged_list FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if row and row["is_flagged_list"]:
            return False  # Cannot delete the flagged shadow list
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
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM watchlist_items WHERE watchlist_id = ?", (wl_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO watchlist_items (id, watchlist_id, sym, notes, sort_order) VALUES (?,?,?,?,?)",
            (item_id, wl_id, sym.upper(), notes, max_order + 1),
        )
        conn.execute(
            "UPDATE watchlists SET updated_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), wl_id),
        )
        conn.commit()
        return {"id": item_id, "watchlist_id": wl_id, "sym": sym.upper(), "notes": notes}
    finally:
        conn.close()


def bulk_add_items(user_id: str, wl_id: str, symbols: list[str]) -> dict | None:
    """Add multiple tickers to a watchlist, skipping duplicates."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return None
        existing = {r["sym"] for r in _get_items(conn, wl_id)}
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM watchlist_items WHERE watchlist_id = ?", (wl_id,)
        ).fetchone()[0]
        added = 0
        for sym in symbols:
            s = sym.strip().upper()
            if not s or s in existing:
                continue
            item_id = str(uuid.uuid4())[:12]
            max_order += 1
            conn.execute(
                "INSERT INTO watchlist_items (id, watchlist_id, sym, notes, sort_order) VALUES (?,?,?,?,?)",
                (item_id, wl_id, s, "", max_order),
            )
            existing.add(s)
            added += 1
        if added:
            conn.execute(
                "UPDATE watchlists SET updated_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), wl_id),
            )
            conn.commit()
        return {"added": added, "watchlist": get_watchlist(wl_id, user_id)}
    finally:
        conn.close()


def update_item_notes(user_id: str, wl_id: str, item_id: str, notes: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return None
        conn.execute("UPDATE watchlist_items SET notes = ? WHERE id = ? AND watchlist_id = ?", (notes, item_id, wl_id))
        conn.commit()
        item = conn.execute("SELECT * FROM watchlist_items WHERE id = ?", (item_id,)).fetchone()
        return dict(item) if item else None
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


def get_or_create_flagged_list(user_id: str) -> dict:
    """Return the user's flagged shadow watchlist, creating it if needed."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? AND is_flagged_list = 1", (user_id,)
        ).fetchone()
        if row:
            wl = dict(row)
            wl["items"] = _get_items(conn, wl["id"])
            wl["owner_name"] = _get_display_name(conn, user_id)
            return wl
        # Create shadow
        wl_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        display_name = _get_display_name(conn, user_id)
        conn.execute(
            "INSERT INTO watchlists (id, user_id, name, description, is_public, is_flagged_list, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (wl_id, user_id, f"Flagged ({display_name})", "", 0, 1, now, now),
        )
        conn.commit()
        return {"id": wl_id, "user_id": user_id, "name": f"Flagged ({display_name})", "description": "",
                "is_public": 0, "is_flagged_list": 1, "created_at": now, "updated_at": now,
                "items": [], "owner_name": display_name}
    finally:
        conn.close()


def sync_flagged_items(user_id: str, symbols: list[str]) -> dict:
    """Full-replace sync: make the shadow watchlist match the given symbols list."""
    # Ensure shadow exists first (uses its own connection)
    get_or_create_flagged_list(user_id)
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? AND is_flagged_list = 1", (user_id,)
        ).fetchone()
        if not row:
            return {"items": []}
        wl_id = row["id"]

        # Diff
        current_items = _get_items(conn, wl_id)
        server_syms = {item["sym"] for item in current_items}
        client_syms = {s.upper() for s in symbols}

        # Batch remove stale
        to_delete = [(item["id"],) for item in current_items if item["sym"] not in client_syms]
        if to_delete:
            conn.executemany("DELETE FROM watchlist_items WHERE id = ?", to_delete)

        # Batch add missing
        to_add = [(str(uuid.uuid4())[:12], wl_id, sym, "") for sym in client_syms - server_syms]
        if to_add:
            conn.executemany(
                "INSERT INTO watchlist_items (id, watchlist_id, sym, notes) VALUES (?,?,?,?)", to_add
            )

        now = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE watchlists SET updated_at = ? WHERE id = ?", (now, wl_id))
        conn.commit()
        display_name = _get_display_name(conn, user_id)
        wl = dict(row)
        wl["updated_at"] = now
        wl["items"] = _get_items(conn, wl_id)
        wl["owner_name"] = display_name
        return wl
    finally:
        conn.close()


def rename_flagged_list(user_id: str, name: str) -> dict | None:
    """Rename the user's flagged shadow watchlist."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? AND is_flagged_list = 1", (user_id,)
        ).fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE watchlists SET name = ?, updated_at = ? WHERE id = ?",
            (name, now, row["id"]),
        )
        conn.commit()
        wl = dict(row)
        wl["name"] = name
        wl["updated_at"] = now
        wl["items"] = _get_items(conn, row["id"])
        wl["owner_name"] = _get_display_name(conn, user_id)
        return wl
    finally:
        conn.close()


def toggle_flagged_sharing(user_id: str, is_public: bool) -> dict | None:
    """Set the flagged shadow watchlist's public visibility."""
    get_or_create_flagged_list(user_id)
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? AND is_flagged_list = 1", (user_id,)
        ).fetchone()
        if not row:
            return None
        wl_id = row["id"]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE watchlists SET is_public = ?, updated_at = ? WHERE id = ?",
            (int(is_public), now, wl_id),
        )
        conn.commit()
        wl = dict(row)
        wl["is_public"] = int(is_public)
        wl["updated_at"] = now
        wl["items"] = _get_items(conn, wl_id)
        wl["owner_name"] = _get_display_name(conn, user_id)
        return wl
    finally:
        conn.close()


def reorder_items(user_id: str, wl_id: str, item_ids: list[str]) -> bool:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return False
        for idx, item_id in enumerate(item_ids):
            conn.execute(
                "UPDATE watchlist_items SET sort_order = ? WHERE id = ? AND watchlist_id = ?",
                (idx, item_id, wl_id),
            )
        conn.commit()
        return True
    finally:
        conn.close()


def _get_items(conn, wl_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY sort_order ASC, added_at DESC", (wl_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def _get_display_name(conn, user_id: str) -> str:
    row = conn.execute("SELECT display_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return "Unknown"
    return row["display_name"] or row["email"].split("@")[0]
