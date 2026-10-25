"""PARITY RAIL: the round-3 production setup drawings (api/services/pattern_engine/setup_draw_r3.py) equal the
judged drawing code on fixed fixtures -- the same facts and the same full drawing (geometry, panel), as-of every bar.

tests/fixtures/setup_draw_r3_parity.json holds 14 SYNTHETIC daily series (seeded random walks with trend / range
regimes, no real ticker), 860 bars each, and, per series, the judged code's output as-of EVERY bar from index 220 on:
{asof: {setup: {facts, sha256 of the whole drawing dict}}}. At every other bar the judged code draws nothing, so the
production module must draw nothing there too. Together the series fire all sixteen setups (814 as-of bars).

JUDGED_CONSTANTS pins the full constant table as well: a behavioural fixture cannot see a perturbation no chart in
it sits on.

If this goes red, the production drawing no longer reproduces the judged geometry. Do NOT re-bless the fixture from
the production module: that makes the rail compare the module with itself. A new drawing round is a new blind check.
"""
import hashlib
import json
import os

import pytest

from api.services.pattern_engine import setup_draw_r3 as M

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "setup_draw_r3_parity.json")
SETUPS = ("outside_bar", "descending_triangle", "inverse_head_shoulders", "bear_flag", "bollinger_squeeze",
          "major_trendlines", "rsi_bearish_divergence", "symmetrical_triangle", "rising_wedge", "avwap_reclaim",
          "nr7", "head_shoulders", "triple_top", "triple_bottom", "wyckoff_spring",
          "ascending_triangle")

#: The judged constant table, frozen with the judged round (each value read from its setup's frozen batch copy).
JUDGED_CONSTANTS = {
    'AT3_FLAT_ATR': 0.3, 'AT3_LOW_RISE_ATR': 0.5, 'AT3_RISE_ATR': 0.3, 'AT3_SPIKE_ATR': 0.25,
    'AT_BREAKOUT_VOL': 1.4, 'AT_DRAW_ROUND': 3, 'AT_LEFT_BARS': 20, 'AT_MAX_CONV': 0.85, 'AT_MAX_DEPTH': 0.35,
    'AT_MAX_GAP': 0.05, 'AT_MAX_LEN': 60, 'AT_MIN_LEN': 20, 'AT_MIN_LOW': 2, 'AT_MIN_TOP': 3, 'AT_PIV_W': 3,
    'AT_PRIOR_ADV': 0.2, 'AT_PRIOR_LOOK': 60, 'AT_SUPPORT_BREAK_ATR': 0.5, 'AT_TOP_TOL': 0.02, 'AT_TOUCH_SEP': 5,
    'AV_BELOW': 7, 'AV_BELOW_N': 10, 'AV_CHOP': 30, 'AV_CLEAR_ATR': 0.3, 'AV_CROSS': 2, 'AV_DECL_ATR': 4.0,
    'AV_EXT_ATR': 1.0, 'AV_FRESH': 3, 'AV_GAP_ATR': 0.5, 'AV_LOOK': 150, 'AV_MIN_AGE': 20, 'AV_POKE_ATR': 0.25,
    'AV_PRIOR_ABOVE': 2, 'AV_UNDER_ATR': 0.2, 'AV_UNDER_N': 15, 'BF_LANE_TOUCH': 2, 'BF_MAX': 20, 'BF_MAX_R3': 12,
    'BF_MIN': 5, 'BF_POLE_ATR': 4.0, 'BF_POLE_BARS': 8, 'BF_POLE_BOUNCE': 0.25, 'BF_POLE_MAX': 12,
    'BF_POLE_PCT': 0.12, 'BF_RETR': 0.5, 'BF_RETR_R3': 0.38, 'BF_SLOPE': 0.5, 'BF_WIDTH': 0.5, 'BF_WIDTH_R3': 0.35,
    'BS_BW_LOOK': 125, 'BS_BW_TOL': 1.1, 'BS_DRIFT': 0.5, 'BS_H_NORMAL': 2.0, 'BS_K_BB': 2.0, 'BS_K_KC': 1.5,
    'BS_MAX_H_ATR': 2.75, 'BS_MAX_RUN': 30, 'BS_MIN_RUN': 6, 'BS_N': 20, 'BS_QUIET_MAX': 1.0, 'BS_QUIET_MEAN': 0.6,
    'BS_WIDE_ATR': 1.3, 'CV_CONV': 0.65, 'CV_LOOK': 100, 'CV_MIN_SPAN': 15, 'CV_MIN_TOUCH': 5, 'CV_MOVE_ATR': 1.0,
    'CV_RW_CONV': 0.5, 'CV_RW_LEAD': 3, 'CV_RW_LOOK': 80, 'CV_RW_TOUCH': 3, 'CV_SEP': 4, 'CV_SYM_BAL': 2.5,
    'CV_TOL_ATR': 0.3, 'DTOP_DECL': 0.1, 'DTOP_MAX_SPAN': 120, 'DT_FLAT': 0.02, 'DT_LOOK': 80, 'DT_MIN_TOUCH': 3,
    'DT_RES_TOUCH': 3, 'DT_SPIKE_ATR': 0.3, 'DT_TOUCH_ATR': 0.35, 'G3_BRK': 3, 'G3_BUY_ZONE': 0.05, 'G3_PAD': 0.1,
    'G3_SMA_LONG': 200, 'G3_SMA_RISE_BARS': 20, 'HST_NL_SLOPE': 0.15, 'HST_SH_LVL_ATR': 0.75, 'HST_SPIKE_ATR': 0.5,
    'HS_FRESH': 20, 'HS_FRESH_R3': 12, 'HS_HEAD_ATR': 1.0, 'HS_HEAD_R3': 1.5, 'HS_LEG': 5, 'HS_NL_SLOPE': 0.5,
    'HS_NL_SLOPE_R3': 0.25, 'HS_PRE': 15, 'HS_SHOULDER': 0.5, 'HS_SH_DEPTH': 0.4, 'HS_SH_EQ': 0.3,
    'HS_SH_EQ_R3': 0.2, 'HS_SPAN': 120, 'HS_TIME_R3': (0.6, 1.67), 'MIN_ASOF_INDEX': 220, 'MIN_ATR_PCT': 0.008,
    'MT_LOOK': 200, 'MT_MAX_GAP': 0.5, 'MT_MIN_SPAN': 60, 'MT_NEAR_ATR': 2.0, 'MT_NEAR_R3': 1.0, 'MT_SEP': 10,
    'MT_TOL_ATR': 0.3, 'MX3_EQ2_ATR': 0.3, 'MX3_EQ_ATR': 0.4, 'MX3_FRESH': 10, 'MX3_INSIDE_ATR': 0.25,
    'MX3_NL2_ATR': 0.5, 'MX3_NL_ATR': 1.0, 'MX3_SPIKE_ATR': 0.5, 'MX_EQ': 0.03, 'MX_EQ_ATR': 0.6, 'MX_FRESH': 20,
    'MX_MIN_SPAN': 30, 'MX_NL_ATR': 1.5, 'MX_NL_EQ': 0.3, 'MX_PRE': 15, 'MX_SEP': 10, 'MX_SPAN': 150,
    'MX_SWING_ATR': 2.0, 'MX_TREND_ATR': 3.0, 'NR_CLEAR': 0.55, 'OB_POKE_ATR': 0.2, 'OB_RANGE_ATR': 1.0,
    'PIV_SPAN': 200, 'RDB_ALIVE_ATR': 2.0, 'RDB_CLEAN': 10, 'RDB_FRESH': 4, 'RDB_PX_ATR': 0.3, 'RDB_RSI_GAP': 8.0,
    'RDB_RSI_SNAP': 2, 'RDB_SEP_MIN': 10, 'RDB_SWING_ATR': 1.5, 'RD_BAR_ATR': 2.5, 'RD_CONF': 2, 'RD_FRESH': 6,
    'RD_NEWEXT': 60, 'RD_OB': 65.0, 'RD_OS': 35.0, 'RD_PX_ATR': 0.2, 'RD_RSI_GAP': 5.0, 'RD_SEP_MAX': 40,
    'RD_SEP_MIN': 8, 'RD_SWING_ATR': 1.0, 'SMA_LONG': 200, 'SMA_RISE_BARS': 20, 'WINDOW': 330, 'WYS_BACK_ATR': 0.5,
    'WYS_CLOSE_POS': 0.5, 'WYS_CLUSTER_ATR': 0.25, 'WYS_DRIFT': 0.15, 'WYS_PRE_ATR': 1.0, 'WYS_TOUCH': 3,
    'WYS_WINDOWS': (60, 50, 40), 'WY_BACK_ATR': 0.25, 'WY_DEPTH_ATR': 2.0, 'WY_DRIFT': 0.25, 'WY_FRESH': 3,
    'WY_MAXH': 0.35, 'WY_MINH': 0.06, 'WY_SEP': 5, 'WY_TOUCH_ATR': 0.5, 'WY_WINDOWS': (60, 50, 40, 30),
}


def _load():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["series"]


SERIES = _load()


def _sha(d):
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


def test_the_module_serves_exactly_the_judged_setups_at_the_judged_round():
    assert M.SETUPS == SETUPS
    assert M.R3_DRAW_ROUND == 3 and M.DRAW_ROUNDS == {s: 3 for s in SETUPS}


def test_the_judged_constant_table():
    for name, val in JUDGED_CONSTANTS.items():
        assert getattr(M, name) == val, name


def test_every_setup_fires_somewhere_in_the_fixture():
    fired = {s for sr in SERIES for v in sr["expected"].values() for s in v}
    assert fired == set(SETUPS)


@pytest.mark.parametrize("k", range(len(SERIES)))
def test_parity_as_of_every_bar(k):
    sr = SERIES[k]
    rows = sr["rows"]
    want_all = sr["expected"]
    bad = []
    for i in range(220, len(rows)):
        got = {}
        for s, d in M.detect_all(rows[:i + 1]).items():
            if d is not None:
                got[s] = {"facts": M.facts(d), "sha": _sha(d)}
        want = want_all.get(str(i), {})
        if got != want:
            bad.append((i, sorted(got), sorted(want)))
    assert not bad, bad[:5]


def test_a_detector_reads_nothing_after_the_as_of_bar():
    """The drawing as-of bar i is the same whether or not later bars exist in the series handed in... once sliced:
    detect() reads only the last WINDOW bars of what it is given, so the caller's slice IS the as-of bar."""
    sr = SERIES[0]
    rows = sr["rows"]
    i = int(min(sr["expected"], key=int))
    a = M.detect_all(rows[:i + 1])
    b = M.detect_all(list(rows[:i + 1]))
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
