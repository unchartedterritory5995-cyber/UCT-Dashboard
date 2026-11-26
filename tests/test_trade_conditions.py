"""Tests for SIP trade-condition filtering on the live-candle feeds.

Ghost prints (odd-lot / out-of-sequence / form-T / average-priced) must not move
the developing candle's high/low or last, but must still count toward volume —
matching how TC2000/TradingView filter the consolidated tape.
"""

import pytest

from api.services import trade_conditions as tc
from api.services import realtime_candle as rc
from api.services.bar_broadcaster import BarBroadcaster


@pytest.fixture(autouse=True)
def _enable_filter(monkeypatch):
    # The filter ships DEFAULT-OFF after the 2026-07-16 extended-hours incident;
    # these tests exercise the gating logic, so force it on.
    monkeypatch.setattr(tc, "FILTER_ENABLED", True)


# ── classify() ────────────────────────────────────────────────────────────────

def test_missing_or_empty_conditions_fully_eligible():
    assert tc.classify(None) == (True, True)
    assert tc.classify([]) == (True, True)


def test_regular_and_eligible_conditions():
    assert tc.classify([0]) == (True, True)   # Regular Sale
    assert tc.classify([14]) == (True, True)  # Intermarket Sweep — updates H/L + last


def test_odd_lot_blocks_both():
    assert tc.classify([37]) == (False, False)


def test_extended_hours_prints_stay_eligible():
    # Form-T (12) and ext-hours sold-OOS (13) are the LEGITIMATE extended session,
    # not ghosts — the client gates RTH-vs-ext by the toggle. Never filter them,
    # or the whole post-market session freezes (the NFLX earnings-flicker incident).
    assert tc.classify([12]) == (True, True)
    assert tc.classify([13]) == (True, True)


def test_out_of_sequence_and_synthetic_block_both():
    assert tc.classify([32]) == (False, False)  # Sold (Out of Sequence)
    assert tc.classify([33]) == (False, False)  # Sold (Out of Sequence)
    assert tc.classify([2]) == (False, False)   # Average Price Trade


def test_sold_last_marks_extreme_but_not_last():
    # Sold Last (30): a late print may set a high/low but is not the "last".
    assert tc.classify([30]) == (True, False)


def test_official_close_sets_last_not_high_low():
    assert tc.classify([15]) == (False, True)


def test_most_restrictive_condition_wins():
    assert tc.classify([0, 37]) == (False, False)


def test_numeric_string_codes_parse():
    assert tc.classify(["37"]) == (False, False)


def test_unknown_lettered_code_stays_eligible():
    # A vocabulary we don't recognize must never hide a real trade.
    assert tc.classify(["X", "@"]) == (True, True)


def test_disabled_filter_passes_everything(monkeypatch):
    monkeypatch.setattr(tc, "FILTER_ENABLED", False)
    assert tc.classify([37]) == (True, True)


# ── provider-load freeze guard (the 2026-07-16 NFLX ext-hours incident) ────────

def test_provider_rules_exclude_form_t_by_hardcoded_id():
    # Provider marks Form-T (12) high/low + last ineligible (RTH-consolidated
    # rules do). The parser MUST strip it, or the post-market session refreezes.
    results = [
        {"id": 12, "name": "Form T",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False}}},
        {"id": 37, "name": "Odd Lot Trade",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False}}},
    ]
    hl, last = tc._parse_provider_rules(results)
    assert 12 not in hl and 12 not in last   # Form-T stays eligible
    assert 37 in hl and 37 in last           # odd-lot still filtered


def test_provider_rules_exclude_extended_hours_by_name_even_with_novel_id():
    # THE hardening: if the feed ever numbers Form-T / extended-hours with an ID
    # we don't hardcode, the NAME still exempts it — the freeze can't sneak back.
    results = [
        {"id": 999, "name": "Extended Trading Hours (Sold Out Of Sequence)",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False}}},
        {"id": 888, "name": "Form T / Extended Hours",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False}}},
    ]
    hl, last = tc._parse_provider_rules(results)
    assert not hl and not last               # both exempted by name


def test_provider_rules_keep_genuine_ghosts_filtered():
    # A real out-of-sequence ghost (not an extended-hours marker) must stay filtered.
    results = [
        {"id": 32, "name": "Sold (Out Of Sequence)",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False}}},
    ]
    hl, last = tc._parse_provider_rules(results)
    assert 32 in hl and 32 in last


def test_is_session_condition_matches_only_extended_markers():
    assert tc._is_session_condition("Form T")
    assert tc._is_session_condition("Extended Trading Hours")
    assert not tc._is_session_condition("Sold (Out Of Sequence)")
    assert not tc._is_session_condition("Odd Lot Trade")
    assert not tc._is_session_condition(None)


# ── bar_broadcaster T-path (Massive push feed) ─────────────────────────────────

def _push(bb, sym, p, s=100, c=None, t=1_700_000_000_000):
    bb.push_aggregate(sym, {"t": t, "p": p, "s": s, "c": c}, "T")


def _partial(bb, sym, tf="5"):
    return bb.get_partial(sym, tf)


def test_broadcaster_ghost_wick_blocked_volume_kept():
    bb = BarBroadcaster()
    _push(bb, "T", 100.0, c=[0])                    # open regular
    _push(bb, "T", 105.0, s=1, c=[37])             # odd-lot spike — ghost
    b = _partial(bb, "T")
    assert b["h"] == 100.0 and b["c"] == 100.0      # high/last unchanged
    assert b["v"] == 101                            # volume still counts the odd-lot
    _push(bb, "T", 90.0, s=50, c=[33])             # out-of-seq low — ghost
    b = _partial(bb, "T")
    assert b["l"] == 100.0                          # low unchanged by the ghost


def test_broadcaster_eligible_trades_move_ohlc():
    bb = BarBroadcaster()
    _push(bb, "R", 100.0, c=[0])
    _push(bb, "R", 101.0, c=[0])
    _push(bb, "R", 99.0, c=[0])
    b = _partial(bb, "R")
    assert b["h"] == 101.0 and b["l"] == 99.0 and b["c"] == 99.0


def test_broadcaster_oddlot_does_not_seed_new_bar():
    bb = BarBroadcaster()
    _push(bb, "S", 500.0, s=1, c=[37])             # only an odd-lot this minute
    assert _partial(bb, "S") is None               # no ghost-priced bar created


# ── realtime_candle.apply_tick eligibility flags (Finnhub fallback) ────────────

def test_apply_tick_gates_hl_and_last_keeps_volume():
    rc._state.clear()
    rc.apply_tick("A", price=100.0, ts=1_700_000_000, size=100, tf="1")
    rc.apply_tick("A", price=105.0, ts=1_700_000_001, size=1, tf="1",
                  update_hl=False, update_last=False)
    cur = rc.get_current("A", "1")
    assert cur["h"] == 100.0 and cur["c"] == 100.0 and cur["v"] == 101


def test_apply_tick_ineligible_does_not_open_bar():
    rc._state.clear()
    rc.apply_tick("B", price=50.0, ts=1_700_000_000, size=1, tf="1",
                  update_hl=False, update_last=False)
    assert rc.get_current("B", "1") is None


# ── D10: Finnhub codes are not SIP codes ───────────────────────────────────────

def test_finnhub_codes_are_never_classified_with_the_sip_table(monkeypatch):
    monkeypatch.setattr(tc, "FILTER_ENABLED", True)
    assert tc.classify([37], source="sip") == (False, False)       # SIP odd lot
    assert tc.classify([37], source="finnhub") == (True, True)     # unknown table => eligible
    assert tc.classify(["37"], source="finnhub") == (True, True)


def test_finnhub_trade_path_passes_its_source(monkeypatch):
    from api.services import realtime_stream as rs
    seen = []
    monkeypatch.setattr(rs.trade_conditions, "classify",
                        lambda c, source="sip": seen.append(source) or (True, True))
    rs._process_finnhub_trade({"s": "ZZZ", "p": 1.0, "t": 1_700_000_000_000, "v": 1, "c": ["37"]})
    assert seen == ["finnhub"]


def test_filter_defaults_on():
    """Correct by default: unset env => the SIP ghost-print filter is ON."""
    import inspect
    assert 'os.environ.get("TRADE_CONDITION_FILTER_ENABLED", "1") == "1"' in inspect.getsource(tc)


# ── the volume rule (2026-11-25, candle-accuracy audit class 1) ─────────────────
# The vendor's minute bar adds a print's size only when its conditions update consolidated volume. Before
# this, the developing bar summed EVERY print: an official open / close report (15/16) or a corrected
# consolidated close (38) inflated the developing volume until that minute's AM replaced it.

@pytest.fixture
def _fallback_rules(monkeypatch):
    monkeypatch.setattr(tc, "_hl_ineligible", set(tc._HL_INELIGIBLE_FALLBACK) - tc._SESSION_CODES)
    monkeypatch.setattr(tc, "_last_ineligible", set(tc._LAST_INELIGIBLE_FALLBACK) - tc._SESSION_CODES)
    monkeypatch.setattr(tc, "_vol_ineligible", set(tc._VOL_INELIGIBLE_FALLBACK) - tc._SESSION_CODES)


def test_classify3_volume_verdicts(_fallback_rules):
    assert tc.classify3([15]) == (False, True, False)    # MC official close: sets last, not h/l, not volume
    assert tc.classify3([16]) == (False, True, False)    # MC official open
    assert tc.classify3([38]) == (False, True, False)    # corrected consolidated close
    assert tc.classify3([37]) == (False, False, True)    # an odd lot is a real trade: volume only
    assert tc.classify3([0]) == (True, True, True)
    assert tc.classify3([0, 15]) == (False, True, False)  # the most restrictive condition wins, per metric
    assert tc.classify3([12, 15]) == (False, True, False)
    assert tc.classify3(None) == (True, True, True)
    assert tc.classify3([15], source="finnhub") == (True, True, True)   # not a SIP table: never classified


def test_classify_keeps_its_two_value_shape(_fallback_rules):
    assert tc.classify([15]) == (False, True)
    assert tc.classify([37]) == (False, False)


def test_volume_rule_is_off_with_the_filter(_fallback_rules, monkeypatch):
    monkeypatch.setattr(tc, "FILTER_ENABLED", False)
    assert tc.classify3([15]) == (True, True, True)


def test_provider_parse_reads_updates_volume():
    results = [
        {"id": 15, "name": "Market Center Official Close",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": True,
                                           "updates_volume": False}}},
        {"id": 37, "name": "Odd Lot Trade",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False,
                                           "updates_volume": True}}},
        {"id": 12, "name": "Form T",
         "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": False,
                                           "updates_volume": False}}},
        {"id": 41, "name": "Trade Thru Exempt",
         "update_rules": {"consolidated": {"updates_high_low": True, "updates_open_close": True}}},
    ]
    hl, last, vol = tc._parse_provider_rules3(results)
    assert vol == {15}                       # 37 updates volume; 12 is the session exemption; 41 says nothing
    assert hl == {15, 37} and last == {37}
    assert tc._parse_provider_rules(results) == (hl, last)   # the two-set shape is unchanged


def test_provider_load_installs_the_volume_set(monkeypatch):
    class _R:
        def raise_for_status(self):
            return None

        def json(self):
            return {"results": [
                {"id": 15, "name": "Market Center Official Close",
                 "update_rules": {"consolidated": {"updates_high_low": False, "updates_open_close": True,
                                                   "updates_volume": False}}},
                {"id": 99, "name": "Synthetic",
                 "update_rules": {"consolidated": {"updates_high_low": True, "updates_open_close": True,
                                                   "updates_volume": False}}}]}

    import httpx
    monkeypatch.setenv("MASSIVE_API_KEY", "test-not-a-key")
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _R())
    monkeypatch.setattr(tc, "_loaded_from_provider", False)
    monkeypatch.setattr(tc, "_hl_ineligible", set(tc._hl_ineligible))
    monkeypatch.setattr(tc, "_last_ineligible", set(tc._last_ineligible))
    monkeypatch.setattr(tc, "_vol_ineligible", set(tc._vol_ineligible))
    tc.load_from_provider()
    assert tc._loaded_from_provider is True
    assert tc._vol_ineligible == {15, 99}
    assert tc.classify3([99]) == (True, True, False)


def test_broadcaster_official_close_moves_the_close_not_volume_or_high_low(_fallback_rules):
    bb = BarBroadcaster()
    _push(bb, "V", 100.0, s=100, c=[0])
    _push(bb, "V", 102.0, s=100, c=[0])
    _push(bb, "V", 101.0, s=5000, c=[15])           # the official close report, inside the range
    b = _partial(bb, "V")
    assert b["c"] == 101.0                          # it IS the last sale (updates_open_close)
    assert (b["h"], b["l"]) == (102.0, 100.0)       # not a high/low
    assert b["v"] == 200                            # and not volume: the vendor's AM leaves it out


def test_broadcaster_odd_lot_adds_volume_only(_fallback_rules):
    bb = BarBroadcaster()
    _push(bb, "W", 100.0, s=100, c=[0])
    _push(bb, "W", 104.0, s=7, c=[37])
    b = _partial(bb, "W")
    assert (b["h"], b["l"], b["c"], b["v"]) == (100.0, 100.0, 100.0, 107)
