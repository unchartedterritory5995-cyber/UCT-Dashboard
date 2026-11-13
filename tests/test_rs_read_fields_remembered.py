"""A chart's three-row rating read (`rs_history.read_fields` for one ticker) does not rediscover
the store every time.

Measured on production 2026-11-13 (Server-Timing on /api/signature/columns-batch, after the bars
read was fixed): `rs-rating` 430 to 850 ms per symbol. One ticker's read ran ~28 statements, 22 of
them to find the newest 21 stored sessions again (one `MAX(session)` seek each) and one
`PRAGMA table_info`; on the web pod a thread waits to get the GIL back after every one. The narrow
ask now remembers the session list, CHECKED with one seek per call, and the table's columns.

⛔ Its own file on purpose: `tests/test_rs_rating_view.py` imports an autouse fixture
(`_hermetic_reads`) that replaces `read_fields` with `lambda: {}`, so a test of the real function
placed there fails with a bare KeyError and no hint why.
"""
import datetime as _dt
import sqlite3
import time

import pytest

from api.services.screener import rs_history


@pytest.fixture
def history(tmp_path, monkeypatch):
    """A real, empty `screener.db` with the flag on: tests seed it with `_store`."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    return tmp_path / "screener.db"


def _store(ratings: dict, ticker="NVDA"):
    """Write ``{session: ibd}`` rows for ``ticker`` through the module's own writer."""
    for s, ibd in ratings.items():
        rs_history.store_rows(s, {ticker: {"ibd": ibd, "m1": 50, "m3": 50, "m6": 50, "m9": 50, "m12": 50,
                                           "score": 1.0, "bars": 253}})


def _weekdays(n, end=_dt.date(2026, 11, 6)):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d -= _dt.timedelta(days=1)
    return sorted(out)


def _iso(t):
    t = str(t)
    return f"{t[:4]}-{t[4:6]}-{t[6:]}"


def _spy_connect(monkeypatch):
    """Every statement the module runs through its connection, in order."""
    seen = []
    real = rs_history.snapshot_db.connect

    class Conn:
        def __init__(self):
            self.conn = real()

        def execute(self, sql, params=()):
            seen.append(sql)
            return self.conn.execute(sql, params)

        def close(self):
            self.conn.close()
    monkeypatch.setattr(rs_history.snapshot_db, "connect", Conn)
    return seen


def test_this_file_reads_the_real_function():
    """CONTROL for the note above: nothing here has swapped `read_fields` for a stub."""
    assert rs_history.read_fields.__module__ == rs_history.__name__
    assert rs_history.read_fields.__name__ == "read_fields"


def test_a_charts_rating_read_does_not_rediscover_the_store_every_time(history, monkeypatch):
    days = _weekdays(30)
    _store({str(t): 40 + i for i, t in enumerate(days)})
    seen = _spy_connect(monkeypatch)
    first = rs_history.read_fields(["nvda"])
    n_first = len(seen)
    assert first["NVDA"]["ibd"] == 69 and first["NVDA"]["asof"] == _iso(days[-1])
    assert first["NVDA"]["d5"] == 5 and first["NVDA"]["d20"] == 20
    assert n_first >= 24, "the first ask walks the 21 newest sessions and reads the columns"
    del seen[:]
    second = rs_history.read_fields(["NVDA"])
    assert second == first
    assert len(seen) == 4, seen
    assert seen[0] == f"SELECT MAX(session) FROM {rs_history.TABLE}", "the one seek that checks the remembered list"
    assert not any("table_info" in sql for sql in seen), "the columns are not read again"
    assert sum(1 for sql in seen if "WHERE session = ?" in sql) == 3, "the three rows, and nothing else"


def test_a_session_stored_since_is_seen_on_the_very_next_ask(history):
    days = _weekdays(31)
    _store({str(t): 40 + i for i, t in enumerate(days[:-1])})
    assert rs_history.read_fields(["NVDA"])["NVDA"]["asof"] == _iso(days[-2])
    _store({str(days[-1]): 99})
    got = rs_history.read_fields(["NVDA"])["NVDA"]
    assert got["asof"] == _iso(days[-1]) and got["ibd"] == 99
    assert got["d5"] == 99 - (40 + 25), "and the 5-sessions-earlier row is counted from the NEW newest session"


def test_a_change_that_leaves_the_newest_session_alone_is_seen_when_the_memory_lapses(history, monkeypatch):
    monkeypatch.setattr(rs_history, "REMEMBER_S", 0.05)
    days = _weekdays(30)
    _store({str(t): 40 + i for i, t in enumerate(days)})
    assert rs_history.read_fields(["NVDA"])["NVDA"]["d5"] == 5
    conn = sqlite3.connect(history)                                   # a restate drops one stored session
    conn.execute(f"DELETE FROM {rs_history.TABLE} WHERE session = ?", (_iso(days[-3]),))
    conn.commit()
    conn.close()
    time.sleep(0.08)
    assert rs_history.read_fields(["NVDA"])["NVDA"]["d5"] == 6, "five STORED sessions earlier is one day further back"


def test_within_the_window_the_remembered_list_is_what_is_used(history, monkeypatch):
    """The other half of the trade: a change that does not move the newest session is NOT seen
    until the memory lapses. (If this ever fails, the list is being rebuilt on every ask again.)"""
    days = _weekdays(30)
    _store({str(t): 40 + i for i, t in enumerate(days)})
    assert rs_history.read_fields(["NVDA"])["NVDA"]["d5"] == 5
    conn = sqlite3.connect(history)
    conn.execute(f"DELETE FROM {rs_history.TABLE} WHERE session = ?", (_iso(days[-3]),))
    conn.commit()
    conn.close()
    assert rs_history.read_fields(["NVDA"])["NVDA"]["d5"] == 5


def test_the_builds_bulk_ask_and_a_named_session_read_the_store_as_before(history, monkeypatch):
    days = _weekdays(30)
    _store({str(t): 40 + i for i, t in enumerate(days)})
    seen = _spy_connect(monkeypatch)
    rs_history.read_fields(["NVDA"])                                   # the narrow ask remembers ...
    many = ["NVDA"] + [f"T{i}" for i in range(rs_history.NARROW_READ_MAX)]
    for _ in range(2):                                                 # ... and the bulk ask does not use it
        del seen[:]
        assert rs_history.read_fields(many)["NVDA"]["ibd"] == 69
        assert len(seen) >= 24 and any("table_info" in sql for sql in seen)
    for _ in range(2):                                                 # nor does an ask for a named session
        del seen[:]
        assert rs_history.read_fields(["NVDA"], session=str(days[-2]))["NVDA"]["ibd"] == 68
        assert len(seen) >= 23
    # CONTROL: exactly NARROW_READ_MAX tickers is still the narrow ask
    del seen[:]
    rs_history.read_fields(many[:rs_history.NARROW_READ_MAX])
    assert len(seen) == 4


def test_what_is_remembered_belongs_to_one_database(history, tmp_path, monkeypatch):
    days = _weekdays(30)
    _store({str(t): 40 + i for i, t in enumerate(days)})
    assert rs_history.read_fields(["NVDA"])["NVDA"]["d5"] == 5
    # another store with the SAME newest session and a different history behind it: the check on
    # the newest session cannot tell them apart, only the path can
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "other.db"))
    _store({str(t): 40 + i for i, t in enumerate(days) if t != days[-3]})
    got = rs_history.read_fields(["NVDA"])["NVDA"]
    assert got["ibd"] == 69 and got["asof"] == _iso(days[-1])
    assert got["d5"] == 6, "five of THIS store's sessions earlier"


def test_the_remembered_columns_belong_to_one_database_too(history, tmp_path, monkeypatch):
    days = _weekdays(3)
    _store({str(t): 50 + i for i, t in enumerate(days)})
    assert rs_history.read_fields(["NVDA"])["NVDA"]["m9"] == 50
    # a store from before the nine-month rank existed: no such column
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "old.db"))
    _store({str(t): 60 + i for i, t in enumerate(days)})
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.execute(f"ALTER TABLE {rs_history.TABLE} DROP COLUMN m9")
    conn.commit()
    conn.close()
    got = rs_history.read_fields(["NVDA"])["NVDA"]
    assert got["ibd"] == 62 and got["m9"] is None, "read without the column it does not carry, not failed"


def test_an_empty_store_is_still_missing_and_is_asked_again(history):
    failures: dict = {}
    assert rs_history.read_fields(["NVDA"], failures=failures) == {}
    assert "missing" in failures.get("rs_history", {})
    _store({"2026-11-06": 71})                                         # the table appears: seen at once
    assert rs_history.read_fields(["NVDA"])["NVDA"]["ibd"] == 71
