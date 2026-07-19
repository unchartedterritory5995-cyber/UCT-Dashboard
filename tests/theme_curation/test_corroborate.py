import pytest
from tools.theme_curation import corroborate as C


def test_corroborate_matches_industry(monkeypatch):
    monkeypatch.setattr(C.industry_map, "get_groups", lambda syms: {
        "NVDA": {"sector": "Technology", "industry": "Semiconductors"},
        "MSFT": {"sector": "Technology", "industry": "Software - Infrastructure"},
        "ZZZ":  {"sector": None, "industry": None},
    })
    out = C.corroborate(["NVDA", "MSFT", "ZZZ"], {"Semiconductors"})
    assert out == {"NVDA": True, "MSFT": False, "ZZZ": False}


def test_concept_theme_all_false(monkeypatch):
    monkeypatch.setattr(C.industry_map, "get_groups",
                        lambda syms: {s: {"sector": None, "industry": "X"} for s in syms})
    assert C.corroborate(["A", "B"], None) == {"A": False, "B": False}


def test_ensure_industry_map_hard_fails_on_no_key(monkeypatch):
    monkeypatch.setattr(C.industry_map, "status", lambda: {"rows": 0, "stale": True})
    monkeypatch.setattr(C.industry_map, "bulk_refresh_from_finviz", lambda: 0)
    with pytest.raises(RuntimeError):
        C.ensure_industry_map()
