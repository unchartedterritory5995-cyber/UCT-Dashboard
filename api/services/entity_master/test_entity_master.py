"""Entity Master test suite — colocated with its service (matches this
codebase's `api/services/test_grade_ticker.py` precedent, per
entity-master-spec.md §12).

Every fixture is synthetic. No test touches `cap_universe.json`, `C:\\data`,
or any production file — every database used here is created fresh under
pytest's `tmp_path`, never at the real `entity_master.db` / `DATA_DIR` path.

Checkpoint 1 (Schema) tests only. Read/write-primitive tests (AC-1 through
AC-10, `test_share_class_vs_vendor_notation`) are added in later checkpoints
once `api.services.entity_master.api`/`store` exist.
"""
import sqlite3

import pytest

from api.services.entity_master import schema


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "entity_master_test.db")


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


def test_init_db_creates_every_table(db_path):
    conn = schema.init_db(db_path=db_path)
    names = _table_names(conn)
    for t in schema.TABLES:
        assert t in names, f"missing table {t}"


def test_init_db_creates_expected_indexes(db_path):
    conn = schema.init_db(db_path=db_path)
    idx = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    for expected in (
        "idx_alias_lookup", "idx_alias_entity", "idx_vendor_symbol_lookup",
        "idx_figi_composite", "idx_relation_entity", "idx_events_entity",
    ):
        assert expected in idx, f"missing index {expected}"


def test_init_db_is_idempotent(db_path):
    """Calling init_db() twice must not raise, duplicate tables, or lose rows
    already written — the "safe to call on every process boot" contract."""
    conn = schema.init_db(db_path=db_path)
    now = "2026-09-02T00:00:00Z"
    conn.execute(
        "INSERT INTO entities(entity_id, entity_type, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        ("ent_TEST0000000000000000000", "equity", now, now),
    )
    conn.commit()

    conn2 = schema.init_db(db_path=db_path)  # re-run against the same file
    row = conn2.execute(
        "SELECT entity_id FROM entities WHERE entity_id = ?",
        ("ent_TEST0000000000000000000",),
    ).fetchone()
    assert row is not None, "re-running init_db() destroyed existing data"
    assert conn2.execute("SELECT COUNT(*) FROM entities").fetchone()[0] == 1


def test_migrations_ledger_starts_empty_and_records_future_migrations(db_path):
    conn = schema.init_db(db_path=db_path)
    # No migrations defined yet at schema introduction.
    assert conn.execute("SELECT COUNT(*) FROM _migrations").fetchone()[0] == 0

    # Simulate one future migration being added and applied, mirroring
    # bars_sqlite.py's (name, sql) tuple pattern — verifies the ledger
    # mechanism itself (not a real migration) without editing schema.py.
    name, sql = "checkpoint1_smoke_migration", "SELECT 1"
    already = conn.execute(
        "SELECT 1 FROM _migrations WHERE name=?", (name,)
    ).fetchone()
    assert not already
    conn.execute(sql)
    conn.execute(
        "INSERT INTO _migrations(name, applied_at) VALUES (?, ?)", (name, 0)
    )
    conn.commit()

    # Re-init must not re-apply (would violate the PRIMARY KEY on `name`).
    conn2 = schema.init_db(db_path=db_path)
    count = conn2.execute(
        "SELECT COUNT(*) FROM _migrations WHERE name=?", (name,)
    ).fetchone()[0]
    assert count == 1


def test_entity_relations_check_constraints(db_path):
    conn = schema.init_db(db_path=db_path)
    now = "2026-09-02T00:00:00Z"
    conn.executemany(
        "INSERT INTO entities(entity_id, entity_type, created_at, updated_at) VALUES (?,?,?,?)",
        [("ent_A", "equity", now, now), ("ent_B", "equity", now, now)],
    )
    conn.commit()

    # Valid relation kind + distinct entities: succeeds.
    conn.execute(
        "INSERT INTO entity_relations(entity_id, related_entity_id, kind, valid_from, source, created_at) "
        "VALUES (?,?,?,?,?,?)",
        ("ent_A", "ent_B", "share_class", "2026-01-01", "seed:test", now),
    )
    conn.commit()

    # Invalid kind: rejected by the CHECK constraint.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO entity_relations(entity_id, related_entity_id, kind, valid_from, source, created_at) "
            "VALUES (?,?,?,?,?,?)",
            ("ent_A", "ent_B", "bogus_kind", "2026-01-01", "seed:test", now),
        )

    # Self-relation: rejected by the CHECK constraint.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO entity_relations(entity_id, related_entity_id, kind, valid_from, source, created_at) "
            "VALUES (?,?,?,?,?,?)",
            ("ent_A", "ent_A", "successor", "2026-01-01", "seed:test", now),
        )


def test_entity_events_dedup_key_is_unique(db_path):
    conn = schema.init_db(db_path=db_path)
    now = "2026-09-02T00:00:00Z"
    conn.execute(
        "INSERT INTO entity_events(dedup_key, event_type, payload_json, source, applied_at) "
        "VALUES (?,?,?,?,?)",
        ("dedup-1", "new_entity", "{}", "admin_manual", now),
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO entity_events(dedup_key, event_type, payload_json, source, applied_at) "
            "VALUES (?,?,?,?,?)",
            ("dedup-1", "new_entity", "{}", "admin_manual", now),
        )


def test_init_db_never_touches_a_different_file(tmp_path):
    """A rollback/no-op sanity check: pointing init_db() at path A must never
    create or write path B."""
    a = str(tmp_path / "a.db")
    b = str(tmp_path / "b.db")
    schema.init_db(db_path=a)
    import os
    assert os.path.exists(a)
    assert not os.path.exists(b)
