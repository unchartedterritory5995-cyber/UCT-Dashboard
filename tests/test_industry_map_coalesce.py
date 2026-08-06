"""Regression test for data-dependability C26: `_upsert_many`'s
`ON CONFLICT ... SET sector = excluded.sector` clobbered a good, previously-
resolved sector/industry with NULL whenever a later write (e.g. the weekly
Finviz bulk refresh) had a blank value for that column -- Finviz's export
legitimately leaves Sector/Industry blank for some tickers.
"""
import contextlib

import pytest

from api.services import industry_map as im


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    """Point the module at a throwaway SQLite file and force re-init."""
    db_path = str(tmp_path / "industry_map_test.db")
    monkeypatch.setattr(im, "_DB_PATH", db_path)
    monkeypatch.setattr(im, "_INIT_DONE", False)
    im._ensure_init()
    yield db_path


def _row(db_path, ticker):
    with contextlib.closing(im._connect()) as c:
        r = c.execute(
            "SELECT sector, industry, source FROM industry_map WHERE ticker = ?", (ticker,)
        ).fetchone()
    return dict(r) if r else None


class TestUpsertCoalesce:
    def test_null_sector_on_reinsert_does_not_clobber_good_value(self, isolated_db):
        # First write: a good, yfinance-resolved sector/industry.
        im._upsert_many([("SNDK", "Technology", "Semiconductors", "yfinance", 1000)])
        assert _row(isolated_db, "SNDK") == {
            "sector": "Technology", "industry": "Semiconductors", "source": "yfinance",
        }

        # Second write: the weekly Finviz bulk refresh, blank for this ticker
        # (Finviz's export legitimately leaves Sector/Industry blank for some
        # rows -- this is NOT a signal that the ticker has no sector).
        im._upsert_many([("SNDK", None, None, "finviz", 2000)])

        row = _row(isolated_db, "SNDK")
        assert row["sector"] == "Technology"        # NOT clobbered to None
        assert row["industry"] == "Semiconductors"   # NOT clobbered to None
        assert row["source"] == "finviz"             # provenance still updates

    def test_a_real_new_value_still_overwrites(self, isolated_db):
        """Control: a genuinely-updated value (not NULL) must still win --
        COALESCE must not make the map permanently sticky."""
        im._upsert_many([("SNDK2", "Technology", "Old Industry", "yfinance", 1000)])
        im._upsert_many([("SNDK2", "Technology", "New Industry", "finviz", 2000)])

        row = _row(isolated_db, "SNDK2")
        assert row["industry"] == "New Industry"

    def test_first_insert_with_null_stores_null(self, isolated_db):
        """Control: COALESCE only protects an UPDATE against a prior good
        value -- a ticker with no prior row and a blank Finviz row is
        legitimately unclassified (never fabricated into a fake sector)."""
        im._upsert_many([("NEWTICK", None, None, "finviz", 1000)])
        row = _row(isolated_db, "NEWTICK")
        assert row["sector"] is None
        assert row["industry"] is None
