"""Wave 5 schema: the 13 new columns exist, type-set membership holds, and the
widen path still works (138 -> 151)."""
import sqlite3


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


WAVE5 = ("pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir",
         "pattern_entry_dist_pct", "pattern_stop_dist_pct",
         "pattern_expectancy_r", "dp_notional_1d", "dp_prints_1d",
         "dp_notional_5d", "dp_level_dist_pct", "opt_net_premium_1d",
         "opt_bull_pct_1d", "opt_net_premium_5d")


def test_wave5_columns_are_declared(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    missing = [c for c in WAVE5 if c not in snapshot_db.COLUMNS]
    assert not missing, missing
    assert len(WAVE5) == 13  # the reference table's own count, pinned
    assert len(snapshot_db.COLUMNS) == 158


def test_wave5_type_set_membership(monkeypatch, tmp_path):
    """`pattern_engine_ids` is TEXT (comma-joined list); `pattern_engine_dir`
    (reader-encoded +1/-1/0, ruling D4) and `dp_prints_1d` (a count) are INT;
    everything else Wave-5 is the REAL default."""
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    assert "pattern_engine_ids" in snapshot_db._TEXT
    assert "pattern_engine_dir" in snapshot_db._INT
    assert "dp_prints_1d" in snapshot_db._INT
    rest = [c for c in WAVE5 if c not in ("pattern_engine_ids", "pattern_engine_dir",
                                           "dp_prints_1d")]
    for c in rest:
        assert c not in snapshot_db._TEXT, c
        assert c not in snapshot_db._INT, c
    assert not (snapshot_db._TEXT & snapshot_db._INT)


def test_init_db_creates_all_151(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(snapshot_db.COLUMNS) <= have
    assert len(snapshot_db.COLUMNS) == 158


def test_init_db_widens_a_pre_wave5_shaped_table(monkeypatch, tmp_path):
    """A prod DB that stopped short of Wave 5 (145 columns incl. the Wave-6 parity four + the parity2 growth trio) gains the 13 on init --
    the PRAGMA-diff ALTER path (`init_db`'s `have`/`COLUMNS` diff), no
    migration script (map 4 §8 tail).

    `COLUMNS` itself is monkeypatched to the pre-Wave-5 138 for the FIRST
    `init_db()` call (so the table is created the way `init_db` would have
    shaped it before this task), then restored to the real 151 so the SECOND
    call exercises the exact ALTER-diff path a live pod hits on redeploy.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    real_columns = snapshot_db.COLUMNS
    pre_wave5_cols = [c for c in real_columns if c not in WAVE5]
    assert len(pre_wave5_cols) == 145

    monkeypatch.setattr(snapshot_db, "COLUMNS", pre_wave5_cols)
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have_before = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(pre_wave5_cols) <= have_before
    assert not (set(WAVE5) & have_before), "the 13 must not exist yet"

    monkeypatch.setattr(snapshot_db, "COLUMNS", real_columns)
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have_after = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(real_columns) <= have_after
    missing_after = [c for c in WAVE5 if c not in have_after]
    assert not missing_after, missing_after

    snapshot_db.upsert_rows([{"ticker": "T", "pattern_engine_ids": "wedge,flag",
                              "pattern_engine_dir": 1, "dp_prints_1d": 4}])
    row = snapshot_db.get_row("T")
    assert row["pattern_engine_ids"] == "wedge,flag"
    assert row["pattern_engine_dir"] == 1
    assert row["dp_prints_1d"] == 4
