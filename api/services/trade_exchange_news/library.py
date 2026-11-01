"""UCT News -- a member's Research Library: bookmarks, personal collections, notes (V1).

⛔⛔ THE ARCHIVE IS NOT TOUCHED HERE. Every Trade Exchange headline and delivery stays in
the News store (`store.py`) and the R2 journal permanently, saved or not. This module
reads the News store and never writes it: removing a bookmark, deleting a collection or
clearing a note deletes only the MEMBER'S OWN rows below, in auth.db. A test pins that
nothing here names the News tables in a write.

WHERE THE MEMBER'S DATA LIVES. auth.db (`auth_db.SCHEMA`: `txn_bookmarks`,
`txn_collections`, `txn_collection_items`), beside watchlists -- NOT in the News database:
that file is shared by every member and can be rebuilt from R2 (`txn_rebuild_from_r2`),
which would lose anything personal kept in it. auth.db is backed up every 6 h and nightly
(`authdb_backup`), and an account deletion removes these rows (`account_purge`
`_DIRECT_USER_TABLES`, plus `ON DELETE CASCADE` from `users`).

STABLE REFERENCES. A bookmark holds the headline's `event_id` -- the receiver's ULID,
written into the R2 journal with the delivery -- never `seq` (renumbered by a rebuild, in a
new epoch). It is resolved through `deliveries` (`Store.resolve_events`), whose rows are one
per delivery, so it still finds its headline after a rebuild even when a different delivery
of the same story became that headline's first. A bookmark the store cannot resolve yet (an
empty volume still recovering) is KEPT and listed as "restoring", never dropped.

ONE BOOKMARK PER STORY. A headline's own id is its FIRST delivery's, and which delivery is
first can change in a rebuild (a late delivery recovered from R2 is replayed in event-id
order). So every write matches the member's bookmark against ALL of the story's delivery
ids (`Store.story_ids`), and `state` answers the headline's CURRENT id beside the stored
one: a News row still shows as saved, saving it again is a no-op (no duplicate), and
removing it removes the stored bookmark. The stored id itself never changes.

TRANSACTIONS. Every write is one `BEGIN IMMEDIATE` transaction (`_tx`): it commits whole
or rolls back whole, so a failed removal never leaves a bookmark without its collection
rows or the reverse. Removal is immediate and complete on the server; Undo is a fresh
save that puts back exactly what removal answered (note, note time, saved time and the
collections that still exist). A closed tab simply never sends Undo -- the database is
already consistent, and a later save is a fresh bookmark with no note and no collections.

PER-MEMBER, ALWAYS. Every statement is keyed by the session's `user_id` (the routes never
read one from the request). A collection id that is not the caller's is "not found" -- the
same answer as one that does not exist, so ids reveal nothing.
"""
from __future__ import annotations

import collections
import contextlib
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Iterable
from zoneinfo import ZoneInfo

FLAG = "TXN_LIBRARY_ENABLED"
MAX_BOOKMARKS = 5000
MAX_COLLECTIONS = 100
NAME_MAX = 60
NOTE_MAX = 4000
PAGE_MAX = 200
DEFAULT_PAGE = 60
WRITES_PER_MINUTE = 120
ET = ZoneInfo("America/New_York")

#: The member tables, in auth.db. `account_purge._DIRECT_USER_TABLES` names all three.
TABLES = ("txn_bookmarks", "txn_collections", "txn_collection_items")


class LibraryError(Exception):
    """A refusal the member reads: `status` for the route, `detail` a sentence."""

    def __init__(self, status: int, reason: str, detail: str) -> None:
        super().__init__(reason)
        self.status, self.reason, self.detail = status, reason, detail


def enabled() -> bool:
    import os
    return os.environ.get(FLAG, "1").strip() != "0"


def _now_ms() -> int:
    return int(time.time() * 1000)


@contextlib.contextmanager
def _db():
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        yield c
    finally:
        c.close()


@contextlib.contextmanager
def _tx(c):
    """One write transaction: the write lock up front (so a check followed by a write cannot race),
    committed whole or rolled back whole."""
    c.execute("BEGIN IMMEDIATE")
    try:
        yield c
    except BaseException:
        c.rollback()
        raise
    c.commit()


def _story(store, eid: str) -> list[str]:
    """`eid` and every other delivery id of its story (just `eid` when the store cannot say)."""
    try:
        ids = store.story_ids(eid) if store is not None else []
    except Exception:  # noqa: BLE001 -- a store mid-recovery: match the id alone
        ids = []
    return list(dict.fromkeys([eid, *ids]))


def _stored_id(c, uid: str, ids: list[str]) -> str | None:
    """The member's bookmark among a story's ids: the exact id if saved, else the newest."""
    marks = ",".join("?" * len(ids))
    rows = c.execute(f"SELECT event_id FROM txn_bookmarks WHERE user_id = ? AND event_id IN ({marks})"
                     " ORDER BY saved_at_ms DESC", (uid, *ids)).fetchall()
    have = [r[0] for r in rows]
    return ids[0] if ids[0] in have else (have[0] if have else None)


# ── write rate (per member, in-process) ──────────────────────────────────────

_recent: dict[str, collections.deque] = {}
_recent_lock = threading.Lock()


def _write_ok(uid: str) -> None:
    now = time.monotonic()
    with _recent_lock:
        q = _recent.setdefault(uid, collections.deque())
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= WRITES_PER_MINUTE:
            raise LibraryError(429, "rate_limited", "That's a lot of changes in a minute. Try again shortly.")
        q.append(now)


# ── validation ───────────────────────────────────────────────────────────────

def _event_id(v: Any) -> str:
    import re
    if not isinstance(v, str) or not re.fullmatch(r"[0-9A-Za-z_-]{1,64}", v):
        raise LibraryError(422, "bad_id", "That headline could not be identified.")
    return v


def _name(v: Any) -> str:
    name = " ".join(str(v or "").split())
    if not name:
        raise LibraryError(422, "bad_name", "Give the collection a name.")
    if len(name) > NAME_MAX:
        raise LibraryError(422, "bad_name", f"Collection names are at most {NAME_MAX} characters.")
    return name


def _note(v: Any) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        raise LibraryError(422, "bad_note", "A note is text.")
    note = v.replace("\r\n", "\n").strip()
    if len(note) > NOTE_MAX:
        raise LibraryError(422, "bad_note", f"Notes are at most {NOTE_MAX:,} characters.")
    return note


def _must_resolve(store, event_id: str) -> None:
    if store is None or not store.resolve_events([event_id]):
        raise LibraryError(404, "not_found", "That headline could not be found.")


# ── reads ────────────────────────────────────────────────────────────────────

def _collection_rows(c, uid: str) -> list[dict[str, Any]]:
    rows = c.execute(
        "SELECT col.id, col.name, col.created_at_ms, col.updated_at_ms,"
        " (SELECT COUNT(*) FROM txn_collection_items i WHERE i.collection_id = col.id AND i.user_id = col.user_id)"
        " FROM txn_collections col WHERE col.user_id = ? ORDER BY col.name COLLATE NOCASE", (uid,)).fetchall()
    return [{"id": r[0], "name": r[1], "created_at_ms": r[2], "updated_at_ms": r[3], "count": r[4]} for r in rows]


def state(uid: str, store=None) -> dict[str, Any]:
    """What every News widget needs to mark saved rows: the saved ids and the collections.
    With the store, each bookmark's headline's CURRENT id follows its stored id, so a row
    whose first delivery changed in a rebuild still shows as saved."""
    with _db() as c:
        stored = [r[0] for r in c.execute("SELECT event_id FROM txn_bookmarks WHERE user_id = ?"
                                          " ORDER BY saved_at_ms DESC", (uid,)).fetchall()]
        cols = _collection_rows(c, uid)
    found = {}
    if store is not None and stored:
        try:
            found = store.resolve_events(stored)
        except Exception:  # noqa: BLE001 -- the stored ids alone still mark rows
            found = {}
    ids = list(dict.fromkeys(x for e in stored for x in (e, (found.get(e) or {}).get("event_id")) if x))
    return {"ids": ids, "collections": cols, "limits": {"bookmarks": MAX_BOOKMARKS, "collections": MAX_COLLECTIONS,
                                                       "name": NAME_MAX, "note": NOTE_MAX}}


def _bookmarks(c, uid: str) -> list[dict[str, Any]]:
    rows = c.execute("SELECT event_id, saved_at_ms, note, note_updated_at_ms FROM txn_bookmarks"
                     " WHERE user_id = ?", (uid,)).fetchall()
    links: dict[str, list[str]] = collections.defaultdict(list)
    for eid, cid in c.execute("SELECT event_id, collection_id FROM txn_collection_items WHERE user_id = ?"
                              " ORDER BY added_at_ms", (uid,)).fetchall():
        links[eid].append(cid)
    return [{"event_id": r[0], "saved_at_ms": r[1], "note": r[2] or "", "note_updated_at_ms": r[3],
             "collection_ids": links.get(r[0], [])} for r in rows]


def _et_day_ms(day: str | None, *, end: bool) -> int | None:
    if not day:
        return None
    try:
        d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=ET)
    except (TypeError, ValueError):
        raise LibraryError(422, "bad_date", "Dates are YYYY-MM-DD.")
    if end:
        d = d + timedelta(days=1)
    return int(d.timestamp() * 1000)


def items(uid: str, store, *, query: str = "", ticker: str = "", collection: str = "",
          date_from: str = "", date_to: str = "", sort: str = "saved", offset: int = 0,
          limit: int = DEFAULT_PAGE, event_for=None) -> dict[str, Any]:
    """The member's saved headlines, filtered, newest first. `event_for(row)` builds a
    headline's event (the route passes the News pipeline's own builder)."""
    q = (query or "").strip().casefold()
    sym = (ticker or "").strip().upper().lstrip("$")
    lo, hi = _et_day_ms(date_from, end=False), _et_day_ms(date_to, end=True)
    with _db() as c:
        marks = _bookmarks(c, uid)
        if collection:
            owned = c.execute("SELECT 1 FROM txn_collections WHERE id = ? AND user_id = ?",
                              (collection, uid)).fetchone()
            if not owned:
                raise LibraryError(404, "not_found", "That collection could not be found.")
    if collection:
        marks = [m for m in marks if collection in m["collection_ids"]]
    found = store.resolve_events([m["event_id"] for m in marks]) if (store is not None and marks) else {}
    out = []
    for m in marks:
        row = found.get(m["event_id"])
        ev = event_for(row) if (row is not None and event_for) else None
        if row is None:
            # Kept, never dropped: the archive is restoring it. A text/ticker/date filter
            # cannot match what is not readable yet, so only the plain view lists it.
            if q or sym or lo is not None or hi is not None:
                continue
            out.append({"id": m["event_id"], "restoring": True, "bookmark": m})
            continue
        if q and q not in row["content"].casefold() and q not in m["note"].casefold():
            continue
        tickers = (ev or {}).get("tickers") or row.get("tickers") or []
        if sym and sym not in tickers:
            continue
        if lo is not None and row["received_at_ms"] < lo:
            continue
        if hi is not None and row["received_at_ms"] >= hi:
            continue
        item = dict(ev) if ev else {"id": m["event_id"], "content": row["content"],
                                    "received_at_ms": row["received_at_ms"], "tickers": tickers}
        item["id"] = m["event_id"]          # the member's reference, whatever the headline's first delivery
        item["bookmark"] = m
        out.append(item)
    key = (lambda i: i.get("received_at_ms") or 0) if sort == "received" else (lambda i: i["bookmark"]["saved_at_ms"])
    out.sort(key=key, reverse=True)
    offset = max(0, int(offset or 0))
    limit = max(1, min(PAGE_MAX, int(limit or DEFAULT_PAGE)))
    return {"items": out[offset:offset + limit], "total": len(out), "offset": offset, "limit": limit,
            "saved_total": len(marks) if not collection else None}


# ── writes ───────────────────────────────────────────────────────────────────

def _owned_collections(c, uid: str, ids: Iterable[Any]) -> list[str]:
    want = [i for i in dict.fromkeys(ids or []) if isinstance(i, str)]
    if not want:
        return []
    marks = ",".join("?" * len(want))
    have = {r[0] for r in c.execute(f"SELECT id FROM txn_collections WHERE user_id = ? AND id IN ({marks})",
                                    (uid, *want)).fetchall()}
    return [i for i in want if i in have]


def save(uid: str, store, event_id: Any, *, note: Any = None, collection_ids: Iterable[Any] = (),
         saved_at_ms: Any = None, note_updated_at_ms: Any = None) -> dict[str, Any]:
    """Save (idempotent: saving a saved headline -- by ANY delivery id of its story -- changes
    nothing and is not an error). `note`, `note_updated_at_ms`, `collection_ids` and
    `saved_at_ms` restore a bookmark the member just removed (Undo), exactly; collection ids
    that are not the member's (or were deleted since) are ignored."""
    eid = _event_id(event_id)
    _write_ok(uid)
    _must_resolve(store, eid)
    now = _now_ms()

    def past(v):
        return isinstance(v, int) and not isinstance(v, bool) and 0 < v <= now

    when = saved_at_ms if past(saved_at_ms) else now
    text = _note(note)
    noted = (note_updated_at_ms if past(note_updated_at_ms) else now) if text else None
    story = _story(store, eid)
    with _db() as c:
        with _tx(c):
            existing = _stored_id(c, uid, story)
            if not existing:
                n = c.execute("SELECT COUNT(*) FROM txn_bookmarks WHERE user_id = ?", (uid,)).fetchone()[0]
                if n >= MAX_BOOKMARKS:
                    raise LibraryError(409, "full", f"Your library holds {MAX_BOOKMARKS:,} headlines. Remove some to save more.")
                c.execute("INSERT INTO txn_bookmarks (user_id, event_id, saved_at_ms, note, note_updated_at_ms)"
                          " VALUES (?,?,?,?,?)", (uid, eid, when, text, noted))
                for cid in _owned_collections(c, uid, collection_ids):
                    c.execute("INSERT OR IGNORE INTO txn_collection_items (user_id, collection_id, event_id, added_at_ms)"
                              " VALUES (?,?,?,?)", (uid, cid, eid, now))
        key = existing or eid
        mark = next(m for m in _bookmarks(c, uid) if m["event_id"] == key)
    return {"bookmark": mark, "created": not existing}


def remove(uid: str, event_id: Any, store=None) -> dict[str, Any]:
    """Remove the member's bookmark (and its place in their collections and its note), in
    one transaction. Answers what was removed, so the client can offer Undo. The headline
    is untouched."""
    eid = _event_id(event_id)
    _write_ok(uid)
    story = _story(store, eid)
    with _db() as c:
        with _tx(c):
            key = _stored_id(c, uid, story)
            if key is None:
                return {"removed": None}
            mark = next(m for m in _bookmarks(c, uid) if m["event_id"] == key)
            c.execute("DELETE FROM txn_collection_items WHERE user_id = ? AND event_id = ?", (uid, key))
            c.execute("DELETE FROM txn_bookmarks WHERE user_id = ? AND event_id = ?", (uid, key))
    return {"removed": mark}


def set_note(uid: str, event_id: Any, note: Any, store=None) -> dict[str, Any]:
    """Write (or, with empty text, clear) the note on a SAVED headline."""
    eid = _event_id(event_id)
    _write_ok(uid)
    text = _note(note)
    story = _story(store, eid)
    with _db() as c:
        with _tx(c):
            key = _stored_id(c, uid, story)
            if key is None:
                raise LibraryError(404, "not_saved", "Save the headline before adding a note.")
            c.execute("UPDATE txn_bookmarks SET note = ?, note_updated_at_ms = ? WHERE user_id = ? AND event_id = ?",
                      (text, _now_ms() if text else None, uid, key))
        mark = next(m for m in _bookmarks(c, uid) if m["event_id"] == key)
    return {"bookmark": mark}


def create_collection(uid: str, name: Any) -> dict[str, Any]:
    n = _name(name)
    _write_ok(uid)
    now = _now_ms()
    cid = "c" + secrets.token_hex(8)
    with _db() as c:
        try:
            with _tx(c):
                if c.execute("SELECT COUNT(*) FROM txn_collections WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_COLLECTIONS:
                    raise LibraryError(409, "full", f"You can have up to {MAX_COLLECTIONS} collections.")
                c.execute("INSERT INTO txn_collections (id, user_id, name, created_at_ms, updated_at_ms) VALUES (?,?,?,?,?)",
                          (cid, uid, n, now, now))
        except sqlite3.IntegrityError as e:  # the unique (user, name) index
            if "UNIQUE" in str(e).upper():
                raise LibraryError(409, "duplicate", f"You already have a collection named “{n}”.")
            raise
        return next(x for x in _collection_rows(c, uid) if x["id"] == cid)


def rename_collection(uid: str, cid: Any, name: Any) -> dict[str, Any]:
    n = _name(name)
    _write_ok(uid)
    with _db() as c:
        try:
            with _tx(c):
                cur = c.execute("UPDATE txn_collections SET name = ?, updated_at_ms = ? WHERE id = ? AND user_id = ?",
                                (n, _now_ms(), str(cid), uid))
                if cur.rowcount == 0:
                    raise LibraryError(404, "not_found", "That collection could not be found.")
        except sqlite3.IntegrityError as e:
            if "UNIQUE" in str(e).upper():
                raise LibraryError(409, "duplicate", f"You already have a collection named “{n}”.")
            raise
        return next(x for x in _collection_rows(c, uid) if x["id"] == str(cid))


def delete_collection(uid: str, cid: Any) -> dict[str, Any]:
    """Delete the member's collection. Its headlines stay saved (and stay in the archive)."""
    _write_ok(uid)
    with _db() as c, _tx(c):
        cur = c.execute("DELETE FROM txn_collections WHERE id = ? AND user_id = ?", (str(cid), uid))
        if cur.rowcount == 0:
            raise LibraryError(404, "not_found", "That collection could not be found.")
        c.execute("DELETE FROM txn_collection_items WHERE collection_id = ? AND user_id = ?", (str(cid), uid))
    return {"deleted": str(cid)}


def set_membership(uid: str, cid: Any, event_id: Any, member: bool, store=None) -> dict[str, Any]:
    """Put a SAVED headline in (or take it out of) one of the member's collections."""
    eid = _event_id(event_id)
    _write_ok(uid)
    story = _story(store, eid)
    with _db() as c:
        with _tx(c):
            if not c.execute("SELECT 1 FROM txn_collections WHERE id = ? AND user_id = ?", (str(cid), uid)).fetchone():
                raise LibraryError(404, "not_found", "That collection could not be found.")
            key = _stored_id(c, uid, story)
            if member:
                if key is None:
                    raise LibraryError(404, "not_saved", "Save the headline before adding it to a collection.")
                c.execute("INSERT OR IGNORE INTO txn_collection_items (user_id, collection_id, event_id, added_at_ms)"
                          " VALUES (?,?,?,?)", (uid, str(cid), key, _now_ms()))
            elif key is not None:
                c.execute("DELETE FROM txn_collection_items WHERE user_id = ? AND collection_id = ? AND event_id = ?",
                          (uid, str(cid), key))
        mark = next((m for m in _bookmarks(c, uid) if m["event_id"] == key), None) if key else None
    return {"bookmark": mark}


# ── operator view (counts only) ──────────────────────────────────────────────

def snapshot(store) -> dict[str, Any]:
    """Counts only -- never a member's ids, names or notes. `unresolved` = bookmarks whose
    headline the News store cannot find right now (expected 0 except mid-recovery)."""
    try:
        with _db() as c:
            n_marks = c.execute("SELECT COUNT(*) FROM txn_bookmarks").fetchone()[0]
            n_members = c.execute("SELECT COUNT(DISTINCT user_id) FROM txn_bookmarks").fetchone()[0]
            n_cols = c.execute("SELECT COUNT(*) FROM txn_collections").fetchone()[0]
            ids = [r[0] for r in c.execute("SELECT DISTINCT event_id FROM txn_bookmarks").fetchall()]
        unresolved = len(ids) - len(store.resolve_events(ids)) if store is not None else None
    except Exception as e:  # noqa: BLE001 -- the status page never fails on this
        return {"enabled": enabled(), "error": type(e).__name__}
    return {"enabled": enabled(), "bookmarks": n_marks, "members": n_members, "collections": n_cols,
            "distinct_headlines": len(ids), "unresolved": unresolved}


def _reset_for_tests() -> None:
    with _recent_lock:
        _recent.clear()
