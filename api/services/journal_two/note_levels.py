"""Wave 13 lane 13D -- the level index (`j2_note_levels`) and the resurfacing ledger.

When a ticker a member wrote about reaches a level their note named, moves 8% or more, or
reaches a date they set, the Awareness Engine brings that note back in-app ("here's what you
thought then"), opening it at the VERSION that named the level. This module is the I/O half
of that: the index the rules read and the ledger that keeps it calm. The rules are
`awareness/rules.py` R7-R9; the pass is `awareness/engine._run_resurface_pass`.

TWO SELF-ENSURED TABLES in auth.db, both purged with the account
(`account_purge._DIRECT_USER_TABLES`), neither carrying a name/title column (so the
address-space census derives neither as an addressable kind):

  j2_note_levels           ONE ROW PER LEVEL OR DATE a live note names, per (member, note,
                           level id). A PROJECTION of `plan_extract.note_levels` -- the ONE
                           reader of plan levels -- plus the note's date properties, never a
                           second parse of a note. Also one ``note`` row per note with a
                           ticker (R8's "you wrote about it"), and one ``none`` row for a note
                           that yields nothing, so its watermark is still recorded.
  j2_note_resurface_fires  THE LEDGER: one row per resurfacing that reached the member, keyed
                           (member, fire key, ET day). "One per level per day" is a read of
                           this table; the insight's id is here so the in-app notice can open
                           the note at the version that named the level.

⛔⛔ NOT IN THE SAVE PATH, AND NEVER A WRITER INTO NOTES (plan §3.4, R-12). `catch_up_all`
compares every live note's ``updated_at`` with the watermark stored on its rows and
re-projects only what changed, a bounded number per scan cycle. It runs only inside the
awareness scan, and only while AWARENESS_NOTE_RESURFACE_ENABLED is on.

WHICH TICKER A NOTE IS ABOUT: the note's ``ticker`` field; else, when the note mentions or
embeds exactly ONE symbol, that one; else none (a note about three names does not say which
one its "Stop: 40" belongs to, and this module never guesses).

THE VERSION THAT NAMED A LEVEL: the OLDEST saved version (`j2_note_versions`, oldest first,
at most VERSION_SCAN_LIMIT) whose body and properties name the same (role, price) through
the same reader. A level the note's history has never held (it was added since the last
checkpoint, or the note was never edited) has no version id, and the notice opens the note
as it is now -- which is the content that named it.

PLACEHOLDER STOPS ARE NEVER LEVELS: a stop that `placeholder_stop.is_placeholder_stop`
reads as the mirror of an entry in the same note (a broker-filled tracker) is not indexed.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import date, datetime, timezone
from typing import Any, Iterable
from urllib.parse import quote

from api.services.notebook_flags import flag_on

log = logging.getLogger(__name__)

#: The gate. An ENABLEMENT gate: unset means OFF. A row of `auth.NOTEBOOK_FLAGS`, read through
#: the one parse, per call.
FLAG = "AWARENESS_NOTE_RESURFACE_ENABLED"

#: Notes re-projected per scan cycle at most. The first cycle after the flag is armed works
#: through a large notebook over several cycles; every later cycle sees only edited notes.
PROJECT_BUDGET = 150
#: Versions read per note when looking for the one that first named a level.
VERSION_SCAN_LIMIT = 200

#: The roles a row carries beyond plan_extract's price roles.
ROLE_NOTE = "note"          # the note is about this ticker (R8)
ROLE_NONE = "none"          # the note yields nothing; the row only holds its watermark
DATE_ROLES = ("review_date", "catalyst_date")
PRICE_ROLES = ("entry", "stop", "target")

#: The built-in Review Date property (note_properties.BUILTIN_PROPERTY_DEFS).
REVIEW_DATE_PROP = "builtin:review_date"
#: A member's own DATE property whose name says catalyst, event or earnings is a catalyst date.
_CATALYST_NAME = re.compile(r"\b(catalyst|event|earnings)\b", re.IGNORECASE)

_DDL = (
    """CREATE TABLE IF NOT EXISTS j2_note_levels (
        user_id          TEXT NOT NULL,
        note_id          TEXT NOT NULL,
        level_id         TEXT NOT NULL,
        symbol           TEXT NOT NULL,
        role             TEXT NOT NULL,
        shape            TEXT,
        price            REAL,
        on_date          TEXT,
        version_id       TEXT,
        named_at         TEXT,
        last_side        TEXT,
        note_updated_at  TEXT NOT NULL,
        projected_at     TEXT NOT NULL,
        PRIMARY KEY (user_id, note_id, level_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_note_levels_symbol ON j2_note_levels(symbol)",
    """CREATE TABLE IF NOT EXISTS j2_note_resurface_fires (
        user_id     TEXT NOT NULL,
        fire_key    TEXT NOT NULL,
        day_et      TEXT NOT NULL,
        insight_id  INTEGER,
        kind        TEXT NOT NULL,
        note_id     TEXT NOT NULL,
        version_id  TEXT,
        fired_at    TEXT NOT NULL,
        PRIMARY KEY (user_id, fire_key, day_et)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_note_resurface_fires_insight"
    " ON j2_note_resurface_fires(user_id, insight_id)",
)


def enabled() -> bool:
    """Is resurfacing on, read now (the one parse; unset = OFF)."""
    return flag_on(FLAG, False)


def ensure_schema(conn: sqlite3.Connection) -> None:
    for stmt in _DDL:
        conn.execute(stmt)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_symbol(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().lstrip("$").upper()
    return s if s and len(s) <= 12 else None


# ── reading ONE note (pure apart from the reader it calls) ────────────────────

def _date_rows(properties_json: Any, prop_defs: Iterable[dict] | None) -> list[dict]:
    """The note's dates: its Review Date, and any of the member's own date properties whose
    name says catalyst / event / earnings. Values, never prose."""
    values = properties_json
    if isinstance(values, (str, bytes)):
        try:
            values = json.loads(values)
        except (TypeError, ValueError):
            values = None
    if not isinstance(values, dict):
        return []
    out: list[dict] = []
    for d in prop_defs or []:
        if not isinstance(d, dict) or d.get("type") != "date":
            continue
        pid = d.get("id")
        if pid == REVIEW_DATE_PROP:
            role = "review_date"
        elif isinstance(d.get("name"), str) and _CATALYST_NAME.search(d["name"]):
            role = "catalyst_date"
        else:
            continue
        raw = values.get(pid)
        if not isinstance(raw, str):
            continue
        try:
            day = date.fromisoformat(raw.strip()[:10]).isoformat()
        except ValueError:
            continue
        out.append({"role": role, "on_date": day, "shape": "properties"})
    return out


def _level_id(role: str, value: Any) -> str:
    return f"{role}@{value}"


def read_note_rows(body_json: Any, properties_json: Any, prop_defs: list[dict] | None,
                   symbol: str) -> dict[str, dict]:
    """{level_id: row} for one note body: its price levels (from `plan_extract.note_levels`,
    the one reader; the highest-precedence shape kept when two shapes name the same
    (role, price)), minus placeholder stops, plus its dates. Never raises."""
    from api.services.journal_two.plan_extract import note_levels as plan_note_levels
    from api.services.placeholder_stop import is_placeholder_stop
    rows: dict[str, dict] = {}
    try:
        levels = plan_note_levels(body_json, properties_json, prop_defs, symbol)
        entries = [lv["price"] for lv in levels if lv.get("role") == "entry"]
        for lv in levels:            # precedence order: the first shape to name it wins
            role, price = lv.get("role"), lv.get("price")
            if role not in PRICE_ROLES or not isinstance(price, (int, float)):
                continue
            if role == "stop" and any(is_placeholder_stop(price, e) for e in entries):
                continue             # a placeholder stop is never a level
            lid = _level_id(role, price)
            rows.setdefault(lid, {"role": role, "price": float(price), "on_date": None,
                                  "shape": lv.get("shape")})
        for d in _date_rows(properties_json, prop_defs):
            rows.setdefault(_level_id(d["role"], d["on_date"]),
                            {"role": d["role"], "price": None, "on_date": d["on_date"], "shape": d["shape"]})
    except Exception:  # noqa: BLE001 -- member data reads as "less", never as a failed scan
        log.warning("[note_levels] a note could not be read", exc_info=True)
    return rows


# ── the projection ──────────────────────────────────────────────────────────

def _note_symbol(conn: sqlite3.Connection, user_id: str, note_id: str, ticker: Any) -> str | None:
    sym = _clean_symbol(ticker)
    if sym:
        return sym
    found = {r[0] for r in conn.execute(
        "SELECT symbol FROM j2_note_mentions WHERE note_id = ? AND user_id = ?"
        " UNION SELECT symbol FROM j2_note_embeds WHERE note_id = ? AND user_id = ? AND symbol IS NOT NULL",
        (note_id, user_id, note_id, user_id))}
    cleaned = {s for s in (_clean_symbol(x) for x in found) if s}
    return next(iter(cleaned)) if len(cleaned) == 1 else None


def _prop_defs(conn: sqlite3.Connection, user_id: str, cache: dict) -> list[dict]:
    if user_id not in cache:
        try:
            from api.services.journal_two.note_properties import list_property_defs
            cache[user_id] = list_property_defs(user_id, conn)
        except Exception:  # noqa: BLE001 -- no defs reads as "no property levels"
            cache[user_id] = []
    return cache[user_id]


def _versions_naming(conn: sqlite3.Connection, user_id: str, note_id: str, symbol: str,
                     prop_defs: list[dict], wanted: set[str]) -> dict[str, tuple[str, str]]:
    """{level_id: (version_id, version created_at)} -- the OLDEST version naming each."""
    found: dict[str, tuple[str, str]] = {}
    if not wanted:
        return found
    for v in conn.execute(
            "SELECT id, body_json, properties_json, created_at FROM j2_note_versions"
            " WHERE user_id = ? AND note_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
            (user_id, note_id, VERSION_SCAN_LIMIT)):
        names = read_note_rows(v["body_json"], v["properties_json"], prop_defs, symbol)
        for lid in wanted - set(found):
            if lid in names:
                found[lid] = (v["id"], v["created_at"])
        if len(found) == len(wanted):
            break
    return found


def project_note(conn: sqlite3.Connection, user_id: str, note: sqlite3.Row,
                 defs_cache: dict | None = None) -> int:
    """Rebuild one note's rows inside the caller's transaction. A level that survives the
    rebuild keeps its last observed side (so a re-save never re-arms a cross). Returns the
    number of rows written (the ``none`` watermark row included)."""
    defs_cache = {} if defs_cache is None else defs_cache
    note_id = note["id"]
    prev_side = {r["level_id"]: r["last_side"] for r in conn.execute(
        "SELECT level_id, last_side FROM j2_note_levels WHERE user_id = ? AND note_id = ?",
        (user_id, note_id))}
    conn.execute("DELETE FROM j2_note_levels WHERE user_id = ? AND note_id = ?", (user_id, note_id))
    now = _now()
    symbol = _note_symbol(conn, user_id, note_id, note["ticker"])
    rows: dict[str, dict] = {}
    if symbol:
        defs = _prop_defs(conn, user_id, defs_cache)
        rows = read_note_rows(note["body_json"], note["properties_json"], defs, symbol)
        named = _versions_naming(conn, user_id, note_id, symbol, defs, set(rows))
        for lid, row in rows.items():
            vid, at = named.get(lid, (None, note["updated_at"]))
            row["version_id"], row["named_at"] = vid, at
        rows[ROLE_NOTE] = {"role": ROLE_NOTE, "price": None, "on_date": None, "shape": None,
                           "version_id": None, "named_at": note["updated_at"]}
    else:
        rows[ROLE_NONE] = {"role": ROLE_NONE, "price": None, "on_date": None, "shape": None,
                           "version_id": None, "named_at": None}
    conn.executemany(
        "INSERT INTO j2_note_levels (user_id, note_id, level_id, symbol, role, shape, price,"
        " on_date, version_id, named_at, last_side, note_updated_at, projected_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(user_id, note_id, lid, symbol or "", r["role"], r["shape"], r["price"], r["on_date"],
          r["version_id"], r["named_at"], prev_side.get(lid), note["updated_at"], now)
         for lid, r in rows.items()])
    return len(rows)


def catch_up_all(conn: sqlite3.Connection, budget: int = PROJECT_BUDGET) -> dict:
    """Bring the index up to every member's live notes: drop the rows of notes that are
    trashed or gone, then re-project up to `budget` notes whose ``updated_at`` moved past
    their watermark (oldest edit first, so a backlog drains in order)."""
    ensure_schema(conn)
    current = {(r["user_id"], r["id"]): r["updated_at"] for r in conn.execute(
        "SELECT user_id, id, updated_at FROM j2_notes WHERE deleted_at IS NULL")}
    projected = {(r["user_id"], r["note_id"]): r["u"] for r in conn.execute(
        "SELECT user_id, note_id, MAX(note_updated_at) AS u FROM j2_note_levels"
        " GROUP BY user_id, note_id")}
    gone = [k for k in projected if k not in current]
    for uid, nid in gone:
        conn.execute("DELETE FROM j2_note_levels WHERE user_id = ? AND note_id = ?", (uid, nid))
    stale = sorted((u, k) for k, u in current.items() if projected.get(k) != u)[:max(0, int(budget))]
    defs_cache: dict = {}
    written = 0
    for _, (uid, nid) in stale:
        note = conn.execute(
            "SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
            " WHERE id = ? AND user_id = ? AND deleted_at IS NULL", (nid, uid)).fetchone()
        if note is not None:
            written += project_note(conn, uid, note, defs_cache)
    conn.commit()
    behind = sum(1 for k, u in current.items() if projected.get(k) != u) - len(stale)
    return {"notes_projected": len(stale), "notes_removed": len(gone), "rows_written": written,
            "notes_behind": max(0, behind)}


# ── what the scan reads and writes ─────────────────────────────────────────────

def load_index(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    """{user_id: [row]} for every live note's levels, dates and ``note`` rows -- one query,
    joined to j2_notes so a trashed note is never read even before its rows are dropped."""
    ensure_schema(conn)
    out: dict[str, list[dict]] = {}
    for r in conn.execute(
            "SELECT l.user_id, l.note_id, l.level_id, l.symbol, l.role, l.price, l.on_date,"
            " l.version_id, l.named_at, l.last_side, n.title AS note_title,"
            " n.updated_at AS note_updated_at"
            " FROM j2_note_levels l JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"
            " WHERE n.deleted_at IS NULL AND l.role != ? AND l.symbol != ''", (ROLE_NONE,)):
        out.setdefault(r["user_id"], []).append(dict(r))
    return out


def record_sides(conn: sqlite3.Connection, changes: list[tuple[str, str, str, str]]) -> int:
    """Store each level's side for the next cycle's cross test. `changes` is
    [(side, user_id, note_id, level_id)] for the rows whose side MOVED -- a level sitting
    on one side writes nothing."""
    if not changes:
        return 0
    conn.executemany("UPDATE j2_note_levels SET last_side = ? WHERE user_id = ? AND note_id = ?"
                     " AND level_id = ?", changes)
    conn.commit()
    return len(changes)


def already_fired(conn: sqlite3.Connection, user_id: str, fire_key: str, day_et: str,
                  once: bool = False) -> bool:
    ensure_schema(conn)
    if once:
        row = conn.execute("SELECT 1 FROM j2_note_resurface_fires WHERE user_id = ? AND fire_key = ?"
                           " LIMIT 1", (user_id, fire_key)).fetchone()
    else:
        row = conn.execute("SELECT 1 FROM j2_note_resurface_fires WHERE user_id = ? AND fire_key = ?"
                           " AND day_et = ?", (user_id, fire_key, day_et)).fetchone()
    return row is not None


def record_fire(conn: sqlite3.Connection, user_id: str, fire_key: str, day_et: str,
                insight_id: int, kind: str, note_id: str, version_id: str | None) -> None:
    ensure_schema(conn)
    conn.execute(
        "INSERT OR IGNORE INTO j2_note_resurface_fires (user_id, fire_key, day_et, insight_id,"
        " kind, note_id, version_id, fired_at) VALUES (?,?,?,?,?,?,?,?)",
        (user_id, fire_key, day_et, int(insight_id), kind, note_id, version_id, _now()))
    conn.commit()


def note_link(note_id: str, version_id: str | None) -> str:
    """The in-app door: the Notebook's own `?note=` door (address_space's note door), plus
    `resurfaceVersion` when a saved version named the level."""
    link = f"/journal/notebook?note={quote(str(note_id), safe='')}"
    if version_id:
        link += f"&resurfaceVersion={quote(str(version_id), safe='')}"
    return link


def links_for_insights(conn: sqlite3.Connection, user_id: str, insight_ids: Iterable[int]) -> dict[int, str]:
    """{insight_id: link} for this member's resurfacing insights, from the ledger. Only a note
    that is still live gets a link (a trashed one would open to nothing)."""
    ids = [int(i) for i in insight_ids]
    if not ids:
        return {}
    ensure_schema(conn)
    marks = ",".join("?" * len(ids))
    out: dict[int, str] = {}
    for r in conn.execute(
            f"SELECT f.insight_id, f.note_id, f.version_id FROM j2_note_resurface_fires f"
            f" JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id"
            f" WHERE f.user_id = ? AND n.deleted_at IS NULL AND f.insight_id IN ({marks})",
            [user_id, *ids]):
        out[int(r["insight_id"])] = note_link(r["note_id"], r["version_id"])
    return out
