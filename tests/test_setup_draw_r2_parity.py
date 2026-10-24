"""PARITY RAIL: the round-2 production setup drawings (api/services/pattern_engine/setup_draw_r2.py) equal the
judged drawing code on fixed fixtures -- the same facts and the same full drawing (geometry, panel), as-of every bar.

tests/fixtures/setup_draw_r2_parity.json holds 4 SYNTHETIC daily series (seeded random walks with trend / range
regimes, no real ticker), 860 bars each, and, per series, the judged code's output as-of EVERY bar from index 220 on:
{asof: {setup: {facts, sha256 of the whole drawing dict}}}. At every other bar the judged code draws nothing, so the
production module must draw nothing there too. Together the series fire all nine setups (2,560 as-of bars).

JUDGED_CONSTANTS pins the full constant table as well: a behavioural fixture cannot see a perturbation no chart in
it sits on.

If this goes red, the production drawing no longer reproduces the judged geometry. Do NOT re-bless the fixture from
the production module: that makes the rail compare the module with itself. A new drawing round is a new blind check.
"""
import hashlib
import json
import os

import pytest

from api.services.pattern_engine import setup_draw_r2 as M

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "setup_draw_r2_parity.json")
SETUPS = ("rsi_bullish_divergence", "wyckoff_upthrust", "channel", "pennant", "darvas_box", "falling_wedge", "double_top",
          "golden_cross", "death_cross")

#: The judged constant table, frozen with the judged round.
JUDGED_CONSTANTS = {
    'WINDOW': 330, 'PIV_SPAN': 200, 'SMA_LONG': 200, 'SMA_RISE_BARS': 20, 'MIN_ATR_PCT': 0.008,
    'CH_ALT': 3, 'CH_COVER': 0.4, 'CH_LOOK': 150, 'CH_MAXW': 10.0, 'CH_MINW': 3.0, 'CH_MIN_SPAN': 30, 'CH_SEP': 6,
    'CH_TOL_ATR': 0.3, 'CV_CONV': 0.65, 'CV_LOOK': 100, 'CV_MIN_SPAN': 15, 'CV_MIN_TOUCH': 5, 'CV_MOVE_ATR': 1.0,
    'CV_SEP': 4, 'CV_TOL_ATR': 0.3, 'DV_FRESH': 2, 'DV_MAX_DEPTH': 0.12, 'DV_MAX_LEN': 30, 'PN_DEPTH': 0.5,
    'PN_MAX': 20, 'PN_MIN': 5, 'PN_POLE_ATR': 4.0, 'PN_POLE_MAX': 12, 'PN_POLE_PCT': 0.12, 'RD_BAR_ATR': 2.5,
    'RD_CONF': 2, 'RD_FRESH': 6, 'RD_NEWEXT': 60, 'RD_OB': 65.0, 'RD_OS': 35.0, 'RD_PX_ATR': 0.2, 'RD_RSI_GAP': 5.0,
    'RD_SEP_MAX': 40, 'RD_SEP_MIN': 8, 'RD_SWING_ATR': 1.0, 'WY_BACK_ATR': 0.25, 'WY_DEPTH_ATR': 2.0,
    'WY_DRIFT': 0.25, 'WY_FRESH': 3, 'WY_MAXH': 0.35, 'WY_MINH': 0.06, 'WY_SEP': 5, 'WY_TOUCH_ATR': 0.5,
    'WY_WINDOWS': (60, 50, 40, 30),
    'MX_EQ': 0.03, 'MX_EQ_ATR': 0.6, 'MX_SWING_ATR': 2.0, 'MX_SEP': 10, 'MX_MIN_SPAN': 30, 'MX_NL_EQ': 0.3,
    'MX_TREND_ATR': 3.0, 'MX_NL_ATR': 1.5, 'DTOP_MAX_SPAN': 120, 'MX_FRESH': 20, 'MX_PRE': 15, 'MX_SPAN': 150,
    'DTOP_DECL': 0.10, 'GC_FRESH': 3, 'GC_SHOW': 120, 'GC_CLEAN': 60,
}


def _load():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["series"]


SERIES = _load()


def _sha(d):
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


def test_the_module_serves_exactly_the_judged_setups_at_the_judged_round():
    assert M.SETUPS == SETUPS
    assert M.R2_DRAW_ROUND == 2 and M.DRAW_ROUNDS == {s: 2 for s in SETUPS}


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
