"""SQLite store for Charts-workspace layout templates.

Two kinds of saved layout live here:
  • scope='global' (user_id=0) — admin-built PREBUILT templates, visible to every
    user in the "Open layout" picker.
  • scope='user'  (user_id=<id>) — a user's own named layouts.

A layout row stores the widget ARRANGEMENT ({widgets, cols}) plus the optional
color-group tickers ({A,B,C,D}) so opening it restores the exact setup.

DB path: /data/charts_layouts.db (web service Railway volume). Dashboard-owned,
mirrors the modelbook/catalyst store pattern: WAL, _WRITE_LOCK on writes,
contextlib.closing on every connection (Windows teardown needs explicit close).
"""
from __future__ import annotations

import contextlib
import json
import os
import secrets
import sqlite3
import threading
import time
from typing import Any, Optional

_DB_PATH = os.environ.get("CHARTS_LAYOUTS_DB_PATH", "/data/charts_layouts.db")
_WRITE_LOCK = threading.Lock()

# Global (prebuilt) rows use user_id=0 so UNIQUE(scope,user_id,name) upserts
# cleanly (SQLite treats NULL as distinct in UNIQUE, which would break upsert).
_GLOBAL_UID = 0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS charts_layouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT    NOT NULL,            -- 'global' | 'user'
  user_id     INTEGER NOT NULL DEFAULT 0,  -- 0 for global; owner id for user
  name        TEXT    NOT NULL,
  layout_json TEXT    NOT NULL,            -- {widgets:[...], cols:N}
  groups_json TEXT,                        -- {A,B,C,D} color-group tickers (optional)
  created_by  TEXT,                        -- display name/email of creator (for prebuilt attribution)
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  UNIQUE(scope, user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_charts_layouts_scope ON charts_layouts(scope, user_id, sort_order);

-- Terminal-grade property 3 ("saved things become names, and names are
-- addresses") for a USER-scoped layout. Mirrors user_definitions.py's
-- definition_shares design exactly: APPEND-ONLY (never UPDATE/DELETE a share
-- row — a share row records that a member published something at a moment in
-- time; rewriting it would erase the fact rather than end it), idempotent
-- minting (pressing Share twice must return the SAME token, since the first
-- may already be in somebody's chat window), and "revoked" stays a different
-- fact from "never shared" so a recipient can be told WHY their link died.
-- No listing route and no way to walk the token space (128 bits) — the only
-- route to somebody else's layout is a link they chose to send.
CREATE TABLE IF NOT EXISTS chart_layout_shares (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  layout_id  INTEGER NOT NULL,
  revoked    INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chart_layout_shares_token ON chart_layout_shares(token, id DESC);
CREATE INDEX IF NOT EXISTS idx_chart_layout_shares_owner ON chart_layout_shares(user_id, layout_id, id DESC);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def _row_to_dict(row: sqlite3.Row) -> dict:
    try:
        layout = json.loads(row["layout_json"]) if row["layout_json"] else None
    except Exception:
        layout = None
    try:
        groups = json.loads(row["groups_json"]) if row["groups_json"] else None
    except Exception:
        groups = None
    return {
        "id": row["id"],
        "scope": row["scope"],
        "user_id": row["user_id"],
        "name": row["name"],
        "layout": layout,
        "groups": groups,
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_for_user(user_id) -> dict:
    """Return {'global': [...], 'mine': [...]} for the given user."""
    with contextlib.closing(_connect()) as c:
        g = c.execute(
            "SELECT * FROM charts_layouts WHERE scope='global' ORDER BY sort_order, name COLLATE NOCASE"
        ).fetchall()
        m = c.execute(
            "SELECT * FROM charts_layouts WHERE scope='user' AND user_id=? ORDER BY sort_order, name COLLATE NOCASE",
            (user_id,),
        ).fetchall()
    return {
        "global": [_row_to_dict(r) for r in g],
        "mine": [_row_to_dict(r) for r in m],
    }


def get(layout_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        r = c.execute("SELECT * FROM charts_layouts WHERE id=?", (layout_id,)).fetchone()
    return _row_to_dict(r) if r else None


def upsert(scope: str, user_id, name: str, layout: dict,
           groups: Optional[dict], created_by: Optional[str]) -> dict:
    """Create or replace a layout by (scope, user_id, name). Returns the saved row."""
    if scope not in ("global", "user"):
        scope = "user"
    # users.id is a UUID string — never coerce to int (int() here 500'd every
    # user-scope save; global saves worked only because they use _GLOBAL_UID).
    uid = _GLOBAL_UID if scope == "global" else user_id
    layout_json = json.dumps(layout)
    groups_json = json.dumps(groups) if groups else None
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        existing = c.execute(
            "SELECT id FROM charts_layouts WHERE scope=? AND user_id=? AND name=?",
            (scope, uid, name),
        ).fetchone()
        if existing:
            c.execute(
                "UPDATE charts_layouts SET layout_json=?, groups_json=?, created_by=?, updated_at=? WHERE id=?",
                (layout_json, groups_json, created_by, now, existing["id"]),
            )
            new_id = existing["id"]
        else:
            cur = c.execute(
                "INSERT INTO charts_layouts (scope, user_id, name, layout_json, groups_json, created_by, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (scope, uid, name, layout_json, groups_json, created_by, now),
            )
            new_id = cur.lastrowid
        c.commit()
        r = c.execute("SELECT * FROM charts_layouts WHERE id=?", (new_id,)).fetchone()
    return _row_to_dict(r)


def rename(layout_id: int, name: str) -> Optional[dict]:
    """Rename a layout IN PLACE. Returns the updated row, or None if it is gone.

    Renaming needs its own path because `upsert` is keyed on (scope, user_id,
    name): calling it with a new name creates a SECOND row rather than renaming
    the first, so the only client-side rename available was save-new +
    delete-old — two writes with a window where both exist, and a failure mode
    that leaves a duplicate behind.

    Raises sqlite3.IntegrityError when the new name is already taken in the same
    scope for the same user (the UNIQUE constraint); the router turns that into
    a 409 rather than a 500.
    """
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "UPDATE charts_layouts SET name=?, updated_at=? WHERE id=?",
            (name, now, layout_id),
        )
        if cur.rowcount == 0:
            return None
        c.commit()
        r = c.execute("SELECT * FROM charts_layouts WHERE id=?", (layout_id,)).fetchone()
    return _row_to_dict(r) if r else None


def delete(layout_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM charts_layouts WHERE id=?", (layout_id,))
        c.commit()
        return cur.rowcount > 0


# ═══ sharing (terminal-grade property 3) ═════════════════════════════════════
#
# Mirrors user_definitions.py's share/unshare/share_status/resolve pattern.
# Global (prebuilt, scope='global') layouts are already visible to every user
# via list_for_user, so sharing only ever applies to scope='user' rows —
# callers (the router) are responsible for rejecting a share attempt on a
# global row before calling here.


def share_token() -> str:
    """A fresh share token. 32 hex = 128 bits, so it cannot be guessed or walked."""
    return "cl_" + secrets.token_hex(16)


def _newest_share(c: sqlite3.Connection, user_id: Any, layout_id: int):
    """The current state of one layout's link — the LAST row written."""
    return c.execute(
        "SELECT * FROM chart_layout_shares WHERE user_id=? AND layout_id=?"
        " ORDER BY id DESC LIMIT 1",
        (user_id, layout_id),
    ).fetchone()


def share(user_id, layout_id: int) -> Optional[dict]:
    """Mint (or return) the share link for one of my layouts. ``None`` if the
    layout doesn't exist or isn't owned by this user.

    IDEMPOTENT ON THE TOKEN — pressing Share twice returns the SAME token
    (same reasoning as user_definitions.share: a live link must not be broken
    out from under whoever already has it).
    """
    row = get(layout_id)
    if row is None or row["scope"] != "user" or row["user_id"] != user_id:
        return None
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        live = _newest_share(c, user_id, layout_id)
        token = (live["token"] if live is not None and not live["revoked"]
                 else share_token())
        c.execute(
            "INSERT INTO chart_layout_shares (token, user_id, layout_id, revoked, created_at)"
            " VALUES (?,?,?,0,?)",
            (token, user_id, layout_id, int(time.time())),
        )
        c.commit()
    return {"token": token, "layout_id": layout_id}


def unshare(user_id, layout_id: int) -> bool:
    """Turn the link off by APPENDING a revocation row (never an UPDATE/DELETE
    of the live one — see the schema comment on why)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        live = _newest_share(c, user_id, layout_id)
        if live is None or live["revoked"]:
            return False
        c.execute(
            "INSERT INTO chart_layout_shares (token, user_id, layout_id, revoked, created_at)"
            " VALUES (?,?,?,1,?)",
            (live["token"], user_id, layout_id, int(time.time())),
        )
        c.commit()
    return True


def share_status(user_id, layout_id: int) -> Optional[dict]:
    """The live token for a layout, or ``None``. READ-ONLY — never mints, so
    opening a share panel can never itself publish a layout."""
    with contextlib.closing(_connect()) as c:
        row = _newest_share(c, user_id, layout_id)
    if row is None or row["revoked"]:
        return None
    return {"token": row["token"], "layout_id": row["layout_id"]}


def resolve_share(token: str) -> Optional[dict]:
    """The layout a token points at, or ``None`` if the token never existed,
    was revoked, or the layout behind it has since been deleted.

    Distinguishing "revoked" from "not found" is a caller-side decision (this
    returns None for both, same as user_definitions' own resolve — the
    recipient sees a 404 either way; the *owner's* share_status is where
    "revoked vs never shared" stays visible).
    """
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM chart_layout_shares WHERE token=? ORDER BY id DESC LIMIT 1",
            (token,),
        ).fetchone()
        if row is None or row["revoked"]:
            return None
        layout_row = c.execute(
            "SELECT * FROM charts_layouts WHERE id=?", (row["layout_id"],)
        ).fetchone()
    return _row_to_dict(layout_row) if layout_row else None
