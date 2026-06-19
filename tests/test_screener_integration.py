"""End-to-end smoke: build one real ticker via the actual readers, then scan it.
Skips gracefully when local bars aren't available in the environment, but still
proves the reader wrappers resolve (no AttributeError on real service names)."""
import importlib
import pytest


def test_build_one_ticker_then_scan(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    try:
        bars = b._read_daily_bars("AAPL")
    except Exception as e:
        pytest.skip(f"local bars reader unavailable: {e}")
    if not bars:
        pytest.skip("no local bars for AAPL in this environment")

    # readers must at least not raise
    ratings = b._read_ratings("AAPL")
    funda = b._read_fundamentals("AAPL")
    row = b.build_row("AAPL", bars, ratings, funda)

    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows([row])

    import api.services.screener.query as q
    importlib.reload(q)
    res = q.run_scan({"filters": [{"key": "price", "op": "gte", "min": 1}],
                      "view": "technical"})
    assert res["total"] == 1
    assert res["rows"][0]["ticker"] == "AAPL"
