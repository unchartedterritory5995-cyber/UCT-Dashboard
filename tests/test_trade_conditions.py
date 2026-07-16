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


# ── bar_broadcaster T-path (Massive push feed) ─────────────────────────────────

def _push(bb, sym, p, s=100, c=None, t=1_700_000_000_000):
    bb.push_aggregate(sym, {"t": t, "p": p, "s": s, "c": c}, "T")


def _partial(bb, sym, tf="5"):
    with bb._lock:
        pr = bb._partials.get((sym, tf))
        return dict(pr) if pr else None


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
