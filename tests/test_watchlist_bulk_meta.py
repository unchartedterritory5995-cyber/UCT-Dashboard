"""A whole watchlist's row metadata, in one indexed read.

⛔ WHAT THIS REPLACES. `POST /api/research/snapshot-batch` is hard-capped at 100
tickers and measured 10,031 ms for those 100 on prod 2026-09-20 — its floor is one
yfinance `.info` HTTP call PER SYMBOL plus one SQLite query per symbol for average
volume. So rows 101+ of a 1,872-name Russell 2000 could NEVER show Name, Market
Cap, Rating, Earnings or Sector. That is a functional truncation, not slow
hydration, and raising the cap would have meant 2,000 Yahoo round-trips.

`screener_rows` already carries those fields for the whole universe, rebuilt
nightly. Production census 2026-09-20 (50-row sample): uct_composite 50/50,
ipo_date 50/50, avg_volume_30d 50/50, company 50/50, sector 47/50, market_cap
33/50, next_earnings_date 31/50 — partial where the underlying data genuinely is,
complete where it is not.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def snap(monkeypatch):
    """A fake `screener_rows` projection, recording what was asked for.

    ⚠️ Patches the FUNCTION on the real module, not a `sys.modules` entry. The route
    does `from api.services.screener import snapshot_db`, which reads the attribute
    off the already-imported PACKAGE — so a fake registered in `sys.modules` is
    bypassed the moment any earlier test has imported the real module. These tests
    passed alone and failed in the full suite until this was an attribute patch.
    """
    from api.routers import watchlists as r
    from api.services.screener import snapshot_db

    seen = {}
    universe = {
        "AAPL": {"company": "Apple Inc.", "sector": "Technology", "industry": "Consumer Electronics",
                 "market_cap": 3.1e12, "uct_composite": 92, "next_earnings_date": "2026-10-30",
                 "ipo_date": "1980-12-12", "avg_volume_30d": 51234567.0},
        "CRNX": {"company": "Crinetics Pharmaceuticals Inc", "sector": "Healthcare",
                 "industry": "Biotechnology", "market_cap": None, "uct_composite": 78,
                 "next_earnings_date": None, "ipo_date": "2018-07-18", "avg_volume_30d": 5128094.0},
    }

    def fake_get_projected(tickers, columns):
        seen["tickers"] = list(tickers)
        seen["columns"] = list(columns)
        return {t: {c: universe[t].get(c) for c in columns}
                for t in tickers if t in universe}

    monkeypatch.setattr(snapshot_db, "get_projected", fake_get_projected)
    return r, seen


def test_a_whole_russell_2000_is_enriched_in_one_call(snap):
    r, seen = snap
    tickers = ["AAPL", "CRNX"] + [f"X{i}" for i in range(1870)]

    out = r.bulk_meta(r.BulkMetaRequest(tickers=tickers), user={"id": "u"})

    # Everything asked for in ONE call — no 100-row cliff.
    assert len(seen["tickers"]) == 1872
    assert out["results"]["AAPL"]["name"] == "Apple Inc."
    assert out["results"]["AAPL"]["composite"] == 92
    assert out["results"]["AAPL"]["market_cap"] == 3.1e12
    assert out["results"]["AAPL"]["avg_vol_20d"] == 51234567.0


def test_symbols_outside_the_snapshot_universe_are_reported_missing_not_null(snap):
    """The snapshot has a ~$300M cap floor, so a few hundred R2K micro-caps have no
    row. Absent ≠ null: the client must be able to fall back for exactly those."""
    r, _ = snap
    out = r.bulk_meta(r.BulkMetaRequest(tickers=["AAPL", "NOSUCH", "CRNX"]), user={"id": "u"})

    assert set(out["results"]) == {"AAPL", "CRNX"}
    assert out["missing"] == ["NOSUCH"]
    # A field that is genuinely empty for a covered symbol still comes back as null,
    # which is a different statement from "we have no row for this ticker".
    assert "CRNX" in out["results"] and out["results"]["CRNX"]["market_cap"] is None


def test_it_projects_columns_rather_than_selecting_everything(snap):
    """`screener_rows` is 205 columns wide. Measured: 2,000 tickers via SELECT * is
    275 ms / 9.8 MB; the same 2,000 projected is ~7 ms."""
    r, seen = snap
    r.bulk_meta(r.BulkMetaRequest(tickers=["AAPL"]), user={"id": "u"})

    assert set(seen["columns"]) == set(r._BULK_META_COLS.values())
    assert len(seen["columns"]) < 12


def test_an_unreadable_snapshot_degrades_instead_of_failing(monkeypatch):
    """Every row must still render its symbol if the screener DB is unavailable."""
    from api.routers import watchlists as r
    from api.services.screener import snapshot_db

    def boom(*a, **k):
        raise RuntimeError("screener.db locked")
    monkeypatch.setattr(snapshot_db, "get_projected", boom)

    out = r.bulk_meta(r.BulkMetaRequest(tickers=["AAPL", "MSFT"]), user={"id": "u"})
    assert out["results"] == {}
    assert out["missing"] == ["AAPL", "MSFT"]


def test_the_request_is_bounded(snap):
    r, seen = snap
    r.bulk_meta(r.BulkMetaRequest(tickers=[f"T{i}" for i in range(5000)]), user={"id": "u"})
    assert len(seen["tickers"]) == r._BULK_META_MAX


def test_duplicates_and_case_are_normalised(snap):
    r, seen = snap
    r.bulk_meta(r.BulkMetaRequest(tickers=["aapl", "AAPL", " crnx "]), user={"id": "u"})
    assert seen["tickers"] == ["AAPL", "CRNX"]


# ── get_projected itself ──────────────────────────────────────────────────────

def test_get_projected_whitelists_columns_and_reads_only_those(tmp_path, monkeypatch):
    """⛔ It interpolates column names into SQL, so the whitelist is a SECURITY
    boundary, not a tidiness one. Only names already in `COLUMNS` may appear."""
    import sqlite3
    from api.services.screener import snapshot_db

    db = tmp_path / "screener.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, company TEXT, "
                 "sector TEXT, market_cap REAL, uct_composite INTEGER)")
    conn.execute("INSERT INTO screener_rows VALUES ('AAPL','Apple Inc.','Technology',3.1e12,92)")
    conn.commit(); conn.close()
    monkeypatch.setattr(snapshot_db, "get_db_path", lambda: str(db))

    got = snapshot_db.get_projected(["aapl"], ["company", "market_cap"])
    assert got == {"AAPL": {"company": "Apple Inc.", "market_cap": 3.1e12}}

    # An unknown column is dropped rather than interpolated.
    got = snapshot_db.get_projected(["AAPL"], ["company", "1); DROP TABLE screener_rows;--"])
    assert got == {"AAPL": {"company": "Apple Inc."}}
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0] == 1
    conn.close()

    # No valid column at all is a no-op, never a bare SELECT.
    assert snapshot_db.get_projected(["AAPL"], ["nope"]) == {}
    assert snapshot_db.get_projected([], ["company"]) == {}


def test_get_projected_chunks_past_sqlites_variable_limit(tmp_path, monkeypatch):
    import sqlite3
    from api.services.screener import snapshot_db

    db = tmp_path / "screener.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, company TEXT)")
    conn.executemany("INSERT INTO screener_rows VALUES (?,?)",
                     [(f"T{i}", f"Co {i}") for i in range(2000)])
    conn.commit(); conn.close()
    monkeypatch.setattr(snapshot_db, "get_db_path", lambda: str(db))

    got = snapshot_db.get_projected([f"T{i}" for i in range(2000)], ["company"])
    assert len(got) == 2000
    assert got["T1999"] == {"company": "Co 1999"}
