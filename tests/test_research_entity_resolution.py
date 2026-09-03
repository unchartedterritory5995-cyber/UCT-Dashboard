"""S3 (Entity Master) resolution shared helper for the research page's tabs.

Vertical slice (owner authorization, 2026-09-03): `route symbol -> canonical
entity -> capability request -> D1 -> provider`. Real Entity Master, real
write API, isolated DB per test -- same fixture pattern as
`test_ticker_search_entity_master_integration.py` (Checkpoint 6), so this
never touches the real entity_master.db or leaks state between tests.
"""
import pytest

from api.services.entity_master import schema, store
from api.services.entity_master import api as em_api
from api.services.research.entity_resolution import resolve_entity


@pytest.fixture(autouse=True)
def _isolated_entity_master(tmp_path, monkeypatch):
    db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(schema, "DB_PATH", db_path)
    store._local.conns = {}
    store._ALIAS_CACHE.clear()
    store._CACHE_LOADED = False
    schema.init_db(db_path=db_path)
    yield db_path
    store._local.conns = {}
    store._ALIAS_CACHE.clear()
    store._CACHE_LOADED = False


def _seed(alias, entity_type="equity", valid_from="2020-01-01"):
    r = em_api.apply_event(
        "new_entity",
        {"entity_type": entity_type, "initial_alias": alias, "initial_alias_valid_from": valid_from},
        dedup_key=f"test:{alias}", source="admin_manual",
    )
    assert r.accepted
    return r.entity_id


def test_resolved_entity_with_no_vendor_mapping_falls_back_to_the_raw_symbol():
    eid = _seed("NVDA")
    entity, effective = resolve_entity("nvda", vendor="fmp")
    assert entity == {"status": "resolved", "entityId": eid}
    # No vendor_symbol row exists yet for this entity -- a valid, common
    # outcome (Entity Master's coverage is new/partial), not an error.
    assert effective == "NVDA"


def test_unknown_symbol_does_not_block_resolution_reporting():
    entity, effective = resolve_entity("ZZZNOTREAL", vendor="fmp")
    assert entity == {"status": "not_found", "entityId": None}
    # The raw symbol is still handed back so the caller's own fetch proceeds
    # unchanged -- Entity Master not knowing a ticker must not stop the page
    # from working for it.
    assert effective == "ZZZNOTREAL"


def test_brk_b_style_symbol_normalization_via_a_real_vendor_symbol_mapping():
    """The exact case the authorization named: a class-share ticker whose
    vendor-native spelling differs from the route param. Not simulated --
    seeded through Entity Master's own real write API
    (`set_vendor_symbol`), then resolved through the real read path."""
    eid = _seed("BRK-B", entity_type="equity")
    r = em_api.set_vendor_symbol(eid, "fmp", "BRK.B", "2020-01-01", source="admin_manual")
    assert r.written and not r.conflict

    entity, effective = resolve_entity("BRK-B", vendor="fmp")
    assert entity == {"status": "resolved", "entityId": eid}
    assert effective == "BRK.B"


def test_a_vendor_with_no_mapping_at_all_is_not_asked_for():
    """No `vendor=` kwarg -> no vendor_symbol lookup attempted; the
    financials.py caller (which doesn't route through D1 yet this pass)
    exercises exactly this path."""
    eid = _seed("MSFT")
    entity, effective = resolve_entity("msft")
    assert entity == {"status": "resolved", "entityId": eid}
    assert effective == "MSFT"


def test_ambiguous_resolution_is_reported_honestly_and_still_does_not_block(monkeypatch):
    """Entity Master's own ambiguity-triggering conditions are its own
    architecture (not reopened here) -- this exercises resolve_entity()'s
    handling of that outcome via a synthetic ResolveResult, matching the
    real return shape `entity_master.api.resolve` documents."""
    from api.services.entity_master import api as em_api_module

    def _fake_resolve(alias, as_of=None, *, db_path=None):
        return em_api_module.ResolveResult(status="ambiguous", entity=None, candidates=("e1", "e2"))

    monkeypatch.setattr(em_api_module, "resolve", _fake_resolve)
    entity, effective = resolve_entity("DUP", vendor="fmp")
    assert entity == {"status": "ambiguous", "entityId": None}
    assert effective == "DUP"


def test_a_raising_resolve_never_propagates(monkeypatch):
    """Defense-in-depth: even if entity_master.api.resolve's own
    'never raises' contract were ever violated, this caller must not 500 a
    member-facing page over an identity lookup."""
    from api.services.entity_master import api as em_api_module

    def _boom(alias, as_of=None, *, db_path=None):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(em_api_module, "resolve", _boom)
    entity, effective = resolve_entity("AAPL", vendor="fmp")
    assert entity == {"status": "not_found", "entityId": None}
    assert effective == "AAPL"
