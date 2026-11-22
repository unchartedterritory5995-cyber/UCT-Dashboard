"""Community scan-board layouts: a member shares the ARRANGEMENT of their Screener board
(owner direction 2026-11-17: "i want people to be able to publish their scan layouts to the
community"). Router: `api/routers/screener_layout_gallery.py`. Dark behind
`SCREENER_LAYOUT_GALLERY_ENABLED`.

The rules, each held by `tests/test_screener_layout_gallery.py`:

  * WHAT LEAVES IS THE ARRANGEMENT AND A NAME, NOTHING ELSE. A shared layout is the widgets
    (type + box, and the results widget's row style) plus the name the author typed. Never a
    screen, a filter, a switch, a ticker or anything else from the author's board.
  * THE SERVER REFUSES, IT NEVER REPAIRS. The client (`boardModel.js`) repairs what it reads
    from its own preferences; what one member publishes for every other member to load is
    refused whole when any part of it is not a real board. The grid and the widget minimums
    are ONE FACT IN TWO FILES, pinned against `boardModel.js` by the test (it parses the
    client file rather than restating it).
  * REVIEW FIRST (the notebook gallery's precedent, `template_gallery.py`): a publish is
    `pending` and invisible to other members until an admin approves it.
  * HIDE IS A VISIBILITY STATE, NEVER A DELETE. UNPUBLISH is the author's own request about
    their own copy, so it deletes the row with the reports and use records about it. A layout
    another member already loaded is in their own preferences and stays theirs.
  * THE AUTHOR'S DISPLAY NAME ONLY (`template_gallery._display_label`, the one rule): never an
    email, never an id. A blank or email-looking name reads "A UCT member".

Tables live in auth.db, created on first use (`ensure_schema`), and leave with the account
(`journal_two/account_purge.py`: the member's own rows, and what other members recorded about
their layouts).
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services import auth_db

# ── the board's facts (mirrors app/src/pages/screener/focus/board/boardModel.js) ─────────
COLS = 24
ROWS = 20
MAX_NAME = 40
#: type -> (minimum width, minimum height)
WIDGETS: dict[str, tuple[int, int]] = {
    "results": (4, 4),
    "chart": (8, 8),
    "details": (5, 5),
    "news": (6, 4),
    "screens": (3, 6),
}
ROW_STYLES = ("line", "compact", "two", "cards", "chips")
DEFAULT_ROWS = "line"

#: A member's layouts that are listed or waiting for review.
MAX_MINE = 10
#: Every row a member may hold, declined ones included (a declined layout is kept so its author
#: can see the answer; this stops them piling up without end).
MAX_ROWS_PER_MEMBER = 30
LIST_LIMIT = 100
QUEUE_LIMIT = 200

REPORT_REASONS = ("name", "broken", "other")
ADMIN_ACTIONS = ("approve", "decline", "hide", "unhide", "dismiss")
STATUSES = ("pending", "approved", "declined")

S_NAME_MISSING = "Give the layout a name."
S_NAME_LONG = f"Keep the name to {MAX_NAME} characters or fewer."
S_NAME_CHARACTER = "That name has a character that can't be used. Use letters, numbers and spaces."
S_NAME_URL = "A layout name can't contain a web address."
S_NAME_EMAIL = "A layout name can't contain an email address."
S_NAME_HANDLE = "A layout name can't contain an @ name."
S_LAYOUT_UNREADABLE = "That layout can't be read."
S_LAYOUT_COUNT = f"A layout needs between 1 and {len(WIDGETS)} widgets."
S_LAYOUT_TYPE = "That layout has a widget this board doesn't have."
S_LAYOUT_TWICE = "A layout can hold each widget once."
S_LAYOUT_NUMBERS = "A widget's position and size must be whole numbers."
S_LAYOUT_SMALL = "A widget is smaller than its minimum size."
S_LAYOUT_OUTSIDE = "A widget is outside the board."
S_LAYOUT_OVERLAP = "Two widgets overlap."
S_LAYOUT_ROWS = "Pick a row style the board has."
S_CAP = f"You can share up to {MAX_MINE} layouts. Remove one first."
S_ROWS_CAP = "You have a lot of declined layouts. Remove some first."
S_DUPLICATE = "You already shared a layout with that name."
S_REPORT_REASON = "Pick a reason for the report."
S_REPORT_OWN = "You can't report your own layout. Remove it instead."
S_ADMIN_ACTION = "Pick an action: approve, decline, hide, unhide or dismiss."


class LayoutError(ValueError):
    """A request the member can fix -- answered 400 with this sentence."""


class LayoutConflict(LayoutError):
    """A request that is fine on its own and clashes with what is stored -- answered 409."""


# ── schema ───────────────────────────────────────────────────────────────────────────────
# Each table is its own statement so the account-purge rail can read its DDL out of this file.

_DDL = (
    """CREATE TABLE IF NOT EXISTS screener_layout_gallery (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        name_key    TEXT NOT NULL,
        layout_json TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        hidden      INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS screener_layout_gallery_reports (
        id          TEXT PRIMARY KEY,
        gallery_id  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        reason      TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'open',
        created_at  TEXT NOT NULL,
        UNIQUE (gallery_id, user_id)
    )""",
    """CREATE TABLE IF NOT EXISTS screener_layout_gallery_uses (
        gallery_id  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (gallery_id, user_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_screener_layout_gallery_user ON screener_layout_gallery (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_screener_layout_gallery_listed ON screener_layout_gallery (status, hidden)",
    "CREATE INDEX IF NOT EXISTS idx_screener_layout_gallery_reports_item"
    " ON screener_layout_gallery_reports (gallery_id, status)",
)

_ready_for: str | None = None


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the three tables on first use. Remembered per database path, so a test that points
    auth.db somewhere new gets its tables too."""
    global _ready_for
    path = getattr(auth_db, "_DB_PATH", None)
    if _ready_for is not None and _ready_for == path:
        return
    for ddl in _DDL:
        conn.execute(ddl)
    conn.commit()
    _ready_for = path


def _open(conn: sqlite3.Connection | None) -> tuple[sqlite3.Connection, bool]:
    owned = conn is None
    conn = conn or auth_db.get_connection()
    ensure_schema(conn)
    return conn, owned


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


# ── validation: refuse, never repair ─────────────────────────────────────────────────────

_URL = re.compile(
    r"(?i)(?:https?:|ftp:|//|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|gg|me|ly|app|xyz|info|biz|dev|ai|tv|cc|link|site|shop)\b)")
_EMAIL = re.compile(r"\S+@\S+\.\S+")
#: Unicode categories a name may not hold: controls, invisible format marks (zero-width and
#: direction overrides among them), surrogates, private-use and unassigned code points, and the
#: line and paragraph separators.
_BAD_CATEGORIES = {"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"}


def validate_name(raw: Any) -> str:
    """The name as it will be stored, or a `LayoutError` with the sentence to show."""
    if not isinstance(raw, str):
        raise LayoutError(S_NAME_MISSING)
    if any(unicodedata.category(ch) in _BAD_CATEGORIES for ch in raw):
        raise LayoutError(S_NAME_CHARACTER)
    name = " ".join(raw.split())
    if not name:
        raise LayoutError(S_NAME_MISSING)
    if len(name) > MAX_NAME:
        raise LayoutError(S_NAME_LONG)
    if _EMAIL.search(name):
        raise LayoutError(S_NAME_EMAIL)
    if "@" in name:
        raise LayoutError(S_NAME_HANDLE)
    if _URL.search(name):
        raise LayoutError(S_NAME_URL)
    return name


def _whole(v: Any) -> int | None:
    """A whole number as an int, or None. A bool is not a number here, and neither is a float
    with a fraction, an infinity or a NaN."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and math.isfinite(v) and v.is_integer():
        return int(v)
    return None


def _overlaps(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def validate_layout(raw: Any) -> dict[str, Any]:
    """`{"widgets": [...]}` in its canonical stored shape, or a `LayoutError`. Every widget is
    `{id: type, type, x, y, w, h}` (+ `opts: {rows}` on the results widget); any other key the
    caller sent is dropped, and anything that is not a real board is refused."""
    if not isinstance(raw, dict) or not isinstance(raw.get("widgets"), list):
        raise LayoutError(S_LAYOUT_UNREADABLE)
    listed = raw["widgets"]
    if not 1 <= len(listed) <= len(WIDGETS):
        raise LayoutError(S_LAYOUT_COUNT)
    out: list[dict[str, Any]] = []
    for w in listed:
        if not isinstance(w, dict) or not isinstance(w.get("type"), str) or w["type"] not in WIDGETS:
            raise LayoutError(S_LAYOUT_TYPE)
        kind = w["type"]
        if any(o["type"] == kind for o in out):
            raise LayoutError(S_LAYOUT_TWICE)
        box = {k: _whole(w.get(k)) for k in ("x", "y", "w", "h")}
        if any(v is None for v in box.values()):
            raise LayoutError(S_LAYOUT_NUMBERS)
        min_w, min_h = WIDGETS[kind]
        if box["w"] < min_w or box["h"] < min_h:
            raise LayoutError(S_LAYOUT_SMALL)
        if box["x"] < 0 or box["y"] < 0 or box["x"] + box["w"] > COLS or box["y"] + box["h"] > ROWS:
            raise LayoutError(S_LAYOUT_OUTSIDE)
        clean: dict[str, Any] = {"id": kind, "type": kind, **box}
        if kind == "results":
            opts = w.get("opts")
            rows = DEFAULT_ROWS
            if opts is not None:
                if not isinstance(opts, dict):
                    raise LayoutError(S_LAYOUT_ROWS)
                if "rows" in opts:
                    if not isinstance(opts["rows"], str) or opts["rows"] not in ROW_STYLES:
                        raise LayoutError(S_LAYOUT_ROWS)
                    rows = opts["rows"]
            clean["opts"] = {"rows": rows}
        if any(_overlaps(o, clean) for o in out):
            raise LayoutError(S_LAYOUT_OVERLAP)
        out.append(clean)
    return {"widgets": out}


def _clean_id(gallery_id: Any) -> str | None:
    """A gallery id is `uuid4().hex`. Anything else is not one (and is never looked up)."""
    if isinstance(gallery_id, str) and re.fullmatch(r"[0-9a-f]{32}", gallery_id):
        return gallery_id
    return None


# ── reading ──────────────────────────────────────────────────────────────────────────────

def author_label(display_name: Any) -> str:
    """THE author-label rule, the notebook gallery's own (`template_gallery._display_label`):
    a blank or email-looking display name reads "A UCT member". Imported at call time (that
    module is large) and never retyped, so the two galleries cannot disagree."""
    from api.services.journal_two.template_gallery import _display_label
    return _display_label(display_name)


_SELECT = (
    "SELECT g.*, u.display_name AS author_display,"
    " (SELECT COUNT(*) FROM screener_layout_gallery_uses s WHERE s.gallery_id = g.id) AS uses,"
    " (SELECT COUNT(*) FROM screener_layout_gallery_reports r WHERE r.gallery_id = g.id AND r.status = 'open')"
    " AS open_reports,"
    " EXISTS (SELECT 1 FROM screener_layout_gallery_reports r WHERE r.gallery_id = g.id AND r.user_id = ?)"
    " AS reported"
    " FROM screener_layout_gallery g LEFT JOIN users u ON u.id = g.user_id"
)


def _item(row: sqlite3.Row, viewer_id: str, is_admin: bool) -> dict[str, Any]:
    """One layout as a response carries it. Never a user id, never an email."""
    try:
        layout = validate_layout(json.loads(row["layout_json"]))
    except (ValueError, TypeError):
        layout = {"widgets": []}             # a row no board can draw; the client skips it
    out: dict[str, Any] = {
        "id": row["id"],
        "name": row["name"],
        "author": author_label(row["author_display"]),
        "layout": layout,
        "uses": int(row["uses"] or 0),
        "mine": row["user_id"] == viewer_id,
        "status": row["status"] if row["status"] in STATUSES else "pending",
        "reported": bool(row["reported"]),
        "createdAt": row["created_at"],
    }
    # The author is told when their own layout was hidden (it would otherwise read "Shared"
    # while no one can see it). No one else learns it, and report counts stay the admin's.
    if is_admin or out["mine"]:
        out["hidden"] = bool(row["hidden"])
    if is_admin:
        out["reports"] = int(row["open_reports"] or 0)
    return out


def _one(conn: sqlite3.Connection, gallery_id: str, viewer_id: str) -> sqlite3.Row | None:
    return conn.execute(_SELECT + " WHERE g.id = ?", (viewer_id, gallery_id)).fetchone()


def list_for(user_id: str, *, is_admin: bool = False, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """`{items, mine, limits}` and, for an admin only, `queue`."""
    conn, owned = _open(conn)
    try:
        def rows(where: str, order: str, limit: int, *params: Any) -> list[dict[str, Any]]:
            sql = f"{_SELECT} WHERE {where} ORDER BY {order} LIMIT {int(limit)}"
            return [_item(r, user_id, is_admin) for r in conn.execute(sql, (user_id, *params)).fetchall()]

        out: dict[str, Any] = {
            "items": rows("g.status = 'approved' AND g.hidden = 0", "uses DESC, g.created_at DESC, g.rowid DESC",
                          LIST_LIMIT),
            "mine": rows("g.user_id = ?", "g.created_at DESC, g.rowid DESC", MAX_ROWS_PER_MEMBER + MAX_MINE, user_id),
            "limits": {"maxMine": MAX_MINE},
        }
        if is_admin:
            pending = rows("g.status = 'pending'", "g.created_at ASC, g.rowid ASC", QUEUE_LIMIT)
            reported = rows(
                "g.status != 'pending' AND g.hidden = 0 AND EXISTS (SELECT 1 FROM screener_layout_gallery_reports r"
                " WHERE r.gallery_id = g.id AND r.status = 'open')",
                "open_reports DESC, g.created_at ASC, g.rowid ASC", QUEUE_LIMIT)
            hidden = rows("g.status != 'pending' AND g.hidden = 1", "g.updated_at DESC, g.rowid DESC", QUEUE_LIMIT)
            out["queue"] = pending + reported + hidden
        return out
    finally:
        if owned:
            conn.close()


# ── the member's own doors ───────────────────────────────────────────────────────────────

def _delete(conn: sqlite3.Connection, gallery_id: str) -> None:
    conn.execute("DELETE FROM screener_layout_gallery_reports WHERE gallery_id = ?", (gallery_id,))
    conn.execute("DELETE FROM screener_layout_gallery_uses WHERE gallery_id = ?", (gallery_id,))
    conn.execute("DELETE FROM screener_layout_gallery WHERE id = ?", (gallery_id,))


def publish(user_id: str, name: Any, layout: Any, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Share one layout: stored `pending` until an admin approves it. `LayoutError` (400) for a
    name or layout that is refused; `LayoutConflict` (409) at the cap or on a name the member
    already shared. A declined layout of the same name is replaced by the new submission."""
    clean_name = validate_name(name)
    clean_layout = validate_layout(layout)
    key = clean_name.casefold()
    conn, owned = _open(conn)
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            mine = conn.execute(
                "SELECT id, name_key, status FROM screener_layout_gallery WHERE user_id = ?", (user_id,)).fetchall()
            live = [r for r in mine if r["status"] in ("pending", "approved")]
            if any(r["name_key"] == key for r in live):
                raise LayoutConflict(S_DUPLICATE)
            if len(live) >= MAX_MINE:
                raise LayoutConflict(S_CAP)
            replaced = [r["id"] for r in mine if r["status"] == "declined" and r["name_key"] == key]
            if len(mine) - len(replaced) >= MAX_ROWS_PER_MEMBER:
                raise LayoutConflict(S_ROWS_CAP)
            for old in replaced:
                _delete(conn, old)
            gallery_id = uuid.uuid4().hex
            now = _now()
            conn.execute(
                "INSERT INTO screener_layout_gallery (id, user_id, name, name_key, layout_json, status, hidden,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
                (gallery_id, user_id, clean_name, key, json.dumps(clean_layout, separators=(",", ":")), now, now))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        return _item(_one(conn, gallery_id, user_id), user_id, False)
    finally:
        if owned:
            conn.close()


def unpublish(user_id: str, gallery_id: Any, *, is_admin: bool = False,
              conn: sqlite3.Connection | None = None) -> bool:
    """The author (or an admin) removes a layout: the row and every report and use record about
    it. False when there is no such layout, or it is someone else's."""
    gid = _clean_id(gallery_id)
    if gid is None:
        return False
    conn, owned = _open(conn)
    try:
        row = conn.execute("SELECT user_id FROM screener_layout_gallery WHERE id = ?", (gid,)).fetchone()
        if row is None or (row["user_id"] != user_id and not is_admin):
            return False
        _delete(conn, gid)
        conn.commit()
        return True
    finally:
        if owned:
            conn.close()


def _visible(row: sqlite3.Row | None) -> bool:
    return row is not None and row["status"] == "approved" and not row["hidden"]


def use(user_id: str, gallery_id: Any, *, is_admin: bool = False,
        conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Load a listed layout: counted once per member per layout, ever, and never for its own
    author. None when the member cannot see it (the author always sees their own)."""
    gid = _clean_id(gallery_id)
    if gid is None:
        return None
    conn, owned = _open(conn)
    try:
        row = _one(conn, gid, user_id)
        if row is None:
            return None
        own = row["user_id"] == user_id
        if not own and not _visible(row):
            return None
        if not own:
            conn.execute(
                "INSERT OR IGNORE INTO screener_layout_gallery_uses (gallery_id, user_id, created_at)"
                " VALUES (?, ?, ?)", (gid, user_id, _now()))
            conn.commit()
            row = _one(conn, gid, user_id)
        return _item(row, user_id, is_admin)
    finally:
        if owned:
            conn.close()


def report(user_id: str, gallery_id: Any, reason: Any, *,
           conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Report a listed layout. One report per member per layout: a second answers
    `already: true` and changes nothing. None when the member cannot see it."""
    if not isinstance(reason, str) or reason not in REPORT_REASONS:
        raise LayoutError(S_REPORT_REASON)
    gid = _clean_id(gallery_id)
    if gid is None:
        return None
    conn, owned = _open(conn)
    try:
        row = conn.execute("SELECT user_id, status, hidden FROM screener_layout_gallery WHERE id = ?",
                           (gid,)).fetchone()
        if row is None:
            return None
        if row["user_id"] == user_id:
            raise LayoutError(S_REPORT_OWN)
        if not _visible(row):
            return None
        try:
            conn.execute(
                "INSERT INTO screener_layout_gallery_reports (id, gallery_id, user_id, reason, status, created_at)"
                " VALUES (?, ?, ?, ?, 'open', ?)", (uuid.uuid4().hex, gid, user_id, reason, _now()))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            return {"reported": True, "already": True}
        return {"reported": True, "already": False}
    finally:
        if owned:
            conn.close()


# ── the admin's door ─────────────────────────────────────────────────────────────────────

def admin_act(admin_id: str, gallery_id: Any, action: Any, *,
              conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """`approve | decline | hide | unhide | dismiss` on one layout. Approve and decline set the
    status and nothing else; hide and unhide set visibility and leave the status alone; hide and
    dismiss mark the layout's open reports handled. None when there is no such layout."""
    if not isinstance(action, str) or action not in ADMIN_ACTIONS:
        raise LayoutError(S_ADMIN_ACTION)
    gid = _clean_id(gallery_id)
    if gid is None:
        return None
    conn, owned = _open(conn)
    try:
        if conn.execute("SELECT 1 FROM screener_layout_gallery WHERE id = ?", (gid,)).fetchone() is None:
            return None
        now = _now()
        if action in ("approve", "decline"):
            conn.execute("UPDATE screener_layout_gallery SET status = ?, updated_at = ? WHERE id = ?",
                         ("approved" if action == "approve" else "declined", now, gid))
        elif action in ("hide", "unhide"):
            conn.execute("UPDATE screener_layout_gallery SET hidden = ?, updated_at = ? WHERE id = ?",
                         (1 if action == "hide" else 0, now, gid))
        if action in ("hide", "dismiss"):
            conn.execute("UPDATE screener_layout_gallery_reports SET status = 'handled'"
                         " WHERE gallery_id = ? AND status = 'open'", (gid,))
        conn.commit()
        return _item(_one(conn, gid, admin_id), admin_id, True)
    finally:
        if owned:
            conn.close()
