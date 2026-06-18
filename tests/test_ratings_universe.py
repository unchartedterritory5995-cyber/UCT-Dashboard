"""Tests for the nightly universe gather (ratings_universe) — fully offline."""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def ru(tmp_path, monkeypatch):
    monkeypatch.setenv("RESEARCH_RATINGS_DB_PATH", str(tmp_path / "rr.db"))
    monkeypatch.setenv("RATINGS_PERCENTILE_MIN_SAMPLE", "5")
    monkeypatch.setenv("RATINGS_PERCENTILE_SLEEP", "0")  # no sleeps in tests
    import api.services.research.ratings_db as rdb
    importlib.reload(rdb)
    import api.services.research.ratings_universe as ru_mod
    importlib.reload(ru_mod)
    rdb.init_db()
    # run_in_pool → just call the fn (no real pool/timeout in tests)
    monkeypatch.setattr(ru_mod, "run_in_pool", lambda fn, timeout=None: fn())
    yield ru_mod
    _cleanup_ratings_db(rdb)  # keep seeded distributions out of other test files


def _cleanup_ratings_db(rdb):
    import os
    rdb._invalidate_memo()
    for suf in ("", "-wal", "-shm"):
        try:
            os.remove(rdb.DB_PATH + suf)
        except OSError:
            pass


def _fake_bars(sym):
    # 130 oldest-first daily rows (ts,o,h,l,c,v); rising closes so RS return is computable
    base = (hash(sym) % 50) + 10
    return [(20240000 + i, base + i, base + i + 1, base + i - 1, base + i * 0.5, 1000 + i * 10)
            for i in range(130)]


def test_compute_one_composes_local_and_fundamentals(ru, monkeypatch):
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda s, tf, n: _fake_bars(s))
    monkeypatch.setattr(ru, "get_fundamentals", lambda s: {
        "earnings_growth_pct": 25.0, "revenue_growth_pct": 15.0,
        "operating_margin_pct": 20.0, "roe_pct": 30.0,
        "peg": 1.5, "pe_forward": 22.0, "held_pct_institutions": 65.0,
        "sector": "Technology",
    })
    m = ru._compute_one("AAPL")
    assert m["earnings_growth"] == 25.0
    assert m["rev_growth"] == 15.0
    assert m["blended_growth"] is not None       # _blend_growth(15, 25)
    assert m["rs_return"] is not None             # from local bars
    assert m["accdis_ratio"] is not None          # from local bars
    assert m["inst_pct"] == 65.0
    assert m["peg"] == 1.5
    assert m["sector"] == "Technology"            # for Sector RS


def test_compute_one_survives_missing_bars_and_funds(ru, monkeypatch):
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda s, tf, n: [])
    monkeypatch.setattr(ru, "get_fundamentals", lambda s: {"error": "no data", "ticker": s})
    m = ru._compute_one("ZZZZ")
    assert m["rs_return"] is None
    assert m["earnings_growth"] is None
    assert ru._has_data(m) is False  # nothing gathered → not worth storing


def test_disabled_returns_disabled(ru, monkeypatch):
    monkeypatch.delenv("RATINGS_PERCENTILE_ENABLED", raising=False)
    assert ru.run_percentile_refresh()["status"] == "disabled"


def test_force_refresh_builds_distributions(ru, monkeypatch):
    universe = [f"T{i}" for i in range(20)]
    monkeypatch.setattr(ru, "_load_universe", lambda: universe)
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda s, tf, n: _fake_bars(s))
    monkeypatch.setattr(ru, "get_fundamentals", lambda s: {
        "earnings_growth_pct": float(hash(s) % 60), "revenue_growth_pct": float(hash(s) % 40),
        "operating_margin_pct": float(hash(s) % 30), "roe_pct": float(hash(s) % 50),
        "peg": 1.0 + (hash(s) % 30) / 10.0, "pe_forward": 15.0, "held_pct_institutions": float(hash(s) % 90),
    })
    res = ru.run_percentile_refresh(force=True)
    assert res["status"] == "ok"
    assert res["universe"] == 20
    assert res["processed"] == 20
    assert res["distributions"]["earnings_growth"] == 20
    # distributions are now usable downstream
    dists = ru.ratings_db.get_distributions()
    assert dists["rs_return"]["n"] == 20


def test_incremental_skips_fresh(ru, monkeypatch):
    universe = [f"T{i}" for i in range(10)]
    monkeypatch.setattr(ru, "_load_universe", lambda: universe)
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda s, tf, n: _fake_bars(s))
    monkeypatch.setattr(ru, "get_fundamentals", lambda s: {"earnings_growth_pct": 10.0, "roe_pct": 5.0})
    monkeypatch.setenv("RATINGS_PERCENTILE_ENABLED", "1")
    first = ru.run_percentile_refresh()
    assert first["processed"] == 10
    # second run: all fresh → none processed
    second = ru.run_percentile_refresh()
    assert second["processed"] == 0
    assert second["stale"] == 0


def test_max_per_run_caps_batch(ru, monkeypatch):
    universe = [f"T{i}" for i in range(50)]
    monkeypatch.setattr(ru, "_load_universe", lambda: universe)
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda s, tf, n: _fake_bars(s))
    monkeypatch.setattr(ru, "get_fundamentals", lambda s: {"earnings_growth_pct": 10.0, "roe_pct": 5.0})
    res = ru.run_percentile_refresh(max_per_run=15, force=True)
    assert res["processed"] == 15
    assert res["remaining"] == 35
