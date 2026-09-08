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


# ─── Seam 16 — dot/hyphen share-class identity ─────────────────────────────
# Reproduces the exact real-world shape: Massive's own reference feed returns
# the DOT spelling ('BRK.B'), cap_universe.json carries the HYPHEN spelling
# ('BRK-B'), and Entity Master's alias table is seeded with the hyphen form
# only (mirroring entity_master_seed.py's own already-fixed behavior).
# `test_build_index_and_search_expose_entity_id` above never actually
# exercised this — it fed 'BRK-B' to the Massive stub, which is not what the
# real provider returns for a dual-class ticker.

def test_share_class_alias_converts_dot_form():
    assert tsi._share_class_alias("BRK.B") == "BRK-B"
    assert tsi._share_class_alias("BF.A") == "BF-A"


def test_share_class_alias_returns_none_for_a_plain_ticker():
    assert tsi._share_class_alias("NVDA") is None
    assert tsi._share_class_alias("SPY") is None


def test_share_class_alias_distinguishes_different_share_classes():
    """The A and B classes of the same root must never be conflated with
    each other -- each is a genuinely distinct security."""
    assert tsi._share_class_alias("BF.A") == "BF-A"
    assert tsi._share_class_alias("BF.B") == "BF-B"
    assert tsi._share_class_alias("BF.A") != tsi._share_class_alias("BF.B")


def test_share_class_alias_does_not_misfire_on_an_unrelated_dotted_string():
    """Dot/hyphen safety requirement: this must never become a blanket
    'every dot == every hyphen' rule."""
    assert tsi._share_class_alias("A.B.C") is None       # multiple dots
    assert tsi._share_class_alias("TOOLONG.B") is None   # root > 5 chars
    assert tsi._share_class_alias("BRK.TOO") is None     # suffix > 2 chars
    assert tsi._share_class_alias("") is None


def test_collect_rows_rekeys_a_dot_form_massive_ticker_to_hyphen(monkeypatch):
    """The real provider shape: Massive returns 'BRK.B', never 'BRK-B'."""
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway Inc. Class B",
                 "primary_exchange": "XNYS"}],
    )
    rows = tsi._collect_rows()
    syms = {r["sym"] for r in rows}
    assert "BRK-B" in syms
    assert "BRK.B" not in syms  # never survives as a literal dot-keyed row


def test_collect_rows_dot_and_hyphen_coalesce_into_one_row(monkeypatch):
    """The exact reproduction of the recorded defect: Massive's dot-form row
    and cap_universe's hyphen-form entry must coalesce onto ONE row, not two
    -- the duplicate-alias-result bug Section XIII of the authorization
    guards against."""
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway Inc. Class B"}],
        universe=["BRK-B", "NVDA"],
    )
    rows = tsi._collect_rows()
    brk_rows = [r for r in rows if r["sym"] in ("BRK-B", "BRK.B")]
    assert len(brk_rows) == 1  # never two rows for one real instrument
    assert brk_rows[0]["sym"] == "BRK-B"
    assert brk_rows[0]["name"] == "Berkshire Hathaway Inc. Class B"  # rich data preserved


def test_collect_rows_dot_form_row_resolves_the_real_seeded_entity_id(monkeypatch):
    """The core fix proof: before this program, the dot-keyed row's entity_id
    resolved to None (Entity Master's alias table only had the hyphen
    spelling); after re-keying, `_em_api.resolve('BRK-B')` -- already a real,
    previously-seeded alias -- succeeds for the SAME row."""
    eid = _seed_one("BRK-B", "1996-05-09")
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}],
    )
    rows = tsi._collect_rows()
    row = next(r for r in rows if r["sym"] == "BRK-B")
    assert row["entity_id"] == eid


def test_search_dot_query_finds_the_canonical_hyphen_row(monkeypatch):
    eid = _seed_one("BRK-B", "1996-05-09")
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}],
    )
    tsi.build_index()
    results = tsi.search("BRK.B", limit=5)
    assert len(results) == 1
    hit = results[0]
    assert hit["ticker"] == "BRK-B"  # canonical output, never the provider spelling
    assert hit["entity_id"] == eid
    assert hit["name"] == "Berkshire Hathaway"


def test_search_lowercase_dot_query_also_finds_the_canonical_row(monkeypatch):
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}],
    )
    tsi.build_index()
    results = tsi.search("brk.b", limit=5)
    assert [r["ticker"] for r in results] == ["BRK-B"]


def test_search_hyphen_query_is_unaffected_control(monkeypatch):
    """Control: the ordinary, already-working hyphen query must behave
    identically before and after this fix."""
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}],
    )
    tsi.build_index()
    results = tsi.search("BRK-B", limit=5)
    assert [r["ticker"] for r in results] == ["BRK-B"]


def test_search_lowercase_hyphen_query_is_unaffected_control(monkeypatch):
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}],
    )
    tsi.build_index()
    results = tsi.search("brk-b", limit=5)
    assert [r["ticker"] for r in results] == ["BRK-B"]


def test_search_ordinary_ticker_is_completely_unaffected(monkeypatch):
    """An ordinary ticker with no dot in it must take exactly the pre-fix
    code path -- `_share_class_alias` returns None and every new branch is
    a no-op."""
    _patch_massive_and_universe(monkeypatch, stocks=[{"ticker": "NVDA", "type": "CS", "name": "NVIDIA Corp"}])
    tsi.build_index()
    results = tsi.search("NVDA", limit=5)
    assert [r["ticker"] for r in results] == ["NVDA"]


def test_search_generic_prefix_query_returns_the_instrument_exactly_once(monkeypatch):
    """A query that does NOT match the share-class dot shape (a bare prefix
    like 'BRK') must still see the coalesced single row, not a duplicate --
    this is the query shape that would have shown the bug most visibly
    (both a blank cap_universe row and a well-named Massive row for one
    real instrument)."""
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"},
                {"ticker": "BRK.A", "type": "CS", "name": "Berkshire Hathaway Class A"}],
        universe=["BRK-B", "BRK-A"],
    )
    tsi.build_index()
    results = tsi.search("BRK", limit=10)
    tickers = [r["ticker"] for r in results]
    assert tickers.count("BRK-B") == 1
    assert tickers.count("BRK-A") == 1
    assert len(tickers) == 2  # exactly the two real instruments, no duplicates


def test_search_invalid_ticker_still_returns_nothing(monkeypatch):
    _patch_massive_and_universe(monkeypatch, stocks=[{"ticker": "NVDA", "type": "CS", "name": "NVIDIA Corp"}])
    tsi.build_index()
    assert tsi.search("ZZZZNOTREAL", limit=5) == []


def test_search_different_share_classes_never_collapse_into_each_other(monkeypatch):
    """BF-A and BF-B are genuinely distinct securities -- the alias logic
    must never let a query for one match the other."""
    _patch_massive_and_universe(
        monkeypatch,
        stocks=[{"ticker": "BF.A", "type": "CS", "name": "Brown-Forman Class A"},
                {"ticker": "BF.B", "type": "CS", "name": "Brown-Forman Class B"}],
    )
    tsi.build_index()
    results = tsi.search("BF.A", limit=10)
    assert [r["ticker"] for r in results] == ["BF-A"]


def test_fallback_symbol_scan_dot_query_finds_the_hyphen_ticker(monkeypatch):
    """The narrow pre-index-build startup window (router-level fallback)
    gets the same query-side fix, reusing the shared helper."""
    from api.routers import ticker_search as router_mod

    monkeypatch.setattr(router_mod, "_UNIVERSE", ["BRK-B", "NVDA"])
    out = router_mod._fallback_symbol_scan("BRK.B", 5)
    assert [r["ticker"] for r in out] == ["BRK-B"]


def test_router_dot_query_routes_through_the_full_stack_to_canonical_result(monkeypatch):
    """End-to-end through the actual router entry point -- what the frontend
    (SymbolSearch/CommandPalette/SwitchTickerBox/MobileSymbolSheet all call
    the SAME /api/ticker-search endpoint) actually receives for a member
    who types the dot spelling."""
    from api.routers import ticker_search as router_mod

    eid = _seed_one("BRK-B", "1996-05-09")
    _patch_massive_and_universe(
        monkeypatch, stocks=[{"ticker": "BRK.B", "type": "CS", "name": "Berkshire Hathaway"}],
    )
    tsi.build_index()
    monkeypatch.setattr(router_mod, "_UNIVERSE", ["BRK-B"])

    resp = router_mod.ticker_search(q="BRK.B", limit=20, type="")
    assert len(resp["results"]) == 1
    row = resp["results"][0]
    assert row["ticker"] == "BRK-B"          # canonical downstream symbol
    assert row["entity_id"] == eid           # real identity, not None
    assert row["name"] == "Berkshire Hathaway"
