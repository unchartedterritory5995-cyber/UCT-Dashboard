"""D5 CHECKPOINT 3 — the one confirmed corporate-actions source: splits.

⛔ `massive.get_split_tickers` is retired (D5 CP3, 2026-09-18) — zero callers,
zero tests, superseded by `fetch_confirmed_splits` below, which keeps full row
detail (execution date + ratio) rather than just ticker-set membership.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import massive, reference_corp_actions as rca


class _FakeClient:
    _api_key = "k"

    def __init__(self, pages):
        self._pages = list(pages)
        self.urls = []

    def _get(self, url):
        self.urls.append(url)
        return self._pages.pop(0) if self._pages else {}


def test_fetch_confirmed_splits_builds_the_correct_url_and_paginates(monkeypatch):
    pages = [
        {"results": [{"ticker": "aapl", "execution_date": "2026-09-01",
                      "split_from": 1, "split_to": 4}],
         "next_url": "https://api.massive.com/v3/reference/splits?cursor=abc"},
        {"results": [{"ticker": "MSFT", "execution_date": "2026-09-05",
                      "split_from": 1, "split_to": 2}]},
    ]
    client = _FakeClient(pages)
    monkeypatch.setattr(massive, "_get_client", lambda: client)

    rows = rca.fetch_confirmed_splits("2026-09-01", "2026-09-30")

    assert rows == [
        {"ticker": "AAPL", "execution_date": "2026-09-01", "split_from": 1, "split_to": 4},
        {"ticker": "MSFT", "execution_date": "2026-09-05", "split_from": 1, "split_to": 2},
    ]
    assert "execution_date.gte=2026-09-01" in client.urls[0]
    assert "execution_date.lte=2026-09-30" in client.urls[0]
    assert "/v3/reference/splits" in client.urls[0]
    # page 2 followed next_url, carrying the api key forward
    assert client.urls[1].startswith("https://api.massive.com/v3/reference/splits?cursor=abc")
    assert "apiKey=k" in client.urls[1]


def test_fetch_confirmed_splits_skips_a_row_missing_ticker_or_date(monkeypatch):
    client = _FakeClient([{"results": [
        {"ticker": None, "execution_date": "2026-09-01"},
        {"ticker": "GOOD", "execution_date": None},
        {"ticker": "GOOD", "execution_date": "2026-09-01", "split_from": 1, "split_to": 2},
    ]}])
    monkeypatch.setattr(massive, "_get_client", lambda: client)

    rows = rca.fetch_confirmed_splits("2026-09-01", "2026-09-30")
    assert rows == [{"ticker": "GOOD", "execution_date": "2026-09-01",
                      "split_from": 1, "split_to": 2}]


def test_fetch_confirmed_splits_returns_empty_on_provider_failure(monkeypatch):
    class _Boom:
        _api_key = "k"

        def _get(self, url):
            raise RuntimeError("provider down")

    monkeypatch.setattr(massive, "_get_client", lambda: _Boom())
    assert rca.fetch_confirmed_splits("2026-09-01", "2026-09-30") == []


def test_record_confirmed_splits_writes_and_is_idempotent(tmp_path):
    db = str(tmp_path / "rca.db")
    rows = [{"ticker": "AAPL", "execution_date": "2026-09-01", "split_from": 1, "split_to": 4}]

    n1 = rca.record_confirmed_splits(rows, now=1000.0, db_path=db)
    assert n1 == 1

    conn = sqlite3.connect(db)
    got = conn.execute("SELECT ticker, execution_date, split_from, split_to, source, "
                       "confirmed_at FROM confirmed_splits").fetchall()
    conn.close()
    assert got == [("AAPL", "2026-09-01", 1.0, 4.0, "massive", 1000.0)]

    # ⛔ Re-running over an OVERLAPPING window must UPSERT, never duplicate —
    # the whole point of keying on (ticker, execution_date).
    n2 = rca.record_confirmed_splits(rows, now=2000.0, db_path=db)
    assert n2 == 1
    conn = sqlite3.connect(db)
    count = conn.execute("SELECT COUNT(*) FROM confirmed_splits").fetchone()[0]
    confirmed_at = conn.execute("SELECT confirmed_at FROM confirmed_splits").fetchone()[0]
    conn.close()
    assert count == 1, "an overlapping refresh duplicated the row instead of upserting it"
    assert confirmed_at == 2000.0, "the re-run did not update confirmed_at"


def test_record_confirmed_splits_skips_a_row_missing_ticker_or_date(tmp_path):
    db = str(tmp_path / "rca.db")
    rows = [{"ticker": "", "execution_date": "2026-09-01"},
            {"ticker": "GOOD", "execution_date": ""}]
    assert rca.record_confirmed_splits(rows, db_path=db) == 0


def test_record_confirmed_splits_empty_input_is_a_no_op(tmp_path):
    db = str(tmp_path / "rca.db")
    assert rca.record_confirmed_splits([], db_path=db) == 0
    import os
    assert not os.path.isfile(db), "an empty write must not even create the file"


def test_refresh_confirmed_splits_fetches_then_records(monkeypatch, tmp_path):
    db = str(tmp_path / "rca.db")
    client = _FakeClient([{"results": [
        {"ticker": "NVDA", "execution_date": "2026-09-10", "split_from": 1, "split_to": 10},
    ]}])
    monkeypatch.setattr(massive, "_get_client", lambda: client)

    n = rca.refresh_confirmed_splits("2026-09-01", "2026-09-30", now=500.0, db_path=db)
    assert n == 1

    conn = sqlite3.connect(db)
    row = conn.execute("SELECT ticker, split_to FROM confirmed_splits").fetchone()
    conn.close()
    assert row == ("NVDA", 10.0)


# ── MUTATION — the collision proof this checkpoint exists for ────────────────

def test_MUTATION_the_upsert_key_is_ticker_and_execution_date_together(tmp_path):
    """A key on ticker ALONE would silently drop a ticker's earlier split the
    moment it splits again; a key on execution_date ALONE would collide two
    unrelated tickers that split the same day. Prove BOTH columns are load-
    bearing in the primary key by writing two rows that share exactly one of
    the two columns each, and confirming neither overwrites the other."""
    db = str(tmp_path / "rca.db")
    rows = [
        {"ticker": "AAPL", "execution_date": "2026-01-01", "split_from": 1, "split_to": 4},
        {"ticker": "AAPL", "execution_date": "2026-06-01", "split_from": 1, "split_to": 2},
        {"ticker": "MSFT", "execution_date": "2026-01-01", "split_from": 1, "split_to": 3},
    ]
    rca.record_confirmed_splits(rows, db_path=db)
    conn = sqlite3.connect(db)
    count = conn.execute("SELECT COUNT(*) FROM confirmed_splits").fetchone()[0]
    conn.close()
    assert count == 3, "same-ticker or same-date rows collided instead of coexisting"


# ── D5 CP4 — the first real reader of the ledger ──────────────────────────────

def test_read_confirmed_splits_returns_the_same_shape_fmp_meta_uses(tmp_path):
    db = str(tmp_path / "rca.db")
    rows = [
        {"ticker": "NVDA", "execution_date": "2026-06-10", "split_from": 1, "split_to": 10},
        {"ticker": "NVDA", "execution_date": "2026-01-01", "split_from": 2, "split_to": 3},
    ]
    rca.record_confirmed_splits(rows, db_path=db)
    got = rca.read_confirmed_splits("nvda", db_path=db)  # lowercase query ticker
    assert got == [("2026-01-01", 1.5), ("2026-06-10", 10.0)], (
        "expected (execution_date, split_to/split_from) tuples, ordered by date; "
        "the QUERY ticker's case must not matter, since fetch_confirmed_splits "
        "always stores uppercase already")


def test_read_confirmed_splits_on_an_empty_or_missing_ledger_returns_empty_list(tmp_path):
    missing = str(tmp_path / "does_not_exist_yet.db")
    assert rca.read_confirmed_splits("AAPL", db_path=missing) == []


def test_read_confirmed_splits_never_raises_on_a_corrupt_db_path(tmp_path):
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"not a sqlite file at all")
    assert rca.read_confirmed_splits("AAPL", db_path=str(corrupt)) == []
