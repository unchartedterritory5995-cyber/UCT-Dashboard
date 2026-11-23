"""⭐⭐ TRAIN e95 (the 2b bind audit) -- EVERY SERVER GATE DECIDES ON THE TREE A BINDING DRAWS, NEVER ON AN UNPICKED KNOB ARM.

Since e95 unit 2b the member door builds every arm of a ``switch`` on a member's ``input.string`` (a live knob), and the
SAVED tree keeps them all; one binding prunes the arms its knobs do not pick (``ast_bind.prune_knob_arms``). Before 2b
the door folded the switch to its default, so a saved document held one arm. A gate that reads the saved tree therefore
began to refuse a knob script on an arm the member never picked. Measured by the 2b census: the VWAP built-in's
Earnings arm reads ``earnings.standardized`` (``EV-ES-11``, a field UCT does not hold), and at the default anchor
(Session) the alert lane refused every plot (``other-symbol:unservable``).

Each gate below now binds at the instance's settings (``ast_bind.tree_at_settings``; the declared defaults when there
is no instance), and each has a CONTROL: an arm the member DOES pick still refuses by name. The browser half is
``app/src/components/chart/engine/__tests__/knobArmsGates.test.js``; the mutants are ``ci/mutants/e95-bind-audit.json``.
"""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import alert_trigger_policy as tp                 # noqa: E402
from api.services import alert_user_series as aus                   # noqa: E402
from api.services import ast_bind                                   # noqa: E402
from api.services import scan_definition as sd                      # noqa: E402

OPTIONS = ["Session", "Week", "Earnings"]
EARNINGS = 2                       # the option's index: what the tree compares the knob with
EVENT_TICKER = "EV-ES-11"          # earnings.standardized, gaps on, lookahead on: a field UCT does not hold


def _knob(default="Session"):
    return {"key": "anchor", "type": "enum", "label": "Anchor Period", "default": default, "options": list(OPTIONS)}


def _is(k):
    return {"type": "op", "name": "==", "args": [{"type": "series", "name": "anchor"}, {"type": "num", "value": k}]}


def _pick(earnings_arm, other_arm):
    """``anchor == Earnings ? earnings_arm : other_arm`` -- a knob ternary, as the member door writes one."""
    return {"type": "op", "name": "?:", "args": [_is(EARNINGS), earnings_arm, other_arm]}


CLOSE = {"type": "series", "name": "close"}
OPEN = {"type": "series", "name": "open"}
EVENT_READ = {"type": "sym", "value": EVENT_TICKER, "args": [CLOSE]}


def _defn(tree, default="Session"):
    return {"inputs": [_knob(default)], "plots": [{"key": "p"}], "compute": {"kind": "ast", "ast": tree}}


def _bars(n=40):
    return [{"t": 20260105 + i, "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i, "c": 100.5 + i, "v": 1000}
            for i in range(n)]


def test_the_saved_tree_reads_the_unpicked_arm_and_the_binding_does_not():
    """⛔ non-vacuity: the saved tree reads the event field; bound at the defaults it does not, at Earnings it does."""
    tree = _pick(EVENT_READ, CLOSE)
    assert aus._external_reads(tree)[0] == (EVENT_TICKER,)
    assert aus._external_reads(ast_bind.tree_at_settings(tree, _defn(tree)))[0] == ()
    assert aus._external_reads(ast_bind.tree_at_settings(tree, _defn(tree), {"anchor": "Earnings"}))[0] == (EVENT_TICKER,)


class TestTheAlertLane:
    def test_admitted_at_the_default_arm(self):
        tree = _pick(EVENT_READ, CLOSE)
        fn = aus._make_value_fn("u_knob_gate", "p", _defn(tree))     # raises AdmissionRefused when unbound
        assert fn.reads_symbols == ()

    def test_control_a_default_that_picks_the_event_arm_is_refused_by_name(self):
        tree = _pick(EVENT_READ, CLOSE)
        with pytest.raises(aus.AdmissionRefused) as exc:
            aus._make_value_fn("u_knob_gate_e", "p", _defn(tree, default="Earnings"))
        assert "other-symbol:unservable" in str(exc.value)

    def test_each_instance_is_asked_at_its_own_setting(self):
        """The arm a member picks is re-asked the admission's gates: withheld BY NAME, never armed to stay silent."""
        tree = _pick(EVENT_READ, CLOSE)
        fn = aus._make_value_fn("u_knob_gate_i", "p", _defn(tree))
        bars = _bars()
        assert fn.withheld(bars, {}, "D") is None
        assert fn.withheld(bars, {"anchor": "Week"}, "D") is None
        why = fn.withheld(bars, {"anchor": "Earnings"}, "D")
        assert why and "other-symbol:unservable" in why and "at this setting" in why
        assert all(v is None for v in fn.column(bars, {"anchor": "Earnings"}, "D"))
        assert any(v is not None for v in fn.column(bars, {"anchor": "Week"}, "D"))


class TestTheAlertColumnsHistory:
    LONG_ARM = {"type": "call", "name": "sma", "args": [CLOSE, {"type": "num", "value": 300}]}

    def test_an_unpicked_arm_s_longer_lookback_never_withholds_the_column(self):
        """40 bars: the default arm (close) answers; the picked 300-bar average is short, so it withholds (CONTROL)."""
        fn = aus._make_value_fn("u_knob_gate_h", "p", _defn(_pick(self.LONG_ARM, CLOSE)))
        bars = _bars(40)
        assert any(v is not None for v in fn.column(bars, {}, "D"))
        assert all(v is None for v in fn.column(bars, {"anchor": "Earnings"}, "D"))


class TestTheTriggerPolicy:
    SCALAR_READ = {"type": "op", "name": ">", "args": [{"type": "series", "name": "market_cap"}, {"type": "num", "value": 1e9}]}
    CONDITION = {"type": "op", "name": ">", "args": [CLOSE, OPEN]}

    def test_the_type_is_the_default_arms(self):
        assert tp.output_type_of(_defn(_pick(self.SCALAR_READ, self.CONDITION)), "p") == "condition"

    def test_control_a_default_that_picks_the_scalar_arm_is_a_scalar(self):
        assert tp.output_type_of(_defn(_pick(self.SCALAR_READ, self.CONDITION), default="Earnings"), "p") == "scalar"


class TestTheScanDoorAndTheSweep:
    EVENT_POSITIVE = {"type": "op", "name": ">", "args": [EVENT_READ, {"type": "num", "value": 0}]}
    CONDITION = {"type": "op", "name": ">", "args": [CLOSE, OPEN]}

    def test_admitted_at_the_default_arm_and_the_sweep_reads_that_tree(self):
        defn = _defn(_pick(self.EVENT_POSITIVE, self.CONDITION))
        spec = sd.assert_scannable(defn)                               # raises ScanRefused when unbound
        assert spec["def_hash"]
        bound = sd.bound_scan_tree(defn)
        assert bound == self.CONDITION                                 # no knob left for the input-less sweep to miss
        from api.services import ast_interpret
        assert ast_interpret.symbols_named(bound) == ()

    def test_control_a_default_that_picks_the_event_arm_is_refused_by_name(self):
        with pytest.raises(sd.ScanRefused):
            sd.assert_scannable(_defn(_pick(self.EVENT_POSITIVE, self.CONDITION), default="Earnings"))

    def test_the_sweep_evaluates_the_tree_the_door_admitted(self):
        """⛔ ONE TREE: ``evaluate_one`` reads ``scan_definition.bound_scan_tree`` (railed by AST: a sweep that read
        ``compute.ast`` again would load an unpicked arm's symbol and miss the knob it was never handed)."""
        import ast
        src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "screener" / "scan_evaluator.py")
        mod = ast.parse(src.read_text(encoding="utf-8"))
        fn = next(n for n in mod.body if isinstance(n, ast.FunctionDef) and n.name == "evaluate_one")
        sources = [ast.unparse(a.value) for a in ast.walk(fn) if isinstance(a, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == "tree" for t in a.targets)]
        assert sources == ["scan_definition.bound_scan_tree(definition)"], sources
