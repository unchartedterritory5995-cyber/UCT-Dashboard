import pytest


@pytest.fixture
def rs(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    from api.services.awareness import regime_snapshots as mod
    monkeypatch.setattr(mod, "_DB_PATH", str(db_path))
    mod.init_schema()
    return mod


def test_get_last_label_none_when_empty(rs):
    assert rs.get_last_label() is None


def test_record_and_read_back_last_label(rs):
    rs.record_snapshot("bull_trend", 0.8)
    assert rs.get_last_label() == "bull_trend"


def test_last_label_reflects_most_recent_row(rs):
    rs.record_snapshot("bull_trend", 0.8)
    rs.record_snapshot("chop", 0.5)
    rs.record_snapshot("bear_trend", 0.6)
    assert rs.get_last_label() == "bear_trend"


def test_record_snapshot_is_append_only(rs):
    rs.record_snapshot("bull_trend", 0.8)
    rs.record_snapshot("bull_trend", 0.8)  # same label -- still a new row
    with rs._conn() as db:
        n = db.execute(
            "SELECT COUNT(*) FROM awareness_regime_snapshots"
        ).fetchone()[0]
    assert n == 2


def test_init_schema_is_idempotent(rs):
    rs.init_schema()  # second call must not raise
    rs.record_snapshot("chop", 0.4)
    assert rs.get_last_label() == "chop"
