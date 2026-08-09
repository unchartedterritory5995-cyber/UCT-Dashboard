"""The alert lane must read the history its own formula declares.

🔴 THE DEFECT. `_fetch_bars_for_alert(sym, tf, count=200)` and EVERY caller
passing the literal `200`, while `ast_budget.DEFAULT_BUDGET["maxLookback"]` is
**500** and `scan_evaluator` already sized its window from the tree
(`min(5000, max(400, lookback + 400))`). Same tree, two windows. Measured on the
store 2026-08-09:

    STZ ema(close,200)   200 bars -> 145.9311      converged -> 153.2869
                                                   -$7.36, -4.80%

and the worse half, on 200 real bars:

    close > sma(close,300)  ->  200 x 0.0 and ZERO None
                                a finite, confident "no", forever, to a question
                                the lane cannot answer

⛔ `pytest.approx` IS NOT USED HERE. E-7 measured an `ema` difference of
`9.919e-07` between two genuinely different indicators — INSIDE approx's default
`rel=1e-6`.
"""
from __future__ import annotations

import math

import pytest

from api.services import alert_user_series as aus
from api.services import ast_budget
from api.services import ast_interpret as ai
from api.services import indicator_alert_evaluator as ev


CLOSE = {"type": "series", "name": "close"}


def _call(name, period):
    return {"type": "call", "name": name,
            "args": [CLOSE, {"type": "num", "value": period}]}


def _gt(a, b):
    return {"type": "op", "name": ">", "args": [a, b]}


def _defn(tree):
    return {"inputs": [], "plots": [{"key": "p"}],
            "compute": {"kind": "ast", "ast": tree}}


def _bars(n, start=100.0, step=0.1):
    return [{"t": 20200101 + i, "o": start + i * step, "h": start + i * step + 1,
             "l": start + i * step - 1, "c": start + i * step, "v": 1000}
            for i in range(n)]


# ── the window ──────────────────────────────────────────────────────────────
class TestTheWindowIsSizedFromTheTree:
    def test_the_two_lanes_size_the_same_window(self):
        """⛔ DERIVED FROM THE OTHER LANE, NOT RETYPED. `scan_evaluator` owns the
        original constants; this reads them and fails if either side moves, so
        the copy in the alert lane cannot become a second authority."""
        from api.services.screener import scan_evaluator
        assert (ev.BARS_MIN, ev.BARS_MAX) == (scan_evaluator._MIN_BARS,
                                              scan_evaluator._MAX_BARS)
        for lookback in (0, 1, 200, 300, 500, 4_999, 50_000):
            scan_want = min(scan_evaluator._MAX_BARS,
                            max(scan_evaluator._MIN_BARS,
                                lookback + scan_evaluator._MIN_BARS))
            assert ev.bars_wanted(lookback) == scan_want

    def test_the_window_covers_the_budget_the_lane_advertises(self):
        """`maxLookback: 500` is what a definition is ALLOWED to declare. A lane
        that reads fewer bars than its own budget admits cannot answer the widest
        tree it accepts."""
        admitted = ast_budget.DEFAULT_BUDGET["maxLookback"]
        assert ev.bars_wanted(admitted) >= admitted
        assert ev.bars_wanted(0) > 200

    def test_a_user_alerts_window_comes_from_max_lookback(self, monkeypatch):
        tree = _call("sma", 300)
        fn = aus._make_value_fn("u_0123456789ab", "p", _defn(tree))
        monkeypatch.setitem(aus.USER_FUNCS, aus.scoped_key(7, "u_0123456789ab.p"), fn)
        alert = {"indicator": "u_0123456789ab.p", "user_id": 7, "params_json": "{}"}
        assert aus.lookback_for_alert(alert) == ai.max_lookback(tree)
        assert ev.bars_needed_for_alert(alert) == ev.bars_wanted(300)

    def test_a_builtin_window_comes_from_the_declared_inputs(self):
        """⛔ NOT A HAND-LIST. `alert_series.address_inputs` reads the knobs off
        the column function; a `{"rsi": 14}` map here would be the retired
        twin-table shape."""
        from api.services import alert_series
        for address in ("rsi", "atr", "macd", "price_vs_ma", "bb.upper"):
            declared = alert_series.address_inputs(address)
            windows = sum(int(v) for v in declared.values()
                          if isinstance(v, (int, float))
                          and not isinstance(v, bool) and float(v) == int(v))
            got = ev.bars_needed_for_alert({"indicator": address,
                                            "params_json": "{}"})
            assert got == ev.bars_wanted(windows), address

    def test_an_instance_parameter_widens_the_window(self):
        """A `price_vs_ma` alert armed at period 500 must not read a 50-bar
        window because 50 is the DEFAULT."""
        narrow = ev.bars_needed_for_alert(
            {"indicator": "price_vs_ma", "params_json": '{"period": 50}'})
        wide = ev.bars_needed_for_alert(
            {"indicator": "price_vs_ma", "params_json": '{"period": 500}'})
        assert wide == ev.bars_wanted(500) and wide > narrow

    def test_an_unreadable_alert_falls_back_to_the_floor_not_to_200(self):
        for alert in ({"indicator": "nope", "params_json": "not json"},
                      {"indicator": None}, {}):
            assert ev.bars_needed_for_alert(alert) == ev.BARS_MIN

    def test_sizing_an_alert_never_fetches_bars(self, monkeypatch):
        """⛔ THE READER MUST NOT RE-ENTER THE FETCH IT IS SIZING.
        `value_function_for_alert`'s registry-miss branch calls `arm_for_alert`,
        which fetches. A sizer that reached it would be a cycle."""
        def _boom(*a, **kw):                       # pragma: no cover - must not run
            raise AssertionError("bars_needed_for_alert fetched bars")
        monkeypatch.setattr(ev, "_fetch_bars_for_alert", _boom)
        monkeypatch.setattr(aus, "arm_for_alert", _boom)
        assert ev.bars_needed_for_alert(
            {"indicator": "u_ffffffffffff.p", "user_id": 1, "params_json": "{}"}) == ev.BARS_MIN

    def test_no_call_site_still_hardcodes_two_hundred(self):
        """The literal that WAS the defect, gone from every live call site.
        Read off the sources with an AST, never a grep — a grep on this repo once
        reported five call sites and all five were prose."""
        import ast as _ast
        import inspect
        from api.services import alert_shadow_log, indicator_alert_service
        from api.routers import indicator_alerts
        offenders = []
        for mod in (ev, aus, alert_shadow_log, indicator_alert_service,
                    indicator_alerts):
            tree = _ast.parse(inspect.getsource(mod))
            for node in _ast.walk(tree):
                if not isinstance(node, _ast.Call):
                    continue
                name = getattr(node.func, "attr", getattr(node.func, "id", ""))
                if name != "_fetch_bars_for_alert":
                    continue
                for arg in node.args[2:]:
                    if isinstance(arg, _ast.Constant) and arg.value == 200:
                        offenders.append(f"{mod.__name__}:{node.lineno}")
        assert offenders == []


class TestTheGroupTakesTheWidestMember:
    def test_one_fetch_serves_the_widest_formula_on_the_symbol(self, monkeypatch):
        """One fetch serves a whole (sym, tf) group. Sizing it off the first
        member hands a 500-bar formula its neighbour's 400-bar series."""
        asked: list[int] = []
        monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                            lambda s, t, n: asked.append(n) or [])
        monkeypatch.setattr(ev, "eval_mode", lambda: "forming")

        class _IAS:
            @staticmethod
            def list_active():
                return [{"id": 1, "sym": "SPY", "tf": "D", "indicator": "rsi",
                         "params_json": '{"period": 14}', "condition": "above",
                         "threshold": 70},
                        {"id": 2, "sym": "SPY", "tf": "D",
                         "indicator": "price_vs_ma",
                         "params_json": '{"period": 500}', "condition": "above",
                         "threshold": 0}]
        import api.services as _svc
        monkeypatch.setattr(_svc, "indicator_alert_service", _IAS, raising=False)
        monkeypatch.setattr(ev, "_evaluate_for_cycle",
                            lambda *a, **k: (None, False, None))
        ev._run_one_cycle()
        assert asked == [ev.bars_wanted(500)]


# ── not computable is not zero ──────────────────────────────────────────────
class TestInsufficientHistoryIsNotAConfidentFalse:
    def test_the_comparison_ate_the_hole_before_the_fix(self):
        """RED FIRST, and it is the UNGUARDED interpreter that stays red: this is
        the behaviour `interpret` still has and must keep — the fix is to ask the
        question BEFORE evaluating, not to change `_cmp` and move 17 frozen
        cross-lane digests."""
        tree = _gt(CLOSE, _call("sma", 300))
        column = ai.interpret(tree, _bars(200))
        assert len(column) == 200
        assert sum(1 for v in column if v == 0.0) == 200
        assert not [v for v in column
                    if v is None or (isinstance(v, float) and math.isnan(v))]

    def test_the_alert_column_answers_none_instead(self):
        tree = _gt(CLOSE, _call("sma", 300))
        fn = aus._make_value_fn("d2", "p", _defn(tree))
        bars = _bars(200)
        column = fn.column(bars, {})
        assert column == [None] * 200
        assert fn(bars, {}) is None

    def test_it_answers_again_as_soon_as_the_history_is_there(self):
        """The control on the guard: a refusal that never lifts is a lane that
        never fires, which is the same defect wearing the other sign."""
        tree = _gt(CLOSE, _call("sma", 300))
        fn = aus._make_value_fn("d3", "p", _defn(tree))
        assert fn(_bars(299), {}) is None
        assert fn(_bars(ev.bars_wanted(300)), {}) is not None

    def test_the_shortfall_is_measured_against_the_trees_own_declaration(self):
        for period in (20, 200, 300):
            tree = _call("sma", period)
            assert ai.unresolved_lookback(tree, _bars(period - 1)) == 1
            assert ai.unresolved_lookback(tree, _bars(period)) == 0
            assert ai.unresolved_lookback(tree, None) == period

    def test_a_nested_tree_counts_the_path_not_the_widest_argument(self):
        """`sma(sma(close,5),7)` needs 12 bars, and neither argument alone
        exceeds anything — the case a per-argument check misses."""
        inner = _call("sma", 5)
        tree = {"type": "call", "name": "sma",
                "args": [inner, {"type": "num", "value": 7}]}
        assert ai.max_lookback(tree) == 12
        assert ai.unresolved_lookback(tree, _bars(11)) == 1
        assert ai.unresolved_lookback(tree, _bars(12)) == 0


class TestTheSeededEmaIsNoLongerWhatTheLaneReports:
    def test_a_200_bar_window_reports_the_sma_seed_and_a_sized_one_does_not(self):
        """`ema(close,200)` over exactly 200 bars has ONE value, at index 199,
        and it is the SMA200 SEED — not an EMA. The window is what fixes that;
        no refusal can tell "seeded" from "converged"."""
        tree = _call("ema", 200)
        fn = aus._make_value_fn("d4", "p", _defn(tree))
        narrow = _bars(200)
        seed = sum(b["c"] for b in narrow) / 200
        got_narrow = fn(narrow, {})
        assert abs(got_narrow - seed) <= 1e-9, (
            "at exactly `period` bars the only value IS the seed")
        got_wide = fn(_bars(ev.bars_wanted(200)), {})
        assert abs(got_wide - seed) > 1e-6
        # and the widened window is what the lane now asks for
        assert ev.bars_wanted(ai.max_lookback(tree)) == 600
