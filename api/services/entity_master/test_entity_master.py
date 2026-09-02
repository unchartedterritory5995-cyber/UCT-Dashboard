"""Entity Master test suite — colocated with its service (matches this
codebase's `api/services/test_grade_ticker.py` precedent, per
entity-master-spec.md §12).

Every fixture is synthetic. No test touches `cap_universe.json`, `C:\\data`,
or any production file — every database used here is created fresh under
pytest's `tmp_path`, never at the real `entity_master.db` / `DATA_DIR` path.

Checkpoints 1 (Schema) and 2 (Read primitives). Write-path tests (AC-3, AC-5)
are added in Checkpoint 3 once `apply_event` exists.
"""
import sqlite3

import pytest

from api.services.entity_master import api as em_api
from api.services.entity_master import schema
from api.services.entity_master import store


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


# ─── Checkpoint 2 — Read primitives ────────────────────────────────────────
# Fixtures are seeded directly at the SQLite layer (apply_event does not
# exist until Checkpoint 3) — the same approach entity-master-spec.md §12
# specifies for AC-6 explicitly, and used here for every read-primitive test
# so Checkpoint 2 is independently testable/reviewable without Checkpoint 3.

_NOW = "2026-09-02T00:00:00Z"


def _seed_entity(conn, entity_id, entity_type="equity", lifecycle_state="active", lifecycle_since=None):
    conn.execute(
        "INSERT INTO entities(entity_id, entity_type, lifecycle_state, lifecycle_since, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?)",
        (entity_id, entity_type, lifecycle_state, lifecycle_since, _NOW, _NOW),
    )


def _seed_alias(conn, entity_id, alias, valid_from, valid_to=None, source="seed:test"):
    conn.execute(
        "INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (entity_id, alias, valid_from, valid_to, source, _NOW),
    )


def test_cold_start_returns_not_found_never_raises(db_path):
    """AC-7: against a freshly-created, empty database, every primitive
    returns its documented empty outcome, never an exception."""
    schema.init_db(db_path=db_path)
    r = em_api.resolve("NVDA", db_path=db_path)
    assert r.status == "not_found"
    assert em_api.aliases("ent_NOPE", db_path=db_path) == []
    assert em_api.vendor_symbol("ent_NOPE", "massive", db_path=db_path) is None
    assert em_api.related_to("ent_NOPE", "share_class", db_path=db_path) == []


def test_rename_resolves_correctly(db_path):
    """AC-1: a renamed entity's OLD alias resolves before the cutover, its
    NEW alias resolves after, and each is the same underlying entity."""
    conn = schema.init_db(db_path=db_path)
    _seed_entity(conn, "ent_SQ_BLOCK")
    _seed_alias(conn, "ent_SQ_BLOCK", "SQ", "2015-11-19", "2021-12-10")
    _seed_alias(conn, "ent_SQ_BLOCK", "XYZ", "2021-12-10", None)
    conn.commit()
    store.rebuild_cache(db_path=db_path)

    before = em_api.resolve("SQ", as_of="2020-01-01", db_path=db_path)
    assert before.status == "resolved"
    assert before.entity.entity_id == "ent_SQ_BLOCK"

    after_old = em_api.resolve("SQ", as_of="2022-01-01", db_path=db_path)
    assert after_old.status == "not_found"

    now = em_api.resolve("XYZ", db_path=db_path)  # as_of=None -> currently open
    assert now.status == "resolved"
    assert now.entity.entity_id == "ent_SQ_BLOCK"


def test_delisting_marks_never_erases(db_path):
    """AC-2: a delisted entity's historical resolve still works and
    aliases() never drops the closed row."""
    conn = schema.init_db(db_path=db_path)
    _seed_entity(conn, "ent_LEH", lifecycle_state="delisted", lifecycle_since="2008-09-15")
    _seed_alias(conn, "ent_LEH", "LEH", "1994-01-01", "2008-09-15")
    conn.commit()
    store.rebuild_cache(db_path=db_path)

    historical = em_api.resolve("LEH", as_of="2005-01-01", db_path=db_path)
    assert historical.status == "resolved"
    assert historical.entity.lifecycle_state == "delisted"

    full_roster = em_api.aliases("ent_LEH", db_path=db_path)
    assert len(full_roster) == 1
    assert full_roster[0].alias == "LEH"
    assert full_roster[0].valid_to == "2008-09-15"

    current = em_api.resolve("LEH", db_path=db_path)  # as_of=None -> now
    assert current.status == "not_found"  # closed, no longer open


def test_ambiguous_is_distinguishable_and_logged(db_path):
    """AC-6: two entities holding the same alias open at once (constructed
    by seeding directly, bypassing apply_event's write-time guard, exactly
    as the spec names for this test) resolves as "ambiguous", distinct from
    both a clean resolve and a NotFound."""
    conn = schema.init_db(db_path=db_path)
    _seed_entity(conn, "ent_ONE")
    _seed_entity(conn, "ent_TWO")
    _seed_alias(conn, "ent_ONE", "DUPE", "2020-01-01", None)
    _seed_alias(conn, "ent_TWO", "DUPE", "2021-01-01", None)
    conn.commit()
    store.rebuild_cache(db_path=db_path)

    r = em_api.resolve("DUPE", db_path=db_path)
    assert r.status == "ambiguous"
    assert set(r.candidates) == {"ent_ONE", "ent_TWO"}
    assert r.entity is None


def test_as_of_consistency_across_primitives(db_path):
    """AC-8: one bitemporal fixture; resolve/aliases/vendor_symbol/
    related_to all agree at two named points in time."""
    conn = schema.init_db(db_path=db_path)
    _seed_entity(conn, "ent_GOOG")
    _seed_entity(conn, "ent_GOOGL")
    _seed_alias(conn, "ent_GOOG", "GOOG", "2004-08-19", None)
    _seed_alias(conn, "ent_GOOGL", "GOOGL", "2014-04-03", None)
    conn.execute(
        "INSERT INTO entity_relations(entity_id, related_entity_id, kind, valid_from, source, created_at) "
        "VALUES (?,?,?,?,?,?)",
        ("ent_GOOG", "ent_GOOGL", "share_class", "2014-04-03", "seed:test", _NOW),
    )
    conn.execute(
        "INSERT INTO entity_vendor_symbols(entity_id, vendor, vendor_symbol, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        ("ent_GOOG", "massive", "GOOG", "2004-08-19", None, "seed:test", _NOW),
    )
    conn.commit()
    store.rebuild_cache(db_path=db_path)

    t1, t2 = "2010-01-01", "2026-01-01"
    for t in (t1, t2):
        r = em_api.resolve("GOOG", as_of=t, db_path=db_path)
        assert r.status == "resolved" and r.entity.entity_id == "ent_GOOG"
        vs = em_api.vendor_symbol("ent_GOOG", "massive", as_of=t, db_path=db_path)
        assert vs == "GOOG"
        rel = em_api.related_to("ent_GOOG", "share_class", db_path=db_path)
        assert [e.entity_id for e in rel] == ["ent_GOOGL"]

    # GOOGL didn't exist as an alias before 2014-04-03.
    pre = em_api.resolve("GOOGL", as_of="2010-01-01", db_path=db_path)
    assert pre.status == "not_found"
    post = em_api.resolve("GOOGL", as_of="2026-01-01", db_path=db_path)
    assert post.status == "resolved"


def test_vendor_symbol_returns_none_when_unmapped(db_path):
    """A vendor that has never carried this entity is a valid outcome (per
    spec §9.2), not an error — None, not an exception."""
    conn = schema.init_db(db_path=db_path)
    _seed_entity(conn, "ent_X")
    conn.commit()
    assert em_api.vendor_symbol("ent_X", "fmp", db_path=db_path) is None


def test_share_class_vs_vendor_notation(db_path):
    """§4.4's required fixture: two entities (GOOG/GOOGL) linked
    share_class, plus one BRK-B entity with a derived massive->BRK.B vendor
    row — related_to and vendor_symbol must not conflate the two cases."""
    conn = schema.init_db(db_path=db_path)
    _seed_entity(conn, "ent_GOOG")
    _seed_entity(conn, "ent_GOOGL")
    _seed_entity(conn, "ent_BRKB")
    _seed_alias(conn, "ent_GOOG", "GOOG", "2004-08-19", None)
    _seed_alias(conn, "ent_GOOGL", "GOOGL", "2014-04-03", None)
    _seed_alias(conn, "ent_BRKB", "BRK-B", "1996-05-09", None)
    conn.execute(
        "INSERT INTO entity_relations(entity_id, related_entity_id, kind, valid_from, source, created_at) "
        "VALUES (?,?,?,?,?,?)",
        ("ent_GOOG", "ent_GOOGL", "share_class", "2014-04-03", "seed:test", _NOW),
    )
    conn.execute(
        "INSERT INTO entity_vendor_symbols(entity_id, vendor, vendor_symbol, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        ("ent_BRKB", "massive", "BRK.B", "1996-05-09", None, "seed:test", _NOW),
    )
    conn.commit()
    store.rebuild_cache(db_path=db_path)

    # GOOG/GOOGL: two entities, related, each with its OWN alias (no vendor row needed).
    rel = em_api.related_to("ent_GOOG", "share_class", db_path=db_path)
    assert [e.entity_id for e in rel] == ["ent_GOOGL"]
    assert em_api.vendor_symbol("ent_GOOG", "massive", db_path=db_path) is None

    # BRK-B: ONE entity, one canonical alias, a vendor-notation row (not a relation).
    assert em_api.related_to("ent_BRKB", "share_class", db_path=db_path) == []
    assert em_api.vendor_symbol("ent_BRKB", "massive", db_path=db_path) == "BRK.B"
    from api.services.massive import to_polygon_symbol
    assert em_api.vendor_symbol("ent_BRKB", "massive", db_path=db_path) == to_polygon_symbol("BRK-B")


def test_ac10_existing_consumers_unaffected():
    """AC-10: importing and calling the existing ticker-identity-adjacent
    modules behaves exactly as before Entity Master's package existed — a
    smoke check that S3's mere presence changes nothing about them."""
    from api.services import cap_universe, delisted_registry
    from api.services.massive import to_polygon_symbol

    assert to_polygon_symbol("BRK-B") == "BRK.B"
    assert to_polygon_symbol("AAPL") == "AAPL"
    assert isinstance(cap_universe.symbols(), frozenset)
    assert delisted_registry.resolve("__DEFINITELY_NOT_A_REAL_TICKER__") is None


def test_ac9_no_cusip_shaped_identifier():
    """AC-9: static check — no column name or generated id shape references
    a CUSIP, anywhere in this package's source."""
    import re
    from pathlib import Path

    pkg_dir = Path(__file__).parent
    hits = []
    for f in pkg_dir.glob("*.py"):
        if f.name == "test_entity_master.py":
            continue
        text = f.read_text(encoding="utf-8")
        if re.search(r"cusip", text, re.IGNORECASE):
            hits.append(f.name)
    assert not hits, f"CUSIP-shaped reference found in: {hits}"
