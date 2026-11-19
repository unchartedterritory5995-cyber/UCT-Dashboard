"""bars-api's boot "is the local store populated?" check (2026-11-19).

It was `COUNT(*) FROM (SELECT ticker FROM ohlcv GROUP BY ticker LIMIT 3000)`, which reads every
row of the first 3,000 tickers: 70-82 s of full-store IO on the cold 20 GB store at every boot.
`_distinct_tickers_at_least` answers the same question with one primary-key seek per ticker.
"""
import sqlite3

from api import bars_api_main as bam


def _store(tickers, rows_each=3):
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL,"
              " PRIMARY KEY (ticker, tf, ts)) WITHOUT ROWID")
    for t in tickers:
        for tf in ("D", "5"):
            for i in range(rows_each):
                c.execute("INSERT INTO ohlcv VALUES (?,?,?,1,1,1,1,1)", (t, tf, i))
    return c


def test_counts_distinct_tickers_not_rows():
    c = _store([f"T{i:03d}" for i in range(7)], rows_each=5)
    assert bam._distinct_tickers_at_least(c, 100) == 7


def test_stops_at_the_bound():
    c = _store([f"T{i:04d}" for i in range(50)])
    assert bam._distinct_tickers_at_least(c, 20) == 20


def test_empty_store_is_zero():
    assert bam._distinct_tickers_at_least(_store([]), 2000) == 0


def test_same_answer_as_the_old_group_by():
    # one ticker a prefix of others (A, AA, AAL, BRK, BRK.B) is the case a sloppy seek would skip
    tickers = [f"{a}{b}" for a in "ABCDEFGH" for b in "XYZ"] + ["A", "AA", "AAL", "BRK", "BRK.B", "BF-A", "a_lower"]
    c = _store(tickers)
    old = c.execute("SELECT COUNT(*) FROM (SELECT ticker FROM ohlcv GROUP BY ticker LIMIT 3000)").fetchone()[0]
    assert bam._distinct_tickers_at_least(c, 3000) == old == len(tickers)
