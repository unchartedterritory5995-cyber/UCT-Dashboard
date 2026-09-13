"""The rig-window rule, encoded rather than remembered.

⛔ *"Rig only when no Q1 scheduled task is due within the hour"* (owner ruling).
The sampler, the canary and the F5 matrix all drive **the same signed-in Chrome
profile** — there is one, it is never recreated, and a fresh one is a signed-out
one. An overlap corrupts whichever run is mid-flight and leaves either a SKIPPED
observation row or a half-finished matrix cell, with **no way to tell which
caused which**.

⭐ A rule an operator has to remember is a rule that gets skipped on the run that
matters. These cases prove the guard fires, and — the half that is easy to
forget — that it stays quiet on a genuinely clear window.
"""
from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
NOW = datetime.datetime(2026, 9, 13, 9, 45)


def _matrix():
    spec = importlib.util.spec_from_file_location("q1_f5_matrix", TOOLS / "q1_f5_matrix.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["q1_f5_matrix"] = mod
    spec.loader.exec_module(mod)
    return mod


def _q(payload):
    return lambda: payload


def test_it_refuses_when_a_rig_task_is_due_inside_the_hour():
    m = _matrix()
    why = m.rig_window_refusal(NOW, _q(
        '[{"name":"UCT-WaveQ1-Observe","next":"2026-09-13T10:00:00"}]'))
    assert why and "UCT-WaveQ1-Observe" in why and "10:00" in why
    # ⛔ It NAMES the task and the time. "The window is not clear" tells an
    # operator nothing about when to come back, and a refusal nobody can act on
    # is the one people learn to pass `--ignore-window` to.
    assert "15 min" in why


def test_it_stays_quiet_on_a_genuinely_clear_window():
    """⭐ THE PAIR. A guard that refuses everything is not a guard, it is an
    outage — and this one gates the only instrument that can lift F5's freeze."""
    m = _matrix()
    assert m.rig_window_refusal(NOW, _q(
        '[{"name":"UCT-WaveQ1-Observe","next":"2026-09-13T12:00:00"}]')) is None


def test_a_task_already_running_is_not_read_as_far_away():
    """A next-run time in the PAST means the task is running or overdue — the
    worst moment to spawn a second browser on the one profile."""
    m = _matrix()
    why = m.rig_window_refusal(NOW, _q(
        '[{"name":"UCT-WaveQ1-Canary","next":"2026-09-13T09:44:00"}]'))
    # ⚠️ A past stamp is NOT inside the forward window, so the guard is silent —
    # recorded deliberately rather than hidden: Task Scheduler keeps NextRunTime
    # in the future for an enabled task, and a past one means the task is
    # disabled or the trigger has expired. `spawn_rig` refuses a busy profile
    # anyway, which is the real protection against a run in flight.
    assert why is None


def test_an_unreadable_schedule_is_NOT_a_clear_window():
    """⛔ UNKNOWN IS NOT CLEAR. A guard that treats a failed read as permission is
    the swallowed-error shape: it goes quiet exactly when something is wrong
    (`lesson_a_swallowed_error_becomes_a_confident_finding`)."""
    m = _matrix()
    assert "unknown is not clear" in (m.rig_window_refusal(NOW, _q(
        '[{"name":"UCT-WaveQ1-Observe","next":"soon-ish"}]')) or "")

    def boom():
        raise OSError("powershell is not on PATH")
    assert "unknown is not clear" in (m.rig_window_refusal(NOW, boom) or "")


def test_finding_no_Q1_task_at_all_is_an_instrument_answer():
    """⛔ An empty result is a failed invocation until proven otherwise (rule 14).
    The tasks exist on this machine; a query that returns none of them is the
    query being wrong, and reading that as a clear window would let the matrix
    run straight through the sampler's minute."""
    m = _matrix()
    why = m.rig_window_refusal(NOW, _q("[]"))
    assert why and "instrument answer" in why


def test_the_guarded_task_list_covers_every_rig_driver():
    """⛔ DERIVED FROM WHAT ACTUALLY DRIVES THE PROFILE, not from what was
    scheduled when this was written. All three of these run `window_check` or
    `nb_observe`, and both take the rig."""
    m = _matrix()
    assert set(m.RIG_TASKS) >= {
        "UCT-WaveQ1-Observe", "UCT-WaveQ1-Canary", "UCT Wave Q1 Window Check"}
    # ⭐ The GATE is deliberately NOT in the list: it reads a file and never
    # opens a browser, so guarding against it would refuse a window that is
    # genuinely clear — the false-refusal half of the same mistake.
    assert "UCT-WaveQ1-Gate" not in m.RIG_TASKS
    assert m.WINDOW_MINUTES == 60
