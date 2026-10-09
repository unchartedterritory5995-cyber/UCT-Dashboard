"""Wave 4 lane C: the cached theme-performance base must never be changed by serving it.

`_apply_live_returns` hands back the base itself when the live map comes back empty, and
reuses base holding rows that have no live price. `_enrich_with_taxonomy`, `_strip_delisted`
and the `live_as_of` stamp then wrote into those objects, so one empty live poll left the
cached base carrying enrichment keys, appended taxonomy members and a stamp, which every
later overlay of that same cached object inherited."""
from __future__ import annotations

import copy

import pytest

from api.services import theme_performance as tp


_BASE = {
    "generated_at": "2026-10-08T20:00:00+00:00",
    "themes": [
        {
            "name": "Semis",
            "ticker": "SEMI",
            "holdings": [
                {"sym": "AAA", "returns": {"1d": 1.0}, "ref_prices": {"1d": 10.0}},
                {"sym": "BBB", "returns": {"1d": -0.5}, "ref_prices": {"1d": 20.0}},
            ],
        }
    ],
}

_TAXONOMY = {
    "sectors": [{"id": "tech", "name": "Technology"}],
    "themes": [{
        "id": "SEMI", "name": "Semis", "etf_ticker": None, "sector_id": "tech",
        "sub_themes": [],
        "holdings": [
            {"sym": "AAA", "tier": "core", "source": "owner"},
            {"sym": "BBB", "tier": "relevant", "source": "owner"},
            {"sym": "CCC", "tier": "relevant", "source": "owner"},   # not in the wire base
        ],
    }],
}


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    monkeypatch.setattr(tp.theme_db, "get_all_themes", lambda: copy.deepcopy(_TAXONOMY))
    monkeypatch.setattr(tp.delisted_registry, "is_delisted", lambda s: False)
    monkeypatch.setattr(tp, "set_by_completeness", lambda *a, **k: None)


def test_an_overlay_with_empty_live_data_leaves_the_cached_base_unchanged(monkeypatch):
    monkeypatch.setattr(tp, "_fetch_live_maps", lambda syms: ({}, {}))
    base = copy.deepcopy(_BASE)

    out, complete = tp._overlay_and_memoize(base)

    assert complete is False                      # an empty live map is not complete
    assert base == _BASE                          # the cached object is exactly as cached
    assert "live_as_of" not in base
    # ...while the served payload still carries the enrichment.
    assert out["themes"][0]["sector"] == "Technology"
    assert [h["sym"] for h in out["themes"][0]["holdings"]] == ["AAA", "BBB", "CCC"]
    assert "live_as_of" in out


def test_a_partial_live_map_does_not_write_into_base_holding_rows(monkeypatch):
    # AAA has a live print, BBB does not: BBB's base row is reused by the overlay.
    monkeypatch.setattr(tp, "_fetch_live_maps", lambda syms: ({"AAA": 2.0}, {}))
    base = copy.deepcopy(_BASE)

    out, complete = tp._overlay_and_memoize(base)

    assert complete is True
    assert base == _BASE
    bbb = next(h for h in out["themes"][0]["holdings"] if h["sym"] == "BBB")
    assert bbb["tier"] == "relevant"              # enrichment landed on the served copy


def test_repeated_empty_overlays_are_identical(monkeypatch):
    monkeypatch.setattr(tp, "_fetch_live_maps", lambda syms: ({}, {}))
    base = copy.deepcopy(_BASE)
    first, _ = tp._overlay_and_memoize(base)
    second, _ = tp._overlay_and_memoize(base)
    first.pop("live_as_of"), second.pop("live_as_of")
    assert first == second
