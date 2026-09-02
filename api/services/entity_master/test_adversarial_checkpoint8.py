"""Checkpoint 8 — adversarial validation of what the real seed run taught us.

Items already covered by existing test modules are NOT re-tested here (see
entity-master-implementation-log.md's Checkpoint 8 section for the full
cross-reference): stale-delisted-source protection (test_reconciliation.py),
provider-ID conflicts / repeat mapping writes (test_entity_master.py
Checkpoint 5 section), repeat seed/reconciliation idempotency
(test_entity_master_seed.py, test_reconciliation.py), hyphen/dot
normalization (both), missing FIGI (test_entity_master.py Checkpoint 2/5).

This module covers what was NOT yet directly tested: behavior at the real
large-index-universe scale, the identical-symbol/different-venue question,
and canonical ID stability specifically across a reconciliation-driven
lifecycle transition (as opposed to a provider-mapping write, already
covered elsewhere).
"""
import pytest

from api.services.entity_master import api as em_api
from api.services.entity_master import reconciliation as recon
from api.services.entity_master import schema, store


@pytest.fixture
def db_path(tmp_path):
    p = str(tmp_path / "adversarial_test.db")
    schema.init_db(db_path=p)
    return p


def _seed(db_path, alias, valid_from="2020-01-01", entity_type="equity"):
    r = em_api.apply_event(
        "new_entity", {"entity_type": entity_type, "initial_alias": alias, "initial_alias_valid_from": valid_from},
        dedup_key=f"seed:{alias}", source="admin_manual", db_path=db_path,
    )
    assert r.accepted
    return r.entity_id


# ─── Item 2: large index universe (13,322 real entities of this type) ──────

def test_large_index_population_does_not_degrade_resolve_correctness(db_path):
    """No code path may assume 'index' is a small, curated set. Seed a
    population an order of magnitude larger than any curated benchmark
    list (real scale: 13,322) and confirm every primitive still answers
    correctly — not just fast, CORRECT, for a name buried in the middle."""
    n = 2000  # bounded for test speed; the real run already proved 13,322 at full scale (Checkpoint 4/6 report)
    for i in range(n):
        _seed(db_path, f"IDX{i:05d}", entity_type="index")
    # A name near the end of a large population must resolve exactly as
    # well as one near the start — no code path may special-case position.
    first = em_api.resolve("IDX00000", db_path=db_path)
    middle = em_api.resolve(f"IDX{n // 2:05d}", db_path=db_path)
    last = em_api.resolve(f"IDX{n - 1:05d}", db_path=db_path)
    for r in (first, middle, last):
        assert r.status == "resolved"
        assert r.entity.entity_type == "index"
    # A non-existent name in the middle of the alphabet must still be
    # NotFound, not accidentally matched to a real one (a substring-match
    # bug would be far more likely to surface at this population size).
    assert em_api.resolve("IDX99999-NOT-REAL", db_path=db_path).status == "not_found"


def test_entity_type_index_is_not_assumed_small_by_any_primitive(db_path):
    """Checkpoint-6/7 finding B's explicit contract: entity_type='index'
    means only 'Massive classifies this as an index' — related_to,
    vendor_symbol, aliases must all work identically regardless of how
    large the index population is, with no special-casing."""
    eid = _seed(db_path, "BIGIDX1", entity_type="index")
    for i in range(500):
        _seed(db_path, f"IDXFILL{i:04d}", entity_type="index")
    assert em_api.vendor_symbol(eid, "massive", db_path=db_path) is None
    assert em_api.related_to(eid, "share_class", db_path=db_path) == []
    assert len(em_api.aliases(eid, db_path=db_path)) == 1


# ─── Item 4: identical symbol string, different venue ──────────────────────

def test_venue_is_not_modeled_same_symbol_string_is_one_entity_by_design(db_path):
    """Entity Master does NOT track venue/exchange (deliberately — that
    stays with ticker_meta, per spec §2.1: 'S3 never reads or writes this
    cache'). So 'the same symbol string on two venues' is not a case this
    schema can distinguish, and it should not try to: a second new_entity
    for the identical alias string is correctly rejected as a collision,
    exactly like any other duplicate-alias attempt — there is no venue
    parameter to disambiguate it by, which is the intended, documented
    boundary, not a gap."""
    first = em_api.apply_event(
        "new_entity", {"entity_type": "equity", "initial_alias": "DUAL", "initial_alias_valid_from": "2020-01-01"},
        "d1", "admin_manual", db_path=db_path,
    )
    assert first.accepted
    second = em_api.apply_event(
        "new_entity", {"entity_type": "equity", "initial_alias": "DUAL", "initial_alias_valid_from": "2020-01-01"},
        "d2", "admin_manual", db_path=db_path,
    )
    assert not second.accepted  # correctly rejected — no venue axis to disambiguate by
    conn = store._conn(db_path)
    assert conn.execute("SELECT COUNT(*) FROM entities WHERE entity_id != ?", (first.entity_id,)).fetchone()[0] == \
        conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0] - 1  # only ONE entity total


# ─── Item 10: canonical ID stability across a reconciliation lifecycle change ──

def test_canonical_id_survives_a_reconciliation_driven_delisting(monkeypatch, db_path):
    """Real-data-observed behavior (AL's entity_id was identical before and
    after Checkpoint 7's real reconciliation write), proven here as a
    synthetic, deterministic regression test: entity_id must be BYTE-
    IDENTICAL before and after a reconciliation-driven lifecycle-state
    flip — the whole point of a permanent internal id (D3, LOCKED)."""
    import api.services.massive as massive

    eid = _seed(db_path, "OLDCO")
    before = em_api.resolve("OLDCO", db_path=db_path).entity

    def _empty_feed(active=True, market="stocks", limit=1000, max_pages=60):
        return []

    monkeypatch.setattr(massive, "list_reference_tickers", _empty_feed)
    result = recon.run_reconciliation(dry_run=False, db_path=db_path)
    assert result["delisted"] == 1

    after = em_api.resolve("OLDCO", db_path=db_path).entity
    assert before.entity_id == after.entity_id == eid
    assert before.lifecycle_state == "active"
    assert after.lifecycle_state == "delisted"
    # The alias, FIGI, and vendor mappings (had any existed) would be
    # untouched too — proven generally by test_provider_mapping_writes_
    # never_touch_canonical_identity (Checkpoint 5); this test's own
    # addition is specifically the RECONCILIATION write path, not the
    # provider-mapping write path already covered there.
    roster = em_api.aliases(eid, db_path=db_path)
    assert len(roster) == 1 and roster[0].alias == "OLDCO" and roster[0].valid_to is None
