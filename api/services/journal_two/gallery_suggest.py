"""Notebook widgets wave 11 (Task 11.9, ruling W11-R12): the member's suggested value for each "pick yours" choice.

When a member opens a shared widget or template, each choice (`share.SLOT_TYPES`) starts at the value the member
uses most, so the preview with their own data works at once. `suggest` answers, per asked type, `{"value", "label"}`
or None; `suggest_for` answers per CHOICE, matching the choice's source (ruling c2):

* `setup` / `tag` / `symbol` -- the most used value in the member's closed trades (a tag is a mistake or an emotion
  tag of a trade; a choice on the mistake or emotion field reads that field only). A tag or symbol choice on the
  NOTES source reads the member's note tags or note tickers instead;
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
* Bounded: each scan is ONE query over an indexed order, newest first, `LIMIT SCAN_LIMIT` (5001, the widget engine's
  own bound; read at call time); the routine and tracker reads are `LIMIT 1`. Each scan runs at most once per call.
* "Most used" counts flagged trades too (`analytics_excluded` is NOT applied: a flagged trade still used the setup).
* Ties go to the newest (the first met in the newest-first scan).
* No data is None, never a zero, an empty string or a placeholder (W9-R7).
* Notes are the notes the member's notes list holds, never the sample notebook (`compile.note_membership_sql`, which
  carries `sample_marker`'s predicate; railed by tests/test_sample_never_feeds_real_numbers.py).
"""
from __future__ import annotations

import sqlite3
from collections import Counter
from typing import Any, Iterable, Mapping

from api.services.journal_two import note_kinds as j2_note_kinds
from api.services.journal_two import note_properties
from api.services.journal_two import sample_marker
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as wsources

#: The one bound of every scan here: the widget engine's own (`LIMIT 5001`). Read at call time.
SCAN_LIMIT = wcompile.SCAN_LIMIT
#: The longest label answered (the plan's own text bound).
LABEL_MAX = 200

#: Which scan answers which type.
_TRADE_TYPES = frozenset({"setup", "tag", "symbol", "account"})
_NOTE_TYPES = frozenset({"folder", "note_kind", "property"})
#: The notes source's own value fields: a tag or symbol choice on notes reads the member's NOTES (ruling c2).
_NOTES_SOURCE = "notes"
_NOTE_VALUE_FIELDS = {"tag": "tag", "symbol": "ticker"}
#: A trade tag choice names its own field: a mistake tag is suggested from mistakes only.
_TRADE_TAG_FIELDS = frozenset({"mistake", "emotion"})

ROUTINE_SQL = ("SELECT r.id, r.name FROM j2_routine_ticks t"
               " JOIN j2_routines r ON r.id = t.routine_id AND r.user_id = t.user_id"
               " WHERE t.user_id = ? AND t.ticked = 1 AND r.deleted_at IS NULL AND r.archived_at IS NULL"
               " ORDER BY t.updated_at DESC LIMIT 1")
TRACKER_SQL = ("SELECT k.id, k.name FROM j2_tracker_values v"
               " JOIN j2_trackers k ON k.id = v.tracker_id AND k.user_id = v.user_id"
               " WHERE v.user_id = ? AND k.deleted_at IS NULL AND k.archived_at IS NULL"
               " ORDER BY v.updated_at DESC LIMIT 1")


def trades_sql() -> str:
    """Newest first on `idx_j2_trades_user_exit (user_id, exit_date)`, bounded by `SCAN_LIMIT`; flagged trades
    included (no `analytics_included_sql`): "most used" is what the member used, not what their stats count."""
    return ("SELECT setup, symbol, mistake_tags, emotion_tags, account_id FROM j2_trades"
            f" WHERE user_id = ? ORDER BY exit_date DESC LIMIT {int(SCAN_LIMIT)}")


def notes_sql(user_id: str) -> tuple[str, list]:
    """The notes the member's notes list holds, newest first on `idx_j2_notes_user_created (user_id,
    created_at)`, bounded: `compile.note_membership_sql` (the notes widget's own predicate), checked to carry
    the sample marker so a sample note is never "most used"."""
    where, params = wcompile.note_membership_sql(user_id)
    if sample_marker.not_sample_sql() not in where:
        raise RuntimeError("the notes predicate lost the sample marker")
    return (f"SELECT folder_id, properties_json, tags, ticker FROM j2_notes n{where}"
            f" ORDER BY created_at DESC LIMIT {int(SCAN_LIMIT)}", params)


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


def _tally() -> tuple[Counter, dict]:
    return Counter(), {}


def _top(tally: tuple[Counter, dict]) -> dict | None:
    v = _most(*tally)
    return _answer(v, v)


def _number(v: Any) -> bool:
    return (isinstance(v, (int, float)) and not isinstance(v, bool) and v == v
            and v not in (float("inf"), float("-inf")))


class _Trades:
    """ONE bounded scan of the member's closed trades, tallied per value field."""

    def __init__(self, conn: sqlite3.Connection, user_id: str):
        self._conn, self._uid = conn, user_id
        self.t = {k: _tally() for k in ("setup", "symbol", "mistake", "emotion", "tag", "account")}
        for setup, symbol, mistakes, emotions, account in conn.execute(trades_sql(), (user_id,)):
            _count(*self.t["setup"], setup.strip() if isinstance(setup, str) else None)
            _count(*self.t["symbol"], symbol.strip() if isinstance(symbol, str) else None)
            m, e = wsources._tags(mistakes), wsources._tags(emotions)
            for tag in dict.fromkeys(m):
                _count(*self.t["mistake"], tag)
            for tag in dict.fromkeys(e):
                _count(*self.t["emotion"], tag)
            for tag in dict.fromkeys(m + e):
                _count(*self.t["tag"], tag)
            _count(*self.t["account"], account)

    def answer(self, kind: str) -> dict | None:
        if kind != "account":
            return _top(self.t[kind])
        names = {r[0]: r[1] for r in self._conn.execute(
            "SELECT id, name FROM j2_accounts WHERE user_id = ?", (self._uid,))}
        v = _most(*self.t["account"], allowed=names)
        return _answer(v, names.get(v)) if v else None


class _Notes:
    """ONE bounded scan of the member's live notes, tallied per value."""

    def __init__(self, conn: sqlite3.Connection, user_id: str, want_props: bool):
        self._conn, self._uid = conn, user_id
        self.props = ([d for d in note_properties.list_property_defs(user_id, conn)
                       if d.get("type") == "number"
                       and wsources.member_property(conn, user_id, d.get("id")) is not None]
                      if want_props else [])
        self.t = {k: _tally() for k in ("folder", "kind", "filled", "tag", "ticker")}
        sql, params = notes_sql(user_id)
        for folder_id, raw, tags, ticker in conn.execute(sql, params):
            _count(*self.t["folder"], folder_id)
            parsed = note_properties._parse_properties_json(raw)
            _count(*self.t["kind"], parsed.get(j2_note_kinds.NOTE_KIND_PROPERTY))
            for d in self.props:
                if _number(parsed.get(d["id"])):
                    _count(*self.t["filled"], d["id"])
            for tag in dict.fromkeys(wsources._tags(tags)):
                _count(*self.t["tag"], tag)
            _count(*self.t["ticker"], ticker.strip().upper() if isinstance(ticker, str) else None)

    def answer(self, kind: str) -> dict | None:
        if kind == "folder":
            own = {r[0]: r[1] for r in self._conn.execute(
                "SELECT id, name FROM j2_note_folders WHERE user_id = ? AND " + sample_marker.not_sample_sql(),
                (self._uid,))}
            v = _most(*self.t["folder"], allowed=own)
            return _answer(v, own.get(v)) if v else None
        if kind == "note_kind":
            counts, order = self.t["kind"]
            for k in sorted(counts, key=lambda k: (-counts[k], order[k])):   # the most used kind that is theirs
                found = j2_note_kinds.get_kind(self._uid, k, self._conn)
                if found is not None:
                    return _answer(k, found.get("name"))
            return None
        if kind == "property":
            names = {d["id"]: d.get("name") for d in self.props}
            v = _most(*self.t["filled"], allowed=names)
            return _answer(v, names.get(v)) if v else None
        return _top(self.t[kind])                                            # "tag", "ticker"


def _newest(conn: sqlite3.Connection, sql: str, user_id: str) -> dict | None:
    row = conn.execute(sql, (user_id,)).fetchone()
    return _answer(row[0], row[1]) if row else None


class _Reader:
    """Each scan at most once per call, and only when an asked choice needs it."""

    def __init__(self, conn: sqlite3.Connection, user_id: str, want_props: bool):
        self.conn, self.uid, self.want_props = conn, user_id, want_props
        self._trades: _Trades | None = None
        self._notes: _Notes | None = None

    def trades(self) -> _Trades:
        if self._trades is None:
            self._trades = _Trades(self.conn, self.uid)
        return self._trades

    def notes(self) -> _Notes:
        if self._notes is None:
            self._notes = _Notes(self.conn, self.uid, self.want_props)
        return self._notes

    def by_type(self, stype: str) -> dict | None:
        if stype in _TRADE_TYPES:
            return self.trades().answer(stype)
        if stype in _NOTE_TYPES:
            return self.notes().answer(stype)
        if stype == "routine":
            return _newest(self.conn, ROUTINE_SQL, self.uid)
        if stype == "tracker":
            return _newest(self.conn, TRACKER_SQL, self.uid)
        return None                                          # a number is the member's to type, never suggested

    def for_slot(self, slot: Mapping) -> dict | None:
        """Ruling c2: a choice's suggestion matches its SOURCE (a notes tag choice suggests a note tag; a mistake
        tag choice a mistake tag); every other choice answers by its type."""
        stype, source, fld = slot.get("type"), slot.get("source"), slot.get("field")
        if source == _NOTES_SOURCE and stype in _NOTE_VALUE_FIELDS:
            return self.notes().answer(_NOTE_VALUE_FIELDS[stype])
        if stype == "tag" and fld in _TRADE_TAG_FIELDS:
            return self.trades().answer(fld)
        return self.by_type(stype)


def suggest(user_id: str, types: Iterable[str], *, conn: sqlite3.Connection) -> dict[str, dict | None]:
    """`{type: {"value", "label"} | None}` for each asked type of `share.SLOT_TYPES` (other names are ignored),
    for the session member `user_id` only. A scan runs only when an asked type needs it."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a suggestion needs the session member's id")
    asked = frozenset(t for t in (types or ()) if isinstance(t, str) and t in share.SLOT_TYPES)
    reader = _Reader(conn, user_id, "property" in asked)
    return {t: reader.by_type(t) for t in asked}


def suggest_for(user_id: str, slots: Iterable[Mapping], *, conn: sqlite3.Connection) -> dict[str, dict | None]:
    """`{slot id: {"value", "label"} | None}` for a shared payload's choices: each suggestion from the member's
    own rows of the choice's SOURCE (ruling c2); each scan read at most once."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a suggestion needs the session member's id")
    good = [s for s in (slots or ()) if isinstance(s, Mapping) and isinstance(s.get("id"), str)
            and s.get("type") in share.SLOT_TYPES]
    reader = _Reader(conn, user_id, any(s["type"] == "property" for s in good))
    return {s["id"]: reader.for_slot(s) for s in good}


__all__ = ["suggest", "suggest_for", "SCAN_LIMIT", "trades_sql", "notes_sql", "ROUTINE_SQL", "TRACKER_SQL"]
