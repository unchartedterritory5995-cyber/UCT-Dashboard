"""get_daily_agg: unadjusted, OCC-safe daily bars (stocks + options, same endpoint)."""

from api.services import massive


def test_get_daily_agg_builds_unadjusted_url_and_passes_occ_verbatim(monkeypatch):
    captured = {}

    class _Client:
        _api_key = "k"

        def _get(self, url):
            captured["url"] = url
            return {"results": [{"t": 1, "c": 36.82}]}

    monkeypatch.setattr(massive, "_get_client", lambda: _Client())

    out = massive.get_daily_agg("O:AAPL260116C00200000", "2025-09-02", "2025-12-01",
                                adjusted=False, map_symbol=False)
    assert out == [{"t": 1, "c": 36.82}]
    assert "/v2/aggs/ticker/O:AAPL260116C00200000/range/1/day/2025-09-02/2025-12-01" in captured["url"]
    assert "adjusted=false" in captured["url"]


def test_get_daily_agg_maps_equity_symbol_when_requested(monkeypatch):
    captured = {}

    class _Client:
        _api_key = "k"

        def _get(self, url):
            captured["url"] = url
            return {"results": []}

    monkeypatch.setattr(massive, "_get_client", lambda: _Client())
    massive.get_daily_agg("BRK-B", "2025-01-01", "2025-02-01", adjusted=False, map_symbol=True)
    # to_polygon_symbol maps BRK-B → BRK.B at the Massive boundary.
    assert "/v2/aggs/ticker/BRK.B/range/1/day/" in captured["url"]
