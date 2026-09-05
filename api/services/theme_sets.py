"""Per-user CUSTOM THEME SETS — the personal, editable Theme Tracker.

A "theme set" is one user's private, NAMED customization of the shared Theme Tracker,
stored as a DIFF (not a copy) on top of the living owner taxonomy so it keeps
auto-updating — minus the themes/stocks the user removed, plus the ones they added and
any custom themes they created. Applying a set NEVER touches the shared taxonomy,
`theme_memberships`, the shared theme-performance compute, or the chart-watermark
"primary theme" logic — it is a read-time overlay in its own endpoint/code path
(`theme_performance.apply_theme_set`), so a user's edits can never move anyone else's
numbers.

Storage: a dedicated SQLite DB (`/data/theme_sets.db`, WAL) — one row per set, the diff
kept as a small JSON blob. Mirrors the modelbook/cot store idiom (WAL + _WRITE_LOCK +
contextlib.closing).

Feature-flagged: `THEME_SETS_ENABLED` (default OFF). When off, `enabled()` is False, the
router serves `{enabled: false}`, and the widget shows only the shared default — fully
inert.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import threading
import time
import uuid

_WRITE_LOCK = threading.Lock()

# Bounds (defensive — a personal diff should be tiny; these stop a runaway payload).
_MAX_SETS_PER_USER = 40
_MAX_NAME_LEN = 60
_MAX_HIDDEN = 400
_MAX_EDITED_THEMES = 400
_MAX_SYMS_PER_THEME = 300
_MAX_CUSTOM_THEMES = 100
_MAX_CUSTOM_MEMBERS = 300
_MAX_SYM_LEN = 12


def enabled() -> bool:
    return os.environ.get("THEME_SETS_ENABLED", "0") not in ("0", "", "false", "False")


def _db_path() -> str:
    p = os.environ.get("THEME_SETS_DB_PATH")
    if p:
        return p
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "theme_sets.db")


_inited = False


def _conn() -> sqlite3.Connection:
    path = _db_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    c = sqlite3.connect(path, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    global _inited
    with _WRITE_LOCK, contextlib.closing(_conn()) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("""
            CREATE TABLE IF NOT EXISTS theme_sets (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                name        TEXT NOT NULL,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                diff_json   TEXT NOT NULL DEFAULT '{}',
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_theme_sets_user ON theme_sets(user_id)")
        c.commit()
    _inited = True


def _ensure() -> None:
    if not _inited:
        init_db()


# ── sanitizing / validation ──────────────────────────────────────────────────

def _sym(s) -> str | None:
    s = str(s or "").strip().upper()
    if not s or len(s) > _MAX_SYM_LEN:
        return None
    # tickers are letters/digits plus . - : $ (breadth/index pseudo-tickers included)
    if not all(ch.isalnum() or ch in ".-:$" for ch in s):
        return None
    return s


def _sym_list(v, cap: int) -> list[str]:
    out, seen = [], set()
    for s in (v or [])[: cap * 2]:
        sy = _sym(s)
        if sy and sy not in seen:
            seen.add(sy)
            out.append(sy)
        if len(out) >= cap:
            break
    return out


def _name(v, fallback="Untitled") -> str:
    n = str(v or "").strip()[:_MAX_NAME_LEN]
    return n or fallback


def sanitize_diff(diff: dict) -> dict:
    """Coerce an arbitrary client payload into a bounded, well-formed diff.
    Shape: {themes:[slug]|None, hidden:[slug], removed:{slug:[sym]}, added:{slug:[sym]},
    custom:[{key,name,members:[sym]}]}.

    `themes` is the ORDERED inclusion list (the additive model): present → show exactly these
    owner themes in this order; absent/None → all defaults (back-compat, minus `hidden`). An
    empty list means "cleared" (no owner themes — build from scratch)."""
    diff = diff if isinstance(diff, dict) else {}

    # Ordered theme inclusion list (None = absent = all-defaults mode).
    themes = None
    if isinstance(diff.get("themes"), list):
        themes, tseen = [], set()
        for s in diff["themes"][:_MAX_EDITED_THEMES * 2]:
            sl = str(s or "").strip().lower()
            if sl and sl not in tseen:
                tseen.add(sl)
                themes.append(sl)
            if len(themes) >= _MAX_EDITED_THEMES:
                break

    hidden = []
    seen = set()
    for s in (diff.get("hidden") or [])[:_MAX_HIDDEN * 2]:
        sl = str(s or "").strip().lower()
        if sl and sl not in seen:
            seen.add(sl)
            hidden.append(sl)
        if len(hidden) >= _MAX_HIDDEN:
            break

    def _slug_map(m):
        out = {}
        if not isinstance(m, dict):
            return out
        for slug, syms in list(m.items())[:_MAX_EDITED_THEMES]:
            sl = str(slug or "").strip().lower()
            if not sl:
                continue
            lst = _sym_list(syms, _MAX_SYMS_PER_THEME)
            if lst:
                out[sl] = lst
        return out

    removed = _slug_map(diff.get("removed"))
    added = _slug_map(diff.get("added"))

    custom = []
    for c in (diff.get("custom") or [])[:_MAX_CUSTOM_THEMES]:
        if not isinstance(c, dict):
            continue
        key = str(c.get("key") or "").strip()[:64] or ("custom:" + uuid.uuid4().hex[:12])
        custom.append({
            "key": key,
            "name": _name(c.get("name"), "Custom Theme"),
            "members": _sym_list(c.get("members"), _MAX_CUSTOM_MEMBERS),
        })

    return {"themes": themes, "hidden": hidden, "removed": removed, "added": added, "custom": custom}


def _row_to_set(row: sqlite3.Row) -> dict:
    try:
        diff = json.loads(row["diff_json"]) if row["diff_json"] else {}
    except Exception:
        diff = {}
    diff = sanitize_diff(diff)
    return {
        "id": row["id"],
        "name": row["name"],
        "sort_order": row["sort_order"],
        "themes": diff["themes"],
        "hidden": diff["hidden"],
        "removed": diff["removed"],
        "added": diff["added"],
        "custom": diff["custom"],
        "updated_at": row["updated_at"],
    }


# ── CRUD (ownership always enforced via user_id in the WHERE clause) ───────────

def list_sets(user_id: str) -> list[dict]:
    _ensure()
    with contextlib.closing(_conn()) as c:
        rows = c.execute(
            "SELECT id, name, sort_order FROM theme_sets WHERE user_id=? ORDER BY sort_order, created_at",
            (user_id,),
        ).fetchall()
    return [{"id": r["id"], "name": r["name"], "sort_order": r["sort_order"]} for r in rows]


def get_set(user_id: str, set_id: str) -> dict | None:
    _ensure()
    with contextlib.closing(_conn()) as c:
        row = c.execute(
            "SELECT * FROM theme_sets WHERE id=? AND user_id=?", (set_id, user_id)
        ).fetchone()
    return _row_to_set(row) if row else None


def create_set(user_id: str, name: str, diff: dict | None = None) -> dict | None:
    _ensure()
    now = time.time()
    sid = "ts_" + uuid.uuid4().hex[:16]
    clean = sanitize_diff(diff or {})
    with _WRITE_LOCK, contextlib.closing(_conn()) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM theme_sets WHERE user_id=?", (user_id,)).fetchone()["n"]
        if n >= _MAX_SETS_PER_USER:
            return None
        order = c.execute(
            "SELECT COALESCE(MAX(sort_order),-1)+1 AS o FROM theme_sets WHERE user_id=?", (user_id,)
        ).fetchone()["o"]
        c.execute(
            "INSERT INTO theme_sets (id,user_id,name,sort_order,diff_json,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (sid, user_id, _name(name, "My Themes"), order, json.dumps(clean), now, now),
        )
        c.commit()
    return get_set(user_id, sid)


def replace_set(user_id: str, set_id: str, name: str | None, diff: dict) -> dict | None:
    """Replace a set's name + whole diff (the frontend holds edit state and PUTs it all)."""
    _ensure()
    clean = sanitize_diff(diff or {})
    with _WRITE_LOCK, contextlib.closing(_conn()) as c:
        row = c.execute("SELECT name FROM theme_sets WHERE id=? AND user_id=?", (set_id, user_id)).fetchone()
        if not row:
            return None
        new_name = _name(name, row["name"]) if name is not None else row["name"]
        c.execute(
            "UPDATE theme_sets SET name=?, diff_json=?, updated_at=? WHERE id=? AND user_id=?",
            (new_name, json.dumps(clean), time.time(), set_id, user_id),
        )
        c.commit()
    return get_set(user_id, set_id)


def delete_set(user_id: str, set_id: str) -> bool:
    _ensure()
    with _WRITE_LOCK, contextlib.closing(_conn()) as c:
        cur = c.execute("DELETE FROM theme_sets WHERE id=? AND user_id=?", (set_id, user_id))
        c.commit()
        return cur.rowcount > 0
