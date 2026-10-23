"""The rare-pattern preview drawings (api/services/pattern_engine/rare_draw.py) and the IPO base round 3 port.

Synthetic bars only (tests/rare_fixtures.py). Each judged fault is a NEGATIVE that changes one thing about a
pattern that fires, and each negative is MUTATION-PROVED in place: switching off the guard(s) meant to catch it
makes the same bars fire, so the reject comes from that guard and not from something incidental.
"""
from __future__ import annotations

import copy
from unittest import mock

import pytest

from api.services import textbook_numbers
from api.services.pattern_engine import rare_draw as R
from api.services.pattern_engine import shape_draw as SD
from tests import rare_fixtures as F


def _cup(b, why=None):
    return R.cup_no_handle_drawing(b, len(b) - 1, _why=why)


def _htf(b, why=None):
    return R.high_tight_flag_drawing(b, len(b) - 1, _why=why)


def _lip_index(b):
    return max(range(len(b) - 61, len(b) - 59), key=lambda k: b[k]["h"])


# ============================================================ positives
def test_a_clean_cup_without_handle_fires_with_the_ceiling_bar_buy_point():
    b = F.cup_bars()
    d = _cup(b)
    assert d is not None
    li = _lip_index(b)
    assert d["buy_point"] == textbook_numbers.buy_point(b[li]["h"]) == round(b[li]["h"] + 0.10, 2)
    assert d["pivot"] == d["buy_point"]
    assert d["buy_label"] == "Cup w/o handle · Buy point %.2f" % d["buy_point"]
    assert d["shape"] == "cup-no-handle" and d["draw_round"] == R.CUP_NO_HANDLE_DRAW_ROUND
    assert d["giveback"] <= R.CNH_MAX_GIVEBACK and d["lip_vs_52w_high"] >= R.CNH_LIP_NEAR_HIGH
    assert d["end_t"] == b[-1]["t"] and d["start_t"] == b[li]["t"]


def test_a_clean_high_tight_flag_fires_with_the_ceiling_bar_buy_point():
    b = F.htf_bars()
    d = _htf(b)
    assert d is not None
    peak = max(x["h"] for x in b[-25:])
    assert d["buy_point"] == round(peak + 0.10, 2)
    assert d["buy_label"] == "High tight flag · Buy point %.2f" % d["buy_point"]
    assert d["pole_gain"] >= R.HTF_POLE_MIN_GAIN
    assert d["pole_max_dd"] <= R.HTF_POLE_MAX_DD and d["flag_tight"] <= R.HTF_FLAG_TIGHT


# ============================================================ the judged faults, cup
def test_a_spike_wick_never_becomes_the_cup_buy_point():
    clean = _cup(F.cup_bars())
    b = F.cup_bars()
    li = _lip_index(b)
    b[li + 2]["h"] = round(b[li]["h"] + 3.7, 4)       # a lone wick inside the lip zone, body far below
    d = _cup(b)
    assert d is not None
    assert d["buy_point"] == clean["buy_point"]
    assert d["buy_point"] != round(b[li + 2]["h"] + 0.10, 2)


def test_a_higher_spike_left_of_the_lip_rejects_the_cup():
    b = F.cup_bars()
    li = _lip_index(b)
    b[li - 4]["h"] = round(b[li]["h"] + 2.7, 4)
    why = []
    assert _cup(b, why) is None and why == ["higher_spike_left"]
    with mock.patch.object(R, "CNH_LEFT_WICK_ATR", 99):
        assert _cup(b) is not None


@pytest.mark.parametrize("kw, reasons, guards", [
    (dict(w_middle=0.5), {"w_closes", "w_lows"}, {"CNH_HUMP_MAX": 9, "CNH_LOW_HUMP_MAX": 9}),
    (dict(v_shape=True), {"v_shape", "v_left", "v_right"},
     {"CNH_MIN_ROUND": -1, "CNH_MAX_5BAR_DROP": 9, "CNH_MAX_5BAR_RISE": 9}),
    (dict(crash_at=0.3), {"crash_bar", "v_left"}, {"CNH_MAX_BAR_DROP": 9, "CNH_MAX_5BAR_DROP": 9}),
    (dict(prior_low=75.0), {"gives_back_the_advance"}, {"CNH_MAX_GIVEBACK": 9}),
    (dict(old_high=130.0), {"lip_under_old_high"}, {"CNH_LIP_NEAR_HIGH": 0}),
], ids=["W", "V", "crash", "gives_back_the_advance", "lip_under_52w_high"])
def test_each_judged_cup_fault_is_rejected_by_its_own_guard(kw, reasons, guards):
    b = F.cup_bars(**kw)
    why = []
    assert _cup(b, why) is None
    assert why and why[0] in reasons
    # mutation proof: with the guard(s) off the same bars fire
    with mock.patch.multiple(R, **guards):
        assert _cup(b) is not None


def test_the_giveback_rule_is_half_the_advance():
    # lip 100.3, prior low 54.7 -> run-up 45.6; a 20% cup gives back ~0.45 of it (fires); from 75 it is ~0.8
    assert R.CNH_MAX_GIVEBACK == 0.50
    assert _cup(F.cup_bars())["giveback"] < 0.5
    why = []
    _cup(F.cup_bars(prior_low=75.0), why)
    assert why == ["gives_back_the_advance"]


# ============================================================ the judged faults, high tight flag
@pytest.mark.parametrize("kw, reasons, guards", [
    (dict(staircase=True), {"pole_pullback"}, {"HTF_POLE_MAX_DD": 9}),
    (dict(stall=True), {"pole_stalls"}, {"HTF_STALL_BARS": 99}),
    (dict(loose=True), {"flag_loose"}, {"HTF_FLAG_TIGHT": 99}),
    (dict(sag=True), {"flag_sagging", "highs_sagging"}, {"HTF_CLOSE_MIN": 0, "HTF_HIGHS_HOLD": 0}),
], ids=["staircase_pole", "stalling_pole", "loose_flag", "sagging_flag"])
def test_each_judged_flag_fault_is_rejected_by_its_own_guard(kw, reasons, guards):
    b = F.htf_bars(**kw)
    why = []
    assert _htf(b, why) is None
    assert why and why[0] in reasons
    with mock.patch.multiple(R, **guards):
        assert _htf(b) is not None


def test_a_spike_wick_above_the_pole_is_never_the_flag_buy_point():
    # a lone wick ~3 ATR over the pole top: the ceiling bars leave it out, and a peak with a higher wick beside
    # it is not a clean new high, so the flag is withheld -- never drawn with the wick as its buy point
    b = F.htf_bars(spike_peak=True)
    why = []
    assert _htf(b, why) is None and why == ["peak_not_high"]


def test_a_wick_does_not_fake_a_pole_pullback():
    # the pole's running high is read on body tops: one tall wick mid-pole is not a staircase
    b = F.htf_bars()
    k = len(b) - 30
    b[k]["h"] = round(b[k]["h"] * 1.35, 4)
    why = []
    _htf(b, why)
    assert "pole_pullback" not in why and "pole_stalls" not in why


# ============================================================ no lookahead
@pytest.mark.parametrize("make, fn", [(F.cup_bars, _cup), (F.htf_bars, _htf)], ids=["cup", "htf"])
def test_no_lookahead(make, fn):
    b = make()
    i = len(b) - 1
    want = fn(b)
    assert want is not None
    future = copy.deepcopy(b) + [dict(b[-1], t=b[-1]["t"] + k, h=b[-1]["h"] * 3, l=b[-1]["l"] / 3,
                                      c=b[-1]["c"] * 2) for k in range(1, 40)]
    draw = R.cup_no_handle_drawing if fn is _cup else R.high_tight_flag_drawing
    assert draw(future, i) == want            # bars after i change nothing
    assert draw(b[:i + 1], i) == want


def test_the_drawings_never_raise_on_short_or_flat_series():
    for b in (F.bars_from([10.0] * 50), F.bars_from([10.0] * 700), []):
        assert R.cup_no_handle_drawing(b, len(b) - 1) is None
        assert R.high_tight_flag_drawing(b, len(b) - 1) is None


# ============================================================ IPO base round 3 (port)
def _ipo_bars():
    # a recent listing: a run-up, a top, a 20% base and a right side back near the top
    closes = F._ramp(20.0, 30.0, 20) + F._ramp(30.0, 24.0, 15) + F._ramp(24.0, 29.5, 15)
    return F.bars_from(closes, vols=[2_000_000] * len(closes))


def test_ipo_round_1_stays_the_default_and_round_3_is_only_drawn_when_asked():
    assert SD.IPO_BASE_DRAW_ROUND == 1 and SD.IPO_PREVIEW_ROUND == 3 and SD.IPO_ROUNDS == (1, 3)
    b = _ipo_bars()
    i = len(b) - 1
    r1 = SD.ipo_base_drawing(b, i, first_t=b[0]["t"])
    assert r1 == SD.ipo_base_drawing(b, i, first_t=b[0]["t"], rnd=1)
    if r1 is not None:
        assert r1["draw_round"] == 1
    with pytest.raises(ValueError):
        SD.ipo_base_drawing(b, i, first_t=b[0]["t"], rnd=2)


def test_ipo_round_3_fails_closed_on_an_unknown_or_shared_first_date():
    from api.services.screener import base_catalog as bc
    assert bc.ipo_listing_is_backfill(None) and bc.ipo_listing_is_backfill(5) and bc.ipo_listing_is_backfill(0)
    assert not bc.ipo_listing_is_backfill(1) and not bc.ipo_listing_is_backfill(4)
    b = _ipo_bars()
    i = len(b) - 1
    if SD.ipo_base_drawing(b, i, first_t=b[0]["t"]) is None:
        pytest.skip("synthetic IPO series does not fire round 1")
    why = []
    assert SD.ipo_base_drawing(b, i, first_t=b[0]["t"], rnd=3, first_t_shared=None, _why=why) is None
    assert why == ["r3_backfill_listing"]


def test_ipo_earlier_base_finds_a_base_before_the_top():
    from api.services.screener import base_catalog as bc
    closes = F._ramp(10.0, 20.0, 10) + F._ramp(20.0, 17.0, 10) + F._ramp(17.0, 19.9, 10) + F._ramp(19.9, 26.0, 10)
    b = F.bars_from(closes)
    top = max(range(len(b)), key=lambda k: b[k]["h"])
    assert bc.ipo_earlier_base(b, top) is not None
    assert bc.ipo_earlier_base(F.bars_from(F._ramp(10.0, 26.0, 40)), 39) is None
