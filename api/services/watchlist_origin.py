"""TERM-077 / FB-A12-03 — copy-from-source or link-to-source, chosen at import.

When a member saves another list (a community list, a prebuilt UCT list, or one
of their own) into "My Lists", they are asked ONCE whether the new list is a
SNAPSHOT or a SUBSCRIPTION, and the answer is recorded beside the list:

  * ``copy`` — a snapshot. The member owns it outright; later changes to the
    source never reach it. The origin is still recorded, so the list can say
    honestly where it came from.
  * ``link`` — the source stays authoritative. The list follows the source on
    every full read, is read-only here (the item routes answer 409), and says
    how current it is — including when the source has gone away, or when the
    list was edited while it could not be guarded.

⛔ THERE IS NO DEFAULT MODE, AND THAT IS THE FEATURE. The source mechanism
(Bloomberg's, via best-of-breed §3.3 A12) is "asks once whether a list is a
snapshot or a subscription and never guesses; a guessed default is wrong half
the time and the wrongness is silent." ``save_from_list`` raises on a missing
or unknown mode rather than picking one.

⛔ A LIST NEVER CHANGES MODE. Nothing in this module (or anywhere else) updates
``mode`` after the row is written. A link whose source vanished stays a link and
SAYS the source is unavailable; a link that was edited while unguarded stays a
link and SAYS it is paused. Neither silently becomes a copy.

⛔ THE LIST, ITS ITEMS AND ITS RECORDED CHOICE ARE WRITTEN IN ONE TRANSACTION,
so no code path can leave a list-from-a-list behind without its choice.

Gate: ``WATCHLIST_COPY_OR_LINK_ENABLED`` — an ENABLEMENT gate, default OFF, read
per call. Off means every watchlist response and route behaves exactly as it
did before this module existed: nothing here is called, the table is never
created, and the save route answers 404. Rows written while it was on are kept
(never deleted); a linked list simply stops following until it is turned on
again.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import uuid
from datetime import datetime, timezone

from api.services import auth_db

FLAG = "WATCHLIST_COPY_OR_LINK_ENABLED"
MODES = ("copy", "link")

# States reported on a list's ``origin``. A copy is always ``independent``.
STATE_INDEPENDENT = "independent"
STATE_CURRENT = "current"
STATE_SOURCE_UNAVAILABLE = "source_unavailable"
STATE_PAUSED_EDITED = "paused_edited"


def enabled() -> bool:
    """Read per call, never captured at import — a flip needs no code change."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


_DDL = """
CREATE TABLE IF NOT EXISTS watchlist_origins (
    wl_id        TEXT PRIMARY KEY REFERENCES watchlists(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    source_id    TEXT NOT NULL,
    source_name  TEXT NOT NULL DEFAULT '',
    mode         TEXT NOT NULL CHECK (mode IN ('copy', 'link')),
    created_at   TEXT NOT NULL,
    synced_at    TEXT NOT NULL,
    synced_sig   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watchlist_origins_user ON watchlist_origins(user_id);
"""

# Keyed by DB path so a test session that points AUTH_DB_PATH elsewhere still
# gets its table. Created lazily, on the flag-ON path only.
_ensured: set[str] = set()


def _ensure(conn: sqlite3.Connection) -> None:
    key = str(auth_db._DB_PATH)
    if key in _ensured:
        return
    conn.executescript(_DDL)
    _ensured.add(key)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dedup_upper(syms) -> list[str]:
    out, seen = [], set()
    for s in syms:
        u = (s or "").strip().upper()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _sig(syms: list[str]) -> str:
    """Order-sensitive fingerprint of a membership list (a re-rank is a change)."""
    return hashlib.sha256("\n".join(syms).encode()).hexdigest()[:24]


def _syms_of(conn: sqlite3.Connection, wl_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT sym FROM watchlist_items WHERE watchlist_id = ? "
        "ORDER BY sort_order ASC, added_at DESC",
        (wl_id,),
    ).fetchall()
    return _dedup_upper(r["sym"] for r in rows)


def _visible_source(conn: sqlite3.Connection, source_id: str, user_id: str):
    row = conn.execute(
        "SELECT id, user_id, name, is_public FROM watchlists WHERE id = ?", (source_id,)
    ).fetchone()
    if not row:
        return None
    if row["user_id"] != user_id and not row["is_public"]:
        return None
    return row


def save_from_list(user_id: str, source_id: str, mode, name: str | None = None) -> dict | None:
    """Create a NEW list in ``user_id``'s lists from ``source_id``, recording ``mode``.

    Returns the new list (with ``items`` and ``origin``), or None when the source
    does not exist or is not visible to this member. Raises ValueError on a
    missing or unknown mode — never guesses one.
    """
    if mode not in MODES:
        raise ValueError("mode must be chosen explicitly: 'copy' or 'link'")
    conn = auth_db.get_connection()
    try:
        _ensure(conn)
        src = _visible_source(conn, source_id, user_id)
        if src is None:
            return None
        syms = _syms_of(conn, source_id)
        new_name = (name or "").strip()[:60] or src["name"]
        wl_id = str(uuid.uuid4())[:12]
        now = _now()
        # ⛔ ONE TRANSACTION: the list, its members and the recorded choice land
        # together or not at all.
        conn.execute(
            "INSERT INTO watchlists (id, user_id, name, description, is_public, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (wl_id, user_id, new_name, "", 0, now, now),
        )
        conn.executemany(
            "INSERT INTO watchlist_items (id, watchlist_id, sym, notes, sort_order) VALUES (?,?,?,?,?)",
            [(str(uuid.uuid4())[:12], wl_id, s, "", i + 1) for i, s in enumerate(syms)],
        )
        conn.execute(
            "INSERT INTO watchlist_origins (wl_id, user_id, source_id, source_name, mode, "
            "created_at, synced_at, synced_sig) VALUES (?,?,?,?,?,?,?,?)",
            (wl_id, user_id, source_id, src["name"] or "", mode, now, now, _sig(syms)),
        )
        conn.commit()
    finally:
        conn.close()
    from api.services import watchlist_service
    wl = watchlist_service.get_watchlist(wl_id, user_id)
    return annotate(user_id, [wl])[0] if wl else None


def _sync_link(conn: sqlite3.Connection, origin: sqlite3.Row) -> str:
    """Bring a linked list in line with its source. Returns the resulting state.

    ⛔ Never overwrites the member's own edits: if the list no longer matches
    what the last sync wrote, it was edited while unguarded (flag off), and the
    list is reported ``paused_edited`` rather than silently rewritten.
    """
    src = _visible_source(conn, origin["source_id"], origin["user_id"])
    if src is None:
        return STATE_SOURCE_UNAVAILABLE
    own_sig = _sig(_syms_of(conn, origin["wl_id"]))
    if own_sig != origin["synced_sig"]:
        return STATE_PAUSED_EDITED
    src_syms = _syms_of(conn, origin["source_id"])
    src_sig = _sig(src_syms)
    if src_sig == origin["synced_sig"]:
        return STATE_CURRENT
    now = _now()
    conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (origin["wl_id"],))
    conn.executemany(
        "INSERT INTO watchlist_items (id, watchlist_id, sym, notes, sort_order) VALUES (?,?,?,?,?)",
        [(str(uuid.uuid4())[:12], origin["wl_id"], s, "", i + 1) for i, s in enumerate(src_syms)],
    )
    conn.execute(
        "UPDATE watchlist_origins SET synced_at = ?, synced_sig = ?, source_name = ? WHERE wl_id = ?",
        (now, src_sig, src["name"] or "", origin["wl_id"]),
    )
    conn.execute("UPDATE watchlists SET updated_at = ? WHERE id = ?", (now, origin["wl_id"]))
    conn.commit()
    return STATE_CURRENT


def annotate(user_id: str, lists: list) -> list:
    """Attach ``origin`` to each list that has one; bring linked lists current.

    Mutates and returns ``lists``. A list with no recorded origin is left
    exactly as it was — no key is added.
    """
    ids = [wl["id"] for wl in (lists or []) if isinstance(wl, dict) and wl.get("id")]
    if not ids:
        return lists
    conn = auth_db.get_connection()
    try:
        _ensure(conn)
        rows = conn.execute(
            "SELECT * FROM watchlist_origins WHERE user_id = ?", (user_id,)
        ).fetchall()
        by_id = {r["wl_id"]: r for r in rows}
        if not any(i in by_id for i in ids):
            return lists
        for wl in lists:
            if not isinstance(wl, dict):
                continue
            origin = by_id.get(wl.get("id"))
            if origin is None:
                continue
            if origin["mode"] == "link":
                state = _sync_link(conn, origin)
                if state == STATE_CURRENT and "items" in wl:
                    from api.services.watchlist_service import _get_items
                    wl["items"] = _get_items(conn, wl["id"])
                    if "item_count" in wl:
                        wl["item_count"] = len(wl["items"])
                origin = conn.execute(
                    "SELECT * FROM watchlist_origins WHERE wl_id = ?", (wl["id"],)
                ).fetchone()
            else:
                state = STATE_INDEPENDENT
            wl["origin"] = {
                "mode": origin["mode"],
                "source_id": origin["source_id"],
                "source_name": origin["source_name"],
                "created_at": origin["created_at"],
                "synced_at": origin["synced_at"],
                "state": state,
            }
        return lists
    finally:
        conn.close()


def is_linked(wl_id: str) -> bool:
    """True when ``wl_id`` is a linked list — its items are the source's to change."""
    conn = auth_db.get_connection()
    try:
        _ensure(conn)
        row = conn.execute(
            "SELECT mode FROM watchlist_origins WHERE wl_id = ?", (wl_id,)
        ).fetchone()
        return bool(row) and row["mode"] == "link"
    finally:
        conn.close()
