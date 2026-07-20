from api.services import groups


def test_normalize_sym_hyphen_and_upper():
    assert groups.normalize_sym("brk.b") == "BRK-B"
    assert groups.normalize_sym("AAPL") == "AAPL"
    assert groups.normalize_sym(" nvda ") == "NVDA"


def test_to_taxonomy_sym_uses_dot():
    assert groups.to_taxonomy_sym("BRK-B") == "BRK.B"
    assert groups.to_taxonomy_sym("aapl") == "AAPL"


def test_is_chartable_uses_cap_universe(monkeypatch):
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAPL", "BRK-B"})
    assert groups.is_chartable("AAPL") is True
    assert groups.is_chartable("brk.b") is True     # normalized to BRK-B
    assert groups.is_chartable("ZZZZ") is False


def test_cap_universe_set_loads_and_normalizes(tmp_path, monkeypatch):
    p = tmp_path / "cap.json"
    p.write_text('["aapl", "BRK.B", "", "nvda"]', encoding="utf-8")
    groups._CAP_CACHE["set"] = None
    monkeypatch.setattr(groups, "_cap_universe_path", lambda: str(p))
    s = groups.cap_universe_set()
    assert "AAPL" in s and "BRK-B" in s and "NVDA" in s
    assert "" not in s


def test_cap_universe_set_missing_file_returns_empty_and_does_not_cache(monkeypatch):
    groups._CAP_CACHE["set"] = None
    monkeypatch.setattr(groups, "_cap_universe_path", lambda: "/no/such/cap_universe.json")
    assert groups.cap_universe_set() == set()
    assert groups._CAP_CACHE["set"] is None    # failure not cached -> retries next call


def test_list_groups_shapes_and_chartable_count(monkeypatch):
    fake = {"sectors": [], "themes": [
        {"id": "space", "name": "Space", "sector_id": "innovation",
         "etf_ticker": "UFO", "sub_themes": [{"id": "launch", "name": "Launch"}],
         "holdings": [{"sym": "RKLB"}, {"sym": "ASTS"}, {"sym": "DEADCO"}]},
    ]}
    monkeypatch.setattr(groups, "_get_all_themes", lambda: fake)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB", "ASTS"})
    monkeypatch.setattr(groups, "_rotation_order", lambda: {})
    out = groups.list_groups()
    row = next(r for r in out if r["id"] == "space")
    assert row["total"] == 3
    assert row["chartable"] == 2          # DEADCO excluded
    assert row["etf_ticker"] == "UFO"
    assert row["sub_theme_count"] == 1


def test_rotation_order_ranks_hot_themes_first(monkeypatch):
    import api.services.theme_performance as tp
    sig = {"rankings": {
        "UFO": {"name": "Space", "1w_rank": 90.0},
        "SMH": {"name": "Semiconductors", "1w_rank": 40.0},
        "XLU": {"name": "Utilities", "1w_rank": None},
    }, "rotating_in": [], "rotating_out": [], "generated_at": ""}
    monkeypatch.setattr(tp, "compute_rotation_signals", lambda: sig)
    order = groups._rotation_order()
    assert order["space"] == 0             # hottest (1w_rank 90) first
    assert order["semiconductors"] == 1
    assert order["utilities"] == 2          # None rank sinks last


def test_today_map_bounds_a_slow_snapshot(monkeypatch):
    """A stalled Massive snapshot must NOT pin the request path — _today_map
    returns {} within the deadline (rank_holdings then falls back to RS) instead
    of blocking ~25s on the httpx read timeout (the 30-40s cold peer-fill bug)."""
    import time as _t
    import api.services.massive as massive
    groups._TODAY_CACHE.clear()

    def _slow(_syms):
        _t.sleep(5.0)                       # far longer than the 3s deadline
        return {"AAA": 1.0}

    monkeypatch.setattr(massive, "get_etf_snapshots", _slow)
    monkeypatch.setattr(groups, "_TODAY_TIMEOUT_S", 0.3)
    t0 = _t.monotonic()
    out = groups._today_map(["AAA"])
    elapsed = _t.monotonic() - t0
    assert out == {}                        # degraded, not blocked
    assert elapsed < 2.0                    # bounded well under the 5s stall


def test_today_map_returns_data_when_fast_and_caches(monkeypatch):
    """A healthy snapshot returns normalized data AND is cached per sym-set so a
    group switch's peers-fill + badge top_n fetch share ONE Massive call."""
    import api.services.massive as massive
    groups._TODAY_CACHE.clear()
    calls = {"n": 0}

    def _fast(syms):
        calls["n"] += 1
        return {"aaa": 5.0, "BBB": -1.0}    # mixed case -> normalized

    monkeypatch.setattr(massive, "get_etf_snapshots", _fast)
    monkeypatch.setattr(groups, "_TODAY_TIMEOUT_S", 3.0)
    out1 = groups._today_map(["AAA", "BBB"])
    out2 = groups._today_map(["BBB", "AAA"])   # same set, order-independent key
    assert out1 == {"AAA": 5.0, "BBB": -1.0}
    assert out2 == out1
    assert calls["n"] == 1                  # second call served from cache


def test_rank_holdings_today_then_fallbacks(monkeypatch):
    holdings = [
        {"sym": "AAA", "tier": "core"},       # today +5
        {"sym": "BBB", "tier": "core"},       # no today, rs 80
        {"sym": "CCC", "tier": "relevant"},   # no today, no rs, 1m +12
        {"sym": "DDD", "tier": "peripheral"}, # no data at all -> last, tier order
        {"sym": "DEAD", "tier": "core"},      # not chartable -> excluded
    ]
    monkeypatch.setattr(groups, "cap_universe_set",
                        lambda: {"AAA", "BBB", "CCC", "DDD"})
    monkeypatch.setattr(groups, "_today_map",
                        lambda syms: {"AAA": 5.0})
    monkeypatch.setattr(groups, "_rs_map",
                        lambda: {"BBB": {"rs_rank": 80, "returns": {"1m": 3.0}},
                                 "CCC": {"rs_rank": None, "returns": {"1m": 12.0}}})
    ranked = groups.rank_holdings(holdings, by="today")
    assert ranked == ["AAA", "BBB", "CCC", "DDD"]
    assert "DEAD" not in ranked


def test_top_n_returns_rows_with_tier_and_rationale(monkeypatch):
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "RKLB", "tier": "core", "rationale": "Launch"},
                                     {"sym": "ASTS", "tier": "core", "rationale": "Sats"}])
    import api.services.theme_db as tdb
    monkeypatch.setattr(tdb, "get_theme_holdings", groups._theme_holdings)
    monkeypatch.setattr(groups, "rank_holdings",
                        lambda h, by="today", seed=None, seed_sub=None, scores_out=None: ["RKLB", "ASTS"])
    out = groups.top_n("space", 2, by="today")
    assert out["syms"] == ["RKLB", "ASTS"]
    # Absent source on a holding = owner (backward compatible, Task 3).
    assert out["rows"][0] == {"sym": "RKLB", "tier": "core", "rationale": "Launch",
                              "gate_score": None, "source": "owner"}


def test_resolve_primary_theme_prefers_core_over_smaller_relevant(monkeypatch):
    # NVDA: core in Semiconductors (size 3) + AI (size 3); relevant in
    # Video Games (size 2, the "fewest holdings"). Core must win.
    rows = [
        {"theme_id": "semis", "theme_name": "Semiconductors", "tier": "core", "sub_theme_id": None},
        {"theme_id": "video_games", "theme_name": "Video Games", "tier": "relevant", "sub_theme_id": None},
    ]
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: rows)
    monkeypatch.setattr(groups, "_theme_size", lambda tid: {"semis": 3, "video_games": 2}.get(tid, 0))
    r = groups.resolve_primary_theme("NVDA")
    assert r["theme_id"] == "semis"


def test_resolve_primary_theme_excludes_factor_buckets(monkeypatch):
    rows = [
        {"theme_id": "meme_retail", "theme_name": "Meme & Retail", "tier": "core", "sub_theme_id": None},
        {"theme_id": "fintech", "theme_name": "Fintech", "tier": "relevant", "sub_theme_id": None},
    ]
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: rows)
    monkeypatch.setattr(groups, "_theme_size", lambda tid: 10)
    r = groups.resolve_primary_theme("PLTR")
    assert r["theme_id"] == "fintech"   # Meme & Retail excluded


def test_resolve_peers_sub_theme_first_then_widen(monkeypatch):
    seed_row = {"theme_id": "space", "theme_name": "Space", "tier": "core", "sub_theme_id": "launch"}
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: seed_row)
    monkeypatch.setattr(groups, "cap_universe_set",
                        lambda: {"RKLB", "ASTS", "LUNR", "LMT"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    holdings = [
        {"sym": "RKLB", "tier": "core", "sub_theme_id": "launch"},   # the seed
        {"sym": "ASTS", "tier": "core", "sub_theme_id": "satellites"},
        {"sym": "LUNR", "tier": "relevant", "sub_theme_id": "launch"},  # same sub-theme -> boosted
        {"sym": "LMT", "tier": "core", "sub_theme_id": "defense"},
    ]
    monkeypatch.setattr(groups, "_theme_holdings", lambda tid: holdings)
    out = groups.resolve_peers("RKLB", 3)
    assert out["source"] == "taxonomy"
    assert out["peers"][0] == "LUNR"      # same sub-theme floats to top
    assert "RKLB" not in out["peers"]     # seed excluded


def test_resolve_peers_liquidity_floor_beats_sub_theme_when_gated(monkeypatch):
    # Gated: a confirmed-liquid DIFFERENT-sub-theme peer outranks an illiquid
    # SAME-sub-theme peer (liquidity floor is the hard prefilter); within the
    # liquid tier, same-sub-theme still leads.
    seed_row = {"theme_id": "space", "theme_name": "Space", "tier": "core", "sub_theme_id": "launch"}
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: seed_row)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB", "SAMEILLIQ", "DIFFLIQ", "SAMELIQ"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    holdings = [
        {"sym": "RKLB", "tier": "core", "sub_theme_id": "launch"},          # seed (excluded)
        {"sym": "SAMEILLIQ", "tier": "core", "sub_theme_id": "launch"},     # same sub, illiquid
        {"sym": "DIFFLIQ", "tier": "core", "sub_theme_id": "satellites"},   # diff sub, liquid
        {"sym": "SAMELIQ", "tier": "core", "sub_theme_id": "launch"},       # same sub, liquid
    ]
    monkeypatch.setattr(groups, "_theme_holdings", lambda tid: holdings)
    _mock_gate_env(monkeypatch, True, {
        "SAMEILLIQ": {"price": 2.0, "dollar_vol": 1e6, "rs_rank": 90, "adr_pct": 9},   # band2
        "DIFFLIQ":   {"price": 40, "dollar_vol": 5e8, "rs_rank": 80, "adr_pct": 6},    # band0
        "SAMELIQ":   {"price": 30, "dollar_vol": 5e8, "rs_rank": 80, "adr_pct": 6},    # band0
    })
    peers = groups.resolve_peers("RKLB", 3)["peers"]
    assert peers[0] == "SAMELIQ"     # liquid + same sub-theme -> top
    assert peers[1] == "DIFFLIQ"     # liquid, different sub-theme
    assert peers[2] == "SAMEILLIQ"   # same sub-theme but illiquid -> backfill last


def test_ticker_meta_primary_theme_matches_resolver(monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_id": "semis", "theme_name": "Semiconductors"})
    assert ticker_meta._primary_theme("NVDA") == "Semiconductors"


def test_ticker_meta_primary_theme_none_when_unresolved(monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    assert ticker_meta._primary_theme("ZZZZ") is None


from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_groups_list_endpoint(monkeypatch):
    monkeypatch.setattr(groups, "list_groups",
                        lambda: [{"id": "space", "name": "Space", "total": 6, "chartable": 6}])
    r = client.get("/api/groups")
    assert r.status_code == 200
    assert r.json()["groups"][0]["id"] == "space"


def test_group_top_endpoint(monkeypatch):
    monkeypatch.setattr(groups, "top_n",
                        lambda tid, n, by: {"group_id": tid, "syms": ["RKLB", "ASTS"],
                                            "total": 2, "by": by, "ranked_as_of": "regular"})
    r = client.get("/api/groups/space/top?n=2&by=today")
    assert r.status_code == 200
    assert r.json()["syms"] == ["RKLB", "ASTS"]


def test_group_peers_endpoint(monkeypatch):
    monkeypatch.setattr(groups, "resolve_peers",
                        lambda sym, n: {"seed": sym, "group_id": "space",
                                        "peers": ["ASTS"], "source": "taxonomy"})
    r = client.get("/api/groups/peers?sym=RKLB&n=5")
    assert r.status_code == 200
    assert r.json()["source"] == "taxonomy"


def test_theme_size_uses_cached_map_not_list_groups(monkeypatch):
    # _theme_size must NOT route through list_groups(); it reads the cached
    # _theme_sizes() map (one get_all_themes()), so the watermark hot path
    # doesn't pay an uncached full-taxonomy scan per call.
    groups._SIZES_CACHE["map"] = None
    calls = {"all_themes": 0}
    def fake_all():
        calls["all_themes"] += 1
        return {"themes": [{"id": "space", "holdings": [{"sym": "RKLB"}, {"sym": "ASTS"}]},
                           {"id": "semis", "holdings": [{"sym": "NVDA"}]}]}
    monkeypatch.setattr(groups, "_get_all_themes", fake_all)
    def boom():
        raise AssertionError("_theme_size must not call list_groups()")
    monkeypatch.setattr(groups, "list_groups", boom)
    assert groups._theme_size("space") == 2
    assert groups._theme_size("semis") == 1
    assert groups._theme_size("missing") == 0
    assert calls["all_themes"] == 1          # cached: one taxonomy read for 3 lookups


def test_ai_peers_validates_sector_match_and_dedups_seed(monkeypatch):
    from api.services import ticker_meta
    # Seed SNDK: SanDisk, Technology / Computer Storage.
    metas = {
        "SNDK": {"name": "SanDisk Corp", "sector": "Technology", "industry": "Computer Storage", "theme": None},
        "WDC":  {"name": "Western Digital", "sector": "Technology", "industry": "Computer Storage", "theme": None},
        "STX":  {"name": "Seagate", "sector": "Technology", "industry": "Computer Storage", "theme": None},
        "AAPL": {"name": "Apple", "sector": "Technology", "industry": "Consumer Electronics", "theme": None},
        "XYZZY": {"name": "Nope", "sector": "Energy", "industry": "Oil", "theme": None},
    }
    monkeypatch.setattr(ticker_meta, "get_ticker_meta", lambda s: metas.get(groups.normalize_sym(s), {"name": None, "sector": None, "industry": None, "theme": None}))
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"SNDK", "WDC", "STX", "AAPL", "XYZZY"})
    # Haiku returns: WDC (good), STX (good), SNDK (the seed — must dedup),
    # XYZZY (wrong sector — must drop), FAKE (not in cap_universe — must drop).
    monkeypatch.setattr(groups, "_ai_peer_raw", lambda seed, n, meta: ["WDC", "STX", "SNDK", "XYZZY", "FAKE"])
    cache_store = {}
    monkeypatch.setattr(groups.cache, "get", lambda k: cache_store.get(k))
    monkeypatch.setattr(groups.cache, "set", lambda k, v, ttl: cache_store.__setitem__(k, v))
    out = groups._ai_peers("SNDK", 5)
    assert out == ["WDC", "STX"]        # seed + wrong-sector + non-chartable all dropped
    # AAPL shares sector (Technology) but industry differs — sector match is enough,
    # but the model didn't return it, so it's simply absent (validation is a filter).


def test_ai_peers_refuses_when_seed_meta_name_is_null(monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "get_ticker_meta", lambda s: {"name": None, "sector": None, "industry": None, "theme": None})
    called = {"raw": 0}
    monkeypatch.setattr(groups, "_ai_peer_raw", lambda *a: called.__setitem__("raw", called["raw"] + 1) or [])
    monkeypatch.setattr(groups.cache, "get", lambda k: None)
    monkeypatch.setattr(groups.cache, "set", lambda k, v, ttl: None)
    assert groups._ai_peers("GHOST", 5) == []
    assert called["raw"] == 0            # never grounds on a null-name seed


def test_resolve_peers_uses_ai_on_taxonomy_miss(monkeypatch):
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)   # not in taxonomy
    monkeypatch.setattr(groups, "_industry_peers", lambda seed, n: None)   # no industry cohort
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: ["WDC", "STX"])
    out = groups.resolve_peers("SNDK", 5)
    assert out == {"seed": "SNDK", "group_id": None, "peers": ["WDC", "STX"], "source": "ai"}


def test_resolve_peers_industry_fallback_before_ai(monkeypatch):
    # Orphan (no theme) → industry cohort peers, NOT the AI fallback.
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(groups, "_industry_peers",
                        lambda seed, n: {"industry": "Banks - Regional", "peers": ["PNC", "USB"]})
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: ["SHOULD_NOT_USE"])
    out = groups.resolve_peers("ORPHANBK", 5)
    assert out["source"] == "industry"
    assert out["peers"] == ["PNC", "USB"]
    assert out["group_id"] == "industry:Banks - Regional"
    assert out["group_name"] == "Banks - Regional"


def test_resolve_peers_none_when_ai_empty(monkeypatch):
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(groups, "_industry_peers", lambda seed, n: None)
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: [])
    out = groups.resolve_peers("GHOST", 5)
    assert out == {"seed": "GHOST", "group_id": None, "peers": [], "source": "none"}


def test_resolve_peers_also_in_lists_other_memberships(monkeypatch):
    # A multi-membership seed exposes its OTHER groups so the UI can offer a switcher.
    seed_row = {"theme_id": "ai_gpu_chips", "theme_name": "AI / GPU Chips", "tier": "core", "sub_theme_id": None}
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: seed_row)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"NVDA", "AMD", "AVGO"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "NVDA", "tier": "core", "sub_theme_id": None},
                                     {"sym": "AMD", "tier": "core", "sub_theme_id": None}])
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [
        {"theme_id": "ai_gpu_chips", "theme_name": "AI / GPU Chips"},          # the primary — excluded
        {"theme_id": "semiconductors", "theme_name": "Semiconductors"},
        {"theme_id": "artificial_intelligence", "theme_name": "Artificial Intelligence"},
    ])
    out = groups.resolve_peers("NVDA", 3)
    assert {g["id"] for g in out["also_in"]} == {"semiconductors", "artificial_intelligence"}


def test_top_n_includes_group_etf(monkeypatch):
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "RKLB", "tier": "core", "rationale": "Launch"}])
    monkeypatch.setattr(groups, "rank_holdings",
                        lambda h, by="today", seed=None, seed_sub=None, scores_out=None: ["RKLB"])
    monkeypatch.setattr(groups, "_theme_etf",
                        lambda tid: "UFO" if tid == "space" else None)
    assert groups.top_n("space", 4, by="today")["etf"] == "UFO"
    monkeypatch.setattr(groups, "_theme_etf", lambda tid: None)
    assert groups.top_n("nustar", 4, by="today")["etf"] is None


from api.services import groups_gates


def _mock_gate_env(monkeypatch, enabled, metrics):
    monkeypatch.setattr(groups_gates, "gates_enabled", lambda: enabled)
    monkeypatch.setattr(groups_gates, "swing_metrics", lambda syms, rs, today: metrics)


def test_rank_holdings_flag_off_is_byte_identical(monkeypatch):
    # Same fixture as test_rank_holdings_today_then_fallbacks — gates OFF must
    # produce the identical order, and must NOT call swing_metrics.
    holdings = [
        {"sym": "AAA", "tier": "core"}, {"sym": "BBB", "tier": "core"},
        {"sym": "CCC", "tier": "relevant"}, {"sym": "DDD", "tier": "peripheral"},
    ]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "BBB", "CCC", "DDD"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"AAA": 5.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {"BBB": {"rs_rank": 80, "returns": {"1m": 3.0}},
                                                    "CCC": {"rs_rank": None, "returns": {"1m": 12.0}}})
    def _boom(*a, **k):
        raise AssertionError("swing_metrics must not run when gates are off")
    monkeypatch.setattr(groups_gates, "gates_enabled", lambda: False)
    monkeypatch.setattr(groups_gates, "swing_metrics", _boom)
    assert groups.rank_holdings(holdings, by="today") == ["AAA", "BBB", "CCC", "DDD"]


def test_rank_holdings_gated_liquidity_leads_and_fills(monkeypatch):
    # LIQUID (band0) leads; ILLIQUID (band2) sinks to backfill; UNCONFIRMED
    # (band1, e.g. fresh IPO) sits between. All names still present.
    holdings = [
        {"sym": "PENNY", "tier": "core"},   # confirmed illiquid, high today move
        {"sym": "IPO", "tier": "core"},     # unconfirmed (no screener row)
        {"sym": "LEAD", "tier": "core"},    # confirmed liquid + momentum
    ]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"PENNY", "IPO", "LEAD"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"PENNY": 9.0, "LEAD": 1.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    _mock_gate_env(monkeypatch, True, {
        "LEAD":  {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6},   # band0 mom2
        "PENNY": {"price": 2.0, "dollar_vol": 1e6, "rs_rank": 90, "adr_pct": 9},  # band2
        "IPO":   {"price": None, "dollar_vol": None, "rs_rank": None, "adr_pct": None},  # band1
    })
    assert groups.rank_holdings(holdings, by="today") == ["LEAD", "IPO", "PENNY"]


def test_rank_holdings_scores_out_populated_only_when_on(monkeypatch):
    holdings = [{"sym": "LEAD", "tier": "core"}]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"LEAD"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    _mock_gate_env(monkeypatch, True, {"LEAD": {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}})
    scores = {}
    groups.rank_holdings(holdings, by="today", scores_out=scores)
    assert scores["LEAD"] == 4      # liq2 + mom2


# ── Verified-review fixes (2026-07-19) ──────────────────────────────────────


def test_industry_peers_blocklists_catch_all_pseudo_industries(monkeypatch):
    # Broad-ETF / SPAC / closed-end-fund Finviz buckets are NOT peer sets —
    # _industry_peers must return None (caller falls through to grounded AI
    # peers) instead of filling the grid with a GLD/HYG/SLV grab-bag.
    from api.services import industry_map
    called = {"cohort": 0}
    monkeypatch.setattr(industry_map, "tickers_in_industry",
                        lambda ind: called.__setitem__("cohort", called["cohort"] + 1) or ["GLD", "HYG"])
    for bad in ["Exchange Traded Fund", "exchange traded fund", " Exchange Traded Fund ",
                "Shell Companies", "Closed-End Fund - Debt",
                "Closed-End Fund - Equity", "Closed-End Fund - Foreign"]:
        monkeypatch.setattr(industry_map, "get_industries",
                            lambda syms, _b=bad: {s: _b for s in syms})
        assert groups._industry_peers("SPY", 5) is None
    assert called["cohort"] == 0    # blocked industries never even build a cohort


def test_resolve_peers_etf_seed_falls_through_to_ai(monkeypatch):
    # SPY (a default grid cell) is in no theme; its Finviz industry is the
    # 'Exchange Traded Fund' catch-all — resolve_peers must skip the industry
    # branch entirely and land on the AI path (seed stays solo when AI is empty).
    from api.services import industry_map
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(industry_map, "get_industries",
                        lambda syms: {s: "Exchange Traded Fund" for s in syms})
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: [])
    out = groups.resolve_peers("SPY", 5)
    assert out["source"] == "none"
    assert out["peers"] == []
    assert out["group_id"] is None


def test_resolve_peers_taxonomy_includes_group_name(monkeypatch):
    # The taxonomy branch must carry the theme's display name — without it the
    # frontend header inherits the PREVIOUS group's name (verified mislabel bug).
    seed_row = {"theme_id": "space", "theme_name": "Space", "tier": "core", "sub_theme_id": None}
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: seed_row)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB", "ASTS"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "RKLB", "tier": "core"},
                                     {"sym": "ASTS", "tier": "core"}])
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])
    out = groups.resolve_peers("RKLB", 3)
    assert out["source"] == "taxonomy"
    assert out["group_id"] == "space"
    assert out["group_name"] == "Space"


def test_rank_holdings_dedupes_duplicate_syms(monkeypatch):
    # Grid contract: one cell per sym. A duplicate holdings row (overlay drift,
    # same sym in two sub-themes) must never yield the same sym twice.
    holdings = [
        {"sym": "AAA", "tier": "core"},
        {"sym": "BBB", "tier": "core"},
        {"sym": "AAA", "tier": "relevant"},     # dup — dropped
        {"sym": "aaa", "tier": "core"},         # dup after normalize — dropped
    ]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "BBB"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"AAA": 5.0, "BBB": 1.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    _mock_gate_env(monkeypatch, False, {})
    assert groups.rank_holdings(holdings, by="today") == ["AAA", "BBB"]


def test_industry_peers_cohort_bounded_and_cached(monkeypatch):
    # A big real industry (Biotechnology ~268 in-cap) must NOT fire a full-cohort
    # Massive batch on every typed commit: the snapshot sees at most
    # _INDUSTRY_COHORT_MAX names (pre-trimmed by cached RS), and a second commit
    # within the TTL reuses the cached ranking (zero extra snapshots).
    from api.services import industry_map
    cohort = [f"T{i:03d}" for i in range(200)]
    monkeypatch.setattr(industry_map, "get_industries",
                        lambda syms: {s: "Biotechnology" for s in syms})
    monkeypatch.setattr(industry_map, "tickers_in_industry", lambda ind: cohort)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: set(cohort))
    # RS: T000 best, descending; the last 100 names have no RS at all.
    monkeypatch.setattr(groups, "_rs_map",
                        lambda: {f"T{i:03d}": {"rs_rank": 100 - i} for i in range(100)})
    calls = {"today": 0, "sizes": []}
    def fake_today(syms):
        calls["today"] += 1
        calls["sizes"].append(len(syms))
        return {}
    monkeypatch.setattr(groups, "_today_map", fake_today)
    _mock_gate_env(monkeypatch, False, {})
    store = {}
    monkeypatch.setattr(groups.cache, "get", lambda k: store.get(k))
    monkeypatch.setattr(groups.cache, "set", lambda k, v, ttl: store.__setitem__(k, v))
    out1 = groups._industry_peers("ORPHANBIO", 5)
    assert out1["industry"] == "Biotechnology"
    assert len(out1["peers"]) == 5
    assert calls["today"] == 1
    assert calls["sizes"][0] <= groups._INDUSTRY_COHORT_MAX     # bounded batch
    assert out1["peers"][0] == "T000"          # top-RS names survive the pre-trim
    out2 = groups._industry_peers("T000", 5)   # different seed, same industry
    assert calls["today"] == 1                 # cache hit — no second snapshot
    assert "T000" not in out2["peers"]         # seed still excluded post-cache
    assert len(out2["peers"]) == 5


def test_ai_peer_raw_releases_semaphore_every_call(monkeypatch):
    # Each _ai_peer_raw call must return its semaphore permit — otherwise the
    # feature dead-locks after GROUPS_AI_PEERS_CONCURRENCY calls.
    class _Msgs:
        def create(self, **k):
            return type("M", (), {"content": [type("B", (), {"text": '["WDC","STX"]'})()]})()
    class _Client:
        messages = _Msgs()
        def with_options(self, **k):
            return self
    import api.services.engine as eng
    monkeypatch.setattr(eng, "_get_anthropic_client", lambda: _Client())
    meta = {"name": "SanDisk", "sector": "Technology", "industry": "Computer Storage"}
    # Call MORE times than there are permits — if the permit leaks, the 4th call
    # blocks ~timeout then returns []; with the fix every call returns the peers.
    for _ in range(6):
        assert groups._ai_peer_raw("SNDK", 5, meta) == ["WDC", "STX"]
    # A permit must still be free (all were released):
    got = groups._AI_PEERS_SEM.acquire(blocking=False)
    assert got is True
    groups._AI_PEERS_SEM.release()
