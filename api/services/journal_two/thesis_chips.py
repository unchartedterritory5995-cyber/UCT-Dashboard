"""Wave 13 lane 13G-2 -- thesis chips on rows.

A row for a symbol a member has written about (Open Positions, Holdings, and -- by
agreement, P2 -- a Watchlist widget) shows a small chip: the note's own
``builtin:thesis_status`` (Watching/Active/Invalidated/Closed) and the price level that
marks the thesis invalidated -- the note's STOP (13D's `j2_note_levels` projection of
`plan_extract`, the ONE reader of plan levels). This module never re-reads a note's body
and never re-derives a level: it reads the already-projected index and the note's own
stored properties, nothing else.

WHICH NOTE, WHEN A MEMBER HAS WRITTEN SEVERAL ABOUT ONE SYMBOL: the most recently
updated LIVE note that names the symbol -- the same "newest row wins" rule
`j2_note_levels` itself keeps for a level's side (CLAUDE.md). A note with no stop/target/
entry row still answers with its thesis status alone (`stop` is then null, worded by the
client as "no stop in this note", never a zero).

THE DISTANCE ITSELF (a percent, from a row's own current price to the returned stop) is
left to the client -- every row that wants a chip already has its own live or broker
price for other columns, and shipping that number again here would be a second price
fetch this module has no reason to make. What must never be recomputed, and is not, is
the LEVEL: `stop`/`target`/`entry` below are `j2_note_levels.price`, verbatim.

ONE BATCH QUERY for every symbol a caller asks about, one process-wide LEFT JOIN -- never
one query per symbol (the rail: N symbols, 1 `conn.execute`, not wall-clock).

NO NEW TABLE. This module reads `j2_note_levels` (13D) and `j2_notes.properties_json`
(the one property store), and writes nothing -- so there is nothing of its own for
`account_purge` to take; the tables it reads are already purged by their own lanes.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from api.services.journal_two.note_levels import note_link
from api.services.notebook_flags import flag_on

#: The gate. An enablement gate: unset means OFF.
FLAG = "NOTEBOOK_THESIS_CHIPS_ENABLED"

#: Symbols a single batch call will resolve. A row population beyond this is not a normal
#: Positions/Holdings/Watchlist page; truncating (not erroring) keeps a large widget's
#: first N rows chipped rather than failing the whole batch for a list a member grew.
MAX_SYMBOLS = 300

#: The level roles a chip reports verbatim from `j2_note_levels`.
_PRICE_FIELDS = ("entry", "stop", "target")

#: The one property this feature reads off a note -- Wave E's builtin select
#: (`note_properties.BUILTIN_PROPERTY_DEFS`), never a second status store.
_THESIS_STATUS_PROP = "builtin:thesis_status"


def enabled() -> bool:
    """Is the chip on, read now (the one parse; unset = OFF)."""
    return flag_on(FLAG, False)


def _clean_symbol(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().lstrip("$").upper()
    return s if s and len(s) <= 12 else None


def _dedupe_symbols(symbols: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for s in list(symbols or [])[: MAX_SYMBOLS * 4]:  # a hostile huge list is still bounded
        c = _clean_symbol(s)
        if c and c not in seen:
            seen.add(c)
            out.append(c)
        if len(out) >= MAX_SYMBOLS:
            break
    return out


def _thesis_status(properties_json: Any) -> str | None:
    values = properties_json
    if isinstance(values, (bytes, bytearray)):
        values = values.decode("utf-8", "replace")
    if isinstance(values, str):
        try:
            values = json.loads(values)
        except (TypeError, ValueError):
            return None
    if not isinstance(values, dict):
        return None
    v = values.get(_THESIS_STATUS_PROP)
    return v if isinstance(v, str) and v else None


def batch_chips(conn: sqlite3.Connection, user_id: str, symbols: Any) -> dict[str, dict]:
    """{symbol: chip} for every requested symbol that resolves to a live note of this
    member's. A symbol with no note for this member is simply absent -- the caller
    renders no chip for it, never an empty one.

    ONE query: every level row for every requested symbol, joined to the note it
    belongs to, in a single `conn.execute`. Grouping by note and picking the newest
    happens in Python over that one result set.
    """
    cleaned = _dedupe_symbols(symbols)
    if not cleaned:
        return {}
    marks = ",".join("?" * len(cleaned))
    # ⛔ THE TABLE IS ANOTHER FEATURE'S (`note_levels.ensure_schema`), and on a running pod
    # only the resurfacing pass creates it. A database that pass has never touched has no
    # levels at all, so the true answer is "no chips" -- never a 500 (flags review R5 I4).
    # Answered as empty rather than by creating the table here: this is a read path, and
    # the batch stays exactly one `execute`.
    try:
        rows = conn.execute(
            "SELECT l.symbol AS symbol, l.note_id AS note_id, l.role AS role, l.price AS price,"
            " n.title AS title, n.properties_json AS properties_json, n.updated_at AS updated_at"
            f" FROM j2_note_levels l JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"
            f" WHERE l.user_id = ? AND l.symbol IN ({marks}) AND n.deleted_at IS NULL",
            [user_id, *cleaned],
        ).fetchall()
    except sqlite3.OperationalError as e:
        if "no such table: j2_note_levels" not in str(e):
            raise
        return {}

    by_note: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["symbol"], r["note_id"])
        rec = by_note.setdefault(key, {
            "symbol": r["symbol"], "note_id": r["note_id"], "title": r["title"],
            "updated_at": r["updated_at"], "properties_json": r["properties_json"],
            "entry": None, "stop": None, "target": None,
        })
        if r["role"] in _PRICE_FIELDS and r["price"] is not None:
            rec[r["role"]] = float(r["price"])

    newest: dict[str, dict] = {}
    for (sym, _nid), rec in by_note.items():
        cur = newest.get(sym)
        if cur is None or (rec["updated_at"] or "") > (cur["updated_at"] or ""):
            newest[sym] = rec

    out: dict[str, dict] = {}
    for sym, rec in newest.items():
        out[sym] = {
            "noteId": rec["note_id"],
            "title": rec["title"],
            "thesisStatus": _thesis_status(rec["properties_json"]),
            "entry": rec["entry"],
            "stop": rec["stop"],
            "target": rec["target"],
            "noteUpdatedAt": rec["updated_at"],
            "link": note_link(rec["note_id"], None),
        }
    return out
