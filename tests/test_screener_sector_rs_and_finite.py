"""Two screener-table guarantees (2026-10-18):

1. A non-finite float is stored as NULL, for every column, at the one write door
   (`snapshot_db._coerce`): a stored inf sorted first, passed `> N` filters and
   then 500'd every scan page that carried it.
2. `sector_rs_pct` is ranked from the `rs_return` stored on the same rows, so
   within a sector it orders names exactly as the RS Ret column does.
"""
import math

import pytest

from api.services.screener import snapshot_db
from api.services.research import ratings_db


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    return tmp_path


def test_coerce_stores_inf_and_nan_as_null_and_keeps_real_values():
    assert snapshot_db._coerce("pe_fwd", float("inf")) is None
    assert snapshot_db._coerce("pe_fwd", float("-inf")) is None
    assert snapshot_db._coerce("pe_fwd", float("nan")) is None
    assert snapshot_db._coerce("pe_fwd", 12.5) == 12.5
    assert snapshot_db._coerce("pe_fwd", 0.0) == 0.0
    assert snapshot_db._coerce("above_50sma", True) == 1
    assert snapshot_db._coerce("sector", "Technology") == "Technology"


def test_an_inf_written_through_upsert_reads_back_as_null(db):
    snapshot_db.upsert_rows([{"ticker": "KOPN", "pe_fwd": float("inf"), "price": 2.5}])
    row = snapshot_db.get_row("KOPN")
    assert row["pe_fwd"] is None
    assert row["price"] == 2.5


def _rows(sector, n, start=0.0, step=1.0):
    return [{"ticker": f"{sector[:3].upper()}{i}", "sector": sector, "rs_return": start + i * step}
            for i in range(n)]


def test_sector_rs_orders_names_exactly_as_rs_return_does_within_a_sector(db):
    floor = ratings_db.SECTOR_MIN_SAMPLE
    rows = _rows("Technology", floor + 5) + _rows("Energy", floor, start=-10.0, step=0.5)
    snapshot_db.upsert_rows(rows)
    receipt = snapshot_db.rank_sector_rs()
    assert receipt["ranked"] == len(rows)
    assert receipt["sectors"] == 2
    for sector in ("Technology", "Energy"):
        got = [(r["rs_return"], snapshot_db.get_row(r["ticker"])["sector_rs_pct"]) for r in rows if r["sector"] == sector]
        got.sort()
        ranks = [g[1] for g in got]
        assert ranks == sorted(ranks), sector
        assert all(1 <= x <= 99 for x in ranks)
        assert ranks[0] < ranks[-1]


def test_sector_rs_uses_the_rows_own_rs_return_not_a_second_copy(db):
    # Whatever an older store said, the rank follows the row's RS Ret.
    floor = ratings_db.SECTOR_MIN_SAMPLE
    rows = _rows("Health", floor)
    rows[0]["sector_rs_pct"] = 99   # a stale value left by the old path
    snapshot_db.upsert_rows(rows)
    snapshot_db.rank_sector_rs()
    lowest = snapshot_db.get_row(rows[0]["ticker"])["sector_rs_pct"]
    highest = snapshot_db.get_row(rows[-1]["ticker"])["sector_rs_pct"]
    assert lowest < highest
    assert lowest == ratings_db._rank(sorted(r["rs_return"] for r in rows), rows[0]["rs_return"])


def test_no_rank_without_a_big_enough_sector_or_an_rs_return(db):
    floor = ratings_db.SECTOR_MIN_SAMPLE
    rows = (_rows("Utilities", floor - 1) + _rows("Materials", floor)
            + [{"ticker": "NORS", "sector": "Materials", "rs_return": None, "sector_rs_pct": 50},
               {"ticker": "NOSEC", "sector": None, "rs_return": 5.0, "sector_rs_pct": 50}])
    snapshot_db.upsert_rows(rows)
    receipt = snapshot_db.rank_sector_rs()
    assert receipt["sectors_below_min"] == 1
    assert all(snapshot_db.get_row(r["ticker"])["sector_rs_pct"] is None for r in rows if r["sector"] == "Utilities")
    assert snapshot_db.get_row("NORS")["sector_rs_pct"] is None
    assert snapshot_db.get_row("NOSEC")["sector_rs_pct"] is None


def test_the_build_no_longer_ranks_sector_rs_from_the_ratings_store(monkeypatch):
    from api.services.screener import snapshot_builder, enrich
    metrics = {"rs_return": 12.0, "sector": "Technology", "eps_growth": 10.0}
    monkeypatch.setattr(ratings_db, "get_ticker_metrics", lambda t: metrics)
    pools = {"Technology": {"rs_return": {"values": [float(i) for i in range(50)], "n": 50}}}
    monkeypatch.setattr(enrich, "load_sector_distributions", lambda: pools)
    out = snapshot_builder._read_ratings("AAA")
    assert "sector_rs_pct" not in out
