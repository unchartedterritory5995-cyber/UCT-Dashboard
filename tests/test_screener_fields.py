"""GET /api/screener/fields — the filter registry without meta()'s measurements."""
from api.services.screener import filters


def test_the_catalog_is_the_registry_itself():
    cat = {f["key"]: f for f in filters.field_catalog()}
    assert set(cat) == {k for k in filters.FILTERS if k not in filters.RETIRED}
    assert cat["adr_pct"] == {"key": "adr_pct", "label": "ADR %", "type": "range", "unit": "%", "category": "technical"}
    assert cat["price"]["unit"] == "$" and cat["chg_pct_1m"]["label"] == "Change 1M"
    assert not set(filters.RETIRED) & set(cat)


def test_the_catalog_measures_nothing(monkeypatch):
    from api.services.screener import distribution
    monkeypatch.setattr(distribution, "distributions", lambda: (_ for _ in ()).throw(AssertionError("measured")))
    monkeypatch.setattr(filters, "_distinct_options", lambda *a, **k: (_ for _ in ()).throw(AssertionError("queried")))
    assert len(filters.field_catalog()) > 100


def test_the_route_is_paid_like_every_screener_route():
    from api.routers import screener
    route = next(r for r in screener.router.routes if getattr(r, "path", "") == "/api/screener/fields")
    deps = [d.call.__name__ for d in route.dependant.dependencies]
    assert "require_paid" in deps
