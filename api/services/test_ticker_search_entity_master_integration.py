"""Checkpoint 6 (Compatibility integration) — entity_master-spec.md §2.2.

Tests the ADDITIVE extension of `ticker_search_index.py`/`api/routers/
ticker_search.py`: entity_id resolution, extra Massive fields retained, and
backward-compatible snapshot loading. Every fixture is synthetic; the real
`entity_master.db` (DATA_DIR default) is never touched — `schema.DB_PATH` is
monkeypatched to a `tmp_path` file and the module-level connection cache
+ alias cache are reset before each test so no state leaks between tests
or from a real server process.
"""
import json

import pytest

from api.services.entity_master import schema, store
from api.services.entity_master import api as em_api
from api.services import ticker_search_index as tsi


@pytest.fixture(autouse=True)
def _isolated_entity_master(tmp_path, monkeypatch):
    """Point Entity Master's DEFAULT db_path (what ticker_search_index.py's
    entity_id resolution actually uses — it never passes db_path) at a fresh
    tmp_path file, and clear the module-global connection/alias caches so
    this test's data can never leak into another test or a real server."""
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


@pytest.fixture(autouse=True)
def _reset_index_state():
    """ticker_search_index.py's own module-level _INDEX/_BY_SYM must not
    leak between tests either."""
    tsi._INDEX = []
    tsi._BY_SYM = {}
    tsi._BUILT_AT = 0.0
    yield
    tsi._INDEX = []
    tsi._BY_SYM = {}
    tsi._BUILT_AT = 0.0


def _seed_one(alias, valid_from="2020-01-01", entity_type="equity"):
    r = em_api.apply_event(
        "new_entity",
        {"entity_type": entity_type, "initial_alias": alias, "initial_alias_valid_from": valid_from},
        dedup_key=f"test:{alias}", source="admin_manual",
    )
    assert r.accepted
    return r.entity_id


def _patch_massive_and_universe(monkeypatch, *, stocks=(), indices=(), universe=()):
    import api.services.massive as massive
    import api.services.cap_universe as cap_universe

    def _fake(active=True, market="stocks", limit=1000, max_pages=60):
        return list(stocks) if market == "stocks" else list(indices)

    monkeypatch.setattr(massive, "list_reference_tickers", _fake)
    monkeypatch.setattr(cap_universe, "symbols", lambda: frozenset(universe))


def test_collect_rows_attaches_entity_id_when_already_seeded(monkeypatch):
    eid = _seed_one("AAPL")
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[{"ticker": "AAPL", "type": "CS", "name": "Apple Inc.",
                 "composite_figi": "BBG000B9XRY4", "cik": "0000320193"}],
    )
    rows = tsi._collect_rows()
    row = next(r for r in rows if r["sym"] == "AAPL")
    assert row["entity_id"] == eid
    # Extra fields are retained (not exposed by search(), but present internally).
    assert row["composite_figi"] == "BBG000B9XRY4"
    assert row["cik"] == "0000320193"


def test_collect_rows_entity_id_none_when_not_seeded(monkeypatch):
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "NVDA", "type": "CS", "name": "NVIDIA Corp"}]
    )
    rows = tsi._collect_rows()
    row = next(r for r in rows if r["sym"] == "NVDA")
    assert row["entity_id"] is None


def test_collect_rows_is_additive_shape_unchanged_for_existing_fields(monkeypatch):
    """The original {sym, name, type, exch} contract must be byte-identical
    to before — this is what "purely additive" is actually verified by."""
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "MSFT", "type": "CS", "name": "Microsoft Corp",
                               "primary_exchange": "XNAS"}]
    )
    rows = tsi._collect_rows()
    row = next(r for r in rows if r["sym"] == "MSFT")
    assert row["sym"] == "MSFT"
    assert row["name"] == "Microsoft Corp"
    assert row["type"] == "stock"
    assert row["exch"] == "NASDAQ"


def test_build_index_and_search_expose_entity_id(monkeypatch):
    eid = _seed_one("BRK-B", "1996-05-09")
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "BRK-B", "type": "CS", "name": "Berkshire Hathaway"}]
    )
    n = tsi.build_index()
    assert n >= 1
    results = tsi.search("BRK-B", limit=5)
    assert results
    hit = next(r for r in results if r["ticker"] == "BRK-B")
    assert hit["entity_id"] == eid
    # Existing fields unchanged.
    assert hit["name"] == "Berkshire Hathaway"
    assert hit["type"] == "stock"


def test_search_ranking_unaffected_by_entity_id_addition(monkeypatch):
    """The ranking algorithm (exact > prefix > contains > name) must not
    have changed at all — entity_id is a passenger field, not a rank input."""
    _seed_one("AAPL")
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[
            {"ticker": "AAPL", "type": "CS", "name": "Apple Inc."},
            {"ticker": "AAPU", "type": "ETF", "name": "Direxion Daily AAPL Bull 2X"},
        ],
    )
    tsi.build_index()
    results = tsi.search("AAPL", limit=10)
    tickers_in_order = [r["ticker"] for r in results]
    assert tickers_in_order[0] == "AAPL"  # exact match still ranks first
    assert "AAPU" in tickers_in_order      # name-contains match still surfaces


def test_snapshot_round_trip_persists_entity_id(monkeypatch, tmp_path):
    eid = _seed_one("SPY")
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "SPY", "type": "ETF", "name": "SPDR S&P 500"}]
    )
    snap_path = str(tmp_path / "snap.json")
    monkeypatch.setattr(tsi, "_SNAP_PATH", snap_path)
    tsi.build_index()

    # Clear in-memory state, reload purely from the disk snapshot.
    tsi._INDEX, tsi._BY_SYM, tsi._BUILT_AT = [], {}, 0.0
    loaded = tsi._load_snapshot()
    assert loaded
    results = tsi.search("SPY", limit=5)
    hit = next(r for r in results if r["ticker"] == "SPY")
    assert hit["entity_id"] == eid


def test_old_snapshot_without_eid_key_loads_without_crashing(tmp_path, monkeypatch):
    """Backward compatibility: a snapshot written BEFORE Checkpoint 6 has no
    "eid" key at all. Loading it must not raise, and entity_id must default
    to None rather than KeyError."""
    snap_path = str(tmp_path / "old_snap.json")
    with open(snap_path, "w", encoding="utf-8") as fh:
        json.dump({"built_at": 12345.0, "rows": [
            {"s": "OLD", "n": "Old Corp", "t": "stock", "e": "NYSE"},
        ]}, fh)
    monkeypatch.setattr(tsi, "_SNAP_PATH", snap_path)
    loaded = tsi._load_snapshot()
    assert loaded
    results = tsi.search("OLD", limit=5)
    hit = next(r for r in results if r["ticker"] == "OLD")
    assert hit["entity_id"] is None


def test_entity_master_unavailable_degrades_to_none_never_raises(monkeypatch):
    """If entity_id resolution itself blows up for any reason, _collect_rows()
    must still return a full, usable index (all entity_id=None) rather than
    an empty index or a raised exception — matches this file's own
    "best-effort everywhere" discipline."""
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "TSLA", "type": "CS", "name": "Tesla Inc"}]
    )

    def _boom(*a, **kw):
        raise RuntimeError("simulated Entity Master failure")

    monkeypatch.setattr(em_api, "resolve", _boom)
    rows = tsi._collect_rows()
    assert rows  # the index itself is not empty
    row = next(r for r in rows if r["sym"] == "TSLA")
    assert row["entity_id"] is None


# ─── Router-level: every emitted row shape carries entity_id ──────────────

def test_router_live_row_carries_real_entity_id(monkeypatch):
    from api.routers import ticker_search as router_mod

    eid = _seed_one("AAPL")
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "AAPL", "type": "CS", "name": "Apple Inc."}]
    )
    tsi.build_index()
    monkeypatch.setattr(router_mod, "_UNIVERSE", ["AAPL"])

    resp = router_mod.ticker_search(q="AAPL", limit=20, type="")
    row = next(r for r in resp["results"] if r["ticker"] == "AAPL")
    assert row["entity_id"] == eid


def test_router_breadth_row_carries_null_entity_id(monkeypatch):
    from api.routers import ticker_search as router_mod
    import api.services.breadth_symbols as breadth_symbols

    monkeypatch.setattr(
        breadth_symbols, "search",
        lambda qq, limit: [{"ticker": "UCTA50", "name": "Above 50-day", "symbol_hit": True}],
    )
    resp = router_mod.ticker_search(q="UCTA50", limit=20, type="breadth")
    assert resp["results"]
    row = resp["results"][0]
    assert row["ticker"] == "UCTA50"
    assert row["entity_id"] is None
    assert row["breadth"] is True


def test_router_delisted_row_carries_null_entity_id(monkeypatch):
    from api.routers import ticker_search as router_mod
    import api.services.delisted_registry as delisted_registry

    monkeypatch.setattr(router_mod, "_UNIVERSE", [])
    monkeypatch.setattr(
        delisted_registry, "search",
        lambda qq, limit: [{"ticker": "BSC-OLD", "name": "Bear Stearns", "delisted_date": "2008-05-30"}],
    )
    resp = router_mod.ticker_search(q="BSC", limit=20, type="")
    row = next(r for r in resp["results"] if r["ticker"] == "BSC-OLD")
    assert row["entity_id"] is None
    assert row["delisted"] is True
