"""Wave 1 schema: new columns exist, and init_db widens a legacy table."""
import sqlite3


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


def test_wave1_columns_are_declared(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    for col in ("chg_pct_3m", "dollar_vol_30d", "pole_pct", "vol_nweek_low",
                "candle_score", "rs_line_trend", "prev_day_high", "close_cv_pct",
                "theme", "in_uct20", "is_leveraged", "stage2", "dist_ath_pct"):
        assert col in snapshot_db.COLUMNS


def test_init_db_widens_a_legacy_table(monkeypatch, tmp_path):
    db = _fresh(monkeypatch, tmp_path)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL)")
    conn.commit()
    conn.close()
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(snapshot_db.COLUMNS) <= have
    # control: the widened table takes a row through the normal upsert
    snapshot_db.upsert_rows([{"ticker": "TEST", "candle_score": 75,
                              "rs_line_trend": "up"}])
    row = snapshot_db.get_row("TEST")
    assert row["candle_score"] == 75 and row["rs_line_trend"] == "up"


def test_every_column_has_exactly_one_type_class(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    overlap = snapshot_db._TEXT & snapshot_db._INT
    assert not overlap, f"columns in both _TEXT and _INT: {overlap}"
