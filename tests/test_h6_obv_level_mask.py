"""H6 (step 90) -- ``ta.obv``'s level, the Python lane's half.

The JS lane writes ``cum(sign(change(close)) * volume)`` for Pine's ``ta.obv`` on the
host lane (``pine.js::obvLevelTree``) and withholds every bar of a tree that reads it
off the listing (``interpret.js::cumulativeLevelMask``, code ``cum:window``). This
lane mirrors the mask (``ast_interpret.cumulative_level_mask``) so a Pine document
evaluated here cannot draw a running total that is TradingView's minus an unknown
constant. The values below are the same hand-computed column the JS rail
(``vendorHarness.h6Obv.test.js``) asserts, so the two lanes are held to one answer.
"""
import math

import api.services.ast_interpret as ai


def _series(name):
    return {"type": "series", "name": name}


def _call(name, args):
    return {"type": "call", "name": name, "args": args}


def _obv(swapped=False):
    signed = _call("sign", [_call("change", [_series("close")])])
    pair = [_series("volume"), signed] if swapped else [signed, _series("volume")]
    return _call("cum", [{"type": "op", "name": "*", "args": pair}])


BARS = [{"t": f"2025-01-{i + 6:02d}", "o": c, "h": c, "l": c, "c": c, "v": v}
        for i, (c, v) in enumerate([(10, 100), (11, 200), (11, 300), (9, 400), (9, 50), (12, 7)])]
OFF = {"tf": "D", "barIndexAbsolute": True}


def test_the_level_is_pines_definition_up_down_and_an_equal_close_adds_zero():
    col = ai.interpret(_obv(), BARS, opts={"tf": "D"})
    assert col[0] is None
    assert col[1:] == [200, 200, -200, -200, -193]


def test_off_the_listing_every_bar_is_withheld_and_named():
    sink = {}
    col = ai.interpret(_call("ema", [_obv(), {"type": "num", "value": 3}]), BARS, opts=dict(OFF, chartClockSink=sink))
    assert all(v is None for v in col)
    assert "cum:window" in sink
    assert ai.whole_series_withheld(_obv(swapped=True), BARS, opts=OFF) == ("cum:window",)


def test_from_the_listing_and_outside_a_pine_document_nothing_is_withheld():
    assert ai.cumulative_level_mask(_obv(), BARS, opts=dict(OFF, historyFromListing=True)) is None
    assert ai.cumulative_level_mask(_obv(), BARS, opts={"tf": "D"}) is None
    assert ai.whole_series_withheld(_obv(), BARS, opts={"tf": "D"}) == ()


def test_the_mask_is_not_vacuous_it_answers_no_for_a_plain_cum():
    plain = _call("cum", [_series("close")])
    assert ai.cumulative_level_mask(plain, BARS, opts=OFF) is None
    assert ai.cumulative_level_mask(_obv(), BARS, opts=OFF) == [1] * len(BARS)
    assert "cum:window" in ai.CHART_CLOCK_WHOLE
    assert not math.isnan(ai.interpret(plain, BARS, opts=OFF)[-1])
