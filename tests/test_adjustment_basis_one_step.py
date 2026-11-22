"""The chart header's split label reads its bars in ONE sqlite step (2026-11-13).

Measured on production while a member scanned a list: `/api/adjustment-basis/{ticker}`
answered in 3.2 s at the median. It reads 400 daily rows (5,000 intraday), and a
row-by-row sqlite read waits about one thread switch interval per row whenever another
thread runs Python. `bars_sqlite.get_bars_fast` hands back the same rows from one step
(`get_bars_packed`), and falls back to the row reader whenever that cannot be exact.

These tests pin: the rows are the row reader's rows; who decides which read is used; that
the label asks through it; and that an intraday ticker with no declared split reads no
rows at all. The label's own answers are `tests/test_adjustment_basis.py`, unchanged.
"""
from __future__ import annotations

import datetime

import pytest

from api.services import adjustment_basis as ab
from api.services import bars_sanitize as bs
from api.services import bars_sqlite


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    monkeypatch.setattr(bs, "_warm_meta", lambda ticker: None)
    monkeypatch.delenv("RS_PACKED_READS", raising=False)


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _seed_meta(ticker, splits=None):
    bs._META_CACHE.set(bs._META_KEY.format(ticker), {"ipo": None, "splits": splits or []}, ttl=3600)


def _sessions(start, n):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += datetime.timedelta(days=1)
    return out


def _write_daily(ticker, n=450, price=100.0, tf="D"):
    days = _sessions(datetime.date(2023, 1, 3), n)
    # (a close inside its bar's range: the store refuses a bar whose close is outside it)
    bars = [{"t": int(d.strftime("%Y%m%d")), "o": price + i * 0.37, "h": (price + i * 0.37) * 1.013,
             "l": (price + i * 0.37) * 0.987, "c": (price + i * 0.37) * 1.0041, "v": 1_000_000 + i * 17} for i, d in enumerate(days)]
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)
    kept = len(bars_sqlite.get_bars(ticker, tf, 10_000))                # (the store drops market holidays)
    assert kept > 400, "more stored rows than the label reads, so its 400-row read is a full one"
    return kept


def _write_intraday(ticker, n=600, tf="5"):
    t0 = 1_760_000_000
    bars = [{"t": t0 + i * 300, "o": 50 + i * 0.01, "h": 50.5 + i * 0.01, "l": 49.5 + i * 0.01,
             "c": 50.2 + i * 0.01, "v": 10_000 + i} for i in range(n)]
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)


def _spy(monkeypatch):
    """Count which read served, without changing either."""
    calls = {"packed": 0, "rows": 0}
    real_packed, real_rows = bars_sqlite.get_bars_packed, bars_sqlite.ROW_READER

    def packed(*a, **k):
        calls["packed"] += 1
        return real_packed(*a, **k)

    monkeypatch.setattr(bars_sqlite, "get_bars_packed", packed)
    # the row reader is counted from inside the connection it uses, so `get_bars is ROW_READER` stays true
    real_conn = bars_sqlite._conn

    class _Counting:
        def __init__(self, conn):
            self._c = conn

        def execute(self, sql, *a, **k):
            if "ORDER BY ts DESC LIMIT" in sql and "json_group_array" not in sql:
                calls["rows"] += 1
            return self._c.execute(sql, *a, **k)

        def __getattr__(self, name):
            return getattr(self._c, name)

    monkeypatch.setattr(bars_sqlite, "_conn", lambda: _Counting(real_conn()))
    assert real_rows is bars_sqlite.get_bars
    return calls


# ── get_bars_fast ────────────────────────────────────────────────────────────

def test_the_rows_are_the_row_readers_rows_daily_and_intraday(fresh_db, monkeypatch):
    daily = _write_daily("ONESTEP")
    _write_intraday("ONESTEP")
    calls = _spy(monkeypatch)
    for tf, n in (("D", 400), ("D", 5000), ("D", 1), ("5", 5000), ("5", 250)):
        want = bars_sqlite.get_bars("ONESTEP", tf, n)
        got = bars_sqlite.get_bars_fast("ONESTEP", tf, n)
        assert got == want and len(got) == min(n, daily if tf == "D" else 600)
        assert [type(v) for v in got[0]] == [type(v) for v in want[0]]
        assert got[0][0] < got[-1][0] or len(got) == 1                 # oldest first
    assert calls["packed"] == 5                                        # CONTROL: the one-step read is what served
    assert bars_sqlite.get_bars_fast("NOBODY", "D", 400) == []


def test_one_step_means_one_statement_and_no_row_by_row_read(fresh_db, monkeypatch):
    _write_daily("ONESTEP")
    assert bars_sqlite.packed_reads_proven(), "this sqlite must be able to run the one-step read for the test to mean anything"
    calls = _spy(monkeypatch)
    bars_sqlite.get_bars_fast("ONESTEP", "D", 400)
    assert calls == {"packed": 1, "rows": 0}


def test_the_knob_turns_the_one_step_read_off(fresh_db, monkeypatch):
    _write_daily("ONESTEP")
    want = bars_sqlite.get_bars("ONESTEP", "D", 400)
    calls = _spy(monkeypatch)
    calls["rows"] = 0
    monkeypatch.setenv("RS_PACKED_READS", "0")
    assert bars_sqlite.get_bars_fast("ONESTEP", "D", 400) == want
    assert calls == {"packed": 0, "rows": 1}
    for on in ("1", "", "yes", " 1 "):                                 # anything but 0 leaves it on
        monkeypatch.setenv("RS_PACKED_READS", on)
        calls.update(packed=0, rows=0)
        assert bars_sqlite.get_bars_fast("ONESTEP", "D", 400) == want
        assert calls == {"packed": 1, "rows": 0}, on
    monkeypatch.setenv("RS_PACKED_READS", " 0 ")
    calls.update(packed=0, rows=0)
    bars_sqlite.get_bars_fast("ONESTEP", "D", 400)
    assert calls == {"packed": 0, "rows": 1}


def test_a_read_that_cannot_be_exact_falls_back_to_the_rows(fresh_db, monkeypatch):
    _write_daily("ONESTEP")
    want = bars_sqlite.get_bars("ONESTEP", "D", 400)
    monkeypatch.setattr(bars_sqlite, "get_bars_packed", lambda *a, **k: None)
    assert bars_sqlite.get_bars_fast("ONESTEP", "D", 400) == want


def test_a_swapped_in_reader_serves_every_row_itself(fresh_db, monkeypatch):
    _write_daily("ONESTEP")
    monkeypatch.setattr(bars_sqlite, "get_bars_packed", lambda *a, **k: pytest.fail("the one-step read went around the swapped reader"))
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: [(20240102, 1.0, 2.0, 0.5, 1.5, 7)])
    assert bars_sqlite.get_bars_fast("ONESTEP", "D", 400) == [(20240102, 1.0, 2.0, 0.5, 1.5, 7)]


# ── the label asks through it ────────────────────────────────────────────────

def test_the_daily_label_reads_in_one_step_and_says_what_it_said(fresh_db, monkeypatch):
    _write_daily("LABEL")
    _seed_meta("LABEL", splits=[("2020-08-31", 4.0)])                   # long before the stored rows: nothing to adjust in them
    row_by_row = None
    monkeypatch.setenv("RS_PACKED_READS", "0")
    row_by_row = ab.compute_adjustment_basis("LABEL", "D").to_dict()
    monkeypatch.delenv("RS_PACKED_READS")
    calls = _spy(monkeypatch)
    one_step = ab.compute_adjustment_basis("LABEL", "D").to_dict()
    assert one_step == row_by_row
    assert one_step["applied_by"] == "vendor" and one_step["splits"] is True
    assert calls == {"packed": 1, "rows": 0}


def test_a_ticker_with_no_declared_split_reads_no_rows_daily_or_intraday(fresh_db, monkeypatch):
    _write_daily("PLAIN")
    _write_intraday("PLAIN")
    _seed_meta("PLAIN", splits=[])
    calls = _spy(monkeypatch)
    for tf in ("D", "W", "5", "60"):
        got = ab.compute_adjustment_basis("PLAIN", tf).to_dict()
        assert got["splits"] is False and got["applied_by"] == "vendor" and got["as_of"] is None, tf
    assert calls == {"packed": 0, "rows": 0}


def test_the_intraday_label_reads_in_one_step_when_a_split_is_declared(fresh_db, monkeypatch):
    _write_intraday("INTRA")
    _seed_meta("INTRA", splits=[("2019-01-02", 2.0)])                    # outside the stored sessions
    monkeypatch.setenv("RS_PACKED_READS", "0")
    row_by_row = ab.compute_adjustment_basis("INTRA", "5").to_dict()
    monkeypatch.delenv("RS_PACKED_READS")
    calls = _spy(monkeypatch)
    one_step = ab.compute_adjustment_basis("INTRA", "5").to_dict()
    assert one_step == row_by_row
    assert calls == {"packed": 1, "rows": 0}
    # an intraday ticker the pod holds no rows for is still "cannot say"
    _seed_meta("EMPTY", splits=[("2019-01-02", 2.0)])
    assert ab.compute_adjustment_basis("EMPTY", "5") == ab.UNDETERMINED
