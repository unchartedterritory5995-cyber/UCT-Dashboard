"""`bars_sqlite.get_bars_packed`: the same rows as `get_bars`, read in ONE sqlite step.

Measured on production 2026-11-12/13: the RS lane's bars read (`get_bars`, one
`sqlite3_step` per row, the GIL released and re-taken around each) cost 0.9 to 3.4 s for a
~5,000-bar series on the web pod, and a median 37 s with 44 such requests at once. The
packed read aggregates the rows inside sqlite and returns one result row.

What this file holds it to:
  * EXACT: every value bit-for-bit the row reader's, over price-like doubles, awkward
    doubles and random bit patterns (a float is never rendered as text on the way);
  * the same window (`max_bars` newest, oldest first), the same ticker folding;
  * it REFUSES (None, the caller reads the rows the old way) whenever it cannot be exact;
  * ONE result row, whatever the bar count: the property the speed comes from.
"""
import math
import random
import sqlite3
import struct

import pytest

from api.services import bars_sqlite


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """A real bars store on disk, with the store's own DDL, behind the module's connection."""
    path = str(tmp_path / "bars.db")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", path)
    monkeypatch.setattr(bars_sqlite, "_local", bars_sqlite.threading.local())
    conn = sqlite3.connect(path)
    conn.execute(bars_sqlite.ohlcv_ddl())
    conn.commit()

    def put(ticker, tf, rows):
        conn.executemany("INSERT OR REPLACE INTO ohlcv(ticker, tf, ts, o, h, l, c, v) VALUES (?,?,?,?,?,?,?,?)",
                         [(ticker, tf, *r) for r in rows])
        conn.commit()
    yield put
    conn.close()
    held = getattr(bars_sqlite._local, "conn", None)
    if held is not None:
        held.close()


def bits(x):
    return None if x is None else struct.pack("<d", x)


def same_bits(a, b):
    """Row lists equal value for value, floats compared by their 64 bits (not by ==)."""
    assert len(a) == len(b)
    for ra, rb in zip(a, b):
        assert ra[0] == rb[0] and type(ra[0]) is type(rb[0])
        for xa, xb in zip(ra[1:5], rb[1:5]):
            assert type(xa) is type(xb), (ra, rb)
            assert bits(xa) == bits(xb), (ra, rb)
        assert ra[5] == rb[5] and type(ra[5]) is type(rb[5]), (ra, rb)
    return True


def test_the_packed_read_is_the_row_read_bit_for_bit_over_price_like_values(store):
    rng = random.Random(20261113)
    rows = []
    for i in range(3000):
        base = rng.choice([0.0007, 0.43, 3.17, 32.78, 187.345, 1043.6, 6120.25, 711000.0])
        # the kinds of numbers a bar store holds: short decimals, split-adjusted products, sums
        o = round(base * rng.uniform(0.5, 1.5), rng.choice([2, 4, 6]))
        h = o * rng.uniform(1.0, 1.1) / rng.choice([1, 2, 3, 4, 7, 10, 20])
        low = (o + 0.1) + 0.2 - rng.random()
        c = o * 0.1 * 3 / 7
        rows.append((20000101 + i, o, h, low, c, rng.randrange(0, 5_000_000_000)))
    store("NVDA", "D", rows)
    plain = bars_sqlite.get_bars("NVDA", "D", 5000)
    packed = bars_sqlite.get_bars_packed("NVDA", "D", 5000)
    assert len(plain) == 3000
    assert same_bits(packed, plain)
    assert packed == plain


def test_awkward_doubles_and_random_bit_patterns_survive_exactly(store):
    rng = random.Random(7)
    awkward = [0.1 + 0.2, 1 / 3, 2 / 3, 1e-9 + 1e-12, 4503599627370495.5, 9007199254740991.0, 0.5 ** 40,
               123456.78901234567, 1.0000000000000002, 0.9999999999999999, 5e-10, 2.0 ** -20, 2.0 ** -30 * 3,
               -17.25, -0.1, 0.0, 1.0, 1e15 + 0.125, 33.333333333333336, math.pi, math.e * 1e5]
    # (every derived column stays below 2^53: the proven range; past it is the refusal test's)
    rows = [(1_700_000_000 + i, x, x / 3, x * 0.7, x / 2 + 0.1, i) for i, x in enumerate(awkward)]
    # random doubles with exponents a price can have (2^-30 .. 2^40), every mantissa bit in play
    for i in range(4000):
        vals = []
        for _ in range(4):
            mant = rng.getrandbits(52)
            exp = rng.randrange(1023 - 30, 1023 + 40)
            sign = rng.getrandbits(1) if rng.random() < 0.05 else 0
            vals.append(struct.unpack("<d", struct.pack("<Q", (sign << 63) | (exp << 52) | mant))[0])
        rows.append((1_700_100_000 + i, *vals, rng.randrange(0, 10 ** 12)))
    store("FUZZ", "5", rows)
    plain = bars_sqlite.get_bars("FUZZ", "5", 10 ** 6)
    packed = bars_sqlite.get_bars_packed("FUZZ", "5", 10 ** 6)
    assert len(plain) == len(rows)
    assert same_bits(packed, plain)


def test_the_window_is_the_newest_max_bars_oldest_first_and_the_ticker_is_folded(store):
    store("SPY", "D", [(20260101 + i, 1.5 + i, 2.5 + i, 0.5 + i, 1.25 + i, 100 + i) for i in range(50)])
    store("SPY", "W", [(20250101, 9.0, 9.0, 9.0, 9.0, 9)])
    store("SPYG", "D", [(20260101, 7.0, 7.0, 7.0, 7.0, 7)])
    for n in (1, 7, 50, 51, 5000):
        plain = bars_sqlite.get_bars("SPY", "D", n)
        assert bars_sqlite.get_bars_packed("spy", "D", n) == plain
        assert len(plain) == min(n, 50)
    newest7 = bars_sqlite.get_bars_packed("SPY", "D", 7)
    assert [r[0] for r in newest7] == [20260101 + i for i in range(43, 50)], "the newest seven, oldest first"
    assert bars_sqlite.get_bars_packed("SPY", "W", 10) == [(20250101, 9.0, 9.0, 9.0, 9.0, 9)]


def test_no_rows_is_an_empty_answer_not_a_refusal(store):
    assert bars_sqlite.get_bars_packed("NOPE", "D", 100) == []
    assert bars_sqlite.get_bars("NOPE", "D", 100) == []


def test_null_prices_and_null_volume_come_back_as_none_like_the_row_reader(store):
    store("GAPS", "D", [(20260101, None, 2.0, None, 1.5, None), (20260102, 1.0, None, 0.5, None, 10)])
    plain = bars_sqlite.get_bars("GAPS", "D", 10)
    packed = bars_sqlite.get_bars_packed("GAPS", "D", 10)
    assert packed == plain == [(20260101, None, 2.0, None, 1.5, None), (20260102, 1.0, None, 0.5, None, 10)]
    assert same_bits(packed, plain)


@pytest.mark.parametrize("bad_row, why", [
    ((20260102, 1.0, 2.0, 0.5, 1.5, 10.5), "a fractional volume is a REAL: its text form is not exact"),
    ((20260102, float("inf"), 2.0, 0.5, 1.5, 10), "an infinite price"),
    ((20260102, 1.0, 2.0 ** 53, 0.5, 1.5, 10), "a price at 2^53: past the proven range"),
    ((20260102, 1.0, 2.0, 0.5, 1e-40, 10), "a value with bits below 2^-104"),
    ((20260102, 1.0, 2.0, 0.5, 2.0 ** -52 / 3, 10), "2^-52 / 3: its lowest bit is 2^-106"),
    ((20260102, 1.0, 2.0, "junk", 1.5, 10), "a price that is not a number"),
])
def test_it_refuses_whenever_it_cannot_be_exact_and_the_row_reader_still_answers(store, bad_row, why):
    store("ODD", "D", [(20260101, 1.0, 2.0, 0.5, 1.5, 10), bad_row])
    assert bars_sqlite.get_bars_packed("ODD", "D", 10) is None, why
    assert len(bars_sqlite.get_bars("ODD", "D", 10)) == 2
    # CONTROL: the refusal is about that one row. The window that leaves it out is answered.
    store("ODD", "D", [(20260103, 3.0, 4.0, 2.5, 3.5, 30)])
    assert bars_sqlite.get_bars_packed("ODD", "D", 1) == [(20260103, 3.0, 4.0, 2.5, 3.5, 30)]


def test_a_sqlite_without_the_json_functions_is_a_refusal_never_an_error(store, monkeypatch):
    store("SPY", "D", [(20260101, 1.0, 2.0, 0.5, 1.5, 10)])
    real = bars_sqlite._conn

    class NoJson:
        def execute(self, sql, params=()):
            if "json_group_array" in sql:
                raise sqlite3.OperationalError("no such function: json_group_array")
            return real().execute(sql, params)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: NoJson())
    assert bars_sqlite.get_bars_packed("SPY", "D", 10) is None
    assert bars_sqlite.get_bars("SPY", "D", 10) == [(20260101, 1.0, 2.0, 0.5, 1.5, 10)]


def test_one_result_row_whatever_the_bar_count(store, monkeypatch):
    """The speed is this property: python takes ONE row from sqlite, not one per bar."""
    store("SPY", "D", [(20100101 + i, 1.0 + i, 2.0 + i, 0.5 + i, 1.5 + i, i) for i in range(2500)])
    real = bars_sqlite._conn
    taken = {"packed": 0, "plain": 0}

    class Counting:
        def __init__(self, cur, kind):
            self.cur, self.kind = cur, kind

        def fetchone(self):
            row = self.cur.fetchone()
            taken[self.kind] += row is not None
            return row

        def fetchall(self):
            rows = self.cur.fetchall()
            taken[self.kind] += len(rows)
            return rows

    class Conn:
        def execute(self, sql, params=()):
            return Counting(real().execute(sql, params), "packed" if "json_group_array" in sql else "plain")
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: Conn())
    packed = bars_sqlite.get_bars_packed("SPY", "D", 5000)
    plain = bars_sqlite.get_bars("SPY", "D", 5000)
    assert packed == plain and len(plain) == 2500
    assert taken == {"packed": 1, "plain": 2500}
    # and the statement itself yields exactly one row (nothing is left unread behind fetchone)
    assert len(real().execute(bars_sqlite._PACKED_SQL, ("SPY", "D", 5000)).fetchall()) == 1


# ── PROVEN ON THE SQLITE THIS PROCESS RUNS ───────────────────────────────────
#
# Everything above ran on the sqlite of the machine that ran it. Production is another build
# (python:3.12-slim-bookworm), and CI does not run this file on that image. So the read proves
# itself in every process before its first answer, and turns itself off if the proof fails.

def test_this_sqlite_reproduces_the_proof_set_and_the_proof_runs_once(store, monkeypatch):
    assert bars_sqlite._packed_self_test() is True
    assert len(bars_sqlite._proof_values()) >= 256
    runs = []
    real = bars_sqlite._packed_self_test
    monkeypatch.setattr(bars_sqlite, "_packed_self_test", lambda: runs.append(1) or real())
    monkeypatch.setattr(bars_sqlite, "_packed_proof", None)
    store("SPY", "D", [(20260101, 1.25, 2.5, 0.5, 1.75, 10)])
    for _ in range(3):
        assert bars_sqlite.get_bars_packed("SPY", "D", 10) == [(20260101, 1.25, 2.5, 0.5, 1.75, 10)]
    assert runs == [1], "once per process, not once per read"
    assert bars_sqlite.packed_reads_proven() is True


def _through_text(column, below=None):
    """The shipped statement with ONE column first rendered the way sqlite renders a REAL as text
    (15 significant digits): what a naive one-step read does. Off by about one part in 10^16.
    `below`: only values under it are rendered (so every error is tiny in absolute terms too)."""
    inner = "SELECT ts, o, h, l, c, v FROM ohlcv WHERE"
    assert bars_sqlite._PACKED_SQL.count(inner) == 1
    text = "CAST(printf('%.15g', {x}) AS REAL)"
    lossy = text if below is None else f"CASE WHEN abs({{x}}) < {below} THEN {text} ELSE {{x}} END"
    cols = ", ".join((lossy.format(x=x) + f" AS {x}") if x == column else x for x in ("o", "h", "l", "c"))
    return bars_sqlite._PACKED_SQL.replace(inner, f"SELECT ts, {cols}, v FROM ohlcv WHERE")


@pytest.mark.parametrize("breakage", ["a wrong rebuild", "the open through 15 digits of text",
                                      "only the close through 15 digits of text",
                                      "only values below one through 15 digits of text", "the proof itself errors"])
def test_a_sqlite_that_fails_the_proof_turns_the_one_step_read_off_and_says_so_once(store, monkeypatch, caplog, breakage):
    store("SPY", "D", [(20260101, 1.25, 2.5, 0.5, 1.75, 10)])
    if breakage == "a wrong rebuild":
        monkeypatch.setattr(bars_sqlite, "_PACK_INV", 2.0 ** -51)
    elif breakage == "the open through 15 digits of text":
        monkeypatch.setattr(bars_sqlite, "_PACKED_SQL", _through_text("o"))
    elif breakage == "only the close through 15 digits of text":
        monkeypatch.setattr(bars_sqlite, "_PACKED_SQL", _through_text("c"))
    elif breakage == "only values below one through 15 digits of text":
        # every error here is under 1e-15 in absolute terms: only a comparison of the BITS sees it
        monkeypatch.setattr(bars_sqlite, "_PACKED_SQL", _through_text("o", below=1))
    else:
        monkeypatch.setattr(bars_sqlite, "ohlcv_ddl", lambda name="ohlcv": "CREATE TABLE nope (")
    monkeypatch.setattr(bars_sqlite, "_packed_proof", None)
    assert bars_sqlite._packed_self_test() is False
    with caplog.at_level("ERROR", logger=bars_sqlite._logger.name):
        assert bars_sqlite.get_bars_packed("SPY", "D", 10) is None
        assert bars_sqlite.get_bars_packed("SPY", "D", 10) is None
    assert bars_sqlite.packed_reads_proven() is False
    said = [r for r in caplog.records if "one-step reads OFF" in r.getMessage()]
    assert len(said) == 1, "said once, not on every read"
    # and the rows are still served, the old way
    assert bars_sqlite.get_bars("SPY", "D", 10) == [(20260101, 1.25, 2.5, 0.5, 1.75, 10)]


def test_the_proof_set_holds_what_fifteen_digits_would_lose():
    """The proof must contain values a text rendering cannot carry, or it proves nothing."""
    lossy = [x for x in bars_sqlite._proof_values() if x and float("%.15g" % x) != x]
    assert len(lossy) >= 100, len(lossy)
    kinds = bars_sqlite._proof_values()
    assert any(0 < abs(x) < 1e-3 for x in kinds) and any(x > 1e15 for x in kinds) and any(x < 0 for x in kinds)
    assert 0.0 in kinds


def test_the_row_reader_is_named_by_identity():
    assert bars_sqlite.ROW_READER is bars_sqlite.get_bars
