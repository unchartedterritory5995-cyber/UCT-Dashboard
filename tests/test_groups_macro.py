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
