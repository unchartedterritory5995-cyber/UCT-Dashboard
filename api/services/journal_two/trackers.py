"""Notebook widgets wave 9 (Task 9.5): the tracker store, with check-ins as two read-only trackers.

CRUD over `j2_trackers` and one value per day in `j2_tracker_values`. The sibling of
`routines.py` (Task 9.4), shaped the same way so the router (Task 9.6) can treat both alike:
the same error shape, optional `now=` and `conn=` on every entry point, the etag If-Match,
recently deleted for 30 days, the count cap, a template-key create that returns the existing
row, and archived trackers that refuse edits.

Rules this module keeps:
  * Ownership: every read and write is `WHERE id = ? AND user_id = ?`. A foreign, unknown or
    deleted id is absent: reads leave it out, writes raise `NotFound`.
  * Values go through `tracker_days.clean_value` and nothing else: a bad value is refused with
    its member sentence and stores nothing. `None` clears the day's row.
  * The write window is `routine_days.write_window(today)` (ruling W9-R1), the routines' own.
    A `trading` tracker also refuses a day that is not a session.
  * Value writes run under `BEGIN IMMEDIATE` (`widget_definitions._begin_immediate`), with
    ownership re-checked inside the transaction.
  * Built-ins: `checkin:mood` and `checkin:focus` are the member's check-ins seen as two 1-5
    trackers. Their ids carry a colon, so they can never collide with a `uuid4`. They read
    `j2_note_checkins` through `widget_engine.sources._checkins` (the one check-in rule: the
    value from the note updated last, trashed and sample notes excluded), and refuse every
    write with `S_READ_ONLY`.
  * ⛔ This module writes no `j2_notes` SQL. The built-ins' READ joins `j2_notes`.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from api.services.journal_two import routine_days, tracker_days, trading_days
from api.services.journal_two.notebook_widgets import _num
from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.journal_two.tool_errors import ToolError
from api.services.journal_two.widget_definitions import _begin_immediate, _read, _write

__all__ = [
    "COUNT_CAP", "NAME_MAX", "KIND", "RECENT_MAX", "DAYS_CHOICES", "RECENTLY_DELETED_DAYS",
    "READ_IDS_MAX", "READ_DAYS_MAX", "DAY_MIN", "DAY_AHEAD_MAX", "BUILTIN", "DEFAULT_SETTINGS",
    "TrackerError", "NotFound", "Conflict", "OutsideWindow", "ReadOnly", "CountCap",
    "create", "get", "update", "list_trackers", "archive", "unarchive", "soft_delete",
    "undelete", "duplicate", "set_value", "read_days", "is_builtin",
]

COUNT_CAP = 30
NAME_MAX = 80
KIND = "tracker"
RECENT_MAX = 30
DAYS_CHOICES = ("trading", "any")
RECENTLY_DELETED_DAYS = 30
READ_IDS_MAX = 30
READ_DAYS_MAX = 31
#: W9-R9, as routines: a day outside [DAY_MIN, today + DAY_AHEAD_MAX] is refused with S_BAD_DAY.
DAY_MIN = date(1990, 1, 1)
DAY_AHEAD_MAX = 366
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

BUILTIN: dict[str, dict] = {
    "checkin:mood": {"name": "Check-in mood", "kind": "scale", "readOnly": True},
    "checkin:focus": {"name": "Check-in focus", "kind": "scale", "readOnly": True},
}
_BUILTIN_DIM = {"checkin:mood": "mood", "checkin:focus": "focus"}

S_CAP = "You have 30 trackers. Archive one in My tools to make room."
S_NOT_FOUND = "Not available."
S_ARCHIVED = "Archived tracker, history only"
S_READ_ONLY = "Mood and focus come from your check-ins."
S_TRADING_ONLY = "This tracker logs trading days only."
S_KIND_FIXED = "A tracker's type can't change. Make a new tracker instead."
S_CONFLICT = "Changed in another tab. Reload to see the newer version."
S_WINDOW = routine_days.S_WINDOW
# The tracker_days value sentences, re-exported so a caller needs one module.
S_YESNO = tracker_days.S_YESNO
S_SCALE = tracker_days.S_SCALE
S_NUMBER = tracker_days.S_NUMBER
S_DURATION = tracker_days.S_DURATION
S_UNIT = tracker_days.S_UNIT
S_KIND = tracker_days.S_KIND
# Not named by the brief; each is the member sentence for a refusal the brief requires.
S_BAD_NAME = "Give the tracker a name."
S_NAME_LONG = "A name can be at most 80 characters."
S_BAD_DAY = "Dates need to look like 2026-10-24."
S_BAD_SETTINGS = "These tracker settings couldn't be saved."
S_BAD_DAYS = "Pick which days this tracker logs."
S_ARCHIVE_FIRST = "Archive this tracker before deleting it."
S_TYPE_NAME = "Type the tracker's name exactly to delete it."
S_BAD_FILTER = "Choose active, archived or deleted trackers."
S_TOO_MANY_IDS = "Ask for at most 30 trackers at once."
S_BAD_IDS = "Pick up to 30 trackers."
S_TOO_MANY_DAYS = "Ask for at most 31 days at once."

DEFAULT_SETTINGS: dict = {"days": "trading"}
_BUILTIN_SETTINGS: dict = {"days": "any"}
TODAY_TOKEN = "today"

_T = "j2_trackers"
_V = "j2_tracker_values"
_TEMPLATE_KEY_MAX = 64
_MISSING = object()


class TrackerError(ToolError):
    """A refusal whose message is a member sentence (`.sentence`), with an HTTP status and code
    (the shared `tool_errors.ToolError` shape, ruling W9-R10; a sibling of `RoutineError`)."""


class NotFound(TrackerError):
    status = 404
    code = "not_found"

    def __init__(self, sentence: str = S_NOT_FOUND):
        super().__init__(sentence)


class Conflict(TrackerError):
    status = 409
    code = "conflict"

    def __init__(self, sentence: str = S_CONFLICT):
        super().__init__(sentence)


class OutsideWindow(TrackerError):
    status = 400
    code = "window"

    def __init__(self, sentence: str = S_WINDOW):
        super().__init__(sentence)


class CountCap(TrackerError):
    """The live-tracker cap (COUNT_CAP) is reached: create, unarchive, duplicate and a
    template restore all refuse with it (W9-R14: the store owns the 409 `count_cap`)."""
    status = 409
    code = "count_cap"

    def __init__(self, sentence: str = S_CAP):
        super().__init__(sentence)


class ReadOnly(TrackerError):
    status = 409
    code = "read_only"

    def __init__(self, sentence: str = S_ARCHIVED):
        super().__init__(sentence)


# ── plumbing ───────────────────────────────────────────────────────────────────────────────────

def is_builtin(tid: Any) -> bool:
    return isinstance(tid, str) and tid in BUILTIN


def _refuse_builtin(tid: Any) -> None:
    if is_builtin(tid):
        raise ReadOnly(S_READ_ONLY)


def _now(now: datetime | None) -> datetime:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _iso(ts: datetime) -> str:
    return ts.isoformat()


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _parse_day(v: Any, today: date) -> date:
    """A strict `YYYY-MM-DD` (no ISO week dates) within [DAY_MIN, today + DAY_AHEAD_MAX]."""
    if not isinstance(v, str) or not _DAY_RE.match(v):
        raise TrackerError(S_BAD_DAY)
    try:
        d = date.fromisoformat(v)
    except ValueError:
        raise TrackerError(S_BAD_DAY) from None
    if not DAY_MIN <= d <= today + timedelta(days=DAY_AHEAD_MAX):
        raise TrackerError(S_BAD_DAY)
    return d


def _dump(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def _load(s: str | None, fallback: Any) -> Any:
    try:
        v = json.loads(s) if s else fallback
    except (TypeError, ValueError):
        return fallback
    return v if isinstance(v, type(fallback)) else fallback


# ── validation ─────────────────────────────────────────────────────────────────────────────────

def _clean_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise TrackerError(S_BAD_NAME)
    clean = name.strip()
    if len(clean) > NAME_MAX:
        raise TrackerError(S_NAME_LONG)
    return clean


def _clean_kind(kind: Any) -> str:
    if not isinstance(kind, str) or kind not in tracker_days.KINDS:
        raise TrackerError(S_KIND)
    return kind


def _clean_unit(unit: Any) -> str | None:
    """A unit is optional text, at most UNIT_MAX characters; blank is none."""
    if unit is None:
        return None
    if not isinstance(unit, str):
        raise TrackerError(S_UNIT)
    clean = unit.strip()
    if len(clean) > tracker_days.UNIT_MAX:
        raise TrackerError(S_UNIT)
    return clean or None


def _clean_settings(raw: Any, base: dict | None = None) -> dict:
    """The given keys over `base` (or the defaults), validated whole."""
    merged = dict(DEFAULT_SETTINGS)
    if base:
        merged.update({k: base[k] for k in DEFAULT_SETTINGS if k in base})
    if raw is not None:
        if not isinstance(raw, dict):
            raise TrackerError(S_BAD_SETTINGS)
        merged.update({k: raw[k] for k in DEFAULT_SETTINGS if k in raw})
    if merged["days"] not in DAYS_CHOICES:
        raise TrackerError(S_BAD_DAYS)
    return {"days": merged["days"]}


def _clean_value(kind: str, raw: Any) -> float:
    try:
        return tracker_days.clean_value(kind, raw)
    except ValueError as e:
        raise TrackerError(str(e)) from None


# ── rows ───────────────────────────────────────────────────────────────────────────────────────

def _owned(c: sqlite3.Connection, user_id: str, tid: Any, *,
           deleted: bool = False) -> sqlite3.Row | None:
    if not isinstance(tid, str) or not tid or not user_id or is_builtin(tid):
        return None
    gate = "deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"
    return c.execute(f"SELECT * FROM {_T} WHERE id = ? AND user_id = ? AND {gate}",
                     (tid, user_id)).fetchone()


def _live_count(c: sqlite3.Connection, user_id: str) -> int:
    return c.execute(f"SELECT COUNT(*) FROM {_T} WHERE user_id = ? AND archived_at IS NULL"
                     " AND deleted_at IS NULL", (user_id,)).fetchone()[0]


def _check_cap(c: sqlite3.Connection, user_id: str) -> None:
    if _live_count(c, user_id) >= COUNT_CAP:
        raise CountCap()


def _settings(row: sqlite3.Row) -> dict:
    try:
        return _clean_settings(None, _load(row["settings_json"], {}))
    except TrackerError:
        return dict(DEFAULT_SETTINGS)


def _created_day(row: sqlite3.Row) -> str | None:
    return compute_trading_day_et(row["created_at"])


def _shape(row: sqlite3.Row) -> dict:
    out = {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "unit": row["unit"],
        "settings": _settings(row),
        "archived": row["archived_at"] is not None,
        "deleted": row["deleted_at"] is not None,
        "etag": row["save_seq"],
        "readOnly": False,
        "usedIn": 0,
        "createdDay": _created_day(row),
        "updatedAt": row["updated_at"],
        "sourceTemplateKey": row["source_template_key"],
    }
    if row["deleted_at"] is not None:
        out["deletedAt"] = row["deleted_at"]
    return out


def _builtin_shape(tid: str) -> dict:
    b = BUILTIN[tid]
    return {"id": tid, "name": b["name"], "kind": b["kind"], "unit": None,
            "settings": dict(_BUILTIN_SETTINGS), "archived": False, "deleted": False,
            "etag": None, "readOnly": True, "usedIn": 0, "createdDay": None,
            "updatedAt": None, "sourceTemplateKey": None}


def _insert(c: sqlite3.Connection, user_id: str, name: str, kind: str, unit: str | None,
            settings: dict, ts: str, template_key: str | None) -> str:
    tid = str(uuid.uuid4())
    c.execute(
        f"INSERT INTO {_T} (id, user_id, name, kind, unit, settings_json, created_at,"
        " updated_at, archived_at, deleted_at, save_seq, source_gallery_id, source_template_key)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, NULL, ?)",
        (tid, user_id, name, kind, unit, _dump(settings), ts, ts, template_key))
    return tid


# ── CRUD ───────────────────────────────────────────────────────────────────────────────────────

def create(user_id: str, *, name: Any, kind: Any, unit: Any = None, settings: dict | None = None,
           source_template_key: str | None = None, now: datetime | None = None,
           conn: sqlite3.Connection | None = None) -> dict:
    """A new tracker. A second create with the same `source_template_key` returns the existing
    tracker."""
    clean_name = _clean_name(name)
    clean_kind = _clean_kind(kind)
    clean_unit = _clean_unit(unit)
    clean_settings = _clean_settings(settings)
    key = source_template_key if isinstance(source_template_key, str) else None
    key = key.strip()[:_TEMPLATE_KEY_MAX] if key and key.strip() else None
    now_dt = _now(now)
    with _write(conn) as c:
        if key is not None:
            have = c.execute(f"SELECT * FROM {_T} WHERE user_id = ? AND source_template_key = ?",
                             (user_id, key)).fetchone()
            if have is not None and have["deleted_at"] is not None:
                # W9-R12: a template key found on a deleted row restores that row live (out of
                # Recently deleted and out of the archive, the cap checked); past the 30 days
                # it is purged and the template starts afresh.
                when = _parse_ts(have["deleted_at"])
                if when is None or now_dt - when > timedelta(days=RECENTLY_DELETED_DAYS):
                    c.execute(f"DELETE FROM {_V} WHERE user_id = ? AND tracker_id = ?",
                              (user_id, have["id"]))
                    c.execute(f"DELETE FROM {_T} WHERE id = ? AND user_id = ?",
                              (have["id"], user_id))
                    have = None
                else:
                    _check_cap(c, user_id)
                    c.execute(f"UPDATE {_T} SET deleted_at = NULL, archived_at = NULL,"
                              " updated_at = ? WHERE id = ? AND user_id = ?",
                              (_iso(now_dt), have["id"], user_id))
                    return _shape(_owned(c, user_id, have["id"]))
            if have is not None:
                return _shape(have)
        _check_cap(c, user_id)
        tid = _insert(c, user_id, clean_name, clean_kind, clean_unit, clean_settings,
                      _iso(now_dt), key)
        return _shape(_owned(c, user_id, tid))


def get(user_id: str, tid: str, *, now: datetime | None = None,
        conn: sqlite3.Connection | None = None) -> dict | None:
    """`{id, name, kind, unit, settings, archived, deleted, etag, readOnly, usedIn, ...}`, or None
    for a foreign, unknown or deleted id. A built-in id answers its built-in row."""
    if is_builtin(tid):
        return _builtin_shape(tid)
    with _read(conn) as c:
        row = _owned(c, user_id, tid)
        return None if row is None else _shape(row)


def update(user_id: str, tid: str, *, if_match: int, name: Any = None, unit: Any = _MISSING,
           settings: dict | None = None, kind: Any = _MISSING, now: datetime | None = None,
           conn: sqlite3.Connection | None = None) -> dict:
    """Edit a tracker. `if_match` is its `etag`; anything else is `Conflict` and nothing is
    written. A `kind` is never changed (`S_KIND_FIXED`). `unit=None` clears the unit; leaving it
    out keeps it. An archived tracker is read-only; a built-in always is."""
    _refuse_builtin(tid)
    if kind is not _MISSING:
        raise TrackerError(S_KIND_FIXED)
    clean_name = _clean_name(name) if name is not None else None
    clean_unit = _clean_unit(unit) if unit is not _MISSING else _MISSING
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, tid)
        if row is None:
            raise NotFound()
        if isinstance(if_match, bool) or not isinstance(if_match, int) \
                or if_match != row["save_seq"]:
            raise Conflict()
        if row["archived_at"] is not None:
            raise ReadOnly()
        new_settings = (_clean_settings(settings, _settings(row)) if settings is not None
                        else _settings(row))
        new_unit = row["unit"] if clean_unit is _MISSING else clean_unit
        c.execute(f"UPDATE {_T} SET name = ?, unit = ?, settings_json = ?, updated_at = ?,"
                  " save_seq = save_seq + 1 WHERE id = ? AND user_id = ?",
                  (clean_name or row["name"], new_unit, _dump(new_settings), ts, tid, user_id))
        return _shape(_owned(c, user_id, tid))


def _purge_old_deleted(c: sqlite3.Connection, user_id: str, now_dt: datetime) -> int:
    """One DELETE per table: this member's values of trackers deleted before the cutoff, then
    those trackers."""
    cutoff = _iso(now_dt - timedelta(days=RECENTLY_DELETED_DAYS))
    c.execute(f"DELETE FROM {_V} WHERE user_id = ? AND tracker_id IN (SELECT id FROM {_T}"
              " WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?)",
              (user_id, user_id, cutoff))
    return c.execute(f"DELETE FROM {_T} WHERE user_id = ? AND deleted_at IS NOT NULL"
                     " AND deleted_at < ?", (user_id, cutoff)).rowcount


def list_trackers(user_id: str, *, filter: Literal["active", "archived", "deleted"] = "active",
                  now: datetime | None = None,
                  conn: sqlite3.Connection | None = None) -> list[dict]:
    """The member's trackers, newest edit first; on `active` the two built-ins come first.
    Hard-deletes this member's trackers deleted more than RECENTLY_DELETED_DAYS ago, with their
    values."""
    gates = {"active": "deleted_at IS NULL AND archived_at IS NULL",
             "archived": "deleted_at IS NULL AND archived_at IS NOT NULL",
             "deleted": "deleted_at IS NOT NULL"}
    if filter not in gates:
        raise TrackerError(S_BAD_FILTER)
    now_dt = _now(now)
    cutoff = _iso(now_dt - timedelta(days=RECENTLY_DELETED_DAYS))
    with _read(conn) as c:
        stale = c.execute(f"SELECT 1 FROM {_T} WHERE user_id = ? AND deleted_at IS NOT NULL"
                          " AND deleted_at < ? LIMIT 1", (user_id, cutoff)).fetchone()
    if stale is not None:
        with _write(conn) as c:
            _purge_old_deleted(c, user_id, now_dt)
    with _read(conn) as c:
        rows = c.execute(f"SELECT * FROM {_T} WHERE user_id = ? AND {gates[filter]}"
                         " ORDER BY updated_at DESC, id DESC", (user_id,)).fetchall()
        own = [_shape(r) for r in rows]
    if filter == "active":
        return [_builtin_shape(b) for b in BUILTIN] + own
    return own


def archive(user_id: str, tid: str, *, now: datetime | None = None,
            conn: sqlite3.Connection | None = None) -> dict:
    _refuse_builtin(tid)
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, tid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is None:
            c.execute(f"UPDATE {_T} SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                      (ts, ts, tid, user_id))
        return _shape(_owned(c, user_id, tid))


def unarchive(user_id: str, tid: str, *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """Back to My tools. Refused at the cap."""
    _refuse_builtin(tid)
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, tid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is not None:
            _check_cap(c, user_id)
            c.execute(f"UPDATE {_T} SET archived_at = NULL, updated_at = ? WHERE id = ?"
                      " AND user_id = ?", (ts, tid, user_id))
        return _shape(_owned(c, user_id, tid))


def soft_delete(user_id: str, tid: str, *, typed_name: Any, now: datetime | None = None,
                conn: sqlite3.Connection | None = None) -> dict:
    """Move an ARCHIVED tracker to Recently deleted, only when `typed_name == name`."""
    _refuse_builtin(tid)
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, tid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is None:
            raise TrackerError(S_ARCHIVE_FIRST)
        if not isinstance(typed_name, str) or typed_name != row["name"]:
            raise TrackerError(S_TYPE_NAME)
        c.execute(f"UPDATE {_T} SET deleted_at = ? WHERE id = ? AND user_id = ?",
                  (ts, tid, user_id))
        return {"id": tid, "deletedAt": ts}


def undelete(user_id: str, tid: str, *, now: datetime | None = None,
             conn: sqlite3.Connection | None = None) -> dict:
    """Bring a recently deleted tracker back (still archived). Past the 30 days it is gone."""
    _refuse_builtin(tid)
    now_dt = _now(now)
    with _write(conn) as c:
        row = _owned(c, user_id, tid, deleted=True)
        if row is None:
            raise NotFound()
        when = _parse_ts(row["deleted_at"])
        if when is None or now_dt - when > timedelta(days=RECENTLY_DELETED_DAYS):
            raise NotFound()
        c.execute(f"UPDATE {_T} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
                  (_iso(now_dt), tid, user_id))
        return _shape(_owned(c, user_id, tid))


def duplicate(user_id: str, tid: str, *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """A new live tracker "<name> copy" with the same kind, unit and settings. No values are
    copied, and the template key is not (it is unique)."""
    _refuse_builtin(tid)
    now_dt = _now(now)
    with _write(conn) as c:
        row = _owned(c, user_id, tid)
        if row is None:
            raise NotFound()
        _check_cap(c, user_id)
        name = (row["name"] + " copy")[:NAME_MAX]
        new_id = _insert(c, user_id, name, row["kind"], row["unit"], _settings(row),
                         _iso(now_dt), None)
        return _shape(_owned(c, user_id, new_id))


# ── values ─────────────────────────────────────────────────────────────────────────────────────

def _text(kind: str, value: float | None, unit: str | None) -> str | None:
    return tracker_days.format_value(kind, value, unit) or None


def _writable(meta: dict, d: date, today: date) -> bool:
    if meta["readOnly"] or meta["archived"]:
        return False
    if not routine_days.in_window(d, today):
        return False
    return meta["settings"]["days"] == "any" or trading_days.is_session(d)


def _tracker_day(meta: dict, d: date, value: Any, today: date) -> dict:
    v = _num(value)
    return {"day": d.isoformat(), "value": v, "text": _text(meta["kind"], v, meta["unit"]),
            "writable": _writable(meta, d, today)}


def set_value(user_id: str, tid: str, day: str, value: Any, *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """Log one day's value; `None` clears it. Answers that day's `TrackerDay`
    `{day, value, text, writable}`."""
    _refuse_builtin(tid)
    now_dt = _now(now)
    today = trading_days.today_et(now_dt)
    d = _parse_day(day, today)
    if not routine_days.in_window(d, today):    # M1: refused before the write lock is taken
        raise OutsideWindow()
    owned = conn is None
    from api.services import auth_db
    c = conn or auth_db.get_connection()
    began = False
    try:
        if not c.in_transaction:
            _begin_immediate(c)
            began = True
        row = _owned(c, user_id, tid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is not None:
            raise ReadOnly()
        meta = _shape(row)
        if meta["settings"]["days"] == "trading" and not trading_days.is_session(d):
            raise TrackerError(S_TRADING_ONLY)
        if value is None:
            c.execute(f"DELETE FROM {_V} WHERE user_id = ? AND tracker_id = ? AND day = ?",
                      (user_id, tid, d.isoformat()))
            stored = None
        else:
            stored = _clean_value(row["kind"], value)
            c.execute(f"INSERT INTO {_V} (user_id, tracker_id, day, value, updated_at)"
                      " VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, tracker_id, day)"
                      " DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                      (user_id, tid, d.isoformat(), stored, _iso(now_dt)))
        out = _tracker_day(meta, d, stored, today)
        if began:
            c.commit()
        return out
    except BaseException:
        if began:
            c.rollback()
        raise
    finally:
        if owned:
            c.close()


# ── the batched read ───────────────────────────────────────────────────────────────────────────

def _checkin_values(c: sqlite3.Connection, user_id: str, lo: str,
                    hi: str) -> dict[str, dict[str, float]]:
    """dim ("mood" / "focus") -> day -> value, by the shared check-in rule, from ONE call.
    Imported here so the widget engine may later import this module without a cycle."""
    from api.services.journal_two.widget_engine.sources import _checkins
    out: dict[str, dict[str, float]] = {"mood": {}, "focus": {}}
    for d, v in _checkins(c, user_id, lo, hi).items():
        for dim in out:
            if v.get(dim) is not None:
                out[dim][d] = v[dim]
    return out


def _stored_values(c: sqlite3.Connection, user_id: str, tids: list[str],
                   hi: str) -> dict[str, dict[str, float]]:
    """tracker id -> day -> value for days on or before `hi`, in ONE query."""
    out: dict[str, dict[str, float]] = {t: {} for t in tids}
    if not tids:
        return out
    marks = ",".join("?" for _ in tids)
    for tid, d, v in c.execute(
            f"SELECT tracker_id, day, value FROM {_V} WHERE user_id = ?"
            f" AND tracker_id IN ({marks}) AND day <= ?", (user_id, *tids, hi)):
        out[tid][d] = v
    return out


def _summary(meta: dict, values: dict[str, float], days: list[date], today: date) -> dict:
    """W9-R13: recent, average, latest and n come from the RECENT_MAX newest of `values`, which
    the queries already bound to days on or before the latest requested day (the ONE place that
    bound lives), so a past note's summary never moves."""
    recent_days = sorted(values)[-RECENT_MAX:]
    recent = [{"day": d, "value": _num(values[d])} for d in recent_days]
    rows = [{"tracker": meta["id"], "day": r["day"], "value": r["value"]} for r in recent]
    avg = tracker_days.TRACKER_MEASURES["tracker_avg"].fn(rows).value
    latest = recent[-1] if recent and recent[-1]["value"] is not None else None
    return {"tracker": meta,
            "days": {d.isoformat(): _tracker_day(meta, d, values.get(d.isoformat()), today)
                     for d in days},
            "recent": recent,
            "average": _num(avg),
            "latest": dict(latest) if latest else None,
            # W9-R7: no entries is no count, never a 0.
            "n": len(recent) or None}


def read_days(user_id: str, ids: list[str], days: list[str], *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """`{"resolved": {"today": day}?, "trackers": {id: {"tracker", "days": {day: TrackerDay},
    "recent": [{day, value}] (newest RECENT_MAX on or before the latest requested day, oldest
    first), "average", "latest", "n"}}}`. At most READ_IDS_MAX ids and READ_DAYS_MAX days.
    `"today"` is the session on or after today ET, as for routines. Foreign, unknown and deleted
    ids are absent; the built-ins answer the caller's own check-ins. One tracker query, one value
    query and at most one check-in query, whatever the number of ids."""
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise TrackerError(S_BAD_IDS)
    if not isinstance(days, list):
        raise TrackerError(S_BAD_DAY)
    want_ids = list(dict.fromkeys(i for i in ids if i))
    if len(want_ids) > READ_IDS_MAX:
        raise TrackerError(S_TOO_MANY_IDS)
    if not all(isinstance(d, str) for d in days):
        raise TrackerError(S_BAD_DAY)
    if len(set(days)) > READ_DAYS_MAX:
        raise TrackerError(S_TOO_MANY_DAYS)
    today = trading_days.today_et(_now(now))
    out: dict = {"trackers": {}}
    resolved: list[date] = []
    for d in dict.fromkeys(days):
        if d == TODAY_TOKEN:
            t = trading_days.session_on_or_after(today)
            out["resolved"] = {TODAY_TOKEN: t.isoformat()}
            resolved.append(t)
        else:
            resolved.append(_parse_day(d, today))
    resolved = sorted(set(resolved))
    if not want_ids:
        return out
    upto = (resolved[-1] if resolved else today).isoformat()
    with _read(conn) as c:
        own_ids = [i for i in want_ids if not is_builtin(i)]
        by_id: dict[str, sqlite3.Row] = {}
        if own_ids:
            marks = ",".join("?" for _ in own_ids)
            by_id = {r["id"]: r for r in c.execute(
                f"SELECT * FROM {_T} WHERE user_id = ? AND deleted_at IS NULL"
                f" AND id IN ({marks})", (user_id, *own_ids))}
        stored = _stored_values(c, user_id, [i for i in own_ids if i in by_id], upto)
        checkins = (_checkin_values(c, user_id, DAY_MIN.isoformat(), upto)
                    if any(is_builtin(i) for i in want_ids) else None)
        for tid in want_ids:
            if is_builtin(tid):
                meta, values = _builtin_shape(tid), checkins[_BUILTIN_DIM[tid]]
            elif tid in by_id:
                meta, values = _shape(by_id[tid]), stored[tid]
            else:
                continue
            out["trackers"][tid] = _summary(meta, values, resolved, today)
    return out
