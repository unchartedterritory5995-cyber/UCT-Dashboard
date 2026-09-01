"""Warn before spending hours on a re-run that cannot change a verdict.

⭐ THE MONOTONICITY THAT MAKES THIS DECIDABLE. `null_max` is the MAXIMUM lift
across null trials, so drawing more trials can only raise it or leave it alone.
Gate 2 asks whether the CI's lower bound clears that maximum. A row failing gate
2 at N trials therefore fails at any M > N: escalation makes the bar strictly
higher, never easier.

⛔ MEASURED ON REAL ROWS, 2026-08-31. `go-signal` screened at +8.52pp with a CI
low of +3.92pp against a 5-trial null max of +6.54pp — escalating it would have
cost hours and moved the bar further away. `ema-crossback` cleared it on the
same screen (+11.93 vs +10.09) and is the one that earned the re-run. One
escalation instead of four.
"""
import sys, pathlib, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import contextlib
import pytest

from tools.run_lift_ledger import _warn_futile_escalations


class _Args:
    def __init__(self, trials, sample):
        self.null_trials = trials
        self.sample = sample


def _run(rows, keys, trials=30, sample=1125):
    """⛔ PASSES PLAIN STRINGS, BECAUSE THAT IS WHAT THE CALLER PASSES.
    `main()` builds `wanted` as `[k.strip() for k in args.only.split(",")]`.
    The first version of this file handed the function objects with a `.key`
    attribute — an input no caller produces — so the tests were green while the
    real runner crashed with `AttributeError: 'str' object has no attribute
    'key'` on its first live invocation. Same defect as the panel reading
    `lift_pp`: a fixture written from an assumption instead of the contract."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        # pass `keys` THROUGH — `None` is a real input (no `--only`), and
        # wrapping it in `list()` would test the helper rather than the function
        _warn_futile_escalations(_Args(trials, sample),
                                 list(keys) if keys is not None else None, rows)
    return buf.getvalue()


# ─── the real rows that motivated it ────────────────────────────────────────

GO_SIGNAL = {"null_trials": 5, "ci_low": 0.0392, "null_max": 0.0654,
             "sample_tickers": 1125}
EMA_CROSSBACK = {"null_trials": 5, "ci_low": 0.1193, "null_max": 0.1009,
                 "sample_tickers": 1125}


def test_it_accepts_the_KEY_STRINGS_the_runner_actually_passes():
    """The regression case. `main()` passes strings; anything else is a shape
    no caller produces."""
    out = _run({"go-signal": GO_SIGNAL}, ["go-signal"])
    assert "go-signal" in out


def test_it_survives_the_no_only_case():
    """`--only` omitted leaves `wanted` empty, meaning "measure everything"."""
    assert _run({"go-signal": GO_SIGNAL}, []).strip() == ""
    assert _run({"go-signal": GO_SIGNAL}, None).strip() == ""


def test_it_warns_on_the_row_that_cannot_be_rescued():
    out = _run({"go-signal": GO_SIGNAL}, ["go-signal"])
    assert "CANNOT CHANGE A VERDICT" in out
    assert "go-signal" in out
    assert "certain" in out, "same sample means the conclusion is certain"


def test_it_stays_SILENT_on_the_row_that_earned_its_re_run():
    """⛔ THE DISCRIMINATION CONTROL. A warning that fired on everything would
    be noise, and noise is how a warning stops being read."""
    out = _run({"ema-crossback": EMA_CROSSBACK}, ["ema-crossback"])
    assert out.strip() == "", f"warned about a row that clears gate 2:\n{out}"


def test_a_DIFFERENT_sample_is_flagged_as_uncertain_rather_than_certain():
    """⭐ HONEST ABOUT ITS OWN LIMIT. A new sample re-measures the lift, so the
    CI can move and the conclusion may not carry. Claiming certainty there
    would be the overreach this codebase keeps paying for."""
    out = _run({"go-signal": GO_SIGNAL}, ["go-signal"], sample=4000)
    assert "go-signal" in out
    assert "DIFFERS" in out and "may move" in out


# ─── it must not fire on the cases that are not escalations ────────────────

def test_a_first_measurement_is_not_an_escalation():
    out = _run({}, ["never-measured"])
    assert out.strip() == ""


def test_running_at_the_SAME_trial_count_is_not_an_escalation():
    out = _run({"go-signal": GO_SIGNAL}, ["go-signal"], trials=5)
    assert out.strip() == ""


def test_a_row_missing_its_numbers_is_not_guessed_about():
    for row in ({"null_trials": 5},
                {"null_trials": 5, "ci_low": 0.03},
                {"null_trials": 5, "null_max": 0.06}):
        assert _run({"k": row}, ["k"]).strip() == "", (
            "a row without both bounds cannot support the claim and must not "
            "produce one")


def test_it_names_the_numbers_so_the_reader_can_check_them():
    """A warning that says only "this is futile" asks to be trusted. One that
    prints both bounds can be argued with."""
    out = _run({"go-signal": GO_SIGNAL}, ["go-signal"])
    assert "+3.92pp" in out and "+6.54pp" in out and "5-trial" in out
