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
import sqlite3
import threading
import time
from typing import Optional

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


def list_for_user(user_id: int) -> dict:
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


def upsert(scope: str, user_id: int, name: str, layout: dict,
           groups: Optional[dict], created_by: Optional[str]) -> dict:
    """Create or replace a layout by (scope, user_id, name). Returns the saved row."""
    if scope not in ("global", "user"):
        scope = "user"
    uid = _GLOBAL_UID if scope == "global" else int(user_id)
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


def delete(layout_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM charts_layouts WHERE id=?", (layout_id,))
        c.commit()
        return cur.rowcount > 0
