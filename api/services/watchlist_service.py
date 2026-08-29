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


def list_user_watchlists(user_id: str, include_items: bool = True) -> list[dict]:
    """The user's lists. `include_items=False` returns metadata + item_count only.

    ⚠️ `include_items` defaults to True so every existing caller is byte-identical.
    Pass False ONLY from a surface that renders list NAMES and never reads `items`.

    Why it exists: `GlobalAddPositionProvider` is mounted app-wide, so this endpoint
    is on the app-shell path of EVERY page — and it was shipping every symbol of
    every list to draw an "＋ Add to watchlist" menu of names. On the owner's account
    that is 33 lists / 4,406 rows / 553 KB per page load (the prebuilt index lists —
    Russell 2000 alone is 1,921 symbols — are owned by the admin user, so they come
    back as "his" lists). Measured 2.5-7.6 s on prod 2026-08-29.

    `item_count` is preserved in BOTH modes and stays derived from the same rows the
    response describes — a slim row must never carry a count the full row wouldn't.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? AND (is_flagged_list = 0 OR is_flagged_list IS NULL) ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        results = [dict(r) for r in rows]
        ids = [wl["id"] for wl in results]
        if include_items:
            items_by_list = _get_items_bulk(conn, ids)
            for wl in results:
                wl["items"] = items_by_list.get(wl["id"], [])
                wl["item_count"] = len(wl["items"])
        else:
            counts = _get_item_counts_bulk(conn, ids)
            for wl in results:
                wl["item_count"] = counts.get(wl["id"], 0)
        return results
    finally:
        conn.close()


def list_public_watchlists(limit: int = 50) -> list[dict]:
    """Community lists: public, but NOT the admin-curated prebuilt ones (those get
    their own tab via list_prebuilt_watchlists)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE is_public = 1 AND (is_prebuilt = 0 OR is_prebuilt IS NULL) "
            "ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        results = [dict(r) for r in rows]
        items_by_list = _get_items_bulk(conn, [wl["id"] for wl in results])
        names_by_user = _get_display_names_bulk(conn, [wl["user_id"] for wl in results])
        for wl in results:
            wl["items"] = items_by_list.get(wl["id"], [])
            wl["item_count"] = len(wl["items"])
            wl["owner_name"] = names_by_user.get(wl["user_id"], "Unknown")
        return results
    finally:
        conn.close()


def list_prebuilt_watchlists(limit: int = 50) -> list[dict]:
    """Admin-curated UCT watchlists shown in the picker's Prebuilt tab. Flagged with
    is_prebuilt = 1 (and kept is_public = 1 so they open via the community: key)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE is_prebuilt = 1 ORDER BY name ASC LIMIT ?", (limit,)
        ).fetchall()
        results = [dict(r) for r in rows]
        items_by_list = _get_items_bulk(conn, [wl["id"] for wl in results])
        names_by_user = _get_display_names_bulk(conn, [wl["user_id"] for wl in results])
        for wl in results:
            wl["items"] = items_by_list.get(wl["id"], [])
            wl["item_count"] = len(wl["items"])
            wl["owner_name"] = names_by_user.get(wl["user_id"], "Unknown")
        return results
    finally:
        conn.close()


def update_watchlist(user_id: str, wl_id: str, data: dict) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)).fetchone()
        if not row:
            return None
        allowed = {"name", "description", "is_public", "is_prebuilt"}
        updates = {k: v for k, v in data.items() if k in allowed}
        if "is_public" in updates:
            updates["is_public"] = int(updates["is_public"])
        if "is_prebuilt" in updates:
            updates["is_prebuilt"] = int(updates["is_prebuilt"])
            # A prebuilt list must be publicly readable so every user can open it.
            if updates["is_prebuilt"]:
                updates["is_public"] = 1
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
        sym_u = sym.strip().upper()
        # Idempotent per (watchlist, sym) — the quick-add bar and the per-list "+"
        # make a repeat add one keystroke away, and bulk_add_items already skips
        # duplicates. Return the row that exists rather than inserting a second
        # one; never overwrite notes the user already wrote on it.
        existing = conn.execute(
            "SELECT id, notes FROM watchlist_items WHERE watchlist_id = ? AND sym = ?", (wl_id, sym_u)
        ).fetchone()
        if existing:
            return {"id": existing["id"], "watchlist_id": wl_id, "sym": sym_u,
                    "notes": existing["notes"] or "", "duplicate": True}
        item_id = str(uuid.uuid4())[:12]
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM watchlist_items WHERE watchlist_id = ?", (wl_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO watchlist_items (id, watchlist_id, sym, notes, sort_order) VALUES (?,?,?,?,?)",
            (item_id, wl_id, sym_u, notes, max_order + 1),
        )
        conn.execute(
            "UPDATE watchlists SET updated_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), wl_id),
        )
        conn.commit()
        return {"id": item_id, "watchlist_id": wl_id, "sym": sym_u, "notes": notes, "duplicate": False}
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
            (wl_id, user_id, "Flagged", "", 0, 1, now, now),
        )
        conn.commit()
        return {"id": wl_id, "user_id": user_id, "name": "Flagged", "description": "",
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


# Chunked so a caller with many lists can never build a statement past SQLite's
# variable ceiling (SQLITE_MAX_VARIABLE_NUMBER — 999 on older builds).
_ITEMS_CHUNK = 400


def _get_items_bulk(conn, wl_ids: list[str]) -> dict[str, list[dict]]:
    """Every list's items in ONE query per chunk, grouped by watchlist_id.

    ⛔ The three list_* functions below called `_get_items` INSIDE their row loop —
    a textbook N+1. auth.db lives on a Railway NETWORK volume, so each of those
    round-trips paid real I/O latency rather than a local page read, and a member
    with many lists turned one page load into thousands of them: `GET /api/watchlists`
    measured 7.6-8.4 s on prod 2026-08-29, on the APP-SHELL path that every page
    hits. Same rows, same order, one query.

    Ordering is IDENTICAL to `_get_items` (sort_order ASC, added_at DESC) and is
    applied by SQLite over the whole result, so each per-list slice comes back in
    the order that function would have produced. A list with no items is absent
    from the map — callers must default to [], exactly as an empty fetchall did.
    """
    out: dict[str, list[dict]] = {}
    if not wl_ids:
        return out
    for i in range(0, len(wl_ids), _ITEMS_CHUNK):
        chunk = wl_ids[i:i + _ITEMS_CHUNK]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT * FROM watchlist_items WHERE watchlist_id IN ({placeholders}) "
            "ORDER BY sort_order ASC, added_at DESC",
            tuple(chunk),
        ).fetchall()
        for r in rows:
            d = dict(r)
            out.setdefault(d["watchlist_id"], []).append(d)
    return out


def _get_item_counts_bulk(conn, wl_ids: list[str]) -> dict[str, int]:
    """Row counts per list, without carrying the rows themselves.

    Counted by SQLite over the same table + predicate `_get_items_bulk` reads, so a
    slim response's `item_count` cannot disagree with the full response's
    `len(items)` — the two are the same number by construction, not by convention.
    """
    out: dict[str, int] = {}
    if not wl_ids:
        return out
    for i in range(0, len(wl_ids), _ITEMS_CHUNK):
        chunk = wl_ids[i:i + _ITEMS_CHUNK]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT watchlist_id, COUNT(*) AS n FROM watchlist_items "
            f"WHERE watchlist_id IN ({placeholders}) GROUP BY watchlist_id",
            tuple(chunk),
        ).fetchall()
        for r in rows:
            out[r["watchlist_id"]] = r["n"]
    return out


def _get_display_names_bulk(conn, user_ids: list[str]) -> dict[str, str]:
    """Owner names for many lists in one query per chunk.

    Same second-N+1 as `_get_items_bulk` addresses: the community/prebuilt lists
    called `_get_display_name` per ROW. Resolution matches `_get_display_name`
    exactly (display_name, else the email local-part); a missing user is absent
    from the map and callers fall back to "Unknown", as that function returns.
    """
    out: dict[str, str] = {}
    uniq = list({u for u in user_ids if u})
    if not uniq:
        return out
    for i in range(0, len(uniq), _ITEMS_CHUNK):
        chunk = uniq[i:i + _ITEMS_CHUNK]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT id, display_name, email FROM users WHERE id IN ({placeholders})",
            tuple(chunk),
        ).fetchall()
        for r in rows:
            out[r["id"]] = r["display_name"] or (r["email"] or "").split("@")[0]
    return out


def _get_display_name(conn, user_id: str) -> str:
    row = conn.execute("SELECT display_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return "Unknown"
    return row["display_name"] or row["email"].split("@")[0]
