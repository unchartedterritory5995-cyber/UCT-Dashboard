"""⛔⛔ NO NOTE WRITER OVERWRITES WORDS THE SERVER ALREADY ACKNOWLEDGED TO ANOTHER WRITER.

Wave 10, lane 10C, fix round 1 (H14, live on master before this). `update_note`'s
compare-and-set read `updated_at` in AUTOCOMMIT and wrote with
`UPDATE ... WHERE id = ? AND user_id = ?` -- no lock between the two. A second
writer holding the SAME baseline passed the same check, committed, was told
"saved", and then the first writer's UPDATE replaced its words. The three append
doors (embed, fact, excerpt) read `body_json` the same way and rewrote the whole
body: an editor PUT landing between their read and their write was acknowledged
and then erased. `patch_note_tags` already named the mechanism and took
`BEGIN IMMEDIATE`; now every read-then-write note door does.

How the rail makes the window real rather than timing it: the first writer runs
on a connection proxy. The moment the door's READ has returned (its rows fetched,
the statement finished), the proxy starts a SECOND writer in its own thread, on
its own connection to the same database file, holding the baseline the first
writer read. It then waits up to `HOOK_WAIT_S` for that writer:

  * without the lock the second writer commits at once -- inside the gap -- and
    the first writer's UPDATE lands on top of it;
  * with the lock the second writer WAITS (its BEGIN IMMEDIATE blocks), the first
    writer commits, and the second then reads that commit and gets the 409.

The verdict is on the STORED BODY TEXT, never a return value: every writer that was
told "saved" must still have its words in the note. ⛔ A control proves the second
writer really ran inside the window for every door; a hook that never fired would
pass every assertion over an unexercised gap.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading

import pytest

from api.services.journal_two import notes as svc
from api.services.journal_two.db import ensure_schema

USER = "u-cas"
HOOK_WAIT_S = 1.0          # how long the proxy lets the second writer run inside the window
BUSY_S = 10                # every connection's busy timeout: far longer than the window
FIRST = "FIRST WRITER WORDS"
SECOND = "SECOND WRITER WORDS"
SEED = "seed words"


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _open(path: str) -> sqlite3.Connection:
    c = sqlite3.connect(path, timeout=BUSY_S)
    c.row_factory = sqlite3.Row
    return c


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "cas.db")
    c = _open(path)
    c.execute("PRAGMA journal_mode=WAL")   # production's mode (auth_db.get_connection)
    ensure_schema(c)
    c.commit()
    c.close()
    return path


class _Rows:
    """The door's read, fully fetched (its statement finished) before the hook runs."""

    def __init__(self, rows):
        self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)


class WindowConn:
    """A connection whose FIRST execution of `read_sql` is followed -- before the
    door continues -- by a second writer started in its own thread."""

    def __init__(self, real: sqlite3.Connection, is_read, second, *, drop_the_lock: bool = False):
        self._real = real
        self._is_read = is_read        # callable(normalised sql) -> is this the door's read?
        self._second = second          # callable() run in the thread
        self._drop_the_lock = drop_the_lock
        self.thread: threading.Thread | None = None
        self.second_was_waiting: bool | None = None
        self.read_seen: str | None = None
        self.lock_taken_before_the_read = False

    def __getattr__(self, name):
        return getattr(self._real, name)

    def execute(self, sql, params=()):
        flat = " ".join(sql.split())
        if flat.upper() == "BEGIN IMMEDIATE":
            if self.thread is None:
                self.lock_taken_before_the_read = True
            if self._drop_the_lock:
                # THE CONTROL: the door as it was before #204. Its read and its write are no
                # longer one transaction; everything else it does is unchanged.
                return self._real.execute("SELECT 1")
        cur = self._real.execute(sql, params)
        if self.thread is None and self._is_read(flat):
            self.read_seen = flat
            rows = _Rows(cur.fetchall())
            self.thread = threading.Thread(target=self._second, daemon=True)
            self.thread.start()
            self.thread.join(HOOK_WAIT_S)
            self.second_was_waiting = self.thread.is_alive()
            return rows
        return cur


# The door's READ of the note row it is about to rewrite, recognised by WHAT IT IS: a SELECT of
# this member's live note by id. ⚰️ Until 2026-10-07 the append doors' read was a typed string,
# "SELECT body_json FROM j2_notes WHERE ...". Wave 10 L14 (#260, 2026-10-01) made the doors read
# `body_json, locked` (a locked note refuses a capture), the string stopped matching, the window
# never opened, and the three append cases were red from that day -- on a product that was
# correct throughout. A column added to that read must never do it again, so the column list is
# not part of the match; which columns the door must read is asserted separately, below.
_NOTE_ROW_READ = re.compile(
    r"^SELECT (?P<cols>.+) FROM j2_notes WHERE id = \? AND user_id = \? AND deleted_at IS NULL$")


def _reads(*needed: str):
    """A matcher for the door's read: the note-row SELECT, carrying at least `needed` columns
    (`*` carries them all). The columns matter: the append doors rebuild the body from what this
    read returned, so a read without `body_json` is not the read the window must follow."""
    def is_read(flat_sql: str) -> bool:
        m = _NOTE_ROW_READ.match(flat_sql)
        if not m:
            return False
        cols = {c.strip() for c in m.group("cols").split(",")}
        return "*" in cols or set(needed) <= cols
    return is_read


UPDATE_READ = _reads("updated_at", "body_json")
APPEND_READ = _reads("body_json")


def _seed(path: str) -> dict:
    c = _open(path)
    try:
        return svc.create_note(USER, {"title": "seed", "bodyJson": _doc(SEED)}, conn=c)
    finally:
        c.close()


def _stored_body(path: str, note_id: str) -> str:
    c = _open(path)
    try:
        return c.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note_id,)).fetchone()["body_json"]
    finally:
        c.close()


def _second_writer(path: str, note_id: str, baseline: str, outcome: dict):
    """An editor PUT holding `baseline`, on its OWN connection in its OWN thread."""

    def run():
        c = _open(path)
        try:
            svc.update_note(USER, note_id, {"bodyJson": _doc(SECOND)}, conn=c,
                            expected_updated_at=baseline)
            outcome["second"] = "saved"
        except svc.NoteConflictError:
            outcome["second"] = "409"
        except Exception as e:  # noqa: BLE001 -- recorded, and the rail names it
            outcome["second"] = f"{type(e).__name__}: {e}"
        finally:
            c.close()
    return run


# door -> (the read the window opens after, how to call the first writer, the words it adds)
DOORS = {
    "update_note (with a baseline)": (
        UPDATE_READ,
        lambda nid, base, conn: svc.update_note(USER, nid, {"bodyJson": _doc(FIRST)}, conn=conn,
                                                expected_updated_at=base),
        FIRST),
    "append_widget_embed": (
        APPEND_READ,
        lambda nid, base, conn: svc.append_widget_embed(USER, nid, {"widgetId": "w-cas"}, conn=conn),
        "w-cas"),
    "append_financial_fact": (
        APPEND_READ,
        lambda nid, base, conn: svc.append_financial_fact(USER, nid, "fact-cas", conn=conn),
        "fact-cas"),
    "append_document_excerpt": (
        APPEND_READ,
        lambda nid, base, conn: svc.append_document_excerpt(USER, nid, "excerpt-cas", conn=conn),
        "excerpt-cas"),
}


@pytest.mark.parametrize("door", sorted(DOORS))
def test_a_second_writer_in_the_window_never_loses_acknowledged_words(db, door):
    read_sql, call, first_marker = DOORS[door]
    note = _seed(db)
    nid, base = note["id"], note["updatedAt"]
    outcome: dict = {}
    real = _open(db)
    proxy = WindowConn(real, read_sql, _second_writer(db, nid, base, outcome))
    try:
        try:
            call(nid, base, proxy)
            outcome["first"] = "saved"
        except svc.NoteConflictError:
            outcome["first"] = "409"
    finally:
        real.close()
    assert proxy.thread is not None, f"{door}: the window never opened -- the read was not seen"
    assert proxy.lock_taken_before_the_read, f"{door}: read {proxy.read_seen!r} with no BEGIN IMMEDIATE before it"
    proxy.thread.join(BUSY_S + 5)
    assert not proxy.thread.is_alive(), f"{door}: the second writer never finished"

    # ⛔ CONTROL: the second writer really ran inside the window, and ended in a known way.
    assert outcome.get("second") in ("saved", "409"), f"{door}: second writer ended {outcome.get('second')!r}"

    body = _stored_body(db, nid)
    acknowledged = {name: words for name, words in (("first", first_marker), ("second", SECOND))
                    if outcome.get(name) == "saved"}
    lost = {name: words for name, words in acknowledged.items() if words not in body}
    assert not lost, (
        f"⛔ {door}: words the server ACKNOWLEDGED are gone from the note -- {lost}. outcome={outcome}, "
        f"second writer waited: {proxy.second_was_waiting}. The read and the write were not one "
        f"transaction (BEGIN IMMEDIATE before the read, notes.py).")
    # With the lock the second writer cannot commit inside the window: it waits,
    # then its baseline is stale, so it is refused -- never silently applied.
    assert proxy.second_was_waiting is True and outcome["second"] == "409", (
        f"{door}: the second writer was not held by the first writer's lock: {outcome}")


def test_a_refused_write_releases_the_lock(db):
    """A 409 inside the lock must roll back, never leave the database locked."""
    note = _seed(db)
    c = _open(db)
    try:
        with pytest.raises(svc.NoteConflictError):
            svc.update_note(USER, note["id"], {"bodyJson": _doc("stale")}, conn=c,
                            expected_updated_at="1999-01-01T00:00:00+00:00")
        assert not c.in_transaction
    finally:
        c.close()
    other = sqlite3.connect(db, timeout=0.2)
    try:
        other.execute("BEGIN IMMEDIATE")      # would raise 'database is locked' if it leaked
        other.rollback()
    finally:
        other.close()


def test_a_caller_in_a_transaction_keeps_its_own(db):
    """The personal API and patch_note_tags call update_note inside BEGIN IMMEDIATE."""
    note = _seed(db)
    c = _open(db)
    try:
        c.execute("BEGIN IMMEDIATE")
        out = svc.update_note(USER, note["id"], {"bodyJson": _doc("inside a caller's lock")}, conn=c)
        assert out is not None
    finally:
        c.close()
    assert "inside a caller's lock" in _stored_body(db, note["id"])


def test_a_missing_note_releases_the_lock(db):
    c = _open(db)
    try:
        assert svc.update_note(USER, "no-such-note", {"bodyJson": _doc("x")}, conn=c) is None
        assert svc.append_widget_embed(USER, "no-such-note", {"widgetId": "w"}, conn=c) is None
        assert not c.in_transaction
    finally:
        c.close()


def test_the_window_body_text_is_what_the_members_see(db):
    """Non-vacuity for the verdict: the stored body carries the words as TEXT."""
    note = _seed(db)
    assert SEED in _stored_body(db, note["id"])
    assert json.loads(_stored_body(db, note["id"]))["type"] == "doc"


# ── the control: the same doors WITHOUT the lock lose acknowledged words ──────────────────────

@pytest.mark.parametrize("door", sorted(DOORS))
def test_without_the_lock_every_door_loses_the_second_writers_acknowledged_words(db, door):
    """⛔ THE RAIL CAN FAIL, door by door. The proxy swallows the door's `BEGIN IMMEDIATE` and
    changes nothing else: that is the door as it was before #204. The second writer is then NOT
    held, commits inside the window and is told "saved"; the first writer's write lands on top;
    and the second writer's words are gone from the stored note. The rail above asserts the
    opposite of each of these three facts, so a door that ever stops taking the lock reds it.
    (Never a product edit: the product is unchanged and only this connection misbehaves.)"""
    read_sql, call, first_marker = DOORS[door]
    note = _seed(db)
    nid, base = note["id"], note["updatedAt"]
    outcome: dict = {}
    real = _open(db)
    proxy = WindowConn(real, read_sql, _second_writer(db, nid, base, outcome), drop_the_lock=True)
    try:
        try:
            call(nid, base, proxy)
            outcome["first"] = "saved"
        except svc.NoteConflictError:
            outcome["first"] = "409"
    finally:
        real.close()
    assert proxy.thread is not None, f"{door}: the window never opened -- the read was not seen"
    proxy.thread.join(BUSY_S + 5)
    assert not proxy.thread.is_alive(), f"{door}: the second writer never finished"
    assert proxy.second_was_waiting is False, f"{door}: something still held the second writer: {outcome}"
    assert outcome == {"first": "saved", "second": "saved"}, f"{door}: {outcome}"
    body = _stored_body(db, nid)
    assert first_marker in body, f"{door}: the first writer's own write is missing"
    assert SECOND not in body, (
        f"{door}: with the lock dropped the second writer's words SURVIVED, so this control no "
        "longer reproduces the lost write the rail exists to catch")


def test_the_read_matcher_follows_a_new_column_and_refuses_a_different_read():
    """The matcher itself: adding a column to the door's read (what L14 did) still matches;
    a read of another table, another predicate, or without the body does not."""
    tail = "FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
    assert APPEND_READ(f"SELECT body_json {tail}")
    assert APPEND_READ(f"SELECT body_json, locked {tail}")
    assert APPEND_READ(f"SELECT body_json, locked, some_future_column {tail}")
    assert APPEND_READ(f"SELECT * {tail}") and UPDATE_READ(f"SELECT * {tail}")
    assert not APPEND_READ(f"SELECT locked {tail}")
    assert not APPEND_READ(f"SELECT 1 {tail}")
    assert not UPDATE_READ(f"SELECT body_json {tail}")
    assert not APPEND_READ("SELECT body_json FROM j2_notes WHERE id = ? AND user_id = ?")
    assert not APPEND_READ("SELECT body_json FROM j2_note_versions WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
