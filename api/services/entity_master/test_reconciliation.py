"""Checkpoint 7 — Reconciliation job tests. Every fixture is synthetic
(monkeypatched `massive.list_reference_tickers`); no network call, no real
`delisted_registry`/`cap_universe` data. The rename-exclusion boundary and
the "never reads delisted_registry" guarantee are both tested directly,
not just asserted in a docstring.
"""
import ast
import inspect

import pytest

from api.services.entity_master import api as em_api
from api.services.entity_master import reconciliation as recon
from api.services.entity_master import schema, store


@pytest.fixture
def db_path(tmp_path):
    p = str(tmp_path / "recon_test.db")
    schema.init_db(db_path=p)
    return p


def _patch_live(monkeypatch, *, stocks=(), indices=()):
    import api.services.massive as massive

    def _fake(active=True, market="stocks", limit=1000, max_pages=60):
        return list(stocks) if market == "stocks" else list(indices)

    monkeypatch.setattr(massive, "list_reference_tickers", _fake)


def _seed(db_path, alias, valid_from="2020-01-01", entity_type="equity"):
    r = em_api.apply_event(
        "new_entity", {"entity_type": entity_type, "initial_alias": alias, "initial_alias_valid_from": valid_from},
        dedup_key=f"seed:{alias}", source="admin_manual", db_path=db_path,
    )
    assert r.accepted
    return r.entity_id


def test_never_imports_delisted_registry():
    """Checkpoint 7 requirement: structurally immune to Finding A's stale
    123 records — because delisted_registry is never in this module's
    input set at all, not because of an added guard. AST-based (not a
    grep over the whole source, which would false-positive on this
    module's own explanatory docstring/comments naming delisted_registry
    to describe what it does NOT do)."""
    src = inspect.getsource(recon)
    tree = ast.parse(src)
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_names.add(node.module)
            imported_names.update(alias.name for alias in node.names)
    assert not any("delisted_registry" in name for name in imported_names), imported_names
    # No import statement means no way to call it — Python has no implicit
    # global access to an unimported module, so this alone is a complete
    # structural proof, not merely evidence.


def test_dry_run_proposes_new_listing_and_writes_nothing(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[{"ticker": "NVDA", "type": "CS", "name": "NVIDIA"}])
    result = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert result["dry_run"] is True
    assert [c["symbol"] for c in result["proposed_creates"]] == ["NVDA"]
    assert result["proposed_delists"] == []
    conn = store._conn(db_path)
    assert conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0] == 0  # nothing written


def test_dry_run_proposes_delisting_for_active_entity_no_longer_live(monkeypatch, db_path):
    eid = _seed(db_path, "OLDCO")
    _patch_live(monkeypatch, stocks=[])  # OLDCO no longer in the live feed
    result = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert result["proposed_creates"] == []
    assert [d["symbol"] for d in result["proposed_delists"]] == ["OLDCO"]
    assert result["proposed_delists"][0]["entity_id"] == eid


def test_already_delisted_entity_not_re_proposed(monkeypatch, db_path):
    """An entity already lifecycle_state='delisted' (its alias intentionally
    stays open per this job's own "resolved but delisted" design) must not
    be proposed for delisting again."""
    eid = _seed(db_path, "OLDCO")
    em_api.apply_event(
        "delisted", {"entity_id": eid, "lifecycle_since": "2020-06-01"},
        "d1", "admin_manual", db_path=db_path,
    )
    _patch_live(monkeypatch, stocks=[])
    result = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert result["proposed_delists"] == []


def test_real_run_delisting_flips_lifecycle_but_keeps_alias_open(monkeypatch, db_path):
    """The delisted event payload (spec §4.3) carries no alias field —
    reconciliation must NOT close the alias. resolve(as_of=None) keeps
    finding the entity, with lifecycle_state='delisted' — 'resolved but
    delisted', not NotFound."""
    _seed(db_path, "OLDCO")
    _patch_live(monkeypatch, stocks=[])
    result = recon.run_reconciliation(dry_run=False, db_path=db_path)
    assert result["delisted"] == 1

    r = em_api.resolve("OLDCO", db_path=db_path)
    assert r.status == "resolved"
    assert r.entity.lifecycle_state == "delisted"


def test_real_run_creates_new_entity(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[{"ticker": "NVDA", "type": "CS", "name": "NVIDIA",
                                       "list_date": "1999-01-22", "composite_figi": "BBG000BBJQV0"}])
    result = recon.run_reconciliation(dry_run=False, db_path=db_path)
    assert result["created"] == 1
    r = em_api.resolve("NVDA", db_path=db_path)
    assert r.status == "resolved"
    assert r.entity.entity_type == "equity"
    conn = store._conn(db_path)
    figi = conn.execute(
        "SELECT composite_figi FROM entity_figi WHERE entity_id=?", (r.entity.entity_id,)
    ).fetchone()
    assert figi == ("BBG000BBJQV0",)


def test_rename_exclusion_boundary_never_correlates_delist_and_create(monkeypatch, db_path):
    """THE BINDING CONDITION: a symbol disappearing (OLDCO) and a DIFFERENT
    symbol appearing (NEWCO) in the SAME reconciliation pass must produce
    two completely independent proposals/entities — never inferred as one
    rename. Even if OLDCO and NEWCO are, in reality, the same underlying
    company (this job has no way to know that, and must not guess)."""
    old_eid = _seed(db_path, "OLDCO")
    _patch_live(monkeypatch, stocks=[{"ticker": "NEWCO", "type": "CS", "name": "New Co"}])

    dry = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert [c["symbol"] for c in dry["proposed_creates"]] == ["NEWCO"]
    assert [d["symbol"] for d in dry["proposed_delists"]] == ["OLDCO"]

    result = recon.run_reconciliation(dry_run=False, db_path=db_path)
    assert result["created"] == 1
    assert result["delisted"] == 1

    old = em_api.resolve("OLDCO", db_path=db_path)
    new = em_api.resolve("NEWCO", db_path=db_path)
    assert old.entity.entity_id == old_eid  # OLDCO's identity is UNCHANGED
    assert new.entity.entity_id != old_eid  # NEWCO is a genuinely NEW, separate entity
    assert old.entity.lifecycle_state == "delisted"
    assert new.entity.lifecycle_state == "active"
    # No relation of any kind was inferred between them.
    assert em_api.related_to(old_eid, "successor", db_path=db_path) == []
    assert em_api.related_to(new.entity.entity_id, "predecessor", db_path=db_path) == []


def test_stale_delisted_registry_record_cannot_affect_reconciliation(monkeypatch, db_path):
    """Direct proof of the Checkpoint-7 protection requirement: seed an
    entity that is ACTIVE and currently live, install a delisted_registry
    stub that (falsely, mirroring Finding A's real 123 stale records) claims
    that same ticker is delisted, and confirm reconciliation's proposals are
    completely unaffected — because it never consults delisted_registry at
    all, confirmed by mid-test monkeypatching a version that would raise if
    ever called."""
    import api.services.delisted_registry as delisted_registry

    eid = _seed(db_path, "AL")  # mirrors the REAL Finding A case (Air Lease Corp)
    _patch_live(monkeypatch, stocks=[{"ticker": "AL", "type": "CS", "name": "Air Lease Corp"}])

    def _poison(*a, **kw):
        raise AssertionError("reconciliation must never call delisted_registry")

    monkeypatch.setattr(delisted_registry, "is_delisted", _poison)
    monkeypatch.setattr(delisted_registry, "resolve", _poison)
    monkeypatch.setattr(delisted_registry, "all_entries", _poison)

    result = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert result["proposed_delists"] == []  # AL is live; must not be proposed for delisting
    assert result["proposed_creates"] == []  # AL already has an open alias; not a "new" listing
    r = em_api.resolve("AL", db_path=db_path)
    assert r.status == "resolved" and r.entity.entity_id == eid and r.entity.lifecycle_state == "active"


def test_ambiguous_symbol_reported_not_silently_skipped_or_recreated(monkeypatch, db_path):
    conn = store._conn(db_path)
    now = "2026-09-02T00:00:00Z"
    conn.executemany(
        "INSERT INTO entities(entity_id, entity_type, created_at, updated_at) VALUES (?,?,?,?)",
        [("ent_A", "equity", now, now), ("ent_B", "equity", now, now)],
    )
    conn.executemany(
        "INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,?,?,?)",
        [("ent_A", "DUPE", "2020-01-01", "2021-01-01", "seed:test", now),  # CLOSED, so DUPE isn't "open" for ent_A
         ("ent_B", "DUPE", "2021-01-01", None, "seed:test", now)],        # open for ent_B
    )
    conn.commit()
    # DUPE has exactly one open row (ent_B) -> not actually ambiguous for a
    # live-feed diff. This test instead verifies genuinely-ambiguous input
    # (two OPEN rows for one alias) is reported, not silently resolved.
    conn.execute(
        "UPDATE entity_aliases SET valid_to = NULL WHERE entity_id='ent_A' AND alias='DUPE'"
    )
    conn.commit()
    store.rebuild_cache(db_path)

    _patch_live(monkeypatch, stocks=[{"ticker": "DUPE", "type": "CS", "name": "Ambiguous Co"}])
    result = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert result["ambiguous"] and result["ambiguous"][0]["symbol"] == "DUPE"
    assert result["proposed_creates"] == []  # never silently "fixed" by creating a third entity


def test_reconciliation_idempotent_across_repeated_passes(monkeypatch, db_path):
    _patch_live(monkeypatch, stocks=[{"ticker": "NVDA", "type": "CS", "name": "NVIDIA"}])
    r1 = recon.run_reconciliation(dry_run=False, db_path=db_path)
    assert r1["created"] == 1
    r2 = recon.run_reconciliation(dry_run=False, db_path=db_path)
    assert r2["created"] == 0  # already exists, not recreated
    conn = store._conn(db_path)
    assert conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0] == 1


def test_canonicalization_matches_seed_script(monkeypatch, db_path):
    """A class-share ticker Massive returns in dot form must reconcile onto
    the SAME canonical entity the seed script would create — never a
    second, dot-keyed duplicate. Direct regression test for the Checkpoint
    6 bug, now proven from reconciliation's side too."""
    eid = _seed(db_path, "BRK-B", "1996-05-09")
    _patch_live(monkeypatch, stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}])
    result = recon.run_reconciliation(dry_run=True, db_path=db_path)
    assert result["proposed_creates"] == []  # BRK-B already exists; BRK.B must not look "new"
    assert result["proposed_delists"] == []
