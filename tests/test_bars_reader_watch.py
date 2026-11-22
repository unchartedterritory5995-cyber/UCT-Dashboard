"""`bars_sqlite.get_bars`: the store's reader notices a convoy and leaves it.

Measured on production 2026-11-13 (the web pod's own thread report, 60 samples in 25 s): on
average twelve threads were inside the row reader at once and four more queued to write. Each
gives the GIL up and takes it back once per row, so a member's `/api/bars` for a symbol not in
memory read its 5,000 rows in 1 to 7 s in those stretches. On a desk, beside eight busy
threads: 1,390 to 1,606 ms row by row, 65 ms in chunks.

Reading everything in one step was the cure for one lane and is the wrong default for all of
them: alone the row reader is fastest (4.8 ms against 18.8 ms), and eight background jobs
parsing one long string each made a bystander's small request wait 30 to 46 ms.

So the reader reads rows and watches them; a batch that comes slowly is a convoy, and the read
starts over in chunks. What this file holds it to:
  * the SAME rows whichever way they were read, at every size, bit for bit;
  * rows first (the fast way alone), chunks only once a batch has run over its budget;
  * the chunked read hands python one row per `_PACK_CHUNK_ROWS` bars, not one per bar and
    not one for the whole series;
  * the knobs, the stand-ins and the swapped-in reader keep working as they did.
"""
import math
import sqlite3
import struct

import pytest

from api.services import bars_sqlite as b


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """A real bars store on disk, with the store's own DDL, behind the module's connection."""
    path = str(tmp_path / "bars.db")
    monkeypatch.setattr(b, "_DB_PATH", path)
    monkeypatch.setattr(b, "_local", b.threading.local())
    monkeypatch.delenv("BARS_PACKED_READS", raising=False)
    monkeypatch.delenv("RS_PACKED_READS", raising=False)
    conn = sqlite3.connect(path)
    conn.execute(b.ohlcv_ddl())
    conn.commit()

    def put(ticker, tf, n, start=20000101):
        rows = [(ticker, tf, start + i, 1.0 + i / 3, 2.0 + i / 7, 0.5 + i * 0.1, (1.5 + i) * 0.1 * 3 / 7, i * 11) for i in range(n)]
        conn.executemany("INSERT OR REPLACE INTO ohlcv(ticker, tf, ts, o, h, l, c, v) VALUES (?,?,?,?,?,?,?,?)", rows)
        conn.commit()
    yield put
    conn.close()
    held = getattr(b._local, "conn", None)
    if held is not None:
        held.close()


def bits(rows):
    return [(r[0], *(None if x is None else struct.pack("<d", x) for x in r[1:5]), r[5]) for r in rows]


class Clock:
    """A clock a test moves by hand: `tick(seconds)` is how long the next timed batch 'took'."""

    def __init__(self, per_batch):
        self.now, self.per_batch, self.reads = 0.0, list(per_batch), 0

    def __call__(self):
        # called twice per batch (before, after): the second call lands after the batch's duration
        self.reads += 1
        if self.reads % 2 == 0:
            self.now += self.per_batch.pop(0) if self.per_batch else 0.0
        return self.now


# ── the same rows, whichever way ─────────────────────────────────────────────

@pytest.mark.parametrize("n", [0, 1, 2, 127, 128, 129, 511, 512, 513, 1300, 5000])
def test_the_reader_answers_exactly_what_the_row_reader_answers(store, n):
    store("NVDA", "D", n)
    want = b._get_bars_rows("NVDA", "D", 6000)
    assert len(want) == n
    assert bits(b.get_bars("NVDA", "D", 6000)) == bits(want)
    packed = b.get_bars_packed("NVDA", "D", 6000)
    assert packed is not None and bits(packed) == bits(want)
    # and a window smaller than the series: the newest max_bars, oldest first
    if n > 3:
        assert bits(b.get_bars("nvda", "D", n - 3)) == bits(want[3:])
        assert bits(b.get_bars_packed("nvda", "D", n - 3)) == bits(want[3:])


def test_rows_read_slowly_are_abandoned_for_the_chunked_read_and_the_answer_is_the_same(store, monkeypatch):
    store("NVDA", "D", 2000)
    want = b._get_bars_rows("NVDA", "D", 5000)
    real = b._rows_while_fast
    seen = {"watched": 0, "packed": 0}

    def slow(cur):
        seen["watched"] += 1
        return real(cur, clock=Clock([b._WATCH_BUDGET_S * 4]))      # the first timed batch runs four budgets long
    monkeypatch.setattr(b, "_rows_while_fast", slow)
    packed = b.get_bars_packed
    monkeypatch.setattr(b, "get_bars_packed", lambda *a: seen.__setitem__("packed", seen["packed"] + 1) or packed(*a))
    got = b.get_bars("NVDA", "D", 5000)
    assert seen == {"watched": 1, "packed": 1}
    assert bits(got) == bits(want) and len(got) == 2000, "no row twice, none missing: the read started over"


def test_rows_that_come_at_once_are_never_read_a_second_way(store, monkeypatch):
    store("NVDA", "D", 2000)
    monkeypatch.setattr(b, "get_bars_packed", lambda *a: pytest.fail("nobody was contending: the rows were enough"))
    assert len(b.get_bars("NVDA", "D", 5000)) == 2000


# ── the watch itself ─────────────────────────────────────────────────────────

class Cur:
    def __init__(self, n):
        self.rows, self.calls = [(i,) for i in range(n)], []

    def fetchmany(self, k):
        self.calls.append(k)
        out, self.rows = self.rows[:k], self.rows[k:]
        return out


def test_the_first_row_is_not_timed_and_every_fast_batch_is_kept():
    n = 1 + sum(b._WATCH_FIRST) + 3 * b._WATCH_ROWS + 5
    cur = Cur(n)
    out = b._rows_while_fast(cur, clock=Clock([0.0] * 8))
    assert out == [(i,) for i in range(n)]
    # the first row alone, the small watched batches in turn, then full ones (the last finds nothing)
    assert cur.calls == [1, *b._WATCH_FIRST, *([b._WATCH_ROWS] * 5)]


def test_a_convoy_is_noticed_within_the_first_eight_rows():
    """Measured on production 2026-11-14: one 600-row read took 739 ms, all of it the first
    watched batch of 128 rows arriving at 5 ms each. Eight rows at that pace is 44 ms."""
    assert b._WATCH_FIRST[0] <= 8 and list(b._WATCH_FIRST) == sorted(b._WATCH_FIRST) and b._WATCH_FIRST[-1] < b._WATCH_ROWS
    cur = Cur(5000)
    assert b._rows_while_fast(cur, clock=Clock([b._WATCH_BUDGET_S * 2])) is None
    assert cur.calls == [1, b._WATCH_FIRST[0]], "given up after the first small batch: nothing more was waited for"
    assert sum(cur.calls) <= 9


def test_a_convoy_that_starts_later_is_noticed_in_the_batch_it_starts_in():
    for slow_at in range(0, 5):
        clock = Clock([0.0] * slow_at + [b._WATCH_BUDGET_S * 3])
        cur = Cur(5000)
        assert b._rows_while_fast(cur, clock=clock) is None
        sizes = [*b._WATCH_FIRST, *([b._WATCH_ROWS] * 5)]
        assert cur.calls == [1, *sizes[:slow_at + 1]], slow_at


def test_a_full_batch_over_its_budget_ends_the_read_at_once():
    cur = Cur(10 * b._WATCH_ROWS)
    out = b._rows_while_fast(cur, clock=Clock([0.0, b._WATCH_BUDGET_S * 1.01]))
    assert out is None
    assert len(cur.calls) == 3, "the first row, one fast batch, the slow batch: nothing after it"
    assert cur.calls == [1, *b._WATCH_FIRST[:2]]


def test_a_batch_exactly_at_its_budget_is_not_a_convoy():
    cur = Cur(1 + sum(b._WATCH_FIRST) + 2 * b._WATCH_ROWS)
    assert b._rows_while_fast(cur, clock=Clock([b._WATCH_BUDGET_S] * 6)) is not None


def test_a_short_last_batch_is_not_judged_there_is_nothing_left_to_save():
    n = 1 + sum(b._WATCH_FIRST) + b._WATCH_ROWS + 7
    cur = Cur(n)
    out = b._rows_while_fast(cur, clock=Clock([0.0] * (len(b._WATCH_FIRST) + 1) + [99.0]))
    assert out is not None and len(out) == n
    # and a short SMALL batch is not judged either: a series of five rows read slowly is whole
    assert b._rows_while_fast(Cur(1 + 4), clock=Clock([99.0])) == [(i,) for i in range(5)]


def test_no_rows_is_an_empty_answer():
    assert b._rows_while_fast(Cur(0), clock=Clock([])) == []


def test_the_budget_is_far_from_both_the_normal_and_the_convoy_time():
    # 128 rows: about 0.15 ms alone, about 40 ms in a convoy (0.3 ms a row, measured). The budget sits between.
    assert 0.0005 <= b._WATCH_BUDGET_S <= 0.01
    assert 32 <= b._WATCH_ROWS <= 512


# ── the chunked read: a few rows for python, not one and not thousands ───────

@pytest.mark.parametrize("n", [1, 511, 512, 513, 2500])
def test_python_takes_one_result_row_per_chunk(store, n):
    store("SPY", "D", n)
    out = b._conn().execute(b._PACKED_SQL, (b._PACK_CHUNK_ROWS, "SPY", "D", 5000)).fetchall()
    assert len(out) == math.ceil(n / b._PACK_CHUNK_ROWS)
    assert sum(r[2] for r in out) == n and max(r[2] for r in out) <= b._PACK_CHUNK_ROWS


def test_a_chunk_that_cannot_be_exact_refuses_the_whole_read(store):
    store("SPY", "D", 1500)
    conn = sqlite3.connect(b._DB_PATH)
    conn.execute("UPDATE ohlcv SET v = 1.5 WHERE ticker='SPY' AND ts = ?", (20000101 + 700,))   # one fractional volume, mid-series
    conn.commit()
    conn.close()
    assert b.get_bars_packed("SPY", "D", 5000) is None
    assert len(b.get_bars("SPY", "D", 5000)) == 1500, "the reader still answers, row by row"


def test_the_proof_crosses_chunk_edges(store):
    assert b._PROOF_CHUNK_ROWS < len(b._proof_values()) // 8
    assert b._packed_self_test() is True


# ── knobs, stand-ins, a swapped-in reader ────────────────────────────────────

def test_the_knob_reads_row_by_row_always(store, monkeypatch):
    store("SPY", "D", 600)
    monkeypatch.setenv("BARS_PACKED_READS", "0")
    monkeypatch.setattr(b, "_rows_while_fast", lambda *a, **k: pytest.fail("the watch is off with the knob"))
    monkeypatch.setattr(b, "get_bars_packed", lambda *a: pytest.fail("and so is the chunked read"))
    assert len(b.get_bars("SPY", "D", 5000)) == 600
    monkeypatch.setenv("BARS_PACKED_READS", "1")
    monkeypatch.undo()


def test_a_stand_in_connection_without_fetchmany_serves_its_rows_its_own_way(store, monkeypatch):
    class OnlyFetchall:
        def fetchall(self):
            return [(1, 1.0, 1.0, 1.0, 1.0, 1)]

    class Conn:
        def execute(self, sql, params=()):
            return OnlyFetchall()
    monkeypatch.setattr(b, "_conn", lambda: Conn())
    assert b.get_bars("X", "D", 10) == [(1, 1.0, 1.0, 1.0, 1.0, 1)]


def test_when_the_chunked_read_refuses_the_rows_are_read_the_old_way(store, monkeypatch):
    store("SPY", "D", 900)
    monkeypatch.setattr(b, "_rows_while_fast", lambda cur: None)
    monkeypatch.setattr(b, "get_bars_packed", lambda *a: None)
    assert len(b.get_bars("SPY", "D", 5000)) == 900


def test_the_stores_reader_is_named_by_identity_and_a_swapped_one_serves_every_row(store, monkeypatch):
    assert b.ROW_READER is b.get_bars
    store("SPY", "D", 50)
    monkeypatch.setattr(b, "get_bars", lambda t, tf, n: [("swapped",)])
    monkeypatch.setattr(b, "get_bars_packed", lambda *a: pytest.fail("a swapped reader is never gone around"))
    assert b.get_bars_fast("SPY", "D", 10) == [("swapped",)]


def test_the_explicit_fast_reader_keeps_its_own_knob(store, monkeypatch):
    store("SPY", "D", 50)
    want = b._get_bars_rows("SPY", "D", 100)
    monkeypatch.setenv("RS_PACKED_READS", "0")
    monkeypatch.setattr(b, "get_bars_packed", lambda *a: pytest.fail("RS_PACKED_READS=0 reads row by row"))
    assert bits(b.get_bars_fast("SPY", "D", 100)) == bits(want)
