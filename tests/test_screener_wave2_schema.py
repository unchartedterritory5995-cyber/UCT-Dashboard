"""Wave 2 schema: the 35 new columns exist and the widen path still works."""
import sqlite3


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


WAVE2 = ("quick_ratio", "p_fcf", "p_ocf", "payout_ratio", "roic",
         "lt_debt_to_capital", "ipo_date", "ipo_age_days", "country",
         "shares_outstanding", "float_shares", "float_pct", "short_float_pct",
         "short_ratio", "insider_own_pct", "next_earnings_date",
         "earnings_session", "days_to_earnings", "last_report_move_pct",
         "implied_move_pct", "earnings_setup_grade", "analyst_consensus",
         "pt_target", "pt_upside_pct", "upgrades_30d", "downgrades_30d",
         "eps_next_y_growth", "insider_cluster_days", "blended_growth",
         "sector_rs_pct", "rating_eps", "rating_growth", "rating_value",
         "rating_smr", "sponsorship")


def test_wave2_columns_are_declared(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    missing = [c for c in WAVE2 if c not in snapshot_db.COLUMNS]
    assert not missing, missing
    assert len(WAVE2) == 35  # the reference table's own count, pinned


def test_init_db_widens_a_wave1_shaped_table(monkeypatch, tmp_path):
    """A prod DB that stopped at Wave 1's 103 columns gains the 35 on init."""
    db = _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    wave1_cols = [c for c in snapshot_db.COLUMNS if c not in WAVE2]
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (%s)" % ", ".join(
        "ticker TEXT PRIMARY KEY" if c == "ticker" else f"{c} REAL"
        for c in wave1_cols))
    conn.commit()
    conn.close()
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(snapshot_db.COLUMNS) <= have
    snapshot_db.upsert_rows([{"ticker": "T", "short_float_pct": 12.5,
                              "earnings_session": "bmo"}])
    row = snapshot_db.get_row("T")
    assert row["short_float_pct"] == 12.5 and row["earnings_session"] == "bmo"


def test_type_classes_stay_disjoint(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    assert not (snapshot_db._TEXT & snapshot_db._INT)
