import importlib


def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    return db


def test_init_upsert_and_read(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    assert db.count_rows() == 0
    n = db.upsert_rows([
        {"ticker": "NVDA", "company": "NVIDIA", "sector": "Technology",
         "price": 184.0, "market_cap": 4.5e12, "rsi14": 61.0,
         "uct_composite": 97, "above_50sma": True,
         "snapshot_date": "2026-06-19", "built_at": 1718800000},
    ])
    assert n == 1
    row = db.get_row("NVDA")
    assert row["company"] == "NVIDIA"
    assert row["rsi14"] == 61.0
    assert row["above_50sma"] == 1  # python bool -> 0/1
    # upsert is replace-by-ticker
    db.upsert_rows([{"ticker": "NVDA", "price": 190.0,
                     "snapshot_date": "2026-06-20", "built_at": 1718900000}])
    assert db.count_rows() == 1
    assert db.get_row("NVDA")["price"] == 190.0


def test_status_reports_freshness(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    db.upsert_rows([{"ticker": "AAA", "snapshot_date": "2026-06-19", "built_at": 123}])
    st = db.status()
    assert st["rows"] == 1
    assert st["latest_snapshot_date"] == "2026-06-19"
    assert st["latest_built_at"] == 123
