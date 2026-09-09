"""Schema init for alert_taxonomy.db (S7 first slice)."""
import pytest

from api.services.alert_taxonomy import db as at_db


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "alert_taxonomy.db")


def test_init_db_creates_every_table(db_path):
    conn = at_db.init_db(db_path=db_path)
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    for t in at_db.TABLES:
        assert t in tables
    conn.close()


def test_init_db_is_idempotent(db_path):
    at_db.init_db(db_path=db_path).close()
    conn = at_db.init_db(db_path=db_path)  # second call must not raise
    row = conn.execute("SELECT COUNT(*) FROM alert_fires").fetchone()
    assert row[0] == 0
    conn.close()


def test_alert_fires_unique_constraint_on_predicate_and_fire_key(db_path):
    conn = at_db.init_db(db_path=db_path)
    conn.execute(
        "INSERT INTO alert_fires (predicate_id, trigger_type, user_id, entity_ref, fire_key, as_of, fired_at) "
        "VALUES ('p1','document-arrival','u1','AAPL','occ:123',1.0,1.0)"
    )
    conn.commit()
    with pytest.raises(Exception):
        conn.execute(
            "INSERT INTO alert_fires (predicate_id, trigger_type, user_id, entity_ref, fire_key, as_of, fired_at) "
            "VALUES ('p1','document-arrival','u1','AAPL','occ:123',2.0,2.0)"
        )
    conn.close()


def test_known_d1_freshness_values_are_the_real_five_not_the_stale_four():
    """The whole point of the readiness-review correction: this must be the
    5-value set D1's real provider_errors.FreshnessClass emits, never the
    stale 4-value data-architecture.md §12.1 set SPEC-S7's literal DDL
    comment cited."""
    assert set(at_db.KNOWN_D1_FRESHNESS_VALUES) == {
        "real_time", "delayed_15", "end_of_day", "historical", "stale",
    }


def test_routing_prefs_table_is_deliberately_not_built_this_pass(db_path):
    conn = at_db.init_db(db_path=db_path)
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    assert "alert_routing_prefs" not in tables
    conn.close()
