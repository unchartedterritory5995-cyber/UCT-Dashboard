from api.services import groups


def test_macro_roster_is_16_names_core_first():
    assert groups.MACRO_CORE == ("SPY", "QQQ", "IWM", "DIA")
    assert len(groups.MACRO_ROSTER) == 16
    assert groups.MACRO_ROSTER[:4] == groups.MACRO_CORE
    assert len(set(groups.MACRO_ROSTER)) == 16          # no dupes


def test_macro_triggers_exclude_theme_fronting_etfs():
    """SMH/ARKK/IBIT/XLF front real themes — typing them must route THERE,
    not to the macro board. They stay roster MEMBERS, just not triggers."""
    for sym in ("SMH", "ARKK", "IBIT", "XLF"):
        assert sym in groups.MACRO_ROSTER
        assert sym not in groups.MACRO_TRIGGERS
    for sym in ("SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "VIXY", "VOO", "RSP"):
        assert sym in groups.MACRO_TRIGGERS


def test_macro_order_pins_core_then_sorts_rest_by_absolute_move():
    today = {"VIXY": -1.0, "TLT": 0.4, "GLD": 6.0, "SMH": -5.0, "SPY": 9.9}
    out = groups._macro_order(today)
    assert out[:4] == ["SPY", "QQQ", "IWM", "DIA"]       # core pinned despite SPY's move
    assert out[4:8] == ["GLD", "SMH", "VIXY", "TLT"]     # |6.0| > |-5.0| > |-1.0| > |0.4|


def test_macro_order_no_data_names_keep_curated_order_behind_movers():
    out = groups._macro_order({"GLD": 3.0})
    assert out[4] == "GLD"
    # everything else has no datum -> curated MACRO_REST order, GLD removed
    assert out[5:] == [s for s in groups.MACRO_REST if s != "GLD"]


def test_macro_order_cold_snapshot_is_the_curated_roster():
    assert groups._macro_order({}) == list(groups.MACRO_ROSTER)


def test_macro_order_puts_the_seed_first_without_duplicating_it():
    out = groups._macro_order({}, seed="iwm")
    assert out[0] == "IWM"
    assert out.count("IWM") == 1
    assert out[1:4] == ["SPY", "QQQ", "DIA"]


def test_macro_order_seed_outside_the_roster_is_still_prepended():
    """VOO is a trigger but not a roster member — typing it must still show VOO."""
    out = groups._macro_order({}, seed="VOO")
    assert out[0] == "VOO"
    assert out[1:5] == list(groups.MACRO_CORE)
    assert len(out) == 17


def test_macro_board_bounds_to_n_and_snapshots_the_whole_roster(monkeypatch):
    seen = {}

    def _fake_today(syms):
        seen["syms"] = list(syms)
        return {"GLD": 4.0}

    monkeypatch.setattr(groups, "_today_map", _fake_today)
    out = groups.macro_board(9)
    assert len(out) == 9
    assert out[:5] == ["SPY", "QQQ", "IWM", "DIA", "GLD"]
    assert set(seen["syms"]) == set(groups.MACRO_ROSTER)   # ONE batch, 16 syms


def test_macro_board_2x2_is_exactly_the_core_four(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"VIXY": 20.0})
    assert groups.macro_board(4) == ["SPY", "QQQ", "IWM", "DIA"]


def test_macro_board_4x4_shows_all_16(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    assert groups.macro_board(16) == list(groups.MACRO_ROSTER)


def test_macro_board_seed_leads(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    assert groups.macro_board(5, seed="TLT")[0] == "TLT"


def test_macro_board_never_returns_empty_on_a_bad_snapshot(monkeypatch):
    def _boom(_syms):
        raise RuntimeError("massive down")

    monkeypatch.setattr(groups, "_today_map", _boom)
    assert groups.macro_board(9) == list(groups.MACRO_ROSTER)[:9]


def _stub_themes(monkeypatch, rows):
    monkeypatch.setattr(groups, "_get_all_themes", lambda: {"sectors": [], "themes": rows})
    monkeypatch.setattr(groups, "_rotation_order", lambda: {})


def test_list_groups_pins_macro_first(monkeypatch):
    _stub_themes(monkeypatch, [
        {"id": "space", "name": "Space", "sector_id": "innovation", "etf_ticker": "UFO",
         "sub_themes": [], "holdings": [{"sym": "RKLB"}]},
    ])
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB"})
    out = groups.list_groups()
    assert out[0]["id"] == groups.MACRO_GROUP_ID
    assert out[0]["name"] == "Index & Macro"
    assert out[0]["sector_id"] == "macro"
    assert out[0]["etf_ticker"] is None
    assert out[0]["total"] == 16 and out[0]["chartable"] == 16
    assert out[0]["sub_theme_count"] == 0
    assert [r["id"] for r in out[1:]] == ["space"]      # themes still follow


def test_top_n_serves_the_macro_board(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_ranked_as_of", lambda: "closed")
    out = groups.top_n(groups.MACRO_GROUP_ID, 9)
    assert out["group_id"] == groups.MACRO_GROUP_ID
    assert out["syms"] == list(groups.MACRO_ROSTER)[:9]
    assert out["etf"] is None                           # pinEtf must be a no-op
    assert out["total"] == 16
    assert out["by"] == "today"
    assert [r["sym"] for r in out["rows"]] == out["syms"]
    assert [r["tier"] for r in out["rows"][:4]] == ["core"] * 4
    assert out["rows"][4]["tier"] == "relevant"
    assert all(r["source"] == "owner" for r in out["rows"])   # no engine dot


def test_top_n_macro_never_touches_theme_db(monkeypatch):
    """A macro top_n must not query holdings — it isn't a theme."""
    def _boom(_id):
        raise AssertionError("theme_db must not be queried for the macro group")

    monkeypatch.setattr(groups, "_theme_holdings", _boom)
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_ranked_as_of", lambda: "closed")
    assert groups.top_n(groups.MACRO_GROUP_ID, 4)["syms"] == list(groups.MACRO_CORE)


def test_theme_peers_payload_shape(monkeypatch):
    holdings = [
        {"sym": "AAA", "tier": "core", "source": "owner"},
        {"sym": "BBB", "tier": "core", "source": "engine"},
        {"sym": "SEED", "tier": "core", "source": "owner"},
    ]
    monkeypatch.setattr(groups, "_theme_holdings", lambda tid: holdings)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "BBB", "SEED"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"AAA": 3.0, "BBB": 1.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])
    out = groups._theme_peers_payload("space", "Space", "SEED", None, "SEED", 8)
    assert out["group_id"] == "space"
    assert out["group_name"] == "Space"
    assert out["seed"] == "SEED"
    assert out["source"] == "taxonomy"
    assert out["peers"] == ["AAA", "BBB"]          # seed excluded, ranked
    assert out["sources"] == {"AAA": "owner", "BBB": "engine"}
    assert out["also_in"] == []


_ETF_THEMES = [
    {"id": "semiconductors", "name": "Semiconductors", "sector_id": "tech",
     "etf_ticker": "SMH", "sub_themes": [],
     "holdings": [{"sym": "NVDA", "tier": "core"}, {"sym": "AVGO", "tier": "core"}]},
    {"id": "financials_broad", "name": "Financials", "sector_id": "fin",
     "etf_ticker": "XLF", "sub_themes": [], "holdings": [{"sym": "JPM", "tier": "core"}]},
]


def _stub_etf_themes(monkeypatch):
    groups._ETF_THEME_CACHE["map"] = None
    monkeypatch.setattr(groups, "_get_all_themes", lambda: {"themes": _ETF_THEMES})
    # Holdings must be stubbed too: without this the test silently reads the REAL
    # theme DB, and any earlier test that repoints theme_db (theme_engine /
    # theme_curation conftests do) empties it -> peers == [] only in a full run.
    monkeypatch.setattr(
        groups, "_theme_holdings",
        lambda tid: [dict(h) for h in next(
            (t["holdings"] for t in _ETF_THEMES if t["id"] == tid), [])])
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"NVDA", "AVGO", "JPM"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])


def test_etf_theme_map_indexes_every_etf_backed_theme(monkeypatch):
    _stub_etf_themes(monkeypatch)
    m = groups._etf_theme_map()
    assert m["SMH"] == ("semiconductors", "Semiconductors")
    assert m["XLF"] == ("financials_broad", "Financials")


def test_typing_a_theme_etf_resolves_to_that_theme(monkeypatch):
    """SMH is a theme's etf_ticker, not a holding — before this it dead-ended."""
    _stub_etf_themes(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    out = groups.resolve_peers("SMH", 8)
    assert out["group_id"] == "semiconductors"
    assert out["group_name"] == "Semiconductors"
    assert out["source"] == "taxonomy"
    assert set(out["peers"]) == {"NVDA", "AVGO"}


def test_etf_front_never_overrides_a_real_membership(monkeypatch):
    """A seed that is BOTH a holding and an etf_ticker (IBIT) keeps its
    membership theme — step 1 wins over step 2."""
    _stub_etf_themes(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_id": "financials_broad",
                                   "theme_name": "Financials", "sub_theme_id": None})
    out = groups.resolve_peers("SMH", 8)
    assert out["group_id"] == "financials_broad"


def test_etf_front_is_case_and_dot_insensitive(monkeypatch):
    _stub_etf_themes(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    assert groups.resolve_peers("smh", 8)["group_id"] == "semiconductors"


def _stub_orphan(monkeypatch):
    """Seed resolves to no theme, no ETF-front, and the industry/AI fallbacks
    would fire — so anything that lands on macro got there on purpose."""
    groups._ETF_THEME_CACHE["map"] = None
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(groups, "_etf_theme_map", lambda: {})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_industry_peers",
                        lambda s, n: {"industry": "Banks - Regional", "peers": ["WAL"]})
    monkeypatch.setattr(groups, "_ai_peers", lambda s, n: [])


def test_typing_spy_fills_the_macro_board(monkeypatch):
    _stub_orphan(monkeypatch)
    out = groups.resolve_peers("SPY", 8)
    assert out["group_id"] == "index_macro"
    assert out["group_name"] == "Index & Macro"
    assert out["source"] == "macro"
    assert out["seed"] == "SPY"
    assert out["peers"] == ["QQQ", "IWM", "DIA", "VIXY", "SMH", "ARKK", "IBIT", "TLT"]
    assert "SPY" not in out["peers"]          # seed never duplicated into a peer cell


def test_typing_a_macro_trigger_outranks_the_industry_cohort(monkeypatch):
    """TLT's industry cohort would otherwise win — macro must be checked first."""
    _stub_orphan(monkeypatch)
    out = groups.resolve_peers("TLT", 8)
    assert out["group_id"] == "index_macro"
    assert out["peers"][:4] == ["SPY", "QQQ", "IWM", "DIA"]


def test_a_non_trigger_orphan_still_falls_through_to_industry(monkeypatch):
    _stub_orphan(monkeypatch)
    out = groups.resolve_peers("WAL", 8)
    assert out["group_id"] == "industry:Banks - Regional"
    assert out["source"] == "industry"


def test_macro_never_outranks_a_real_theme_membership(monkeypatch):
    """XLK is a macro trigger; if it ever GAINS a theme membership the theme wins."""
    _stub_orphan(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_id": "software", "theme_name": "Software",
                                   "sub_theme_id": None})
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "MSFT", "tier": "core"}])
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"MSFT"})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])
    out = groups.resolve_peers("XLK", 8)
    assert out["group_id"] == "software"


def test_macro_peers_returns_none_for_a_non_trigger():
    assert groups._macro_peers("NVDA", 8) is None


def test_macro_peers_respects_n(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    assert len(groups._macro_peers("SPY", 3)["peers"]) == 3
