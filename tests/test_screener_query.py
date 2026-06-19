import importlib
import pytest
from api.services.screener import query


def test_build_where_range_and_enum():
    sql, params = query.build_where([
        {"key": "rsi14", "op": "between", "min": 40, "max": 60},
        {"key": "sector", "op": "eq", "value": "Technology"},
        {"key": "above_50sma", "op": "eq", "value": 1},
    ])
    assert "rsi14 >= ?" in sql and "rsi14 <= ?" in sql
    assert "sector = ?" in sql
    assert params == [40, 60, "Technology", 1]


def test_build_where_rejects_unknown_key():
    with pytest.raises(ValueError):
        query.build_where([{"key": "drop_table", "op": "eq", "value": 1}])


def test_build_where_rejects_bad_op():
    with pytest.raises(ValueError):
        query.build_where([{"key": "rsi14", "op": "in", "values": [1]}])


def test_contains_uses_like():
    sql, params = query.build_where([{"key": "pattern", "op": "contains", "value": "vcp"}])
    assert "patterns LIKE ?" in sql
    assert params == ["%vcp%"]


def test_run_scan_filters_and_paginates(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rsi14": 50, "sector": "Tech", "uct_composite": 90,
         "snapshot_date": "2026-06-19", "built_at": 1},
        {"ticker": "BBB", "rsi14": 80, "sector": "Tech", "uct_composite": 70,
         "snapshot_date": "2026-06-19", "built_at": 1},
    ])
    importlib.reload(query)
    res = query.run_scan({"filters": [{"key": "rsi14", "op": "lte", "max": 60}],
                          "view": "overview", "page": 1, "page_size": 10})
    assert res["total"] == 1
    assert res["rows"][0]["ticker"] == "AAA"
    assert "ticker" in res["view_columns"]
    assert res["snapshot_date"] == "2026-06-19"
