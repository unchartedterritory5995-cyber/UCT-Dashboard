"""Notebook widgets wave 11 (Task 11.9, ruling W11-R12): the member's suggested value for each "pick yours" choice.

When a member opens a shared widget or template, each choice (`share.SLOT_TYPES`) starts at the value the member
uses most, so the preview with their own data works at once. `suggest` answers, per asked type, `{"value", "label"}`
or None:

* `setup` / `tag` / `symbol` -- the most used value in the member's closed trades (a tag is a mistake or an emotion
  tag of a trade, the trade tag fields the closed-trades source offers);
* `account`  -- the member's own account with the most trades (`value` its id, `label` the member's own name for it;
  this answer is the member's own and is never public);
* `property` -- the member's own number property (user-set, not calculated: `sources.member_property`, the notes
  scan's own rule) filled on the most notes;
* `folder`   -- the member's own folder holding the most live notes;
* `note_kind` -- the kind of note the member uses most (a note's CURRENT kind, `note_kinds.NOTE_KIND_PROPERTY`);
* `routine`  -- the member's live routine with the newest tick; `tracker` the live tracker with the newest value;
* `number`   -- never suggested: always None.

Rules:

* The member's own rows only: every query is `WHERE user_id = ?` with the session member, and every id a scan finds
  is answered only when it names a row of THEIR own (an account, a folder, a kind, a property, a routine, a tracker).
* Bounded: each scan is ONE query over an indexed order, newest first, `LIMIT 5001` (`compile.SCAN_LIMIT`, the
  widget engine's own bound); the routine and tracker reads are `LIMIT 1`.
* "Most used" counts flagged trades too (`analytics_excluded` is NOT applied: a flagged trade still used the setup).
* Ties go to the newest (the first met in the newest-first scan).
* No data is None, never a zero, an empty string or a placeholder (W9-R7).
* Notes are the notes the member's notes list holds, never the sample notebook (`compile.note_membership_sql`, which
  carries `sample_marker`'s predicate; railed by tests/test_sample_never_feeds_real_numbers.py).
"""
from __future__ import annotations

import sqlite3
from collections import Counter
from typing import Any, Iterable

from api.services.journal_two import note_kinds as j2_note_kinds
from api.services.journal_two import note_properties
from api.services.journal_two import sample_marker
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as wsources

#: The one bound of every scan here: the widget engine's own (`LIMIT 5001`).
SCAN_LIMIT = wcompile.SCAN_LIMIT
#: The longest label answered (the plan's own text bound).
LABEL_MAX = 200

#: Which scan answers which type.
_TRADE_TYPES = frozenset({"setup", "tag", "symbol", "account"})
_NOTE_TYPES = frozenset({"folder", "note_kind", "property"})

#: Newest first on `idx_j2_trades_user_exit (user_id, exit_date)`; flagged trades included (no
#: `analytics_included_sql`): "most used" is what the member used, not what their stats count.
TRADES_SQL = ("SELECT setup, symbol, mistake_tags, emotion_tags, account_id FROM j2_trades"
              f" WHERE user_id = ? ORDER BY exit_date DESC LIMIT {SCAN_LIMIT}")
ROUTINE_SQL = ("SELECT r.id, r.name FROM j2_routine_ticks t"
               " JOIN j2_routines r ON r.id = t.routine_id AND r.user_id = t.user_id"
               " WHERE t.user_id = ? AND t.ticked = 1 AND r.deleted_at IS NULL AND r.archived_at IS NULL"
               " ORDER BY t.updated_at DESC LIMIT 1")
TRACKER_SQL = ("SELECT k.id, k.name FROM j2_tracker_values v"
               " JOIN j2_trackers k ON k.id = v.tracker_id AND k.user_id = v.user_id"
               " WHERE v.user_id = ? AND k.deleted_at IS NULL AND k.archived_at IS NULL"
               " ORDER BY v.updated_at DESC LIMIT 1")


def _answer(value: Any, label: Any) -> dict | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = label if isinstance(label, str) and label.strip() else value
    return {"value": value, "label": text.strip()[:LABEL_MAX]}


def _most(counts: Counter, order: dict, allowed: Any = None) -> str | None:
    """The most counted key (`allowed` keys only, when given); a tie goes to the one met first (newest)."""
    best = None
    for k, n in counts.items():
        if n <= 0 or (allowed is not None and k not in allowed):
            continue
        if best is None or n > counts[best] or (n == counts[best] and order[k] < order[best]):
            best = k
    return best


def _count(counts: Counter, order: dict, key: Any) -> None:
    if isinstance(key, str) and key.strip():
        counts[key] += 1
        order.setdefault(key, len(order))


def _trades(conn: sqlite3.Connection, user_id: str, types: frozenset[str]) -> dict[str, dict | None]:
    tallies = {t: (Counter(), {}) for t in ("setup", "tag", "symbol", "account")}
    for setup, symbol, mistakes, emotions, account in conn.execute(TRADES_SQL, (user_id,)):
        _count(*tallies["setup"], setup.strip() if isinstance(setup, str) else None)
        _count(*tallies["symbol"], symbol.strip() if isinstance(symbol, str) else None)
        for tag in dict.fromkeys(wsources._tags(mistakes) + wsources._tags(emotions)):
            _count(*tallies["tag"], tag)
        _count(*tallies["account"], account)
    out: dict[str, dict | None] = {}
    for t in ("setup", "tag", "symbol"):
        if t in types:
            v = _most(*tallies[t])
            out[t] = _answer(v, v)
    if "account" in types:
        names = {r[0]: r[1] for r in conn.execute(
            "SELECT id, name FROM j2_accounts WHERE user_id = ?", (user_id,))}
        v = _most(*tallies["account"], allowed=names)
        out["account"] = _answer(v, names.get(v)) if v else None
    return out


def _notes_sql(user_id: str) -> tuple[str, list]:
    """The notes the member's notes list holds, newest first, bounded: `compile.note_membership_sql` (the notes
    widget's own predicate), checked to carry the sample marker so a sample note is never "most used"."""
    where, params = wcompile.note_membership_sql(user_id)
    if sample_marker.not_sample_sql() not in where:
        raise RuntimeError("the notes predicate lost the sample marker")
    return (f"SELECT folder_id, properties_json FROM j2_notes n{where}"
            f" ORDER BY created_at DESC LIMIT {SCAN_LIMIT}", params)


def _number(v: Any) -> bool:
    return (isinstance(v, (int, float)) and not isinstance(v, bool) and v == v
            and v not in (float("inf"), float("-inf")))


def _notes(conn: sqlite3.Connection, user_id: str, types: frozenset[str]) -> dict[str, dict | None]:
    props: list[dict] = []
    if "property" in types:
        props = [d for d in note_properties.list_property_defs(user_id, conn)
                 if d.get("type") == "number" and wsources.member_property(conn, user_id, d.get("id")) is not None]
    folders = (Counter(), {})
    kinds = (Counter(), {})
    filled = (Counter(), {})
    sql, params = _notes_sql(user_id)
    for folder_id, raw in conn.execute(sql, params):
        _count(*folders, folder_id)
        parsed = note_properties._parse_properties_json(raw) if ("note_kind" in types or props) else {}
        _count(*kinds, parsed.get(j2_note_kinds.NOTE_KIND_PROPERTY))
        for d in props:
            if _number(parsed.get(d["id"])):
                _count(*filled, d["id"])
    out: dict[str, dict | None] = {}
    if "folder" in types:
        own = {r[0]: r[1] for r in conn.execute(
            "SELECT id, name FROM j2_note_folders WHERE user_id = ? AND " + sample_marker.not_sample_sql(),
            (user_id,))}
        v = _most(*folders, allowed=own)
        out["folder"] = _answer(v, own.get(v)) if v else None
    if "note_kind" in types:
        out["note_kind"] = None
        counts, order = kinds
        for k in sorted(counts, key=lambda k: (-counts[k], order[k])):       # the most used kind that is theirs
            found = j2_note_kinds.get_kind(user_id, k, conn)
            if found is not None:
                out["note_kind"] = _answer(k, found.get("name"))
                break
    if "property" in types:
        names = {d["id"]: d.get("name") for d in props}
        v = _most(*filled, allowed=names)
        out["property"] = _answer(v, names.get(v)) if v else None
    return out


def _newest(conn: sqlite3.Connection, sql: str, user_id: str) -> dict | None:
    row = conn.execute(sql, (user_id,)).fetchone()
    return _answer(row[0], row[1]) if row else None


def suggest(user_id: str, types: Iterable[str], *, conn: sqlite3.Connection) -> dict[str, dict | None]:
    """`{type: {"value", "label"} | None}` for each asked type of `share.SLOT_TYPES` (other names are ignored),
    for the session member `user_id` only. A scan runs only when an asked type needs it."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a suggestion needs the session member's id")
    asked = frozenset(t for t in (types or ()) if isinstance(t, str) and t in share.SLOT_TYPES)
    out: dict[str, dict | None] = {t: None for t in asked}
    if asked & _TRADE_TYPES:
        out.update(_trades(conn, user_id, asked & _TRADE_TYPES))
    if asked & _NOTE_TYPES:
        out.update(_notes(conn, user_id, asked & _NOTE_TYPES))
    if "routine" in asked:
        out["routine"] = _newest(conn, ROUTINE_SQL, user_id)
    if "tracker" in asked:
        out["tracker"] = _newest(conn, TRACKER_SQL, user_id)
    out.pop("number", None)
    if "number" in asked:
        out["number"] = None                       # a number is the member's to type, never suggested
    return out


__all__ = ["suggest", "SCAN_LIMIT", "TRADES_SQL", "ROUTINE_SQL", "TRACKER_SQL"]
