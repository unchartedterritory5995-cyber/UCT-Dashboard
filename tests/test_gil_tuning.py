"""The interpreter's thread switch interval is set at boot (2026-11-12).

A row-by-row sqlite read is one GIL hand-off per row, and each hand-off waits one switch
interval while another thread runs Python: 852 rows took 1.7 ms alone and 1,640 ms beside
one busy thread. `api/services/gil_tuning.py` shortens the interval; these rails pin what
value is in force for every spelling of the knob, and that the boot applies it.
"""
import ast
import sys
import threading
import time
from pathlib import Path

import pytest

from api.services import gil_tuning as gt

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _restore_interval():
    before = sys.getswitchinterval()
    yield
    sys.setswitchinterval(before)


def test_unset_or_blank_means_the_default():
    assert gt.resolve(None) == gt.DEFAULT_MS
    assert gt.resolve("") == gt.DEFAULT_MS
    assert gt.resolve("   ") == gt.DEFAULT_MS
    assert gt.DEFAULT_MS < 5.0, "the default must be shorter than the interpreter's own 5 ms"


def test_a_stated_value_inside_the_range_is_taken_as_stated():
    assert gt.resolve("5") == 5.0            # the interpreter's own default, the way back
    assert gt.resolve(" 0.1 ") == 0.1
    assert gt.resolve(str(gt.MIN_MS)) == gt.MIN_MS
    assert gt.resolve(str(gt.MAX_MS)) == gt.MAX_MS


@pytest.mark.parametrize("raw", ["fast", "0", "-1", "0.01", "10.5", "1e9", "nan", "inf", "0,5"])
def test_a_value_that_is_not_a_number_in_range_is_REFUSED_not_clamped(raw):
    assert gt.resolve(raw) is None


def test_apply_sets_the_interval_the_environment_names():
    sys.setswitchinterval(0.005)
    out = gt.apply({gt.ENV: "0.25"})
    assert out["applied"] is True and out["raw"] == "0.25"
    assert out["was_ms"] == pytest.approx(5.0)
    assert sys.getswitchinterval() == pytest.approx(0.00025)
    assert out["ms"] == pytest.approx(0.25)


def test_apply_with_nothing_set_puts_the_default_in_force():
    sys.setswitchinterval(0.005)
    out = gt.apply({})
    assert out["applied"] is True
    assert sys.getswitchinterval() == pytest.approx(gt.DEFAULT_MS / 1000.0)


def test_a_refused_value_leaves_the_interpreter_exactly_as_it_was():
    sys.setswitchinterval(0.003)
    out = gt.apply({gt.ENV: "banana"})
    assert out == {"applied": False, "ms": pytest.approx(3.0), "was_ms": pytest.approx(3.0), "raw": "banana"}
    assert sys.getswitchinterval() == pytest.approx(0.003)


def test_the_web_boot_applies_it():
    """`api/main.py` must call `gil_tuning.apply()`: a module nobody calls tunes nothing.

    Read from the AST (a call, not a mention in a comment), with a control that the same
    walk sees a call that is really there.
    """
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))

    def calls(attr):
        return [n for n in ast.walk(tree)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attr]

    applied = [c for c in calls("apply")
               if isinstance(c.func.value, ast.Name) and c.func.value.id in ("gil_tuning", "_gil_tuning")]
    assert len(applied) == 1, "api/main.py must apply the switch interval exactly once"
    assert calls("current_default_thread_limiter"), "the walk cannot see a call that is there"


def test_the_mechanism_a_shorter_interval_bounds_a_many_handoff_loop():
    """The property itself, on this interpreter: a thread that releases the GIL many times
    beside a busy thread finishes sooner under a shorter interval. Deliberately coarse (a
    2x margin on a ~10x effect) so a loaded CI box cannot make it flap."""
    if not hasattr(sys, "getswitchinterval"):
        pytest.skip("no switch interval on this interpreter")
    stop = threading.Event()

    def busy():
        x = 0
        while not stop.is_set():
            for i in range(5000):
                x += i

    def handoffs(n=150):
        t = time.perf_counter()
        for _ in range(n):
            time.sleep(0)                    # releases the GIL and takes it back
        return time.perf_counter() - t

    spinner = threading.Thread(target=busy, daemon=True)
    spinner.start()
    try:
        time.sleep(0.05)
        sys.setswitchinterval(0.02)
        slow = handoffs()
        sys.setswitchinterval(0.0005)
        fast = handoffs()
    finally:
        stop.set()
        spinner.join()
    assert fast * 2 < slow, f"a shorter interval did not shorten the loop: {fast:.3f}s vs {slow:.3f}s"
