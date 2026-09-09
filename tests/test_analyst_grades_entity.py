"""S3 vertical slice for the canonical Analyst Ratings composer
(owner authorization, 2026-09-03, dedicated Analyst Ratings slice):
`analyst_grades.get_analyst_grades` resolves through Entity Master and
routes D1's FMP calls through the resolved vendor symbol. Real Entity
Master, isolated DB per test -- same pattern as
tests/test_research_estimates.py::TestEntityResolution before this
exact BRK-B/BRK.B case moved here (estimates.py has no FMP leg left to
route a vendor symbol into after the 2026-09-03 narrowing)."""
import pytest

from api.services import analyst_grades as ag
from api.services import fmp_client
from api.services import provider_errors as pe
from api.services.cache import cache
from api.services.entity_master import schema, store
from api.services.entity_master import api as em_api


def _empty_result(*_a, **_kw):
    return pe.ProviderResult(
        value=[],
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R",
    )


@pytest.fixture(autouse=True)
def _isolated_entity_master(tmp_path, monkeypatch):
    db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(schema, "DB_PATH", db_path)
    store._local.conns = {}
    store._ALIAS_CACHE.clear()
    store._CACHE_LOADED = False
    schema.init_db(db_path=db_path)
    yield
    store._local.conns = {}
    store._ALIAS_CACHE.clear()
    store._CACHE_LOADED = False
    cache.invalidate("analyst_grades_UNSEEDED")
    cache.invalidate("analyst_grades_BRK-B")


def _no_fmp_calls(monkeypatch):
    """Every FMP leg answers empty by default -- individual tests override
    the ones they care about."""
    for attr in ("get_grades_consensus", "get_price_target_consensus",
                "get_price_target_summary", "get_analyst_grades",
                "get_grades_historical"):
        monkeypatch.setattr(fmp_client, attr, _empty_result)
    monkeypatch.setattr(ag, "cache", cache)


def test_entity_resolves_for_a_known_alias(monkeypatch):
    eid = em_api.apply_event(
        "new_entity", {"entity_type": "equity", "initial_alias": "UNSEEDED",
                      "initial_alias_valid_from": "2020-01-01"},
        dedup_key="test:unseeded", source="admin_manual",
    ).entity_id
    _no_fmp_calls(monkeypatch)
    monkeypatch.setattr(ag, "_consensus", lambda t: {"label": "Buy", "total": 1})
    out = ag.get_analyst_grades("unseeded")
    assert out["entity"] == {"status": "resolved", "entityId": eid}


def test_an_unresolved_symbol_still_serves_data(monkeypatch):
    _no_fmp_calls(monkeypatch)
    monkeypatch.setattr(ag, "_consensus", lambda t: {"label": "Buy", "total": 1})
    out = ag.get_analyst_grades("NOBODYKNOWSTHIS")
    assert out["entity"] == {"status": "not_found", "entityId": None}
    assert out["consensus"]["label"] == "Buy"   # the rest of the page still works


def test_the_resolved_vendor_symbol_is_what_reaches_d1(monkeypatch):
    """The exact BRK-B/BRK.B case: the route param and the symbol D1 is
    actually called with must differ, on purpose, when Entity Master has a
    real vendor mapping."""
    eid = em_api.apply_event(
        "new_entity", {"entity_type": "equity", "initial_alias": "BRK-B",
                      "initial_alias_valid_from": "2020-01-01"},
        dedup_key="test:brkb", source="admin_manual",
    ).entity_id
    em_api.set_vendor_symbol(eid, "fmp", "BRK.B", "2020-01-01", source="admin_manual")

    seen = {}

    def _spy_consensus(ticker, **kw):
        seen["ticker"] = ticker
        return pe.ProviderResult(
            value=[{"strongBuy": 1, "buy": 0, "hold": 0, "sell": 0, "strongSell": 0, "consensus": "Buy"}],
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
            licensing_class="R",
        )

    monkeypatch.setattr(fmp_client, "get_grades_consensus", _spy_consensus)
    monkeypatch.setattr(fmp_client, "get_price_target_consensus", _empty_result)
    monkeypatch.setattr(fmp_client, "get_price_target_summary", _empty_result)
    monkeypatch.setattr(fmp_client, "get_analyst_grades", _empty_result)
    monkeypatch.setattr(fmp_client, "get_grades_historical", _empty_result)
    monkeypatch.setattr(ag, "cache", cache)

    out = ag.get_analyst_grades("BRK-B")
    assert seen["ticker"] == "BRK.B"          # D1 called with the VENDOR symbol
    assert out["symbol"] == "BRK-B"           # the payload still shows the route's own symbol
    assert out["entity"]["status"] == "resolved"
