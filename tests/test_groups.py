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
    monkeypatch.setattr(groups, "rank_holdings", lambda h, by="today", seed=None: ["RKLB", "ASTS"])
    out = groups.top_n("space", 2, by="today")
    assert out["syms"] == ["RKLB", "ASTS"]
    assert out["rows"][0] == {"sym": "RKLB", "tier": "core", "rationale": "Launch"}


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
