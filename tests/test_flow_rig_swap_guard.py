"""The rig's deploy-swap guard must actually fire, and must fail CLOSED.

⛔ HARD RULE (owner, 2026-09-12): a rig run that overlaps any master push is
INCONCLUSIVE. Every master push rebuilds web, so a straddling run measures two
different pods — and the symptom does not announce itself as a deploy. On
2026-09-12 another workstream pushed five times in six minutes and the rig
reported `login http 502` on three consecutive runs, which reads exactly like a
broken product. `/api/health` was 502 in that window and 200 with a 46 s uptime
immediately afterwards.

⭐ THREE OUTCOMES, NOT TWO. An unreadable uptime is the swap case wearing a blank
face — during a swap `/api/health` itself 502s — so `None` must be INCONCLUSIVE and
never a pass. A guard that treats "could not tell" as "fine" is the shape
`lesson_a_saturated_instrument_reports_zero` names.

Mutation proof: invert the `up_after < up_before` comparison in `_swap_verdict`
-> test_a_backward_uptime_is_a_swap goes RED.
"""
from __future__ import annotations

import importlib.util
import os

_RIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "tools", "flow_cold_paint_rig.py")


def _rig():
    spec = importlib.util.spec_from_file_location("flow_cold_paint_rig", _RIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_a_clean_run_is_not_a_swap():
    """The control. Without this, a guard that returns True for everything would
    satisfy every other assertion in this file."""
    swapped, why = _rig()._swap_verdict(1000.0, 1030.0, 30.0)
    assert swapped is False, why
    assert why == ""


def test_a_backward_uptime_is_a_swap():
    swapped, why = _rig()._swap_verdict(2000.0, 12.0, 30.0)
    assert swapped is True
    assert "BACKWARD" in why


def test_a_pod_younger_than_the_run_is_a_swap():
    """The subtle one: uptime can go FORWARD across a swap if the run is long
    enough, so the comparison to elapsed time is what catches it."""
    swapped, why = _rig()._swap_verdict(5.0, 20.0, 60.0)
    assert swapped is True
    assert "younger" in why


def test_an_unreadable_uptime_fails_CLOSED():
    rig = _rig()
    for before, after in ((None, 100.0), (100.0, None), (None, None)):
        swapped, why = rig._swap_verdict(before, after, 10.0)
        assert swapped is True, "uptime %r/%r must be INCONCLUSIVE" % (before, after)
        assert "unreadable" in why


def test_the_summary_discards_swapped_runs_rather_than_averaging_them():
    """A source check, because the discard happens in `main()` and nothing else
    can observe it: the medians must be computed over runs that are NOT swapped."""
    with open(_RIG, encoding="utf-8") as fh:
        src = fh.read()
    assert 'not r.get("deploy_swapped") and r.get(key)' in src, (
        "main()'s summary no longer filters swapped runs out of the medians")
    assert 'discarded = [r for r in cand if r.get("deploy_swapped")]' in src, (
        "main() no longer counts the discarded runs — a silent discard is as bad "
        "as averaging them in, because nobody can tell n dropped")
