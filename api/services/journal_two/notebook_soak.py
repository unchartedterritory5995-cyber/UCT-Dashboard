"""The 30-day soak's server read — aggregates only, admin only, read only.

Wave 9, lane 9C, ruling D-9C2: the soak REUSES the local Wave Q1 observer
(`tools/nb_observe.py`, every two hours) and adds exactly ONE admin read — this
module behind `GET /api/admin/notebook-soak`. No scheduled server job, no new
table, no flag. The observer calls it once per run for the trailing interval and
appends the answer to a sidecar file; `tools/nb_soak.py` rolls the sidecar up.

What it answers, per POPULATION (`notebook_populations.py`; never summed):

  events            `j2:save_failed` by `reason`, `j2:conflict_forked` by `door`,
                    `j2:notebook_blocked_no_baseline`, `j2:notebook_offline_opt_in`
                    — event counts and distinct identities.
  config_served     `j2:notebook_config_served` as `served/total` BY IDENTITY.
                    ⛔ `0/0` stays `0/0`: a rate over an empty population is
                    undefined, and printing 100% there is how a precondition
                    gets satisfied by nobody.
  speed             p50/p95 of `ms` for `note_open_ms`, `search_used`,
                    `ask_used` — measured in the member's browser, so it is
                    labelled "field: network + device" and it is REPORTED,
                    never paged (ruling D-9C3).
  exposure          distinct notes edited per ET day, and distinct identities
                    editing (ruling D-9C4 — the denominator, from rows that
                    already exist; no new write path).
  conflicted_copies notes tagged `sync-conflict` created in the window, split by
                    who wrote them (see `_conflicted_copies`).
  client_errors     Notebook-page client errors (page under `/journal/notebook`)
                    via `client_errors.count_by_user_for_page` — an exact count.

⛔⛔ EXPOSURE, AND WHY ONE READ CANNOT CARRY THE DAY-BY-DAY FIGURE.
`j2_notes.updated_at` holds only a note's LAST edit. A note edited on Monday and
again on Wednesday reads, on Thursday, as a Wednesday edit only: its Monday is
gone from every table. So a single read over thirty days would undercount every
day but the last. That is why the observer samples this every two hours and
appends the answer to a sidecar — each sample sees the edits of the day it is
taken on before a later edit can move them — and why `nb_soak` takes, per ET
day, the LARGEST figure any sample reported for that day. Every sample's figure
is a lower bound (a note in a day's bucket really was edited that day); the
maximum is the best lower bound, never an overcount.

To make each sample a running count rather than an interval fragment, the
exposure section always reads WHOLE ET DAYS: from the ET midnight of `since`'s
day to `until`. The window TOTAL (`identities_editing`, `notes_edited`) is over
`[since, until)` exactly — and for a read whose `until` is now it is exact, not
a bound: any note edited inside the window has its last edit inside it too.

⛔⛔ AGGREGATES ONLY. No user id, no email, no title, no body, no tag text ever
leaves this module: identities are counted, never named. The population lists
decide the bucket in Python, and only the bucket name and a number go out.
`tests/test_notebook_soak.py` walks every key AND every value of a response
built from a fixture and fails on any id, email, title or text it finds.

⛔ A LIMIT IS REPORTED BESIDE THE FIGURE IT CAPS. The timed reads stop at
`MAX_TIMED_ROWS` per event, newest first; when a read reaches the cap its
section says `capped: true`, so a percentile over a truncated set is never read
as one over the whole window.

⚠️ THE CLIENT-ERROR STORE KEEPS `client_errors.RETENTION_DAYS` (14) days. A
window reaching further back is short by construction and says so
(`window_exceeds_retention`); the 2-hourly sidecar persists each interval's
count, which is why the soak does not depend on that store's retention.

⚠️ EVERY QUERY IS AN INDEX RANGE, NEVER A TABLE SCAN. The observer runs this
every two hours for thirty days, and a whole-table read nobody noticed would
grow with the tables. `activity_log` is read through `idx_activity_created`
(the `+a.action` unary plus stops the planner from preferring the action index,
which would read every such event ever logged); `j2_notes` through
`idx_j2_notes_user_updated` / `idx_j2_notes_user_created`, driven from `users`.
⚰️ A plain `JOIN` there let the planner — which has no statistics on a fresh
database — put `j2_notes` OUTSIDE and walk the WHOLE `idx_j2_notes_user_updated`
("SCAN n USING COVERING INDEX"): every note ever written, every two hours. The
rail caught it on its first run. `CROSS JOIN` is SQLite's documented way to fix
the loop order, so `users` (one row per account) is the outer loop and each
account's notes are an index RANGE.
The plans are pinned by a rail (`test_the_soak_queries_never_scan_a_growing_table`).
"""
from __future__ import annotations

import json
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services import auth_db, client_errors
from api.services.journal_two import notebook_telemetry
from api.services.journal_two.notebook_populations import POPULATIONS, population_of

ET = ZoneInfo("America/New_York")
MAX_WINDOW_DAYS = 45
NOTEBOOK_PAGE_PREFIX = "/journal/notebook"
MAX_TIMED_ROWS = 20000

#: An identity whose `users` row is gone (a purged account): counted, never organic.
UNRESOLVED = "unresolved"
REPORT_POPULATIONS = POPULATIONS + (UNRESOLVED,)

#: The integrity events, and the ONE enumerated prop each is broken down by.
INTEGRITY_EVENTS = {
    "save_failed": "reason",
    "conflict_forked": "door",
    "notebook_blocked_no_baseline": None,
    "notebook_offline_opt_in": None,
}
CONFIG_EVENT = "notebook_config_served"
TIMED_EVENTS = ("note_open_ms", "search_used", "ask_used")

_ACTIONS = tuple(f"j2:{e}" for e in (*INTEGRITY_EVENTS, CONFIG_EVENT))

SQL_EVENTS = (
    "SELECT a.action AS action, a.user_id AS user_id, a.details AS details, u.email AS email"
    " FROM activity_log AS a LEFT JOIN users AS u ON u.id = a.user_id"
    " WHERE a.created_at >= ? AND a.created_at < ?"
    f" AND +a.action IN ({', '.join('?' for _ in _ACTIONS)})"
)
SQL_TIMED = (
    "SELECT a.details AS details, u.email AS email"
    " FROM activity_log AS a LEFT JOIN users AS u ON u.id = a.user_id"
    " WHERE a.created_at >= ? AND a.created_at < ? AND +a.action = ?"
    " ORDER BY a.created_at DESC LIMIT ?"
)
SQL_EXPOSURE = (
    "SELECT n.user_id AS user_id, n.updated_at AS stamp, u.email AS email"
    " FROM users AS u CROSS JOIN j2_notes AS n ON n.user_id = u.id"
    " WHERE n.updated_at >= ? AND n.updated_at < ?"
)
SQL_CONFLICTS = (
    "SELECT n.import_source AS import_source, n.tags AS tags, n.created_at AS stamp,"
    " u.email AS email"
    " FROM users AS u CROSS JOIN j2_notes AS n ON n.user_id = u.id"
    " WHERE n.created_at >= ? AND n.created_at < ? AND n.tags LIKE '%sync-conflict%'"
)


class SoakWindowError(ValueError):
    """A window this read refuses — the router turns it into a 400 sentence."""


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _log_stamp(dt: datetime) -> str:
    """`activity_log.created_at` is SQLite's CURRENT_TIMESTAMP: UTC, no `T`."""
    return _utc(dt).strftime("%Y-%m-%d %H:%M:%S")


def _parse_note_stamp(value: Any) -> datetime | None:
    """A `j2_notes` timestamp (ISO; imports may carry `Z` or a bare date)."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return _utc(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        return None


def _population(email: Any) -> str:
    return population_of(email) if isinstance(email, str) and email.strip() else UNRESOLVED


def _enum_values(event: str, prop: str) -> tuple:
    """The server's own enumerated values for one prop — read from the
    telemetry door's schema, never retyped. A value outside them is reported
    as `other`, so a key in this response can never carry free text."""
    from api.routers.journal_two import _NOTEBOOK_PROP_SCHEMAS
    allowed = (_NOTEBOOK_PROP_SCHEMAS.get(event) or {}).get(prop)
    return tuple(allowed) if isinstance(allowed, tuple) else ()


def _details(raw: Any) -> dict:
    try:
        d = json.loads(raw or "{}")
    except (ValueError, TypeError):
        return {}
    return d if isinstance(d, dict) else {}


def et_day_start(dt: datetime) -> datetime:
    """The UTC instant of the ET midnight that begins `dt`'s ET day."""
    local = _utc(dt).astimezone(ET)
    return datetime.combine(local.date(), dtime(0, 0), tzinfo=ET).astimezone(timezone.utc)


def validate_window(since: datetime, until: datetime | None = None,
                    now: datetime | None = None) -> tuple[datetime, datetime]:
    """`(since, until)` in UTC, or `SoakWindowError` with a sentence."""
    now = _utc(now or datetime.now(timezone.utc))
    since = _utc(since)
    until = _utc(until) if until is not None else now
    if until <= since:
        raise SoakWindowError("`until` must be later than `since`.")
    if until - since > timedelta(days=MAX_WINDOW_DAYS):
        raise SoakWindowError(
            f"The window is longer than {MAX_WINDOW_DAYS} days; read it in pieces.")
    return since, until


def _empty_pop_table(factory):
    return {p: factory() for p in REPORT_POPULATIONS}


def _events(conn, since: datetime, until: datetime) -> tuple[dict, dict]:
    rows = conn.execute(SQL_EVENTS, (_log_stamp(since), _log_stamp(until), *_ACTIONS)).fetchall()
    events: dict[str, Any] = {}
    identities: dict[str, dict[str, set]] = {}
    for ev, prop in INTEGRITY_EVENTS.items():
        allowed = _enum_values(ev, prop) if prop else ()
        events[ev] = _empty_pop_table(
            lambda: ({"events": 0, "identities": 0,
                      f"by_{prop}": {v: 0 for v in (*allowed, "other")}} if prop
                     else {"events": 0, "identities": 0}))
        identities[ev] = _empty_pop_table(set)
    served_by: dict[str, dict[str, bool]] = _empty_pop_table(dict)

    for r in rows:
        ev = str(r["action"])[3:]
        pop = _population(r["email"])
        uid = r["user_id"]
        if ev == CONFIG_EVENT:
            served = bool(_details(r["details"]).get("served"))
            served_by[pop][uid] = served_by[pop].get(uid, False) or served
            continue
        if ev not in INTEGRITY_EVENTS:
            continue
        cell = events[ev][pop]
        cell["events"] += 1
        identities[ev][pop].add(uid)
        prop = INTEGRITY_EVENTS[ev]
        if prop:
            v = _details(r["details"]).get(prop)
            bucket = f"by_{prop}"
            cell[bucket][v if isinstance(v, str) and v in cell[bucket] and v != "other" else "other"] += 1
    for ev in INTEGRITY_EVENTS:
        for pop in REPORT_POPULATIONS:
            events[ev][pop]["identities"] = len(identities[ev][pop])
    config = {pop: f"{sum(1 for v in served_by[pop].values() if v)}/{len(served_by[pop])}"
              for pop in REPORT_POPULATIONS}
    return events, config


def _speed(conn, since: datetime, until: datetime) -> dict:
    out: dict[str, Any] = {"label": "field: network + device", "row_limit": MAX_TIMED_ROWS}
    for ev in TIMED_EVENTS:
        rows = conn.execute(
            SQL_TIMED, (_log_stamp(since), _log_stamp(until), f"j2:{ev}", MAX_TIMED_ROWS + 1),
        ).fetchall()
        capped = len(rows) > MAX_TIMED_ROWS
        vals: dict[str, list] = _empty_pop_table(list)
        for r in rows[:MAX_TIMED_ROWS]:
            ms = notebook_telemetry.ms_of(r["details"])
            if ms is not None:
                vals[_population(r["email"])].append(ms)
        by_pop = {}
        for pop, v in vals.items():
            v.sort()
            by_pop[pop] = {"n": len(v),
                           "p50_ms": notebook_telemetry.percentile(v, 0.5),
                           "p95_ms": notebook_telemetry.percentile(v, 0.95)}
        out[ev] = {"by_population": by_pop, "capped": capped}
    return out


def _exposure(conn, since: datetime, until: datetime) -> dict:
    day0 = et_day_start(since)
    # Coarse string bounds a day wide either side (stored stamps are ISO with a
    # `T`, `Z` or offset, or a bare date from an import); the exact window is
    # applied below on the PARSED instant, never on the string.
    lo = (day0 - timedelta(days=1)).strftime("%Y-%m-%d")
    hi = (until + timedelta(days=1)).strftime("%Y-%m-%d")
    by_day: dict[str, dict[str, int]] = _empty_pop_table(dict)
    who_by_day: dict[str, dict[str, set]] = _empty_pop_table(dict)
    who: dict[str, set] = _empty_pop_table(set)
    notes: dict[str, int] = _empty_pop_table(int)
    unparseable = 0
    for r in conn.execute(SQL_EXPOSURE, (lo, hi)).fetchall():
        t = _parse_note_stamp(r["stamp"])
        if t is None:
            unparseable += 1
            continue
        if not (day0 <= t < until):
            continue
        pop = _population(r["email"])
        day = t.astimezone(ET).date().isoformat()
        by_day[pop][day] = by_day[pop].get(day, 0) + 1
        who_by_day[pop].setdefault(day, set()).add(r["user_id"])
        if since <= t:
            who[pop].add(r["user_id"])
            notes[pop] += 1
    return {
        "since_et_day": day0.astimezone(ET).date().isoformat(),
        "note_edits_by_day": by_day,
        "identities_editing_by_day": {p: {d: len(s) for d, s in days.items()}
                                      for p, days in who_by_day.items()},
        "identities_editing": {p: len(s) for p, s in who.items()},
        "notes_edited": notes,
        "unparseable_stamps": unparseable,
        "basis": ("j2_notes.updated_at holds only a note's LAST edit: a day's figure "
                  "is a lower bound, and the 2-hourly sidecar carries the day-by-day "
                  "series; the window totals are exact when `until` is now"),
    }


def _conflicted_copies(conn, since: datetime, until: datetime) -> dict:
    """Notes tagged `sync-conflict` whose row was CREATED in the window.

    Two writers make them, and the data tells them apart:
      * the offline layer (`NoteEditorPage.jsx`, `useOutboxDrain.js`, and the
        `settleNoteWrite.js` path they share) creates a "(conflicted copy)"
        through the ordinary notes door — `import_source` is NULL;
      * the connector engine (`note_connectors/engine.py`, G-094) writes a
        "(synced copy)" sibling through `import_confirm` — `import_source` is
        the provider.
    ⚠️ A connector sibling's `created_at` is the PROVIDER's own createdAt when
    it supplies one (`engine.py` passes `rn.created_at`), so a copy of an old
    remote note is dated before this window: the connector figure is a LOWER
    BOUND and says so. A connector fork is a second writer by construction;
    the offline figure is the integrity signal. A tag a member typed by hand
    is indistinguishable from either.
    """
    lo = (since - timedelta(days=1)).strftime("%Y-%m-%d")
    hi = (until + timedelta(days=1)).strftime("%Y-%m-%d")
    offline: dict[str, int] = _empty_pop_table(int)
    connector: dict[str, int] = _empty_pop_table(int)
    for r in conn.execute(SQL_CONFLICTS, (lo, hi)).fetchall():
        t = _parse_note_stamp(r["stamp"])
        if t is None or not (since <= t < until):
            continue
        try:
            tags = json.loads(r["tags"] or "[]")
        except (ValueError, TypeError):
            continue
        if not isinstance(tags, list) or "sync-conflict" not in tags:
            continue
        pop = _population(r["email"])
        (connector if r["import_source"] else offline)[pop] += 1
    return {"offline_layer": offline, "connector": connector, "connector_lower_bound": True}


def _client_errors(conn, since: datetime, until: datetime, now: datetime) -> dict:
    counts = client_errors.count_by_user_for_page(
        NOTEBOOK_PAGE_PREFIX, since.timestamp(), until.timestamp())
    ids = [u for u in counts if u is not None]
    emails: dict[str, str] = {}
    if ids:
        marks = ",".join("?" for _ in ids)
        for r in conn.execute(f"SELECT id, email FROM users WHERE id IN ({marks})", ids).fetchall():
            emails[r["id"]] = r["email"]
    by_pop = _empty_pop_table(lambda: {"errors": 0, "identities": 0})
    anonymous = 0
    for uid, n in counts.items():
        if uid is None:
            anonymous += n
            continue
        cell = by_pop[_population(emails.get(uid))]
        cell["errors"] += n
        cell["identities"] += 1
    return {
        "page_prefix": NOTEBOOK_PAGE_PREFIX,
        "by_population": by_pop,
        "anonymous_errors": anonymous,
        "beacon_enabled": client_errors.enabled(),
        "retention_days": client_errors.RETENTION_DAYS,
        "window_exceeds_retention": since < now - timedelta(days=client_errors.RETENTION_DAYS),
    }


def soak_summary(since: datetime, until: datetime | None = None, conn=None,
                 now: datetime | None = None) -> dict[str, Any]:
    """Every soak figure for `[since, until)`, per population. Aggregates only."""
    now = _utc(now or datetime.now(timezone.utc))
    since, until = validate_window(since, until, now)
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        events, config = _events(conn, since, until)
        out = {
            "window": {
                "since": since.isoformat(),
                "until": until.isoformat(),
                "hours": round((until - since).total_seconds() / 3600.0, 3),
                "max_days": MAX_WINDOW_DAYS,
            },
            "populations": list(REPORT_POPULATIONS),
            "events": events,
            "config_served": config,
            "speed": _speed(conn, since, until),
            "exposure": _exposure(conn, since, until),
            "conflicted_copies": _conflicted_copies(conn, since, until),
            "client_errors": _client_errors(conn, since, until, now),
        }
        return out
    finally:
        if owned:
            conn.close()
