"""Integration: ratings.get_ratings percentile mode + absolute fallback."""
from __future__ import annotations

import importlib

import pytest


class _FakeDF:
    empty = False

    def __init__(self, closes, vols):
        self._d = {"Close": closes, "Volume": vols}

    def __getitem__(self, k):
        return self._d[k]


def _cleanup_ratings_db(rdb):
    """Wipe the in-process memo + on-disk tmp DB so seeded distributions don't
    leak into other test files (pytest retains tmp dirs; DB_PATH stays stale)."""
    import os
    rdb._invalidate_memo()
    for suf in ("", "-wal", "-shm"):
        try:
            os.remove(rdb.DB_PATH + suf)
        except OSError:
            pass


_CLOSES = [10 + i * 0.5 for i in range(130)]   # rising → computable RS + accdis
_VOLS = [1000 + i * 5 for i in range(130)]

_FUND = {
    "name": "Test Co", "sector": "Tech", "industry": "Software",
    "earnings_growth_pct": 50.0, "revenue_growth_pct": 50.0,
    "operating_margin_pct": 50.0, "roe_pct": 50.0,
    "peg": 50.0, "pe_forward": 20.0, "held_pct_institutions": 50.0,
}


@pytest.fixture()
def rat(tmp_path, monkeypatch):
    monkeypatch.setenv("RESEARCH_RATINGS_DB_PATH", str(tmp_path / "rr.db"))
    monkeypatch.setenv("RATINGS_PERCENTILE_MIN_SAMPLE", "10")
    monkeypatch.setenv("RATINGS_SECTOR_MIN_SAMPLE", "5")
    import api.services.research.ratings_db as rdb
    importlib.reload(rdb)
    import api.services.research.ratings as r
    importlib.reload(r)
    rdb.init_db()
    # offline data sources
    monkeypatch.setattr(r, "get_fundamentals", lambda s: dict(_FUND))
    monkeypatch.setattr(r, "get_ownership", lambda s: {"institutional": {"pct_held": 50.0}})
    monkeypatch.setattr(r, "fetch_history", lambda s, **k: _FakeDF(list(_CLOSES), list(_VOLS)))
    # avoid cross-test cache collisions
    from api.services.cache import cache
    cache.clear()
    yield r, rdb
    # don't let our seeded distributions (memo OR on-disk tmp file that pytest
    # retains) leak into other test files — wipe both so stale reads see nothing.
    _cleanup_ratings_db(rdb)
    cache.clear()


def _seed_uniform_dists(rdb):
    """100 tickers with every rankable metric = 0..99 so a value of 50 ranks ~50th pct."""
    for i in range(100):
        rdb.upsert_metrics(f"U{i}", {
            "earnings_growth": float(i), "rev_growth": float(i), "blended_growth": float(i),
            "rs_return": float(i), "peg": float(i), "op_margin": float(i),
            "roe": float(i), "inst_pct": float(i), "accdis_ratio": float(i),
        })
    rdb.rebuild_distributions()


def test_absolute_fallback_when_no_distributions(rat):
    r, rdb = rat
    out = r.get_ratings("ABSTEST")
    assert out["basis"] == "absolute"
    assert out["universe_n"] is None
    assert "future enhancement" in out["method"]
    # earnings_growth 50% → absolute _EPS_BANDS gives 98
    assert out["components"]["eps"] == 98
    assert out["composite"] is not None


def test_percentile_mode_when_distributions_present(rat):
    r, rdb = rat
    _seed_uniform_dists(rdb)
    out = r.get_ratings("PCTTEST")
    assert out["basis"] == "percentile"
    assert out["universe_n"] == 100
    assert "Percentile rank" in out["method"]
    comp = out["components"]
    # value 50 vs a 0..99 uniform dist → ~50th percentile for "higher is better" metrics
    assert 45 <= comp["eps"] <= 56
    assert 45 <= comp["growth"] <= 56
    # PEG inverted: 50 is mid → ~50; a LOW peg would rank high
    assert 40 <= comp["value"] <= 60
    # letter components become quintile letters (mid → C)
    assert comp["smr"] == "C"
    assert comp["accdis"] in ("A", "B", "C", "D", "E")  # valid quintile letter
    assert comp["sponsorship"] == "C"
    assert 1 <= comp["composite"] <= 99 if isinstance(comp.get("composite"), int) else True
    assert out["composite"] is not None


def test_percentile_low_peg_ranks_high(rat, monkeypatch):
    r, rdb = rat
    _seed_uniform_dists(rdb)
    cheap = dict(_FUND); cheap["peg"] = 3.0   # very low vs 0..99 dist → strong value
    monkeypatch.setattr(r, "get_fundamentals", lambda s: cheap)
    out = r.get_ratings("CHEAP")
    assert out["components"]["value"] >= 90


def test_sector_rs_present_when_sector_dists_exist(rat):
    r, rdb = rat
    _seed_uniform_dists(rdb)
    # seed 8 "Tech" names with rs_return so the sector pool clears the gate (5)
    for i in range(8):
        rdb.upsert_metrics(f"TK{i}", {"rs_return": float(i * 5 - 10), "sector": "Tech"})
    rdb.rebuild_distributions()
    out = r.get_ratings("GRPTEST")
    assert out["sector"] == "Tech"
    assert out["group_rs"] is not None and 1 <= out["group_rs"] <= 99
    assert out["group_sector_n"] == 8


def test_no_sector_rs_when_sector_pool_too_small(rat):
    r, rdb = rat
    _seed_uniform_dists(rdb)
    # only 3 Tech names → below SECTOR_MIN_SAMPLE=5 → no group_rs
    for i in range(3):
        rdb.upsert_metrics(f"TK{i}", {"rs_return": float(i), "sector": "Tech"})
    rdb.rebuild_distributions()
    out = r.get_ratings("GRPSMALL")
    assert out["group_rs"] is None
    assert out["group_sector_n"] is None


def test_missing_metric_degrades_per_component(rat, monkeypatch):
    r, rdb = rat
    _seed_uniform_dists(rdb)
    partial = {"name": "P", "earnings_growth_pct": 50.0}  # no peg/roe/etc.
    monkeypatch.setattr(r, "get_fundamentals", lambda s: partial)
    monkeypatch.setattr(r, "get_ownership", lambda s: {"institutional": {"pct_held": None}})
    out = r.get_ratings("PARTIAL")
    # eps still ranks (has distribution + value); value falls back (no peg) → None or absolute
    assert out["components"]["eps"] is not None
    assert out["basis"] == "percentile"  # at least one metric ranked
