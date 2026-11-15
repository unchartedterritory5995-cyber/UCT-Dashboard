"""A chart's rating reads keep their connection: two statements, no open, nothing remembered.

Measured on production 2026-11-14 (Server-Timing, a fast scan of the Nasdaq 100, 79 RS answers
computed): a median 408 ms on the server, 185 of them the `rating` stage: `rs_history.read_fields`
for one ticker and `rs_history.rating_series`, each on a connection opened for it. Measured with
the web pod's switch interval beside 30 busy threads: 17 ms for an open and its two PRAGMAs, 6 to
14 ms for each statement however little it reads (the thread waits to get the GIL back after
every one), 147 ms for the two reads together. On a kept reader, as two statements: 30.

`snapshot_db.read_on_reader` gives those reads a per-thread, read-only connection. What this file
holds it to:
  * the SAME answers as a connection opened for the read, in two statements and no open;
  * nothing is remembered by the connection: a session stored, a row changed in place, are seen
    by the very next read;
  * the reader cannot write (sqlite refuses) and is never left inside a transaction;
  * one per thread, for one file; a different file at the same path reopens it;
  * a statement the schema refuses (no table on a dark pod) keeps the reader; a busy file is
    raised, not retried; a broken reader is dropped and the read made on a fresh connection;
  * off under pytest unless a test turns it on, off with SCREENER_KEPT_READER=0, and it never
    creates the file.

⛔ Every database is a tmp file. Nothing reads C:\\data.
"""
import datetime as _dt
import os
import sqlite3
import threading
import types

import pytest

from api.services.screener import rs_history, snapshot_db

_REAL_ON = snapshot_db.hot_readers_on


def _weekdays(n, end=_dt.date(2026, 11, 6)):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= _dt.timedelta(days=1)
    return sorted(out)


def _store(session, ratings: dict):
    rs_history.store_rows(session, {t: {"ibd": v, "m1": 50, "m3": 50, "m6": 50, "m9": 50, "m12": 50,
                                        "score": 1.25, "bars": 253} for t, v in ratings.items()})


def _sql(path, statement, params=()):
    conn = sqlite3.connect(path)
    try:
        out = conn.execute(statement, params).fetchall()
        conn.commit()
        return out
    finally:
        conn.close()


@pytest.fixture
def hot(tmp_path, monkeypatch):
    """A real screener.db in a tmp file with 30 stored sessions of two tickers, the reader ON."""
    path = str(tmp_path / "screener.db")
    monkeypatch.setenv("SCREENER_DB_PATH", path)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    monkeypatch.setattr(rs_history, "_remembered", {})
    days = _weekdays(30)
    for i, s in enumerate(days):
        _store(s, {"NVDA": 40 + i, "AAPL": 90 - i})
    monkeypatch.setattr(snapshot_db, "hot_readers_on", lambda: True)   # pytest sets PYTEST_CURRENT_TEST per phase
    snapshot_db.drop_hot_reader()
    yield types.SimpleNamespace(path=path, days=days)
    snapshot_db.drop_hot_reader()


def _both(ns):
    return (rs_history.read_fields(["NVDA", "aapl", "NOPE"]),
            rs_history.rating_series("NVDA", upto=ns.days[-1], limit=1320),
            rs_history.rating_series("AAPL", limit=7))


# ── the same answers, in two statements ──────────────────────────────────────

def test_the_reader_answers_what_a_connection_of_its_own_answers(hot, monkeypatch):
    with_reader = _both(hot)
    assert with_reader[0]["NVDA"]["ibd"] == 69 and with_reader[0]["NVDA"]["d5"] == 5 and with_reader[0]["NVDA"]["d20"] == 20
    assert with_reader[0]["AAPL"]["d20"] == -20 and with_reader[0]["NOPE"] == {}
    assert len(with_reader[1]) == 30 and with_reader[1][-1] == (hot.days[-1], 69) and len(with_reader[2]) == 7
    assert snapshot_db._HOT.conn is not None, "the reader was not used: the comparison would be vacuous"
    snapshot_db.drop_hot_reader()
    with monkeypatch.context() as m:
        m.setattr(snapshot_db, "hot_readers_on", lambda: False)      # a connection per read, as before
        m.setattr(rs_history, "_remembered", {})
        own = _both(hot)
        assert snapshot_db._HOT.conn is None
    assert with_reader == own


def test_a_charts_rating_read_is_two_statements_and_opens_nothing(hot, monkeypatch):
    rs_history.read_fields(["NVDA"])                                  # opens this thread's reader, finds the sessions
    rs_history.rating_series("NVDA", upto=hot.days[-1], limit=1320)
    seen = []
    snapshot_db.hot_reader().set_trace_callback(seen.append)
    monkeypatch.setattr(snapshot_db, "connect", lambda *a, **k: pytest.fail("a read opened a connection"))
    row = rs_history.read_fields(["NVDA"])["NVDA"]
    series = rs_history.rating_series("NVDA", upto=hot.days[-1], limit=1320)
    snapshot_db.hot_reader().set_trace_callback(None)
    assert row["ibd"] == 69 and row["asof"] == hot.days[-1] and len(series) == 30
    assert len(seen) == 2, seen
    assert seen[0].startswith("SELECT m.newest AS newest_") and "json_group_array" in seen[1]


def test_CONTROL_without_the_reader_the_same_read_opens_two_connections(hot, monkeypatch):
    monkeypatch.setattr(snapshot_db, "hot_readers_on", lambda: False)
    opened, seen = [], []
    real = snapshot_db.connect

    def traced(*a, **k):
        c = real(*a, **k)
        opened.append(1)
        c.set_trace_callback(seen.append)
        return c
    rs_history.read_fields(["NVDA"])
    rs_history.rating_series("NVDA", upto=hot.days[-1], limit=1320)
    monkeypatch.setattr(snapshot_db, "connect", traced)
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 69
    assert len(rs_history.rating_series("NVDA", upto=hot.days[-1], limit=1320)) == 30
    assert opened == [1, 1]
    assert len(seen) == 2, "the same two statements (the two PRAGMAs of each open run before the trace is set)"


# ── nothing is remembered by the connection ──────────────────────────────────

def test_a_session_stored_since_is_seen_by_the_very_next_read(hot):
    assert rs_history.read_fields(["NVDA"])["NVDA"]["asof"] == hot.days[-1]
    assert len(rs_history.rating_series("NVDA", limit=1320)) == 30
    _store("2026-11-09", {"NVDA": 99})                                 # another connection, after the reader opened
    got = rs_history.read_fields(["NVDA"])["NVDA"]
    assert got["asof"] == "2026-11-09" and got["ibd"] == 99 and got["d5"] == 99 - (40 + 25)
    assert rs_history.rating_series("NVDA", limit=1320)[-1] == ("2026-11-09", 99)


def test_a_row_changed_in_place_is_seen_by_the_very_next_read(hot):
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 69
    _sql(hot.path, f"UPDATE {rs_history.TABLE} SET ibd = 12 WHERE ticker = 'NVDA' AND session = ?", (hot.days[-1],))
    _sql(hot.path, f"UPDATE {rs_history.TABLE} SET ibd = 70 WHERE ticker = 'NVDA' AND session = ?", (hot.days[-6],))
    got = rs_history.read_fields(["NVDA"])["NVDA"]
    assert got["ibd"] == 12 and got["d5"] == 12 - 70
    assert rs_history.rating_series("NVDA", limit=3)[-1] == (hot.days[-1], 12)


def test_the_reader_cannot_write_and_is_never_left_in_a_transaction(hot):
    rs_history.read_fields(["NVDA"])
    reader = snapshot_db.hot_reader()
    with pytest.raises(sqlite3.OperationalError):
        reader.execute(f"DELETE FROM {rs_history.TABLE}")
    assert reader.in_transaction is False, "no transaction was opened ahead of the refused write"
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 69, "and the rows are still there"
    assert reader.execute("PRAGMA query_only").fetchone()[0] == 1
    assert reader.execute("PRAGMA cache_size").fetchone()[0] == -snapshot_db.HOT_CACHE_KB


# ── one per thread, for one file ─────────────────────────────────────────────

def test_a_thread_keeps_its_reader_and_no_two_threads_share_one(hot):
    mine = snapshot_db.hot_reader()
    assert mine is not None and snapshot_db.hot_reader() is mine
    theirs = []

    def other():
        theirs.append(snapshot_db.hot_reader())
        theirs.append(rs_history.read_fields(["NVDA"])["NVDA"]["ibd"])
        snapshot_db.drop_hot_reader()
    t = threading.Thread(target=other)
    t.start()
    t.join()
    assert theirs[0] is not None and theirs[0] is not mine and theirs[1] == 69
    snapshot_db.drop_hot_reader()
    assert snapshot_db.hot_reader() is not mine, "dropped: the next read opens a new one"


def test_another_database_path_is_another_reader(hot, tmp_path, monkeypatch):
    first = snapshot_db.hot_reader()
    other = str(tmp_path / "second.db")
    _sql(other, "CREATE TABLE t (k TEXT)")
    monkeypatch.setenv("SCREENER_DB_PATH", other)
    second = snapshot_db.hot_reader()
    assert second is not first
    assert second.execute("PRAGMA database_list").fetchone()[2].endswith("second.db")
    with pytest.raises(sqlite3.ProgrammingError):
        first.execute("SELECT 1")                                     # the old one was closed, not leaked


def test_a_different_file_at_the_same_path_reopens_the_reader(hot, monkeypatch):
    first = snapshot_db.hot_reader()
    asked = []
    real = snapshot_db._file_identity

    def counted(path):
        asked.append(path)
        return real(path)
    monkeypatch.setattr(snapshot_db, "_file_identity", counted)
    assert snapshot_db.hot_reader() is first and asked == [], "inside the window the file is not looked at again"
    snapshot_db._HOT.checked -= 2 * snapshot_db.HOT_RECHECK_S          # two windows later
    assert snapshot_db.hot_reader() is first and asked == [hot.path], "the same file: the same reader"
    assert snapshot_db.hot_reader() is first and asked == [hot.path], "and a new window started: not looked at again"
    snapshot_db._HOT.checked -= 2 * snapshot_db.HOT_RECHECK_S
    monkeypatch.setattr(snapshot_db, "_file_identity", lambda path: ("another", "file"))   # replaced by hand
    second = snapshot_db.hot_reader()
    assert second is not None and second is not first
    with pytest.raises(sqlite3.ProgrammingError):
        first.execute("SELECT 1")


def test_a_read_never_creates_the_file(tmp_path, monkeypatch):
    missing = str(tmp_path / "nothing-here.db")
    monkeypatch.setenv("SCREENER_DB_PATH", missing)
    monkeypatch.setattr(snapshot_db, "hot_readers_on", lambda: True)
    snapshot_db.drop_hot_reader()
    assert snapshot_db.hot_reader() is None
    assert not os.path.exists(missing)


def test_under_pytest_there_is_no_reader_and_the_knob_turns_it_off(hot, monkeypatch):
    snapshot_db.drop_hot_reader()
    monkeypatch.setattr(snapshot_db, "hot_readers_on", _REAL_ON)       # the env-reading original
    assert os.environ.get("PYTEST_CURRENT_TEST") and snapshot_db.hot_readers_on() is False
    assert snapshot_db.hot_reader() is None
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 69
    assert snapshot_db._HOT.conn is None
    monkeypatch.delenv("PYTEST_CURRENT_TEST")                          # a service, not a test run
    assert snapshot_db.hot_readers_on() is True
    monkeypatch.setenv("SCREENER_KEPT_READER", "0")
    assert snapshot_db.hot_readers_on() is False and snapshot_db.hot_reader() is None
    monkeypatch.setenv("SCREENER_KEPT_READER", "1")
    assert snapshot_db.hot_readers_on() is True


# ── when something is wrong ──────────────────────────────────────────────────

def test_a_pod_that_never_stored_a_rating_answers_empty_and_keeps_its_reader(hot, tmp_path, monkeypatch, caplog):
    assert len(rs_history.rating_series("NVDA", limit=10)) == 10       # a store WITH the table was read first ...
    path = str(tmp_path / "dark.db")
    _sql(path, "CREATE TABLE something_else (k TEXT)")
    monkeypatch.setenv("SCREENER_DB_PATH", path)                       # ... and what it taught belongs to that file
    try:
        with caplog.at_level("WARNING"):
            assert rs_history.rating_series("NVDA", limit=10) == []
        assert not caplog.records, "no table is the normal case on a dark pod: asked, not tripped over"
        first = snapshot_db._HOT.conn
        assert first is not None
        failures: dict = {}
        assert rs_history.read_fields(["NVDA"], failures=failures) == {}
        assert "missing" in failures.get("rs_history", {})
        assert snapshot_db._HOT.conn is first, "the schema's answer is not a broken reader"
        assert _sql(path, "SELECT name FROM sqlite_master WHERE type = 'table'") == [("something_else",)], "nothing was created"
        _store("2026-11-06", {"NVDA": 71})                             # the table appears: seen at once
        assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 71
        assert rs_history.rating_series("NVDA", limit=10) == [("2026-11-06", 71)]
    finally:
        snapshot_db.drop_hot_reader()


def test_a_busy_file_is_raised_as_it_was_never_retried_and_the_reader_is_dropped(hot, monkeypatch):
    dropped = []

    class Busy:
        def execute(self, *a):
            raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(snapshot_db, "hot_reader", lambda path=None: Busy())
    monkeypatch.setattr(snapshot_db, "drop_hot_reader", lambda: dropped.append(1))
    monkeypatch.setattr(snapshot_db, "connect", lambda *a, **k: pytest.fail("a second five-second wait"))
    with pytest.raises(sqlite3.OperationalError, match="locked"):
        snapshot_db.read_on_reader(lambda conn, path: conn.execute("SELECT 1"))
    assert dropped == [1]
    failures: dict = {}
    assert rs_history.read_fields(["NVDA"], failures=failures) == {}, "the read itself never raises"
    assert "missing" in failures.get("rs_history", {}) and dropped == [1, 1]


def test_a_statement_the_schema_refuses_is_raised_and_the_reader_is_kept(hot, monkeypatch):
    first = snapshot_db.hot_reader()
    monkeypatch.setattr(snapshot_db, "connect", lambda *a, **k: pytest.fail("not asked a second time"))
    for statement in ("SELECT 1 FROM no_such_table", f"SELECT no_such_column FROM {rs_history.TABLE}"):
        with pytest.raises(sqlite3.OperationalError):
            snapshot_db.read_on_reader(lambda conn, path: conn.execute(statement))
        assert snapshot_db.hot_reader() is first


def test_a_reader_that_broke_is_dropped_and_the_read_is_made_on_a_fresh_connection(hot):
    rs_history.read_fields(["NVDA"])
    broken = snapshot_db.hot_reader()
    sqlite3.Connection.close(broken)                                  # closed underneath: ProgrammingError on use
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 69, "answered, on a connection of its own"
    assert snapshot_db._HOT.conn is None, "the broken one was dropped"
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 69
    assert snapshot_db._HOT.conn is not None and snapshot_db._HOT.conn is not broken, "and the next read opened a new one"


def test_the_read_is_handed_the_path_it_ran_against(hot):
    seen = []
    assert snapshot_db.read_on_reader(lambda conn, path: seen.append(path) or conn.execute("SELECT 41 + 1").fetchone()[0]) == 42
    assert seen == [hot.path]


def test_without_the_reader_the_connection_opened_for_a_read_is_closed(hot, monkeypatch):
    monkeypatch.setattr(snapshot_db, "hot_readers_on", lambda: False)
    opened = []
    real = snapshot_db.connect

    def kept(*a, **k):
        opened.append(real(*a, **k))
        return opened[-1]
    monkeypatch.setattr(snapshot_db, "connect", kept)
    seen = []
    assert snapshot_db.read_on_reader(lambda conn, path: seen.append(path) or conn.execute("SELECT 7").fetchone()[0]) == 7
    assert seen == [hot.path] and len(opened) == 1
    with pytest.raises(sqlite3.ProgrammingError):
        opened[0].execute("SELECT 1")
    with pytest.raises(ZeroDivisionError):                             # and when the read itself fails
        snapshot_db.read_on_reader(lambda conn, path: 1 / 0)
    with pytest.raises(sqlite3.ProgrammingError):
        opened[1].execute("SELECT 1")


def test_many_threads_read_while_another_stores_sessions(hot):
    errors = []
    stop = threading.Event()
    extra = [(_dt.date(2026, 11, 9) + _dt.timedelta(days=i)).isoformat() for i in range(400)]

    def writer():
        for s in extra:
            if stop.is_set():
                return
            try:
                _store(s, {"NVDA": 55, "AAPL": 56})
            except Exception as e:                                    # noqa: BLE001 - reported below
                errors.append(("writer", repr(e)))

    def reader():
        try:
            for _ in range(120):
                row = rs_history.read_fields(["NVDA"]).get("NVDA") or {}
                series = rs_history.rating_series("NVDA", limit=1320)
                if row.get("ibd") not in (69, 55) or not series or series[-1][1] not in (69, 55):
                    errors.append(("wrong", row, series[-1:] ))
                if [s for s, _v in series] != sorted(s for s, _v in series):
                    errors.append(("order", series[-3:]))
        except Exception as e:                                        # noqa: BLE001 - reported below
            errors.append(("reader", repr(e)))
        finally:
            snapshot_db.drop_hot_reader()
    w = threading.Thread(target=writer)
    readers = [threading.Thread(target=reader) for _ in range(8)]
    w.start()
    for t in readers:
        t.start()
    for t in readers:
        t.join(timeout=120)
    stop.set()
    w.join(timeout=30)
    assert errors == []
