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
