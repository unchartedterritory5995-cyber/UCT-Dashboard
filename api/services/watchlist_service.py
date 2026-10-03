"""
Watchlist service — user-created watchlists with optional public sharing.
All data in auth.db (watchlists + watchlist_items tables).
"""

import json
import uuid
from datetime import datetime, timezone

from api.services import artifact_versions
from api.services import watchlist_entity_keys
from api.services.auth_db import get_connection


# ── COV-06: version history (dark behind ARTIFACT_VERSIONS_ENABLED) ──────────
#
# A list is edited in many small writes (add / bulk add / remove / reorder / note / rename), so a
# VERSION is a snapshot of the WHOLE list after each committed write, and the store's 60 s
# coalescing turns a burst of edits into one checkpoint. Only a list whose contents are the
# member's own is versioned: never the flagged shadow list (a sync of the flags), an admin INDEX
# list (curated, thousands of rows), or a LINKED list (its source is authoritative).

def _items_json(conn, wl_id: str) -> str:
    rows = conn.execute(
        "SELECT sym, notes FROM watchlist_items WHERE watchlist_id = ? "
        "ORDER BY sort_order ASC, added_at DESC", (wl_id,)
    ).fetchall()
    return json.dumps([{"sym": r["sym"], "notes": r["notes"] or ""} for r in rows],
                      separators=(",", ":"), ensure_ascii=False)


def is_versionable(row) -> bool:
    """True when this watchlist row's contents are its owner's own authoring."""
    if row is None or row["is_flagged_list"] or row["is_prebuilt"]:
        return False
    from api.services import watchlist_origin
    if watchlist_origin.enabled() and watchlist_origin.is_linked(row["id"]):
        return False
    return True


def _content(conn, user_id: str, wl_id: str) -> dict | None:
    """The list's versioned content, or ``None`` when dark / not the member's / not versionable.
    Read-only; the ``is_enabled()`` here only avoids the extra reads while dark."""
    if not artifact_versions.is_enabled():
        return None
    row = conn.execute(
        "SELECT * FROM watchlists WHERE id = ? AND user_id = ?", (wl_id, user_id)
    ).fetchone()
    if not is_versionable(row):
        return None
    return {"name": row["name"], "description": row["description"] or "",
            "items_json": _items_json(conn, wl_id)}


def versioned_content(user_id: str, wl_id: str) -> dict | None:
    if not artifact_versions.is_enabled():
        return None
    conn = get_connection()
    try:
        return _content(conn, user_id, wl_id)
    finally:
        conn.close()


def _version(user_id: str, wl_id: str, before: dict | None, *, created: bool = False,
             source: str = "save", restored_from: int | None = None):
    """Snapshot one committed write. ``before`` is the content it replaced (``None`` only for a
    create). Never raises into the member's write; dark, nothing is read."""
    if not artifact_versions.is_enabled() or (before is None and not created):
        return None
    after = versioned_content(user_id, wl_id)
    if after is None:
        return None
    return artifact_versions.record_save(
        user_id, artifact_versions.KIND_WATCHLIST, wl_id, before=before, after=after,
        label=after["name"], source=source, restored_from=restored_from)


def _write_items(conn, wl_id: str, items: list) -> None:
    """Make ``wl_id``'s items exactly ``items`` (``[{sym, notes}]``, in order). A row whose symbol
    survives keeps its id, so its notes handle and React key stay stable."""
    current = {r["sym"]: r["id"] for r in conn.execute(
        "SELECT id, sym FROM watchlist_items WHERE watchlist_id = ?", (wl_id,)).fetchall()}
    want, seen = [], set()
    for it in items or []:
        sym = str((it or {}).get("sym") or "").strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            want.append((sym, str((it or {}).get("notes") or "")))
    for sym, item_id in current.items():
        if sym not in seen:
            conn.execute("DELETE FROM watchlist_items WHERE id = ?", (item_id,))
    for idx, (sym, notes) in enumerate(want):
        if sym in current:
            conn.execute("UPDATE watchlist_items SET notes = ?, sort_order = ? WHERE id = ?",
                         (notes, idx, current[sym]))
        else:
            conn.execute(
                "INSERT INTO watchlist_items (id, watchlist_id, sym, notes, sort_order) VALUES (?,?,?,?,?)",
                (str(uuid.uuid4())[:12], wl_id, sym, notes, idx))


def restore_content(user_id: str, wl_id: str, payload: dict, *, restored_from: int):
    """COV-06: write a version's name, description and membership back to one of the member's own
    versionable lists. Publication is left exactly as it is. Recorded as a new ``restore``
    version; nothing is removed from the history. ``None`` if not the member's / not versionable."""
    conn = get_connection()
    try:
        before = _content(conn, user_id, wl_id)
        if before is None:
            return None
        conn.execute(
            "UPDATE watchlists SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (payload["name"], payload["description"] or "",
             datetime.now(timezone.utc).isoformat(), wl_id, user_id))
        _write_items(conn, wl_id, json.loads(payload["items_json"] or "[]"))
        conn.commit()
    finally:
        conn.close()
    res = _version(user_id, wl_id, before, source="restore", restored_from=restored_from)
    return get_watchlist(wl_id, user_id), res


def undelete_content(user_id: str, wl_id: str, payload: dict, *, restored_from: int):
    """COV-06: bring a DELETED list back from one of its kept versions, under its OLD id (so its
    history continues). It comes back PRIVATE: publication is not content, and a share the delete
    ended must not come back on its own. ``None`` if the id exists."""
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        if conn.execute("SELECT 1 FROM watchlists WHERE id = ?", (wl_id,)).fetchone():
            return None
        conn.execute(
            "INSERT INTO watchlists (id, user_id, name, description, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (wl_id, user_id, payload["name"], payload["description"] or "", 0, now, now))
        _write_items(conn, wl_id, json.loads(payload["items_json"] or "[]"))
        conn.commit()
    finally:
        conn.close()
    res = _version(user_id, wl_id, None, created=True, source="restore", restored_from=restored_from)
    return get_watchlist(wl_id, user_id), res


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
    finally:
        conn.close()
    _version(user_id, wl_id, None, created=True)
    return get_watchlist(wl_id, user_id)


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
        if not wl.get("is_prebuilt"):
            # Entity Master UC-2 (dark): display alias + renamed/delisted marker.
            watchlist_entity_keys.annotate(wl["items"])
        wl["owner_name"] = _get_display_name(conn, wl["user_id"])
        return wl
    finally:
        conn.close()


def list_user_watchlists(
    user_id: str, include_items: bool = True, include_prebuilt: bool = True
) -> list[dict]:
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

    `include_prebuilt=False` drops the admin-curated INDEX lists. Same defect shape
    as `include_items`, one level up: the prebuilt lists are owned by the admin
    account, so they come back as that user's own lists, and on 2026-09-07 they were
    33 of 34 lists carrying 4,725 of 4,726 items — Russell 2000 alone is 1,872 —
    against ONE real list holding ONE symbol. Measured on prod that day: 592 KB and
    28.1 s cold / 6.6 s warm, on the app-shell path of every page, every 60 s.

    ⛔ It is also a CORRECTNESS filter, not only a size one. The surface that reads
    this to answer "is this ticker on the member's radar?" cannot treat membership in
    the Russell 2000 as a radar hit — that marks essentially every small-cap. Pass
    False from any surface asking about the user's OWN attention; keep True where the
    prebuilt lists are the point (the Watchlists page itself).
    """
    conn = get_connection()
    try:
        # The prebuilt filter is applied in SQL, not after the fetch: the whole point
        # is to not carry 4,725 rows' worth of lists into the items join below.
        prebuilt_clause = "" if include_prebuilt else " AND (is_prebuilt = 0 OR is_prebuilt IS NULL)"
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE user_id = ? AND (is_flagged_list = 0 OR is_flagged_list IS NULL)"
            + prebuilt_clause
            + " ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        results = [dict(r) for r in rows]
        ids = [wl["id"] for wl in results]
        if include_items:
            items_by_list = _get_items_bulk(conn, ids)
            for wl in results:
                wl["items"] = items_by_list.get(wl["id"], [])
                wl["item_count"] = len(wl["items"])
                if not wl.get("is_prebuilt"):
                    # Entity Master UC-2 (dark): never the prebuilt INDEX lists.
                    watchlist_entity_keys.annotate(wl["items"])
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


def list_prebuilt_watchlists(limit: int = 50, include_items: bool = True) -> list[dict]:
    """Admin-curated UCT watchlists shown in the picker's Prebuilt tab. Flagged with
    is_prebuilt = 1 (and kept is_public = 1 so they open via the community: key).

    `include_items=False` returns metadata + `item_count` only — the SAME slim/full
    split `list_user_watchlists` above already documents, applied one level down.

    Why it exists: this endpoint is a DIRECTORY — the picker renders list NAMES and
    counts, and reads neither `items` nor the route's `sample` field — but it was
    shipping every member of every list to draw it. Measured on prod 2026-09-20:
    33 lists carrying **4,704 item rows / 607,445 bytes**, of which Russell 2000
    alone is 1,872, to render a menu of 33 names. The same request in one session
    ranged **172 ms warm to 9,859 ms cold**, essentially all of it server time.
    Members are fetched per-list on selection instead, through `get_watchlist`.

    ⚠️ Defaults True so every existing caller stays byte-identical — and, the trap
    `list_user_watchlists` records, the flag is only real if the ROUTE forwards it.
    `item_count` is preserved in BOTH modes and stays derived from the same rows the
    response describes."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM watchlists WHERE is_prebuilt = 1 ORDER BY name ASC LIMIT ?", (limit,)
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
        names_by_user = _get_display_names_bulk(conn, [wl["user_id"] for wl in results])
        for wl in results:
            wl["owner_name"] = names_by_user.get(wl["user_id"], "Unknown")
        return results
    finally:
        conn.close()


def _update_watchlist_unversioned(user_id: str, wl_id: str, data: dict) -> dict | None:
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


def _delete_watchlist_unversioned(user_id: str, wl_id: str) -> bool:
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


def _add_item_unversioned(user_id: str, wl_id: str, sym: str, notes: str = "") -> dict | None:
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
        # Entity Master UC-2 (dark): key the new row to its entity, once, today.
        watchlist_entity_keys.key_items([(item_id, sym_u)])
        return {"id": item_id, "watchlist_id": wl_id, "sym": sym_u, "notes": notes, "duplicate": False}
    finally:
        conn.close()


def _bulk_add_items_unversioned(user_id: str, wl_id: str, symbols: list[str]) -> dict | None:
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
        new_rows = []
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
            new_rows.append((item_id, s))
            added += 1
        if added:
            conn.execute(
                "UPDATE watchlists SET updated_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), wl_id),
            )
            conn.commit()
            # Entity Master UC-2 (dark): key each new row, once, today.
            watchlist_entity_keys.key_items(new_rows)
        return {"added": added, "watchlist": get_watchlist(wl_id, user_id)}
    finally:
        conn.close()


def _update_item_notes_unversioned(user_id: str, wl_id: str, item_id: str, notes: str) -> dict | None:
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


def _remove_item_unversioned(user_id: str, wl_id: str, item_id: str) -> bool:
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


def _reorder_items_unversioned(user_id: str, wl_id: str, item_ids: list[str]) -> bool:
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


# ── the public writes: each is the unversioned write plus the COV-06 snapshot ──
# ``versioned_content`` is ``None`` while dark (no read) and for a list that is not versionable;
# ``_version`` then does nothing. The snapshot runs only after the member's write committed and
# never raises into it.

def update_watchlist(user_id: str, wl_id: str, data: dict) -> dict | None:
    before = versioned_content(user_id, wl_id)
    out = _update_watchlist_unversioned(user_id, wl_id, data)
    if out:
        _version(user_id, wl_id, before)
    return out


def delete_watchlist(user_id: str, wl_id: str) -> bool:
    before = versioned_content(user_id, wl_id)
    gone = _delete_watchlist_unversioned(user_id, wl_id)
    if gone and before is not None:
        # The history outlives the list (a tombstone), so the delete can be undone.
        artifact_versions.record_delete(user_id, artifact_versions.KIND_WATCHLIST, wl_id,
                                        before=before, label=before["name"])
    return gone


def add_item(user_id: str, wl_id: str, sym: str, notes: str = "") -> dict | None:
    before = versioned_content(user_id, wl_id)
    out = _add_item_unversioned(user_id, wl_id, sym, notes)
    if out and not out.get("duplicate"):
        _version(user_id, wl_id, before)
    return out


def bulk_add_items(user_id: str, wl_id: str, symbols: list[str]) -> dict | None:
    before = versioned_content(user_id, wl_id)
    out = _bulk_add_items_unversioned(user_id, wl_id, symbols)
    if out and out.get("added"):
        _version(user_id, wl_id, before)
    return out


def update_item_notes(user_id: str, wl_id: str, item_id: str, notes: str) -> dict | None:
    before = versioned_content(user_id, wl_id)
    out = _update_item_notes_unversioned(user_id, wl_id, item_id, notes)
    if out:
        _version(user_id, wl_id, before)
    return out


def remove_item(user_id: str, wl_id: str, item_id: str) -> bool:
    before = versioned_content(user_id, wl_id)
    out = _remove_item_unversioned(user_id, wl_id, item_id)
    if out:
        _version(user_id, wl_id, before)
    return out


def reorder_items(user_id: str, wl_id: str, item_ids: list[str]) -> bool:
    before = versioned_content(user_id, wl_id)
    out = _reorder_items_unversioned(user_id, wl_id, item_ids)
    if out:
        _version(user_id, wl_id, before)
    return out


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
