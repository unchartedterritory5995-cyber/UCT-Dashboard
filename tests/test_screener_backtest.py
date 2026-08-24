"""Spec §5's tests for the backtest engine — each one with a CONTROL.

⭐ EVERY TEST HERE CARRIES A CONTROL, and that is not ceremony. A gate that
cannot fail is not a gate: an assertion that passes because the fixture is
degenerate, because the refusal fires for a second reason, or because the arms
were never different in the first place, reads exactly like a working guard. So
each rule below is asserted TWICE — once on the case that must trip it, once on
the neighbouring case that must NOT — and the control is the half that would stay
green if the safety were deleted.

⛔ NO CLOCK AND NO RNG IN ANY FIXTURE. The determinism test is only meaningful if
the inputs are literally the same bytes twice, so every bar array here is built
from an explicit list or an index arithmetic, never from ``now()`` or ``random``.
"""
from __future__ import annotations

import re

import pytest

from api.services.screener import backtest as bt


# --------------------------------------------------------------------------- #
# tree + bar builders — no clock, no RNG
# --------------------------------------------------------------------------- #

def NUM(v):
    return {"type": "num", "value": v}


def SER(n):
    return {"type": "series", "name": n}


def OP(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def CALL(n, *a):
    return {"type": "call", "name": n, "args": list(a)}


#: ``close > sma(close, 3)`` — bar-expressible, so backtestable.
BAR_TREE = OP(">", SER("close"), CALL("sma", SER("close"), NUM(3)))

#: The SAME SHAPE with a declared scalar on the left. ⭐ Same operator, same
#: literal, same arity — so a refusal that fires here and not on ``BAR_TREE``
#: fired for the scalar and not for the shape.
SCALAR_TREE = OP(">", SER("rs_rank"), NUM(80))

#: Always true, once the warmup is past — the fixture that makes signal counts
#: predictable so a coverage identity can be checked by hand.
ALWAYS = OP(">", SER("close"), NUM(0))


def day(i: int) -> str:
    """A deterministic ``YYYY-MM-DD`` for bar ``i``. 2024 had 366 days."""
    m, d = divmod(i, 28)
    return f"2024-{m + 1:02d}-{d + 1:02d}"


def bars(closes, opens=None, start=0):
    """OHLCV bars with explicit closes and (optionally) divergent opens."""
    out = []
    for i, c in enumerate(closes):
        o = c if opens is None else opens[i]
        out.append({"t": day(start + i), "o": float(o), "h": float(max(o, c)) + 1,
                    "l": float(min(o, c)) - 1, "c": float(c), "v": 1000.0})
    return out


def reader(mapping):
    """A ``bars_for`` over a plain dict — the engine's only door to data."""
    return lambda sym: mapping.get(sym)


def rising(n=80, base=10.0, step=1.0, start=0):
    return bars([base + step * i for i in range(n)], start=start)


def holed(n=40, start=0):
    """``n`` bars whose CLOSE is a hole — a data gap spanning the WHOLE window.

    ⭐ ``o``/``h``/``l``/``v`` stay real prices, so this is a symbol the engine
    could price a fill on and simply cannot ask the question of. That is the
    shape that used to leave the calculation without a trace.
    """
    b = rising(n=n, start=start)
    for bar in b:
        bar["c"] = None
    return b


# --------------------------------------------------------------------------- #
# 1 · a tree containing a scalar REFUSES BY NAME
# --------------------------------------------------------------------------- #

def test_a_scalar_screen_refuses_by_name():
    r = bt.run_backtest(SCALAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}))
    assert r.backtestable is False
    assert r.refused == "scalar_no_history"
    # ⭐ BY NAME, not "unsupported". The member has to know WHICH value is the
    # problem — that is the difference between an actionable refusal and a shrug.
    assert "rs_rank" in r.names
    assert "rs_rank" in r.to_dict()["detail"]
    # ⛔ REFUSAL ≠ EMPTY: a refusal must not look like "your screen found nothing".
    assert "forward_returns" not in r.to_dict()


def test_control_the_same_shape_without_the_scalar_does_not_refuse():
    """THE CONTROL for the test above.

    Same operator, same literal, same arity — only the left operand differs. If
    this also refused, the refusal above would be telling us nothing about
    scalars, and a blanket "we cannot backtest anything" would pass test 1.
    """
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}), min_signals=1)
    assert r.backtestable is True, r.detail
    assert r.refused is None


def test_a_mixed_tree_refuses_on_the_scalar_half():
    """A screen that is MOSTLY bar-expressible still refuses — one unknown scalar
    is enough to make the whole curve unauditable."""
    mixed = OP("&&", BAR_TREE, SCALAR_TREE)
    r = bt.run_backtest(mixed, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}))
    assert r.refused == "scalar_no_history"
    assert r.names == ("rs_rank",)


def test_the_refused_names_come_from_the_ast_lane_not_a_local_list():
    """⛔ ONE WRITER. The names must be whatever ``unresolved_scalars`` says, so a
    scalar added to the manifest tomorrow is refused the day it lands without an
    edit here. This asserts the two agree rather than re-typing a list."""
    from api.services.ast_interpret import unresolved_scalars
    for name in ("market_cap", "pe_ttm", "pattern_engine_vcp", "rs_rank"):
        tree = OP(">", SER(name), NUM(1))
        r = bt.run_backtest(tree, ["AAA"], day(0), day(79),
                            bars_for=reader({"AAA": rising()}))
        assert r.names == tuple(unresolved_scalars(tree, {})) == (name,)


# --------------------------------------------------------------------------- #
# 2 · the forward return measures from the NEXT BAR'S OPEN
# --------------------------------------------------------------------------- #

#: ⭐⭐ THE FIXTURE IS THE TEST. Closes and opens are deliberately far apart, so
#: a close-filled backtest and an open-filled one cannot agree by luck: the
#: signal bar closes at 100 while the next bar OPENS at 200. A close fill would
#: book the move from 100; the honest fill books it from 200.
_FILL_CLOSES = [10, 10, 10, 100, 210, 220, 230, 240, 250, 260]
_FILL_OPENS = [10, 10, 10, 100, 200, 205, 210, 215, 220, 225]


def test_the_forward_return_is_measured_from_the_next_bars_open():
    b = bars(_FILL_CLOSES, _FILL_OPENS)
    # signal at index 3 (close 100 > sma of 10,10,10); fill = open[4] = 200
    r = bt._forward_return(b, 3, 1)
    fill_open, exit_open = 200.0, 205.0
    assert r == pytest.approx((exit_open - fill_open) / fill_open * 100)
    assert r == pytest.approx(2.5)


def test_control_the_close_fill_number_is_different_and_is_not_what_we_return():
    """THE CONTROL. If the two bases produced the same number the assertion above
    would pass with the fill logic replaced by ``bars[i]['c']`` — this pins that
    they diverge, and by how much."""
    b = bars(_FILL_CLOSES, _FILL_OPENS)
    signal_close = b[3]["c"]                       # 100 — the flattering fill
    exit_open = b[5]["o"]                          # 205
    flattering = (exit_open - signal_close) / signal_close * 100
    honest = bt._forward_return(b, 3, 1)
    assert flattering == pytest.approx(105.0)
    assert honest == pytest.approx(2.5)
    # 42x apart. A backtest that quoted the first would look extraordinary.
    assert flattering > honest * 40


def test_a_signal_on_the_last_bar_has_no_fill_and_is_counted_not_dropped():
    """There is no next bar to fill on, so the observation does not exist — and
    it is COUNTED as having no forward room rather than silently vanishing."""
    b = bars(_FILL_CLOSES, _FILL_OPENS)
    assert bt._forward_return(b, len(b) - 1, 1) is None
    assert bt._forward_return(b, len(b) - 2, 1) is None      # fill exists, exit does not


def test_a_zero_open_is_not_a_price_and_is_never_divided_by():
    """⛔ A NULL IS NEVER A ZERO. A vendor's 0.0 open sentinel must not become an
    infinite return or a fabricated flat trade."""
    b = bars([10, 10, 10, 100, 210, 220], [10, 10, 10, 100, 0, 205])
    assert bt._forward_return(b, 3, 1) is None
    assert bt._finite_positive(0.0) is None
    assert bt._finite_positive(-1.0) is None
    # CONTROL: a real price still resolves, so the guard is not refusing everything.
    assert bt._finite_positive(12.5) == 12.5


# --------------------------------------------------------------------------- #
# 3 · a baseline is mandatory, and it is STRUCTURAL
# --------------------------------------------------------------------------- #

def test_a_horizon_result_cannot_be_built_without_its_baseline():
    """⭐⭐ RULE 1 AS A TYPE ERROR, not a review comment. This is the control and
    the test at once: the strategy number is not CONSTRUCTIBLE alone."""
    with pytest.raises(TypeError):
        bt.HorizonResult(horizon=5, strategy=bt.Stats(n=10),   # no baseline
                         below_floor=False, coverage={})
    # CONTROL: with the baseline supplied it builds, so the TypeError above is
    # about the missing field and not about the call being malformed generally.
    ok = bt.HorizonResult(horizon=5, strategy=bt.Stats(n=10),
                          baseline=bt.Stats(n=99), below_floor=False, coverage={})
    assert ok.baseline.n == 99


def test_the_payload_ships_both_arms_for_every_horizon():
    b = {"AAA": rising(), "BBB": bars([50 - i * 0.4 for i in range(80)])}
    r = bt.run_backtest(BAR_TREE, ["AAA", "BBB"], day(0), day(79),
                        bars_for=reader(b), min_signals=1, horizons=(5, 10))
    d = r.to_dict()
    assert set(d["forward_returns"]) == set(d["baseline"]) == {"5", "10"}
    for h in ("5", "10"):
        assert d["forward_returns"][h]["win_rate"] is not None
        assert d["baseline"][h]["win_rate"] is not None


def test_the_baseline_is_a_different_number_from_the_strategy():
    """A baseline that always equalled the strategy would be a decoration. The
    fixture mixes a name that trends up with one that trends down, and the screen
    (close above its own SMA) selects the up-days — so the filtered arm MUST beat
    the unfiltered population."""
    b = {"UP": rising(n=80, step=1.0),
         "DOWN": bars([90 - i for i in range(80)])}
    r = bt.run_backtest(BAR_TREE, ["UP", "DOWN"], day(0), day(79),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    hz = r.horizons[0]
    assert hz.strategy.n < hz.baseline.n          # the screen filtered something
    assert hz.strategy.win_rate != hz.baseline.win_rate
    assert hz.strategy.win_rate > hz.baseline.win_rate


def test_control_a_screen_that_selects_nothing_special_matches_its_baseline():
    """THE CONTROL for the test above. ``close > 0`` fires on every bar, so the
    two arms are the SAME population and must agree exactly. If they disagreed
    here, the difference in the previous test would be an artefact of how the
    arms are built rather than of what the screen selected."""
    b = {"UP": rising(n=60), "DOWN": bars([90 - i for i in range(60)])}
    r = bt.run_backtest(ALWAYS, ["UP", "DOWN"], day(0), day(59),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    hz = r.horizons[0]
    assert hz.strategy.n == hz.baseline.n
    assert hz.strategy.win_rate == hz.baseline.win_rate
    assert hz.strategy.avg_pct == pytest.approx(hz.baseline.avg_pct)


# --------------------------------------------------------------------------- #
# 4 · a symbol with no bars is COUNTED AS UNTESTED, not dropped
# --------------------------------------------------------------------------- #

def test_a_symbol_with_no_bars_is_counted_as_untested():
    b = {"AAA": rising(), "GONE": None, "EMPTY": []}
    r = bt.run_backtest(BAR_TREE, ["AAA", "GONE", "EMPTY"], day(0), day(79),
                        bars_for=reader(b), min_signals=1)
    c = r.coverage
    assert c["symbols_requested"] == 3
    assert c["symbols_tested"] == 1
    assert c["symbols_missing_bars"] == 2
    # ⭐ THE DENOMINATOR IS HONEST BOTH WAYS: the two are neither counted as
    # tested-and-failed nor quietly removed from the request count.
    assert c["symbols_tested"] != c["symbols_requested"]


def test_a_symbol_whose_bars_all_fall_outside_the_window_is_its_own_fact():
    """"we have no data for it" and "it has data, just not then" are different
    facts and call for different actions — so they are counted apart."""
    b = {"AAA": rising(), "OLD": rising(n=20, start=300)}
    r = bt.run_backtest(BAR_TREE, ["AAA", "OLD"], day(0), day(79),
                        bars_for=reader(b), min_signals=1)
    c = r.coverage
    assert c["symbols_missing_bars"] == 0
    assert c["symbols_no_bars_in_window"] == 1
    assert c["symbols_tested"] == 1


def test_the_universe_arithmetic_closes_and_the_guard_can_fire():
    """⭐ THE CONTROL IS THAT THE ASSERTION IS REACHABLE. A closed identity nobody
    has seen fail is not a guard, so this drives ``_assert_closes`` directly with
    a total that does not add up and watches it raise."""
    bt._assert_closes("ok", 5, {"a": 2, "b": 3})            # closes: silent
    with pytest.raises(AssertionError) as e:
        bt._assert_closes("broken", 5, {"a": 2, "b": 2})
    assert "arithmetic broke" in str(e.value)


def test_every_requested_symbol_lands_in_exactly_one_bucket():
    """⛔ AND EVERY BUCKET IS OCCUPIED, or the identity is not being tested.

    This fixture used to hold three symbols across three buckets, so the fourth
    term — ``symbols_no_answer_in_window`` — was ``0`` in every case the suite
    ran, and the identity closed whatever that term did. A sum with a term that
    is always zero is a gate that cannot fail on that term: hard-coding the
    bucket to ``0`` in the engine left the whole suite green. The fourth symbol
    fixes that, so each of the four counts is load-bearing here.
    """
    b = {"AAA": rising(), "GONE": None, "OLD": rising(n=20, start=300),
         "HOLED": holed(n=40)}
    r = bt.run_backtest(BAR_TREE, ["AAA", "GONE", "OLD", "HOLED"],
                        day(0), day(79), bars_for=reader(b), min_signals=1)
    c = r.coverage
    assert (c["symbols_tested"] + c["symbols_missing_bars"]
            + c["symbols_no_bars_in_window"] + c["symbols_no_answer_in_window"]
            == c["symbols_requested"])
    assert (c["symbols_tested"], c["symbols_missing_bars"],
            c["symbols_no_bars_in_window"], c["symbols_no_answer_in_window"]) \
        == (1, 1, 1, 1)


def test_a_symbol_whose_whole_window_is_unanswerable_keeps_its_bars_in_coverage():
    """🔴 THE BARS OF AN EXCLUDED SYMBOL STAY IN THE CALCULATION (rule 3).

    ``HOLED`` has forty in-window bars and the screen can answer none of them, so
    it contributes no observation and is kept out of the horizon loop. Summing
    the bar counts over that same shortened list dropped its forty bars out of
    coverage entirely, and the receipt then said ``bars_not_computable: 0`` —
    which does not merely omit a fact, it positively asserts *"no data holes"*
    about a window that was one big hole.

    ⚠️ ``_assert_closes("bars", …)`` cannot catch this and never could: both
    sides of the identity lose the same symbol, so it closes. THIS is the gate.
    """
    b = {"GOOD": rising(n=40), "HOLED": holed(n=40)}
    r = bt.run_backtest(ALWAYS, ["GOOD", "HOLED"], day(0), day(39),
                        bars_for=reader(b), min_signals=1)
    c = r.coverage
    assert c["symbols_tested"] == 1
    assert c["symbols_no_answer_in_window"] == 1
    assert c["bars_in_window"] == 80          # ⭐ BOTH symbols' bars, not one's
    assert c["bars_not_computable"] == 40     # ⭐ the forty holes, named
    assert c["bars_answered"] == 40
    assert (c["bars_warmup"] + c["bars_not_computable"] + c["bars_answered"]
            == c["bars_in_window"])


def test_control_two_clean_symbols_report_the_same_bars_and_no_holes():
    """THE CONTROL for the test above. The bar total is the SAME 80 either way —
    which is the point: excluding a symbol from the horizon loop must not change
    what the window is reported to have contained. If the total moved here, the
    80 above would be measuring the fixture rather than the fold-in.
    """
    b = {"GOOD": rising(n=40), "ALSO": rising(n=40)}
    r = bt.run_backtest(ALWAYS, ["GOOD", "ALSO"], day(0), day(39),
                        bars_for=reader(b), min_signals=1)
    c = r.coverage
    assert c["symbols_tested"] == 2
    assert c["symbols_no_answer_in_window"] == 0
    assert c["bars_in_window"] == 80
    assert c["bars_not_computable"] == 0
    assert c["bars_answered"] == 80


def test_a_universe_that_is_all_hole_refuses_and_still_counts_every_bar():
    """The refusal path keeps the same books. Nothing was testable, and the
    coverage still says WHY in bars rather than leaving the member to guess
    between "quiet market" and "we hold nothing here"."""
    r = bt.run_backtest(ALWAYS, ["H1", "H2"], day(0), day(39),
                        bars_for=reader({"H1": holed(n=40), "H2": holed(n=40)}),
                        min_signals=1)
    assert r.backtestable is False
    assert r.refused == "no_bars_in_window"
    c = r.coverage
    assert c["symbols_no_answer_in_window"] == 2
    assert c["bars_in_window"] == 80
    assert c["bars_not_computable"] == 80
    assert c["bars_answered"] == 0


def test_a_bar_the_screen_cannot_answer_is_not_a_no():
    """⭐ THE HONEST HOLE. A bar with a missing close is not "the screen did not
    match" — it is "we could not ask". It is counted apart and kept out of both
    denominators."""
    b = rising(n=40)
    for i in (20, 21, 22):
        b[i]["c"] = None
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(39),
                        bars_for=reader({"AAA": b}), min_signals=1)
    c = r.coverage
    assert c["bars_not_computable"] > 0
    assert (c["bars_warmup"] + c["bars_not_computable"] + c["bars_answered"]
            == c["bars_in_window"])
    # CONTROL: the same series without holes has none, so the count above is
    # measuring the holes and not a constant.
    clean = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(39),
                            bars_for=reader({"AAA": rising(n=40)}), min_signals=1)
    assert clean.coverage["bars_not_computable"] == 0


def test_a_hole_is_a_confident_zero_at_the_top_of_the_tree_and_we_still_catch_it():
    """🔴 THE MEASURED REASON THE HOLE IS FOUND AT THE LEAF, PINNED.

    This asserts the DEFECT first — that ``interpret`` hands back a confident
    ``0.0`` at a holed bar, not a ``None`` — and then that the engine counts that
    bar as not-computable anyway. Without the first half, the second could pass
    with the leaf check deleted (a bare-series tree would still report ``None``)
    and nobody would know the condition-tree case was unprotected.
    """
    from api.services.ast_interpret import interpret
    b = rising(n=20)
    b[10]["c"] = None

    # (a) the defect: the hole is honest at the leaf and gone one node up.
    assert interpret(SER("close"), b)[10] is None
    assert interpret(OP(">", SER("close"), NUM(0)), b)[10] == 0.0

    # (b) the engine finds it anyway, because it asks the leaf.
    r = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(19),
                        bars_for=reader({"AAA": b}), min_signals=1)
    assert r.coverage["bars_not_computable"] == 1
    assert r.coverage["bars_answered"] == 19

    # CONTROL: the same screen on a clean tape loses nothing, so the 1 above is
    # the hole and not a constant.
    clean = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(19),
                            bars_for=reader({"AAA": rising(n=20)}), min_signals=1)
    assert clean.coverage["bars_not_computable"] == 0
    assert clean.coverage["bars_answered"] == 20


def test_the_hole_poisons_forward_by_the_trees_own_reach():
    """A hole at bar j also NaNs ``sma(close,3)`` at j+1 and j+2, and those bars
    read as a confident 0.0 too. The blocked radius is the tree's declared reach,
    so they are counted rather than scored."""
    slow = OP(">", SER("close"), CALL("sma", SER("close"), NUM(5)))
    b = rising(n=40)
    b[20]["c"] = None
    r = bt.run_backtest(slow, ["AAA"], day(0), day(39),
                        bars_for=reader({"AAA": b}), min_signals=1)
    # one holed bar, poisoning forward by max_lookback=5
    assert r.coverage["bars_not_computable"] > 1
    # CONTROL: a tree with no reach loses exactly the one holed bar.
    flat = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(39),
                           bars_for=reader({"AAA": b}), min_signals=1)
    assert flat.coverage["bars_not_computable"] == 1


def test_the_bar_fields_checked_are_the_ones_the_tree_actually_READS():
    """⛔ DERIVED THROUGH THE MANIFEST. A close-only screen must not lose bars to
    a missing volume it never looked at — and a volume screen must."""
    assert bt._bar_fields(ALWAYS) == ("c",)
    assert bt._bar_fields(OP(">", SER("volume"), NUM(0))) == ("v",)

    b = rising(n=20)
    b[10]["v"] = None
    close_only = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(19),
                                 bars_for=reader({"AAA": b}), min_signals=1)
    assert close_only.coverage["bars_not_computable"] == 0
    # CONTROL: the screen that DOES read volume loses that bar.
    vol = bt.run_backtest(OP(">", SER("volume"), NUM(0)), ["AAA"], day(0), day(19),
                          bars_for=reader({"AAA": b}), min_signals=1)
    assert vol.coverage["bars_not_computable"] == 1


def test_warmup_bars_are_excluded_rather_than_read_as_a_no():
    """Below ``max_lookback`` the tree's own declaration says the maths has not
    got going — and ``_cmp`` answers a confident 0.0 there. Those bars are
    counted as warmup, not as bars where the screen said no."""
    slow = OP(">", SER("close"), CALL("sma", SER("close"), NUM(20)))
    r = bt.run_backtest(slow, ["AAA"], day(0), day(39),
                        bars_for=reader({"AAA": rising(n=40)}), min_signals=1)
    assert r.coverage["bars_warmup"] == 20
    assert r.method["warmup_bars"] == 20
    # CONTROL: a tree needing no history has no warmup, so 20 is the tree's
    # number and not a constant this engine always subtracts.
    fast = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(39),
                           bars_for=reader({"AAA": rising(n=40)}), min_signals=1)
    assert fast.coverage["bars_warmup"] == 0


# --------------------------------------------------------------------------- #
# 5 · below the floor, refuse rather than report
# --------------------------------------------------------------------------- #

def test_a_window_with_too_few_signals_refuses():
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(11),
                        bars_for=reader({"AAA": rising(n=12)}),
                        min_signals=30, horizons=(5,))
    assert r.backtestable is False
    assert r.refused == "too_few_signals"
    # ⭐ THE FLOOR IS IN THE PAYLOAD, never silently applied.
    assert r.method["min_signals"] == 30
    assert "30" in r.detail
    assert "win_rate" not in r.to_dict()


def test_control_the_same_screen_over_a_long_enough_window_reports():
    """THE CONTROL. If this also refused, the refusal above would be about the
    screen or the fixture rather than about the count."""
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising(n=80)}),
                        min_signals=30, horizons=(5,))
    assert r.backtestable is True, r.detail
    assert r.horizons[0].strategy.win_rate is not None


def test_a_below_floor_horizon_withholds_the_rate_but_still_reports_n():
    """The count is a fact the member can act on; the rate is the thing that
    misleads. So ``n`` survives and every rate goes ``None`` — not 0."""
    s = bt._stats([1.0, 2.0, 3.0], withheld=True)
    assert s.n == 3
    assert (s.win_rate, s.avg_pct, s.median_pct, s.best, s.worst) == \
        (None, None, None, None, None)
    # CONTROL: unwithheld, the same numbers produce real statistics.
    ok = bt._stats([1.0, 2.0, 3.0], withheld=False)
    assert ok.n == 3 and ok.win_rate == 100.0 and ok.avg_pct == pytest.approx(2.0)


def test_the_whole_window_refusal_still_reports_n_for_every_horizon():
    """🔴 RULE 5 REACHES INTO THE REFUSAL: *n is always reported; it is the RATE
    that is withheld.*

    This refusal fires AFTER every horizon has been computed, so the counts
    already exist. The first draft returned a receipt with ``horizons=()`` and
    restated one of them into a prose sentence — "the best horizon has 3
    signal(s)" — which no consumer can parse, on the one path where the tuple
    that owned that number was thrown away. Both halves of the defect are pinned
    here: the counts ride on the refusal, and the prose restates none of them.
    """
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(11),
                        bars_for=reader({"AAA": rising(n=12)}),
                        min_signals=30, horizons=(5, 10))
    assert r.refused == "too_few_signals"
    d = r.to_dict()
    assert [h["horizon"] for h in d["horizons"]] == [5, 10]
    for h in d["horizons"]:
        assert h["below_floor"] is True
        assert h["strategy"]["n"] < 30              # the COUNT survives
        assert h["strategy"]["win_rate"] is None    # the RATE is withheld
        assert h["baseline"]["win_rate"] is None
    assert max(h["strategy"]["n"] for h in d["horizons"]) > 0

    # ⛔ ONE WRITER OVER THE COUNT. The only number in the prose is the FLOOR —
    # an input the caller handed us. A count copied out of `horizons` into this
    # sentence would put a second authority on it, and this is how that gets
    # caught rather than reviewed for.
    assert set(re.findall(r"\d+", r.detail)) == {"30"}


def test_control_a_refusal_that_never_computed_a_horizon_carries_none():
    """THE CONTROL. ``scalar_no_history`` fires before a single bar is read, so
    there is no per-horizon fact to report and the key is ABSENT — not ``[]``,
    which would invite a consumer to render "0 horizons" beside a refusal that
    never got that far. Without this, the assertion above would pass with
    ``horizons`` bolted unconditionally onto every refusal."""
    r = bt.run_backtest(SCALAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}))
    assert r.refused == "scalar_no_history"
    assert "horizons" not in r.to_dict()


def test_a_mixed_run_keeps_the_short_horizon_and_withholds_the_long_one():
    """Forward room shrinks with the horizon, so one window can clear the floor
    at 5 bars and miss it at 40. The horizons are judged separately."""
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(49),
                        bars_for=reader({"AAA": rising(n=50)}),
                        min_signals=30, horizons=(5, 40))
    assert r.backtestable is True, r.detail
    by_h = {h.horizon: h for h in r.horizons}
    assert by_h[5].below_floor is False and by_h[5].strategy.win_rate is not None
    assert by_h[40].below_floor is True and by_h[40].strategy.win_rate is None
    assert by_h[40].strategy.n < 30          # the count is still reported


# --------------------------------------------------------------------------- #
# 6 · determinism — same inputs, same receipt
# --------------------------------------------------------------------------- #

def test_the_same_inputs_return_the_same_receipt():
    b = {"AAA": rising(), "BBB": bars([50 - i * 0.4 for i in range(80)])}
    a1 = bt.run_backtest(BAR_TREE, ["AAA", "BBB"], day(0), day(79),
                         bars_for=reader(b), min_signals=1).to_dict()
    a2 = bt.run_backtest(BAR_TREE, ["AAA", "BBB"], day(0), day(79),
                         bars_for=reader(b), min_signals=1).to_dict()
    assert a1 == a2


def test_as_of_is_the_last_evaluated_bar_date_and_not_a_clock():
    """⛔ A ``now()`` would make the receipt non-reproducible — the same question
    twice would give two answers and neither could be checked. ``as_of`` is
    derived from the data, so it moves only when the DATA moves."""
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(39),
                        bars_for=reader({"AAA": rising(n=80)}), min_signals=1)
    assert r.as_of == day(39)
    # CONTROL: a different window moves it, so it is read from the bars rather
    # than being a constant that happens to look right once.
    r2 = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(49),
                         bars_for=reader({"AAA": rising(n=80)}), min_signals=1)
    assert r2.as_of == day(49) != r.as_of


def test_the_engine_imports_no_clock_and_no_rng():
    """⭐ THE STRUCTURAL HALF. Reading the module's source is what catches a
    ``datetime.now()`` added later inside a branch no test happens to cover."""
    import inspect
    src = inspect.getsource(bt)
    for banned in ("import random", "datetime.now", "time.time", "utcnow",
                   "import time\n"):
        assert banned not in src, f"the engine must be deterministic: found {banned}"


# --------------------------------------------------------------------------- #
# 7 · the survivorship caveat is IN the payload (rule 4)
# --------------------------------------------------------------------------- #

def test_the_survivorship_caveat_rides_in_the_payload():
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}), min_signals=1)
    u = r.to_dict()["universe"]
    assert u["survivorship_bias"] is True
    assert u["membership"] == "current"
    assert "today's names against yesterday's prices" in u["caveat"]


def test_the_caveat_rides_on_a_refusal_too():
    """A refused backtest still states what its universe would have been — the
    member reads the refusal, and the caveat is part of understanding it."""
    r = bt.run_backtest(SCALAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}))
    assert r.to_dict()["universe"]["survivorship_bias"] is True


def test_a_receipt_cannot_be_built_without_the_caveat():
    """THE CONTROL for rule 4, and it is structural: ``universe`` has no default,
    so a receipt without the caveat is a ``TypeError``."""
    with pytest.raises(TypeError):
        bt.Receipt(backtestable=True, method={}, coverage={})


def test_the_payload_says_what_question_it_answers():
    """⚠️ SPEC §6 — the wording must not blur "did these go up" with "what would
    I have made"."""
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}), min_signals=1)
    answers = r.method["answers"]
    assert "tend to go up" in answers
    assert "NOT what a portfolio would have made" in answers
    assert r.method["fill"] == "next_bar_open"


# --------------------------------------------------------------------------- #
# 8 · the other named refusals
# --------------------------------------------------------------------------- #

def test_a_non_condition_screen_refuses_rather_than_scoring_a_price():
    """``close`` is not a screen. Treating 123.4 as truthy would silently
    backtest "is the price non-zero", which is true on every bar."""
    r = bt.run_backtest(SER("close"), ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}), min_signals=1)
    assert r.refused == "not_a_condition"
    # CONTROL: wrap it in a comparison and it is a screen again.
    ok = bt.run_backtest(OP(">", SER("close"), NUM(0)), ["AAA"], day(0), day(79),
                         bars_for=reader({"AAA": rising()}), min_signals=1)
    assert ok.backtestable is True, ok.detail


def test_intraday_bars_are_refused_rather_than_guessed_at():
    """⛔ §6 scopes intraday out, and epoch ``t`` is how it would arrive. A
    guessed epoch→date conversion here would be a second authority over what a
    bar's date is."""
    intraday = [{"t": 1700000000 + i * 60, "o": 1.0, "h": 2.0, "l": 0.5,
                 "c": 1.0, "v": 1.0} for i in range(40)]
    r = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": intraday}))
    assert r.refused == "non_daily_bars"
    assert bt.bar_date(intraday[0]) is None
    # CONTROL: a daily bar resolves.
    assert bt.bar_date({"t": "2024-03-04"}) == "2024-03-04"


def test_out_of_order_and_duplicate_bars_are_refused_not_quietly_rescored():
    """🔴 THE MALFORMATION THAT PRODUCED A CONFIDENT WRONG CURVE INSTEAD OF A GAP.

    Five other input malformations already refused by name; this one — the only
    one that CHANGES THE NUMBER rather than emptying it — did not. Measured on
    the same sixty rising bars through ``close > 0`` at h=5, before the guard:

        sorted                -> win_rate 100.0, worst  +7.8%
        rotated b[30:]+b[:30] -> win_rate  90.7, worst -84.6%
        duplicated b + b      -> bars_answered 120, n 114 over 60 dates

    Both coverage identities closed in all three, because every count was honest
    about the rows it was handed. The rows were the lie, and this repo has a
    newest-bar-wins invariant and a reconciliation worker precisely because
    misordered and duplicated bar rows have happened.
    """
    b = rising(n=60)
    rotated = b[30:] + b[:30]

    r = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(59),
                        bars_for=reader({"AAA": rotated}),
                        min_signals=1, horizons=(5,))
    assert r.backtestable is False
    assert r.refused == "unordered_bars"
    assert "the tape goes back" in r.detail

    # the reviewer's double-counting tape: the whole series appended to itself
    twice = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(59),
                            bars_for=reader({"AAA": b + b}),
                            min_signals=1, horizons=(5,))
    assert twice.refused == "unordered_bars"

    # and an ADJACENT duplicate, which is the same refusal with a different,
    # named cause — the two remedies differ (dedupe vs. sort), so the detail
    # says which one arrived.
    doubled = [bar for bar in b for _ in (0, 1)]
    dup = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(59),
                          bars_for=reader({"AAA": doubled}),
                          min_signals=1, horizons=(5,))
    assert dup.refused == "unordered_bars"
    assert "the same date twice" in dup.detail
    assert "the tape goes back" in r.detail and "the same date twice" not in r.detail

    # ⭐ THE REFUSAL IS LOAD-BEARING, NOT TIDINESS. The forward legs are read
    # POSITIONALLY, so the same rows in the rotated order price a different
    # trade — here one of the opposite sign, across the seam.
    assert bt._forward_return(rotated, 25, 5) < 0 < bt._forward_return(b, 25, 5)


def test_control_the_same_bars_in_order_are_backtested_normally():
    """THE CONTROL for the test above. If a sorted tape also refused, the guard
    would be refusing everything and the assertions above would say nothing about
    ordering."""
    b = rising(n=60)
    ok = bt.run_backtest(ALWAYS, ["AAA"], day(0), day(59),
                         bars_for=reader({"AAA": b}), min_signals=1, horizons=(5,))
    assert ok.backtestable is True, ok.detail
    assert ok.horizons[0].strategy.win_rate == 100.0
    # ⛔ pairwise disjoint: ordering is not smuggled in under the intraday name.
    assert bt.REFUSALS["unordered_bars"] != bt.REFUSALS["non_daily_bars"]


def test_an_empty_universe_and_a_backwards_window_refuse_distinctly():
    e = bt.run_backtest(BAR_TREE, [], day(0), day(79), bars_for=reader({}))
    assert e.refused == "empty_universe"
    w = bt.run_backtest(BAR_TREE, ["AAA"], day(79), day(0),
                        bars_for=reader({"AAA": rising()}))
    assert w.refused == "bad_window"
    h = bt.run_backtest(BAR_TREE, ["AAA"], day(0), day(79),
                        bars_for=reader({"AAA": rising()}), horizons=(0,))
    assert h.refused == "bad_horizon"
    # ⛔ PAIRWISE DISJOINT: three different questions, three different answers.
    assert len({e.refused, w.refused, h.refused}) == 3


def test_a_universe_with_no_bars_at_all_refuses_and_says_so():
    r = bt.run_backtest(BAR_TREE, ["A", "B"], day(0), day(79),
                        bars_for=reader({}))
    assert r.refused == "no_bars_in_window"
    assert r.coverage["symbols_missing_bars"] == 2


def test_the_engine_does_no_io_of_its_own():
    """⭐ PURE. The only door data comes through is ``bars_for`` — so a reader
    that raises is the ONLY way this call can touch the outside world."""
    calls = []

    def spy(sym):
        calls.append(sym)
        return rising()

    bt.run_backtest(BAR_TREE, ["AAA", "BBB"], day(0), day(79),
                    bars_for=spy, min_signals=1)
    assert calls == ["AAA", "BBB"]
