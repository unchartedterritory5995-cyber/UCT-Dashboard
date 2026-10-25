"""Notebook widgets wave 9 (Task 9.4): the routine store.

CRUD over `j2_routines`, versioned schedules (`j2_routine_schedules`), per-item ticks
(`j2_routine_ticks`), skipped days (`j2_routine_days`) and the batched day read. Day states,
consistency and runs are derived here from `routine_days` (Task 9.3), never stored.

Rules this module keeps:
  * Ownership: every read and write is `WHERE id = ? AND user_id = ?`. A foreign, unknown or
    deleted id is absent: reads leave it out, writes raise `NotFound`.
  * If-Match (R-15): `save_seq` is the `etag`; an edit whose `if_match` differs raises `Conflict`
    and writes nothing. Ticks and skips take no If-Match: they merge per item.
  * History is never rewritten. An item keeps its id across a rename; a removal sets the item's
    exclusive `to = today`; a new item starts `from = today`. A schedule change writes the row
    for `effective_from = today`, replacing only a row of the same day.
  * Ticks and skips run under `BEGIN IMMEDIATE` (`widget_definitions._begin_immediate`) with
    ownership re-checked inside the transaction, upsert ONE row and answer the merged day, so
    two devices ticking different items of one day both survive.
  * The write window is `routine_days.write_window(today)` (ruling W9-R1).
  * ⛔ The only `j2_notes` SQL here is the read-only `used_in_notes` join (Task 9.10), which counts
    the member's own live, non-sample notes through `sample_marker.not_sample_sql`.
  * Recently deleted: 30 days. A member's rows deleted longer ago are hard-deleted, with their
    schedules, ticks, days and reminder claims, whenever that member lists their routines.

Connections follow the widget store: every entry point takes `conn=`; with none it opens and
closes its own. Time is injected (`now=`) wherever a rule reads the clock.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from api.services import session_calendar
from api.services.journal_two import routine_days, sample_marker, trading_days
from api.services.journal_two.filters import ANALYTICS_INCLUDED_SQL, _DAY
from api.services.journal_two.notebook_widgets import _num
from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.journal_two.tool_errors import ToolError
from api.services.journal_two.widget_definitions import _begin_immediate, _read, _write

__all__ = [
    "COUNT_CAP", "ITEMS_CAP", "NAME_MAX", "ITEM_MAX", "RECENTLY_DELETED_DAYS", "READ_IDS_MAX",
    "READ_DAYS_MAX", "KIND", "DAY_MIN", "DAY_AHEAD_MAX",
    "STORED_ITEMS_MAX", "STARTERS", "DEFAULT_SETTINGS",
    "RoutineError", "NotFound", "Conflict", "OutsideWindow", "ReadOnly", "CountCap",
    "create", "get", "update", "list_routines", "archive", "unarchive", "soft_delete",
    "undelete", "duplicate", "traded_days", "set_tick", "set_skipped", "read_days",
    "import_day_rules", "starters", "used_in_notes",
]

COUNT_CAP = 30
ITEMS_CAP = 25
NAME_MAX = 80
ITEM_MAX = 200
RECENTLY_DELETED_DAYS = 30
READ_IDS_MAX = 30
READ_DAYS_MAX = 31
KIND = "routine"

S_CAP = "You have 30 routines. Archive one in My tools to make room."
S_CONFLICT = "Changed in another tab. Reload to see the newer version."
S_NOT_FOUND = "Not available."
S_ARCHIVED = "Archived routine, history only"
S_WINDOW = routine_days.S_WINDOW
S_BAD_NAME = "Give the routine a name."
S_NAME_LONG = "A name can be at most 80 characters."
S_TOO_MANY_ITEMS = "A routine can hold up to 25 items."
S_ITEM_LONG = "An item can be at most 200 characters."
S_NO_ITEMS = "Add at least one item."
S_BAD_SCHEDULE = "Pick when this routine runs."
S_BAD_DAY = "Dates need to look like 2026-10-24."
S_ARCHIVE_FIRST = "Archive this routine before deleting it."
S_TYPE_NAME = "Type the routine's name exactly to delete it."
S_UNKNOWN_ITEM = "That item isn't in this routine."
# Not named by the brief; each is the member sentence for a refusal the brief requires.
S_BAD_SHARE = "Pick how much of the routine counts as done."
S_BAD_TIME = "Pick a reminder time in 5-minute steps."
S_BAD_SETTINGS = "These routine settings couldn't be saved."
S_BAD_TICK = "Choose ticked or not ticked."
S_OFF_DAY = "This routine didn't run that day."
S_BAD_SKIP = "Choose skipped or not skipped."
S_BAD_FILTER = "Choose active, archived or deleted routines."
S_TOO_MANY_IDS = "Ask for at most 30 routines at once."
S_BAD_IDS = "Pick up to 30 routines."
S_TOO_MANY_DAYS = "Ask for at most 31 days at once."

DEFAULT_SETTINGS: dict = {"done_share": 1.0, "strict": False, "reminder": None}
TODAY_TOKEN = "today"

_R = "j2_routines"

# The member's live, non-sample notes that place one of the member's OWN routines (Task 9.10).
# Ownership is on all three tables, as widget_definitions._USES_JOIN: `u.user_id` is the note
# owner's, `n.user_id` re-checks it against the note, and `t.user_id` makes an id that is not
# the member's routine count and list nothing. ⛔ The sample predicate is the one in sample_marker.
_USES = "j2_tool_uses"
_USES_JOIN = (
    f" FROM {_USES} u JOIN j2_notes n ON n.id = u.note_id AND n.user_id = u.user_id"
    f" JOIN {_R} t ON t.id = u.tool_id AND t.user_id = u.user_id"
    f" WHERE u.user_id = ? AND u.kind = 'routine' AND n.deleted_at IS NULL"
    " AND " + sample_marker.not_sample_sql("n")
)
_SCHED = "j2_routine_schedules"
_TICKS = "j2_routine_ticks"
_DAYS = "j2_routine_days"
_CLAIMS = "j2_routine_reminder_claims"
_CHILDREN = (_SCHED, _TICKS, _DAYS, _CLAIMS)
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: W9-R9: a day outside [DAY_MIN, today + DAY_AHEAD_MAX] is refused with S_BAD_DAY.
DAY_MIN = date(1990, 1, 1)
DAY_AHEAD_MAX = 366
#: M4: at most this many stored items (current + ended); the oldest ended ones go first.
STORED_ITEMS_MAX = 200
_RULE_MAX = 40
_TEMPLATE_KEY_MAX = 64


class RoutineError(ToolError):
    """A refusal whose message is a member sentence (`.sentence`), with an HTTP status and code
    (the shared `tool_errors.ToolError` shape, ruling W9-R10)."""


class NotFound(RoutineError):
    status = 404
    code = "not_found"

    def __init__(self, sentence: str = S_NOT_FOUND):
        super().__init__(sentence)


class Conflict(RoutineError):
    status = 409
    code = "conflict"

    def __init__(self, sentence: str = S_CONFLICT):
        super().__init__(sentence)


class OutsideWindow(RoutineError):
    status = 400
    code = "window"

    def __init__(self, sentence: str = S_WINDOW):
        super().__init__(sentence)


class CountCap(RoutineError):
    """The live-routine cap (COUNT_CAP) is reached: create, unarchive, duplicate and a
    template restore all refuse with it (W9-R14: the store owns the 409 `count_cap`)."""
    status = 409
    code = "count_cap"

    def __init__(self, sentence: str = S_CAP):
        super().__init__(sentence)


class ReadOnly(RoutineError):
    status = 409
    code = "read_only"

    def __init__(self, sentence: str = S_ARCHIVED):
        super().__init__(sentence)


# ── starters ───────────────────────────────────────────────────────────────────────────────────

def _it(text: str, negative: bool = False, suggest: dict | None = None) -> dict:
    return {"text": text, "negative": negative, "suggest": suggest}


STARTERS: dict[str, dict] = {
    "premarket": {"name": "Pre-market routine", "items": [
        _it("Read the morning wire"),
        _it("Check today's economic calendar"),
        _it("Review open positions and stops"),
        _it("Mark key levels on my watchlist"),
        _it("Set my max loss for today"),
    ]},
    "preentry": {"name": "Pre-entry checks", "items": [
        _it("The setup is in my playbook"),
        _it("My stop is set before entry"),
        _it("Size fits my risk per trade"),
        _it("The market is not against the trade"),
    ]},
    "eod": {"name": "End-of-day review", "items": [
        _it("Log every trade"),
        _it("Tag setups and mistakes"),
        _it("Save a screenshot of my best and worst trade"),
        _it("Write one lesson"),
        _it("Build tomorrow's watchlist"),
    ]},
    "rules": {"name": "Rules I keep", "items": [
        _it("Stop on every trade", suggest={"rule": "stop_every_trade"}),
        _it("Max 3 trades", suggest={"rule": "max_trades", "n": 3}),
        _it("Stayed under my daily loss limit", suggest={"rule": "under_daily_loss_limit"}),
        _it("No trade within 10 min of a loss", True, {"rule": "no_trade_after_loss", "n": 10}),
        _it("No revenge trades", True, {"rule": "no_revenge"}),
    ]},
}


def starters() -> list[dict]:
    """`[{key, name, items: [{text, negative, suggest}]}]`, fresh copies every call."""
    return [{"key": k, "name": v["name"],
             "items": [{"text": i["text"], "negative": i["negative"],
                        "suggest": dict(i["suggest"]) if i["suggest"] else None}
                       for i in v["items"]]}
            for k, v in STARTERS.items()]


# ── plumbing ───────────────────────────────────────────────────────────────────────────────────

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


def _today(now: datetime | None) -> date:
    return trading_days.today_et(_now(now))


def _parse_day(v: Any, today: date | None = None) -> date:
    """A strict `YYYY-MM-DD` (M3: no ISO week dates). With `today`, also within
    [DAY_MIN, today + DAY_AHEAD_MAX] (W9-R9), so no later date arithmetic can overflow."""
    if not isinstance(v, str) or not _DAY_RE.match(v):
        raise RoutineError(S_BAD_DAY)
    try:
        d = date.fromisoformat(v)
    except ValueError:
        raise RoutineError(S_BAD_DAY) from None
    if today is not None and not (DAY_MIN <= d <= today + timedelta(days=DAY_AHEAD_MAX)):
        raise RoutineError(S_BAD_DAY)
    return d


def _created_day(row: sqlite3.Row) -> date:
    day = compute_trading_day_et(row["created_at"])
    try:
        return date.fromisoformat(day) if day else date.min
    except ValueError:
        return date.min


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
        raise RoutineError(S_BAD_NAME)
    clean = name.strip()
    if len(clean) > NAME_MAX:
        raise RoutineError(S_NAME_LONG)
    return clean


def _clean_suggest(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    rule = raw.get("rule")
    if not isinstance(rule, str) or not rule.strip() or len(rule) > _RULE_MAX:
        return None
    out: dict = {"rule": rule.strip()}
    n = raw.get("n")
    if isinstance(n, int) and not isinstance(n, bool) and 0 < n <= 1000:
        out["n"] = n
    return out


def _clean_items(raw: Any) -> list[dict]:
    """`[{id?, text, negative, suggest}]`, blank entries dropped. Refuses with the field's
    sentence: none left, more than ITEMS_CAP, or a text longer than ITEM_MAX."""
    if not isinstance(raw, list):
        raise RoutineError(S_NO_ITEMS)
    out: list[dict] = []
    for r in raw:
        if isinstance(r, str):
            r = {"text": r}
        if not isinstance(r, dict):
            raise RoutineError(S_NO_ITEMS)
        text = r.get("text")
        if not isinstance(text, str):
            raise RoutineError(S_NO_ITEMS)
        text = text.strip()
        if not text:
            continue
        if len(text) > ITEM_MAX:
            raise RoutineError(S_ITEM_LONG)
        rid = r.get("id")
        out.append({"id": rid if isinstance(rid, str) and rid else None, "text": text,
                    "negative": r.get("negative") is True,
                    "suggest": _clean_suggest(r.get("suggest"))})
    if not out:
        raise RoutineError(S_NO_ITEMS)
    if len(out) > ITEMS_CAP:
        raise RoutineError(S_TOO_MANY_ITEMS)
    return out


def _clean_schedule(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise RoutineError(S_BAD_SCHEDULE)
    kind = raw.get("kind")
    if kind not in routine_days.SCHEDULE_KINDS:
        raise RoutineError(S_BAD_SCHEDULE)
    if kind != "weekdays":
        return {"kind": kind}
    days = raw.get("days")
    if not isinstance(days, list) or not days:
        raise RoutineError(S_BAD_SCHEDULE)
    clean: set[int] = set()
    for d in days:
        if isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 4:
            raise RoutineError(S_BAD_SCHEDULE)
        clean.add(d)
    return {"kind": "weekdays", "days": sorted(clean)}


def _clean_settings(raw: Any, base: dict | None = None) -> dict:
    """The given keys over `base` (or the defaults), validated whole."""
    merged = dict(DEFAULT_SETTINGS)
    if base:
        merged.update({k: base[k] for k in DEFAULT_SETTINGS if k in base})
    if raw is not None:
        if not isinstance(raw, dict):
            raise RoutineError(S_BAD_SETTINGS)
        merged.update({k: raw[k] for k in DEFAULT_SETTINGS if k in raw})
    share = merged["done_share"]
    if isinstance(share, bool) or not isinstance(share, (int, float)):
        raise RoutineError(S_BAD_SHARE)
    match = [s for s in routine_days.DONE_SHARES if abs(float(share) - s) < 1e-9]
    if not match:
        raise RoutineError(S_BAD_SHARE)
    strict = merged["strict"]
    if not isinstance(strict, bool):
        raise RoutineError(S_BAD_SETTINGS)
    rem = merged["reminder"]
    if rem is not None:
        if not isinstance(rem, dict) or not isinstance(rem.get("on"), bool):
            raise RoutineError(S_BAD_SETTINGS)
        t = rem.get("time_et")
        m = _TIME_RE.match(t) if isinstance(t, str) else None
        if m is None or int(m.group(2)) % 5 != 0:
            raise RoutineError(S_BAD_TIME)
        rem = {"on": rem["on"], "time_et": t}
    return {"done_share": match[0], "strict": strict, "reminder": rem}


# ── rows ───────────────────────────────────────────────────────────────────────────────────────

def _owned(c: sqlite3.Connection, user_id: str, rid: Any, *,
           deleted: bool = False) -> sqlite3.Row | None:
    if not isinstance(rid, str) or not rid or not user_id:
        return None
    gate = "deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"
    return c.execute(f"SELECT * FROM {_R} WHERE id = ? AND user_id = ? AND {gate}",
                     (rid, user_id)).fetchone()


def _live_count(c: sqlite3.Connection, user_id: str) -> int:
    return c.execute(f"SELECT COUNT(*) FROM {_R} WHERE user_id = ? AND archived_at IS NULL"
                     " AND deleted_at IS NULL", (user_id,)).fetchone()[0]


def _check_cap(c: sqlite3.Connection, user_id: str) -> None:
    if _live_count(c, user_id) >= COUNT_CAP:
        raise CountCap()


def _schedules(c: sqlite3.Connection, user_id: str, rid: str) -> list[tuple[str, dict]]:
    return [(r[0], _load(r[1], {})) for r in c.execute(
        f"SELECT effective_from, schedule_json FROM {_SCHED} WHERE user_id = ? AND routine_id = ?"
        " ORDER BY effective_from", (user_id, rid))]


def _schedule_today(scheds: list[tuple[str, dict]], today: date) -> dict | None:
    """In force today; a routine whose first schedule is later than today (a clock skew between
    create and read) answers its earliest one."""
    return routine_days.schedule_on(scheds, today) or (scheds[0][1] if scheds else None)


def _raw_items(row: sqlite3.Row) -> list[dict]:
    return [r for r in _load(row["items_json"], []) if isinstance(r, dict)]


def _items_today(row: sqlite3.Row, today: date) -> list[dict]:
    raw = _raw_items(row)
    valid = {it.id for it in routine_days.items_on(routine_days.parse_items(raw), today)}
    return [{"id": r["id"], "text": r["text"], "negative": bool(r.get("negative")),
             "suggest": r.get("suggest")} for r in raw if r.get("id") in valid]


def _settings(row: sqlite3.Row) -> dict:
    try:
        return _clean_settings(None, _load(row["settings_json"], {}))
    except RoutineError:
        return dict(DEFAULT_SETTINGS)


def _shape(c: sqlite3.Connection, row: sqlite3.Row, today: date, used: int | None = None) -> dict:
    if used is None:
        used = _used_in_count(c, row["user_id"], row["id"])
    scheds = _schedules(c, row["user_id"], row["id"])
    out = {
        "id": row["id"],
        "name": row["name"],
        "items": _items_today(row, today),
        "schedule": _schedule_today(scheds, today),
        "settings": _settings(row),
        "archived": row["archived_at"] is not None,
        "deleted": row["deleted_at"] is not None,
        "etag": row["save_seq"],
        "createdDay": _created_day(row).isoformat(),
        "updatedAt": row["updated_at"],
        "usedIn": used,
        "sourceTemplateKey": row["source_template_key"],
    }
    if row["deleted_at"] is not None:
        out["deletedAt"] = row["deleted_at"]
    return out


def _used_in_count(c: sqlite3.Connection, user_id: str, rid: str) -> int:
    return c.execute(
        "SELECT COUNT(DISTINCT u.note_id)" + _USES_JOIN + " AND u.tool_id = ?", (user_id, rid)
    ).fetchone()[0]


def _used_in_counts(c: sqlite3.Connection, user_id: str) -> dict[str, int]:
    return {r[0]: r[1] for r in c.execute(
        "SELECT u.tool_id, COUNT(DISTINCT u.note_id)" + _USES_JOIN + " GROUP BY u.tool_id",
        (user_id,))}


def used_in_notes(user_id: str, rid: str, *,
                  conn: sqlite3.Connection | None = None) -> list[dict]:
    """`[{noteId, title, updatedAt}]`: the member's live, non-sample notes that place this
    routine, newest first, one entry per note. Another member's note never appears, and an id
    that is not one of the member's routines lists nothing."""
    if not isinstance(rid, str) or not rid or not user_id:
        return []
    with _read(conn) as c:
        rows = c.execute(
            "SELECT n.id, n.title, n.updated_at" + _USES_JOIN + " AND u.tool_id = ?"
            " GROUP BY n.id ORDER BY n.updated_at DESC, n.id DESC",
            (user_id, rid),
        ).fetchall()
    return [{"noteId": r[0], "title": r[1], "updatedAt": r[2]} for r in rows]


def _insert(c: sqlite3.Connection, user_id: str, name: str, items: list[dict], schedule: dict,
            settings: dict, today: date, ts: str, template_key: str | None) -> str:
    rid = str(uuid.uuid4())
    day = today.isoformat()
    stored = [{"id": str(uuid.uuid4()), "text": it["text"], "negative": it["negative"],
               "suggest": it["suggest"], "from": day, "to": None} for it in items]
    c.execute(
        f"INSERT INTO {_R} (id, user_id, name, items_json, settings_json, created_at, updated_at,"
        " archived_at, deleted_at, save_seq, source_gallery_id, source_template_key)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, NULL, ?)",
        (rid, user_id, name, _dump(stored), _dump(settings), ts, ts, template_key))
    c.execute(f"INSERT INTO {_SCHED} (user_id, routine_id, effective_from, schedule_json)"
              " VALUES (?, ?, ?, ?)", (user_id, rid, day, _dump(schedule)))
    return rid


# ── CRUD ───────────────────────────────────────────────────────────────────────────────────────

def create(user_id: str, *, name: Any, items: list[dict], schedule: dict,
           settings: dict | None = None, source_template_key: str | None = None,
           now: datetime | None = None, conn: sqlite3.Connection | None = None) -> dict:
    """A new routine: items get fresh ids valid from today ET, and one schedule row from today.
    A second create with the same `source_template_key` returns the existing routine."""
    clean_name = _clean_name(name)
    clean_items = _clean_items(items)
    clean_sched = _clean_schedule(schedule)
    clean_settings = _clean_settings(settings)
    key = source_template_key if isinstance(source_template_key, str) else None
    key = key.strip()[:_TEMPLATE_KEY_MAX] if key and key.strip() else None
    now_dt = _now(now)
    today = trading_days.today_et(now_dt)
    with _write(conn) as c:
        if key is not None:
            have = c.execute(f"SELECT * FROM {_R} WHERE user_id = ? AND source_template_key = ?",
                             (user_id, key)).fetchone()
            if have is not None and have["deleted_at"] is not None:
                # W9-R12: a template key found on a deleted row restores that row live (out of
                # Recently deleted and out of the archive, the cap checked); past the 30 days
                # it is purged and the template starts afresh.
                when = _parse_ts(have["deleted_at"])
                if when is None or now_dt - when > timedelta(days=RECENTLY_DELETED_DAYS):
                    _purge_ids(c, user_id, [have["id"]])
                    have = None
                else:
                    _check_cap(c, user_id)
                    c.execute(f"UPDATE {_R} SET deleted_at = NULL, archived_at = NULL,"
                              " updated_at = ? WHERE id = ? AND user_id = ?",
                              (_iso(now_dt), have["id"], user_id))
                    return _shape(c, _owned(c, user_id, have["id"]), today)
            if have is not None:
                return _shape(c, have, today)
        _check_cap(c, user_id)
        rid = _insert(c, user_id, clean_name, clean_items, clean_sched, clean_settings, today,
                      _iso(now_dt), key)
        return _shape(c, _owned(c, user_id, rid), today)


def get(user_id: str, rid: str, *, now: datetime | None = None,
        conn: sqlite3.Connection | None = None) -> dict | None:
    """`{id, name, items, schedule, settings, archived, deleted, etag, createdDay, updatedAt,
    usedIn}` as of today ET, or None for a foreign, unknown or deleted id."""
    with _read(conn) as c:
        row = _owned(c, user_id, rid)
        return None if row is None else _shape(c, row, _today(now))


def _diff_items(raw: list[dict], given: list[dict], today: date,
                ticked_ids: frozenset[str] = frozenset()) -> list[dict]:
    """The new stored item list. A given id that is valid today keeps its id (and so its
    ticks) with the new text; a valid item not given ends today; anything else is new from
    today. Ended items keep their spans; nothing before today changes."""
    day = today.isoformat()
    parsed = {it.id: it for it in routine_days.parse_items(raw)}
    valid = {it.id for it in routine_days.items_on(parsed.values(), today)}
    by_id = {r["id"]: r for r in raw}
    kept: list[dict] = []
    seen: set[str] = set()
    for g in given:
        gid = g["id"]
        if gid in valid and gid not in seen:
            seen.add(gid)
            kept.append({**by_id[gid], "text": g["text"], "negative": g["negative"],
                         "suggest": g["suggest"]})
        else:
            kept.append({"id": str(uuid.uuid4()), "text": g["text"], "negative": g["negative"],
                         "suggest": g["suggest"], "from": day, "to": None})
    ended = []
    for r in raw:
        if r["id"] in seen:
            continue
        if r["id"] in valid:
            ended.append({**r, "to": day})
        else:
            ended.append(r)
    over = len(kept) + len(ended) - STORED_ITEMS_MAX
    if over > 0:
        # M4 + ruling W9-R11: drop the oldest ended items (earliest `to`) so the stored list
        # stays bounded, but never one a tick still names: past days must keep reading the same.
        order = sorted((i for i in range(len(ended)) if ended[i]["id"] not in ticked_ids),
                       key=lambda i: str(ended[i].get("to") or ""))
        drop = set(order[:over])
        ended = [r for i, r in enumerate(ended) if i not in drop]
    return kept + ended


def update(user_id: str, rid: str, *, if_match: int, name: Any = None,
           items: list[dict] | None = None, schedule: dict | None = None,
           settings: dict | None = None, now: datetime | None = None,
           conn: sqlite3.Connection | None = None) -> dict:
    """Edit a routine. `if_match` is its `etag`; anything else is `Conflict` and nothing is
    written. Items diff by id (see `_diff_items`); a changed schedule writes today's row. An
    archived routine is read-only."""
    clean_name = _clean_name(name) if name is not None else None
    given = _clean_items(items) if items is not None else None
    clean_sched = _clean_schedule(schedule) if schedule is not None else None
    now_dt = _now(now)
    today = trading_days.today_et(now_dt)
    ts = _iso(now_dt)
    with _write(conn) as c:
        row = _owned(c, user_id, rid)
        if row is None:
            raise NotFound()
        if isinstance(if_match, bool) or not isinstance(if_match, int) \
                or if_match != row["save_seq"]:
            raise Conflict()
        if row["archived_at"] is not None:
            raise ReadOnly()
        new_settings = (_clean_settings(settings, _settings(row)) if settings is not None
                        else _settings(row))
        raw = _raw_items(row)
        if given is not None:
            ticked = frozenset(r[0] for r in c.execute(
                "SELECT DISTINCT item_id FROM j2_routine_ticks WHERE user_id = ? AND routine_id = ?",
                (user_id, rid)))
            new_items = _diff_items(raw, given, today, ticked)
        else:
            new_items = raw
        if clean_sched is not None:
            current = _schedule_today(_schedules(c, user_id, rid), today)
            if current != clean_sched:
                c.execute(f"INSERT OR REPLACE INTO {_SCHED} (user_id, routine_id,"
                          " effective_from, schedule_json) VALUES (?, ?, ?, ?)",
                          (user_id, rid, today.isoformat(), _dump(clean_sched)))
        c.execute(f"UPDATE {_R} SET name = ?, items_json = ?, settings_json = ?, updated_at = ?,"
                  " save_seq = save_seq + 1 WHERE id = ? AND user_id = ?",
                  (clean_name or row["name"], _dump(new_items), _dump(new_settings), ts,
                   rid, user_id))
        return _shape(c, _owned(c, user_id, rid), today)


def _purge_old_deleted(c: sqlite3.Connection, user_id: str, now_dt: datetime) -> int:
    cutoff = _iso(now_dt - timedelta(days=RECENTLY_DELETED_DAYS))
    ids = [r[0] for r in c.execute(
        f"SELECT id FROM {_R} WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?",
        (user_id, cutoff))]
    _purge_ids(c, user_id, ids)
    return len(ids)


def _purge_ids(c: sqlite3.Connection, user_id: str, ids: list[str]) -> None:
    for rid in ids:
        for table in _CHILDREN:
            c.execute(f"DELETE FROM {table} WHERE user_id = ? AND routine_id = ?", (user_id, rid))
        c.execute(f"DELETE FROM {_R} WHERE id = ? AND user_id = ?", (rid, user_id))


def list_routines(user_id: str, *, filter: Literal["active", "archived", "deleted"] = "active",
                  now: datetime | None = None,
                  conn: sqlite3.Connection | None = None) -> list[dict]:
    """The member's routines, newest edit first. Hard-deletes this member's routines deleted
    more than RECENTLY_DELETED_DAYS ago, with every child row."""
    gates = {"active": "deleted_at IS NULL AND archived_at IS NULL",
             "archived": "deleted_at IS NULL AND archived_at IS NOT NULL",
             "deleted": "deleted_at IS NOT NULL"}
    if filter not in gates:
        raise RoutineError(S_BAD_FILTER)
    now_dt = _now(now)
    cutoff = _iso(now_dt - timedelta(days=RECENTLY_DELETED_DAYS))
    with _read(conn) as c:
        stale = c.execute(f"SELECT 1 FROM {_R} WHERE user_id = ? AND deleted_at IS NOT NULL"
                          " AND deleted_at < ? LIMIT 1", (user_id, cutoff)).fetchone()
    if stale is not None:
        with _write(conn) as c:
            _purge_old_deleted(c, user_id, now_dt)
    today = trading_days.today_et(now_dt)
    with _read(conn) as c:
        rows = c.execute(f"SELECT * FROM {_R} WHERE user_id = ? AND {gates[filter]}"
                         " ORDER BY updated_at DESC, id DESC", (user_id,)).fetchall()
        used = _used_in_counts(c, user_id) if rows else {}
        return [_shape(c, r, today, used.get(r["id"], 0)) for r in rows]


def archive(user_id: str, rid: str, *, now: datetime | None = None,
            conn: sqlite3.Connection | None = None) -> dict:
    now_dt = _now(now)
    with _write(conn) as c:
        row = _owned(c, user_id, rid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is None:
            c.execute(f"UPDATE {_R} SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                      (_iso(now_dt), _iso(now_dt), rid, user_id))
        return _shape(c, _owned(c, user_id, rid), trading_days.today_et(now_dt))


def unarchive(user_id: str, rid: str, *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """Back to My tools. Refused at the cap."""
    now_dt = _now(now)
    with _write(conn) as c:
        row = _owned(c, user_id, rid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is not None:
            _check_cap(c, user_id)
            c.execute(f"UPDATE {_R} SET archived_at = NULL, updated_at = ? WHERE id = ?"
                      " AND user_id = ?", (_iso(now_dt), rid, user_id))
        return _shape(c, _owned(c, user_id, rid), trading_days.today_et(now_dt))


def soft_delete(user_id: str, rid: str, *, typed_name: Any, now: datetime | None = None,
                conn: sqlite3.Connection | None = None) -> dict:
    """Move an ARCHIVED routine to Recently deleted, only when `typed_name == name`."""
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, rid)
        if row is None:
            raise NotFound()
        if row["archived_at"] is None:
            raise RoutineError(S_ARCHIVE_FIRST)
        if not isinstance(typed_name, str) or typed_name != row["name"]:
            raise RoutineError(S_TYPE_NAME)
        c.execute(f"UPDATE {_R} SET deleted_at = ? WHERE id = ? AND user_id = ?",
                  (ts, rid, user_id))
        return {"id": rid, "deletedAt": ts}


def undelete(user_id: str, rid: str, *, now: datetime | None = None,
             conn: sqlite3.Connection | None = None) -> dict:
    """Bring a recently deleted routine back (still archived). Past the 30 days it is gone."""
    now_dt = _now(now)
    with _write(conn) as c:
        row = _owned(c, user_id, rid, deleted=True)
        if row is None:
            raise NotFound()
        when = _parse_ts(row["deleted_at"])
        if when is None or now_dt - when > timedelta(days=RECENTLY_DELETED_DAYS):
            raise NotFound()
        c.execute(f"UPDATE {_R} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
                  (_iso(now_dt), rid, user_id))
        return _shape(c, _owned(c, user_id, rid), trading_days.today_et(now_dt))


def duplicate(user_id: str, rid: str, *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """A new live routine "<name> copy": today's items with new ids, today's schedule and the
    same settings. No history is copied, and the template key is not (it is unique)."""
    now_dt = _now(now)
    today = trading_days.today_et(now_dt)
    with _write(conn) as c:
        row = _owned(c, user_id, rid)
        if row is None:
            raise NotFound()
        _check_cap(c, user_id)
        items = _items_today(row, today) or [
            {"text": r["text"], "negative": bool(r.get("negative")), "suggest": r.get("suggest")}
            for r in _raw_items(row)][:ITEMS_CAP]
        sched = _schedule_today(_schedules(c, user_id, rid), today) or {"kind": "every"}
        name = (row["name"] + " copy")[:NAME_MAX]
        new_id = _insert(c, user_id, name, items, sched, _settings(row), today, _iso(now_dt),
                         None)
        return _shape(c, _owned(c, user_id, new_id), today)


# ── traded days ────────────────────────────────────────────────────────────────────────────────

def _shift(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def traded_days(conn: sqlite3.Connection, user_id: str, lo: str, hi: str) -> frozenset[str]:
    """ET days in `[lo, hi]` with a closed trade (`filters._DAY`, flagged trades excluded), an
    opened trade or open position (entry day; estimated entries excluded), or an options
    strategy opened or closed."""
    if lo > hi:
        return frozenset()
    out: set[str] = set()

    def add(day: str | None) -> None:
        if day and lo <= day[:10] <= hi:
            out.add(day[:10])

    for (d,) in conn.execute(
            f"SELECT {_DAY} FROM j2_trades WHERE user_id = ? {ANALYTICS_INCLUDED_SQL}"
            f" AND {_DAY} BETWEEN ? AND ?", (user_id, lo, hi)):
        add(d)
    # The SQL bound is one day wide on each side: a stored UTC instant can be the ET day before.
    wide = (_shift(lo, -1), _shift(hi, 1) + "~")
    for (entry,) in conn.execute(
            "SELECT t.entry_date FROM j2_trades t LEFT JOIN j2_positions p"
            " ON p.id = t.position_id AND p.user_id = t.user_id"
            " WHERE t.user_id = ? AND (t.analytics_excluded IS NULL OR t.analytics_excluded = 0)"
            " AND COALESCE(p.entry_estimated, 0) = 0 AND t.entry_date BETWEEN ? AND ?",
            (user_id, *wide)):
        add(compute_trading_day_et(entry))
    for (entry,) in conn.execute(
            "SELECT entry_date FROM j2_positions WHERE user_id = ? AND closed_at IS NULL"
            " AND COALESCE(entry_estimated, 0) = 0 AND entry_date BETWEEN ? AND ?",
            (user_id, *wide)):
        add(compute_trading_day_et(entry))
    for tday, closed, entry, created in conn.execute(
            "SELECT trading_day_et, closed_at, entry_date, created_at FROM j2_option_strategies"
            " WHERE user_id = ? AND (trading_day_et BETWEEN ? AND ? OR closed_at BETWEEN ? AND ?"
            " OR entry_date BETWEEN ? AND ? OR created_at BETWEEN ? AND ?)",
            (user_id, lo, hi, *wide, *wide, *wide)):
        if closed or tday:
            add(tday or compute_trading_day_et(closed))
        add(compute_trading_day_et(entry) or compute_trading_day_et(created))
    return frozenset(out)


# ── day entries ────────────────────────────────────────────────────────────────────────────────

def _beyond_note(day: date) -> str | None:
    hz = session_calendar.horizon()
    return trading_days.beyond_note(hz + timedelta(days=1)) if day > hz else None


def _history_floor(created: date, upto: date) -> date:
    """The first day `routine_days.history` reads for `upto` (MAX_HISTORY_SESSIONS bound)."""
    if (upto - created).days >= routine_days.MAX_HISTORY_SESSIONS:
        return max(created, trading_days.nth_session_before(
            upto + timedelta(days=1), routine_days.MAX_HISTORY_SESSIONS))
    return created


def _load_schedules(c: sqlite3.Connection, user_id: str,
                    rids: list[str]) -> dict[str, list[tuple[str, dict]]]:
    scheds: dict[str, list[tuple[str, dict]]] = {r: [] for r in rids}
    if not rids:
        return scheds
    marks = ",".join("?" for _ in rids)
    for rid, eff, js in c.execute(
            f"SELECT routine_id, effective_from, schedule_json FROM {_SCHED} WHERE user_id = ?"
            f" AND routine_id IN ({marks}) ORDER BY effective_from", (user_id, *rids)):
        scheds[rid].append((eff, _load(js, {})))
    return scheds


def _load_children(c: sqlite3.Connection, user_id: str, rids: list[str],
                   hi: date, lo: date | dict[str, date] | None = None) -> tuple[dict, dict, dict]:
    """Schedules, ticks and skipped days for every routine in `rids`: one query per table,
    grouped here (I-3). With `lo` (one day, or one day per routine), ticks and skipped days
    before it are not read (W9-R17; a per-routine floor joins a VALUES table, so one sparse
    routine never widens what the others read)."""
    scheds = _load_schedules(c, user_id, rids)
    ticks: dict[str, dict[str, dict[str, bool]]] = {r: {} for r in rids}
    skipped: dict[str, set[str]] = {r: set() for r in rids}
    if not rids:
        return scheds, ticks, skipped
    if isinstance(lo, dict):
        floors = {r: (lo.get(r) or DAY_MIN).isoformat() for r in rids}
        vals = ",".join("(?, ?)" for _ in rids)
        cte = f"WITH lo(rid, d) AS (VALUES {vals}) "
        cte_p = tuple(x for r in rids for x in (r, floors[r]))
        for rid, d, item_id, ticked in c.execute(
                # CROSS JOIN keeps `lo` the outer loop (SQLite honours it), so each routine is one
                # primary-key range seek (user, routine, day >= its floor), never a member-wide scan
                cte + f"SELECT t.routine_id, t.day, t.item_id, t.ticked FROM lo CROSS JOIN {_TICKS} t"
                " ON t.routine_id = lo.rid WHERE t.user_id = ? AND t.day >= lo.d"
                " AND t.day <= ?", (*cte_p, user_id, hi.isoformat())):
            ticks[rid].setdefault(d, {})[item_id] = bool(ticked)
        for rid, d in c.execute(
                cte + f"SELECT s.routine_id, s.day FROM lo CROSS JOIN {_DAYS} s"
                " ON s.routine_id = lo.rid"
                " WHERE s.user_id = ? AND s.skipped = 1 AND s.day >= lo.d AND s.day <= ?",
                (*cte_p, user_id, hi.isoformat())):
            skipped[rid].add(d)
        return scheds, ticks, skipped
    low = " AND day >= ?" if lo is not None else ""
    low_p = (lo.isoformat(),) if lo is not None else ()
    marks = ",".join("?" for _ in rids)
    for rid, d, item_id, ticked in c.execute(
            f"SELECT routine_id, day, item_id, ticked FROM {_TICKS} WHERE user_id = ?"
            f" AND routine_id IN ({marks}) AND day <= ?{low}",
            (user_id, *rids, hi.isoformat(), *low_p)):
        ticks[rid].setdefault(d, {})[item_id] = bool(ticked)
    for rid, d in c.execute(
            f"SELECT routine_id, day FROM {_DAYS} WHERE user_id = ? AND routine_id IN ({marks})"
            f" AND skipped = 1 AND day <= ?{low}", (user_id, *rids, hi.isoformat(), *low_p)):
        skipped[rid].add(d)
    return scheds, ticks, skipped


class _Ctx:
    """One routine's stored state for the day entries of one request. History is built ONCE,
    up to min(the latest requested day, today), and sliced per day (I-1, I-2): a day after
    today is open or off and moves neither consistency nor runs."""

    def __init__(self, row: sqlite3.Row, schedules: list, ticks: dict, skipped: set,
                 traded: frozenset[str]) -> None:
        self.row = row
        self.created = _created_day(row)
        self.items = routine_days.parse_items(_raw_items(row))
        self.schedules = schedules
        self.settings = _settings(row)
        self.archived = row["archived_at"] is not None
        arch = compute_trading_day_et(row["archived_at"]) if self.archived else None
        #: W9-R20: the ET day it was archived; no scheduled day exists after it.
        self.archived_day: date | None = date.fromisoformat(arch[:10]) if arch else None
        self.ticks = ticks
        self.skipped = frozenset(skipped)
        self.traded = traded
        self._hist: list[routine_days.DayState] | None = None
        self._hist_upto: date | None = None

    def uses_traded(self) -> bool:
        return any(s.get("kind") == "traded" for _, s in self.schedules)

    def build_history(self, upto: date, today: date) -> None:
        self._hist_upto = upto
        self._hist = routine_days.history(
            items=self.items, schedules=self.schedules, ticks_by_day=self.ticks,
            skipped_days=self.skipped, created=self.created, upto=upto, today=today,
            traded=self.traded, done_share=self.settings["done_share"],
            archived=self.archived_day)

    def states_upto(self, d: date, today: date) -> list[routine_days.DayState]:
        cut = min(d, today)
        if self._hist is None or self._hist_upto is None or self._hist_upto < cut:
            self.build_history(cut, today)
        lo_s, d_s = _history_floor(self.created, cut).isoformat(), cut.isoformat()
        return [s for s in self._hist if lo_s <= s.day <= d_s]

    def day_state(self, d: date, today: date) -> routine_days.DayState:
        iso = d.isoformat()
        return routine_days.day_state(
            items=self.items, schedule=routine_days.schedule_on(self.schedules, d),
            ticks=self.ticks.get(iso) or {}, skipped=iso in self.skipped, day=d, today=today,
            created=self.created, traded=self.traded, done_share=self.settings["done_share"],
            archived=self.archived_day)

    def entry(self, d: date, today: date) -> dict:
        iso = d.isoformat()
        strict = self.settings["strict"]
        schedule = routine_days.schedule_on(self.schedules, d)
        applicable = routine_days.items_on(self.items, d)
        day_ticks = self.ticks.get(iso) or {}
        ds = self.day_state(d, today)
        states = self.states_upto(d, today)
        cons = routine_days.consistency(states, strict=strict)
        unit = "days you traded" if (schedule or {}).get("kind") == "traded" else "trading days"
        sentence = routine_days.consistency_sentence(cons, unit)
        r = routine_days.runs(states, strict=strict)
        line = routine_days.run_line(r.current)
        past_off = d < today and ds.state == "off"
        return {
            "day": iso,
            "state": ds.state,
            "label": routine_days.STATE_LABELS[ds.state],
            "ticked": {it.id: day_ticks.get(it.id) is True for it in applicable},
            "skipped": iso in self.skipped,
            "partial": routine_days.partial_label(ds) if ds.ticked > 0 else None,
            "items": [{"id": it.id, "text": it.text, "negative": it.negative}
                      for it in applicable],
            "writable": (not self.archived and not past_off
                         and routine_days.in_window(d, today)),
            "beyondNote": _beyond_note(d),
            "consistency": sentence,
            "rate": _num(routine_days.consistency_rate(cons, strict=strict)) if sentence else None,
            "run": {"line": line,
                    "milestone": line is not None and routine_days.is_milestone(r.current),
                    "best": routine_days.best_line(r)},
        }

    def routine(self, today: date) -> dict:
        sched = _schedule_today(self.schedules, today)
        return {"id": self.row["id"], "name": self.row["name"],
                "items": _items_today(self.row, today), "settings": self.settings,
                "archived": self.archived, "scheduleKind": (sched or {}).get("kind")}


def _contexts(c: sqlite3.Connection, user_id: str, rows: list,
              hi: date, lo: date | dict[str, date] | None = None, *,
              traded: frozenset[str] | None = None) -> dict[str, _Ctx]:
    """A `_Ctx` per row, from one query per child table and ONE traded_days call spanning the
    earliest created day (or `lo`, when later) to `hi` (only when some routine has a traded
    schedule; a caller that already read it passes `traded`). With `lo` (one day, or one day per
    routine), nothing before it is read (W9-R17)."""
    rids = [r["id"] for r in rows]
    scheds, ticks, skipped = _load_children(c, user_id, rids, hi, lo)
    ctxs = {r["id"]: _Ctx(r, scheds[r["id"]], ticks[r["id"]], skipped[r["id"]], frozenset())
            for r in rows}
    traders = [x for x in ctxs.values() if x.uses_traded()]
    if traders and traded is not None:
        for x in traders:
            x.traded = traded
    elif traders and isinstance(lo, dict):
        traded = traded_days(c, user_id, max(min(x.created for x in traders), DAY_MIN)
                             .isoformat(), hi.isoformat())
        for x in traders:
            x.traded = traded
    elif traders:
        first = max(min(x.created for x in traders), DAY_MIN)
        if lo is not None:
            first = max(first, lo)
        traded = traded_days(c, user_id, first.isoformat(), hi.isoformat())
        for x in traders:
            x.traded = traded
    return ctxs


@dataclass(frozen=True)
class RoutineHistory:
    """One routine's per-day states, read for the session member (`history_for`)."""
    id: str
    name: str
    created: date
    archived: bool
    archived_at: date | None           # the ET day it was archived (ruling W9-R20 reads it)
    strict: bool
    uses_traded: bool
    items: tuple                       # routine_days.Item, every version
    ticks: dict                        # day -> {item_id: bool}
    states: tuple                      # routine_days.DayState, oldest first


#: The sessions an EVERY-DAY routine's history reaches before `since` (its 20 counted days, with
#: room): the bound the work rails use. The real floor is per routine (`routine_days.window_floor`,
#: ruling W9-R25), so a sparse routine reaches back further without widening any other.
HISTORY_SINCE_LOOKBACK = 2 * routine_days.CONSISTENCY_WINDOW


def _archived_day(row: sqlite3.Row) -> date | None:
    arch = compute_trading_day_et(row["archived_at"]) if row["archived_at"] is not None else None
    return date.fromisoformat(arch[:10]) if arch else None


def history_for(conn: sqlite3.Connection, user_id: str, rids: str | list[str], upto: date,
                today: date, *, since: date | None = None, window: bool = True,
                scheduled_from: date | None = None) -> dict[str, RoutineHistory]:
    """The PUBLIC door to a routine's history (ruling W9-R15): for each of `rids` (one id or a
    list) that is the session member's and not deleted (archived ones keep their history), its
    day states oldest first, from the later of its created day and the MAX_HISTORY_SESSIONS-th
    session back, to `min(upto, today)`.

    With `since`, each routine's history starts at its OWN floor (W9-R25): the later of its created
    day and its CONSISTENCY_WINDOW-th counted day before `since` (`routine_days.window_floor`, one
    backward pass per routine, no ticks needed), so its consistency from `since` on equals
    `read_days`. With `window=False` (a caller that reads no consistency) the floor is `since`.
    Children are loaded ONCE, each routine from its own floor, and `traded_days` runs once, only
    when some routine has a traded schedule.

    With `scheduled_from`, a routine with no scheduled day in `[scheduled_from, min(upto, today)]`
    (`routine_days.has_scheduled_day`: its schedules, created and archived days, the traded set and
    its items, never its ticks) is returned with no states and no ticks, and nothing more of it is
    read or built (ruling W9-R36): a never-traded routine, or one whose schedule never applies,
    costs one check.

    Every day the routine runs or could run is there, `off` included; a caller keeps the states it
    counts. Foreign, unknown, deleted and unreadable ids are absent. Reads only."""
    ids = [rids] if isinstance(rids, str) else list(dict.fromkeys(rids or []))
    ids = [i for i in ids if isinstance(i, str) and i]
    if not ids or not user_id:
        return {}
    marks = ",".join("?" for _ in ids)
    rows = []
    for row in conn.execute(f"SELECT * FROM {_R} WHERE user_id = ? AND deleted_at IS NULL"
                            f" AND id IN ({marks})", (user_id, *ids)).fetchall():
        try:
            routine_days.parse_items(_raw_items(row))
        except (ValueError, KeyError, TypeError):
            continue                   # a malformed routine is left out, never a 500
        rows.append(row)
    if not rows:
        return {}
    cut = min(upto, today)
    hi = max(upto, today)
    floors: dict[str, date] = {}
    empty: dict[str, RoutineHistory] = {}
    if since is None and scheduled_from is None:
        ctxs = _contexts(conn, user_id, rows, hi)
    else:
        scheds = _load_schedules(conn, user_id, [r["id"] for r in rows])
        traders = {r["id"] for r in rows
                   if any(s.get("kind") == "traded" for _, s in scheds[r["id"]])}
        traded: frozenset[str] = frozenset()
        if traders:
            first = max(min(_created_day(r) for r in rows if r["id"] in traders), DAY_MIN)
            traded = traded_days(conn, user_id, first.isoformat(), hi.isoformat())
        if scheduled_from is not None:
            kept = []
            for r in rows:
                items = routine_days.parse_items(_raw_items(r))
                if routine_days.has_scheduled_day(
                        items=items, schedules=scheds[r["id"]], created=_created_day(r),
                        archived=_archived_day(r),
                        traded=traded if r["id"] in traders else frozenset(),
                        lo=scheduled_from, hi=cut, today=today):
                    kept.append(r)
                    continue
                empty[r["id"]] = RoutineHistory(
                    id=r["id"], name=r["name"], created=_created_day(r),
                    archived=r["archived_at"] is not None, archived_at=_archived_day(r),
                    strict=bool(_settings(r).get("strict")), uses_traded=r["id"] in traders,
                    items=tuple(items), ticks={}, states=())
            rows = kept
    if since is None and scheduled_from is not None:
        ctxs = _contexts(conn, user_id, rows, hi, traded=traded) if rows else {}
    elif since is not None:
        for r in rows:
            created = _created_day(r)
            if window:
                f = routine_days.window_floor(
                    items=routine_days.parse_items(_raw_items(r)), schedules=scheds[r["id"]],
                    created=created, archived=_archived_day(r),
                    traded=traded if r["id"] in traders else frozenset(), before=since,
                    today=today)
            else:
                f = since
            floors[r["id"]] = max(created, min(f, since))
        ctxs = _contexts(conn, user_id, rows, hi, floors, traded=traded) if rows else {}
    out: dict[str, RoutineHistory] = {}
    for rid in ids:
        if rid in empty:
            out[rid] = empty[rid]
            continue
        ctx = ctxs.get(rid)
        if ctx is None:
            continue
        if since is None:
            states = ctx.states_upto(cut, today)
        else:
            states = routine_days.history(
                items=ctx.items, schedules=ctx.schedules, ticks_by_day=ctx.ticks,
                skipped_days=ctx.skipped, created=floors[rid], upto=cut, today=today,
                traded=ctx.traded, done_share=ctx.settings["done_share"],
                archived=ctx.archived_day)
        out[rid] = RoutineHistory(
            id=rid, name=ctx.row["name"], created=ctx.created, archived=ctx.archived,
            archived_at=ctx.archived_day,
            strict=bool(ctx.settings.get("strict")), uses_traded=ctx.uses_traded(),
            items=tuple(ctx.items), ticks=ctx.ticks, states=tuple(states))
    return out


def row_capacity(conn: sqlite3.Connection, user_id: str, rids: list[str], lo: date, upto: date,
                 today: date, *, per_item: bool = False, limit: int | None = None) -> int:
    """A SOUND UPPER BOUND on how many history rows `rids` (the session member's, not deleted) can
    have from `lo` to `min(upto, today)` (ruling W9-R39): the sum of each routine's
    `routine_days.scheduled_capacity`, times its item count when `per_item` (one row per item a
    day). From the routines, their schedules and the traded set alone: no tick is read and no
    history is built. With `limit`, it stops adding once the sum passes it. Reads only."""
    ids = [i for i in dict.fromkeys(rids or []) if isinstance(i, str) and i]
    if not ids or not user_id:
        return 0
    marks = ",".join("?" for _ in ids)
    rows = []
    for row in conn.execute(f"SELECT * FROM {_R} WHERE user_id = ? AND deleted_at IS NULL"
                            f" AND id IN ({marks})", (user_id, *ids)).fetchall():
        try:
            rows.append((row, routine_days.parse_items(_raw_items(row))))
        except (ValueError, KeyError, TypeError):
            continue                   # left out by history_for too
    cut = min(upto, today)
    if not rows:
        return 0
    first = max(min(_created_day(r) for r, _ in rows), lo, DAY_MIN)
    if cut < first:
        return 0
    scheds = _load_schedules(conn, user_id, [r["id"] for r, _ in rows])
    traders = [r for r, _ in rows if any(s.get("kind") == "traded" for _, s in scheds[r["id"]])]
    traded: list[str] = []
    if traders:
        t_first = max(min(_created_day(r) for r in traders), lo, DAY_MIN)
        if t_first <= cut:
            traded = sorted(traded_days(conn, user_id, t_first.isoformat(), cut.isoformat()))
    index = routine_days.SessionIndex(first, cut)
    total = 0
    for r, items in rows:
        n = routine_days.scheduled_capacity(
            schedules=scheds[r["id"]], created=_created_day(r), archived=_archived_day(r),
            traded_sorted=traded, lo=lo, hi=cut, today=today, index=index)
        total += n * (max(len(items), 1) if per_item else 1)
        if limit is not None and total > limit:
            break
    return total


def _one_entry(c: sqlite3.Connection, user_id: str, row: sqlite3.Row, d: date,
               today: date, now_dt: datetime) -> dict:
    """The one DayEntry a write answers, the same shape `read_days` answers (with `suggested`)."""
    ctxs = _contexts(c, user_id, [row], max(d, today))
    iso = d.isoformat()
    sug = _suggested(c, user_id, ctxs, [iso], now_dt).get(row["id"], {})
    return {**ctxs[row["id"]].entry(d, today), "suggested": sug.get(iso, [])}


# ── ticks and skips ────────────────────────────────────────────────────────────────────────────

def _write_day(user_id: str, rid: str, day: Any, now: datetime | None,
               conn: sqlite3.Connection | None, write) -> dict:
    now_dt = _now(now)
    today = trading_days.today_et(now_dt)
    d = _parse_day(day, today)
    owned = conn is None
    from api.services import auth_db
    c = conn or auth_db.get_connection()
    began = False
    try:
        if not c.in_transaction:
            _begin_immediate(c)
            began = True
        try:
            if c.execute(f"SELECT 1 FROM {_R} WHERE id = ? AND user_id = ?"
                         " AND deleted_at IS NULL", (rid, user_id)).fetchone() is None:
                raise NotFound()
            row = _owned(c, user_id, rid)
            if row["archived_at"] is not None:
                raise ReadOnly()
            if not routine_days.in_window(d, today):
                raise OutsideWindow()
            if d < today:
                # M1: the off-day check is day_state alone, for that one day. W9-R8: today and
                # later never refuse here (a traded schedule reads "open" before the day's
                # first trade); a past day the routine did not run cannot be ticked.
                ctx = _contexts(c, user_id, [row], d)[rid]
                if ctx.day_state(d, today).state == "off":
                    raise RoutineError(S_OFF_DAY)
            write(c, row, d, _iso(now_dt))
            if began:
                c.commit()
        except BaseException:
            if began:
                c.rollback()
            raise
        # M1: the answer is built after the commit, outside the write lock.
        return _one_entry(c, user_id, _owned(c, user_id, rid), d, today, now_dt)
    finally:
        if owned:
            c.close()


def set_tick(user_id: str, rid: str, day: str, item_id: str, ticked: bool, *,
             now: datetime | None = None, conn: sqlite3.Connection | None = None) -> dict:
    """Tick or untick one item of one day; answers that day's merged `DayEntry`."""
    if not isinstance(ticked, bool):
        raise RoutineError(S_BAD_TICK)

    def write(c, row, d, ts):
        valid = {it.id for it in routine_days.items_on(
            routine_days.parse_items(_raw_items(row)), d)}
        if not isinstance(item_id, str) or item_id not in valid:
            raise RoutineError(S_UNKNOWN_ITEM)
        c.execute(f"INSERT INTO {_TICKS} (user_id, routine_id, day, item_id, ticked, updated_at)"
                  " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, routine_id, day, item_id)"
                  " DO UPDATE SET ticked = excluded.ticked, updated_at = excluded.updated_at",
                  (user_id, rid, d.isoformat(), item_id, int(ticked), ts))

    return _write_day(user_id, rid, day, now, conn, write)


def set_skipped(user_id: str, rid: str, day: str, skipped: bool, *,
                now: datetime | None = None, conn: sqlite3.Connection | None = None) -> dict:
    """Skip or un-skip one day; answers that day's merged `DayEntry`."""
    if not isinstance(skipped, bool):
        raise RoutineError(S_BAD_SKIP)

    def write(c, row, d, ts):
        c.execute(f"INSERT INTO {_DAYS} (user_id, routine_id, day, skipped, updated_at)"
                  " VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, routine_id, day)"
                  " DO UPDATE SET skipped = excluded.skipped, updated_at = excluded.updated_at",
                  (user_id, rid, d.isoformat(), int(skipped), ts))

    return _write_day(user_id, rid, day, now, conn, write)


# ── the batched read ───────────────────────────────────────────────────────────────────────────

def read_days(user_id: str, ids: list[str], days: list[str], *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """`{"resolved": {"today": day}?, "routines": {id: {"routine": ..., "days": {day: DayEntry}}}}`.
    At most READ_IDS_MAX ids and READ_DAYS_MAX days. `"today"` is the session on or after today
    ET. Foreign, unknown and deleted ids are absent. Each DayEntry carries `suggested`: the ids of
    its opted-in items whose rule the member's own trades that day satisfy
    (`routine_insights.suggestions`), computed here at read time and never written."""
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise RoutineError(S_BAD_IDS)
    if not isinstance(days, list):
        raise RoutineError(S_BAD_DAY)
    want_ids = list(dict.fromkeys(i for i in ids if i))
    if len(want_ids) > READ_IDS_MAX:
        raise RoutineError(S_TOO_MANY_IDS)
    if not all(isinstance(d, str) for d in days):
        raise RoutineError(S_BAD_DAY)
    if len(set(days)) > READ_DAYS_MAX:
        raise RoutineError(S_TOO_MANY_DAYS)
    now_dt = _now(now)
    today = trading_days.today_et(now_dt)
    out: dict = {"routines": {}}
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
    hi = max([today, *resolved])
    with _read(conn) as c:
        marks = ",".join("?" for _ in want_ids)
        rows = c.execute(f"SELECT * FROM {_R} WHERE user_id = ? AND deleted_at IS NULL"
                         f" AND id IN ({marks})", (user_id, *want_ids)).fetchall()
        ctxs = _contexts(c, user_id, rows, hi)
        suggested = _suggested(c, user_id, ctxs, [d.isoformat() for d in resolved], now_dt)
    upto = min(resolved[-1], today) if resolved else today
    for rid in want_ids:
        ctx = ctxs.get(rid)
        if ctx is None:
            continue
        if resolved:
            ctx.build_history(upto, today)          # I-2: one history per routine
        sug = suggested.get(rid, {})
        out["routines"][rid] = {"routine": ctx.routine(today),
                                "days": {d.isoformat(): {**ctx.entry(d, today),
                                                         "suggested": sug.get(d.isoformat(), [])}
                                         for d in resolved}}
    return out


def _suggested(c: sqlite3.Connection, user_id: str, ctxs: dict[str, _Ctx], days: list[str],
               now_dt: datetime) -> dict[str, dict[str, list[str]]]:
    """rid -> day -> suggested item ids. The day's trades are read ONCE for every routine, and
    only when some routine has an opted-in item. M-4: never on a day the routine is off or
    skipped, and never an item already ticked (today before its close is never eligible)."""
    from api.services.journal_two import routine_insights   # it imports this module
    if not days:
        return {}
    wanted = {rid: ctx for rid, ctx in ctxs.items()
              if any(routine_insights.opted_in(it) for it in ctx.items)}
    if not wanted:
        return {}
    facts = routine_insights.day_facts(c, user_id, days, now=now_dt)
    today = trading_days.today_et(now_dt)
    out: dict[str, dict[str, list[str]]] = {}
    for rid, ctx in wanted.items():
        raw = routine_insights.suggestions(c, user_id, list(ctx.items), days, now=now_dt,
                                           facts=facts)
        per: dict[str, list[str]] = {}
        for d, iids in raw.items():
            if not iids:
                per[d] = []
                continue
            if ctx.day_state(date.fromisoformat(d), today).state in ("off", "skipped"):
                per[d] = []
                continue
            ticked = ctx.ticks.get(d) or {}
            per[d] = [i for i in iids if ticked.get(i) is not True]
        out[rid] = per
    return out


# ── import ─────────────────────────────────────────────────────────────────────────────────────

def import_day_rules(user_id: str, *, conn: sqlite3.Connection | None = None) -> list[str]:
    """The labels of the member's newest day note with a non-empty rules list, stripped,
    de-duplicated (case-insensitively, first spelling kept), at most ITEMS_CAP."""
    with _read(conn) as c:
        for (rules,) in c.execute("SELECT rules FROM j2_day_notes WHERE user_id = ?"
                                  " ORDER BY date DESC, updated_at DESC", (user_id,)):
            raw = _load(rules, [])
            labels: list[str] = []
            seen: set[str] = set()
            for r in raw:
                label = r.get("label") if isinstance(r, dict) else None
                if not isinstance(label, str) or not label.strip():
                    continue
                text = label.strip()[:ITEM_MAX]
                if text.lower() in seen:
                    continue
                seen.add(text.lower())
                labels.append(text)
                if len(labels) >= ITEMS_CAP:
                    break
            if labels:
                return labels
    return []
