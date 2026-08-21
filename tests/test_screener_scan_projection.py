"""Scan projection + strict sort validation."""
import pytest


def _seed(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "AAA", "price": 10.0, "rsi14": 55.0, "uct_composite": 90,
         "sector": "Tech", "snapshot_date": "2026-08-21"},
        {"ticker": "BBB", "price": 20.0, "rsi14": 45.0, "uct_composite": 80,
         "sector": "Tech", "snapshot_date": "2026-08-21"},
    ])


def test_projection_returns_only_requested_plus_ticker_and_sort(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    out = query.run_scan({"columns": ["price"], "sort": {"key": "rsi14", "dir": "desc"}})
    assert out["view_columns"] == ["ticker", "price", "rsi14"]
    assert set(out["rows"][0].keys()) == {"ticker", "price", "rsi14"}
    assert [r["ticker"] for r in out["rows"]] == ["AAA", "BBB"]  # rsi 55 first


def test_unknown_column_is_a_400_shaped_valueerror(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    with pytest.raises(ValueError, match="unknown columns: nope"):
        query.run_scan({"columns": ["nope"]})


def test_unknown_sort_key_no_longer_silently_substitutes(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    with pytest.raises(ValueError, match="unknown sort key"):
        query.run_scan({"sort": {"key": "not_a_column"}})
    # absent sort still defaults quietly — only a WRONG key is refused
    assert query.run_scan({})["rows"]


def test_no_columns_keeps_full_rows_and_view_columns(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    out = query.run_scan({"view": "overview"})
    assert "rsi14" in out["rows"][0]          # SELECT * unchanged
    assert out["view_columns"]                 # view echo unchanged
