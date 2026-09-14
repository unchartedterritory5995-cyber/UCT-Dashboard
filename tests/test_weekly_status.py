"""F-L2-1 rail - the weekly run's exit code must mean something.

The defect: `claude -p` exits 0 having successfully written a report ABOUT REFUSING TO
PROCEED, so Task Scheduler recorded success for a run that stopped at the first check
and reached nobody. These cases pin the mapping, and the one that matters most is the
LAST one: a report with no status line is exit 5, never 0.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "weekly_status.py"


def _load():
    spec = importlib.util.spec_from_file_location("weeklystatus", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


S = _load()


@pytest.mark.parametrize("status,code", [
    ("RAN", 0),
    ("STOPPED-NOTHING-READY", 0),
    ("STOPPED-ENV", 3),
    ("STOPPED-ERROR", 4),
])
def test_each_declared_status_maps_to_its_exit_code(status, code):
    got, tok, _ = S.decide("a report\n\nSTATUS: %s\n" % status)
    assert (got, tok) == (code, status)


def test_a_report_with_no_status_line_is_five_and_never_zero():
    code, tok, why = S.decide("a report that just stops mid-sen")
    assert code == 5 and tok == "NO-STATUS"
    assert "SILENT FAILURE" in why


def test_an_empty_report_is_five():
    assert S.decide("")[0] == 5


def test_an_unrecognised_status_is_not_treated_as_success():
    """A status this tool does not know is not one it may call fine."""
    code, tok, _ = S.decide("STATUS: FINE\n")
    assert code == 5
    assert tok == "FINE"


def test_the_last_status_line_wins():
    """A run that revises its verdict must not be judged on the first draft."""
    code, tok, _ = S.decide("STATUS: RAN\nlater, on reflection\nSTATUS: STOPPED-ERROR\n")
    assert (code, tok) == (4, "STOPPED-ERROR")


@pytest.mark.parametrize("line", [
    "STATUS: RAN",
    "  STATUS: RAN  ",
    "**STATUS: RAN**",
    "`STATUS: RAN`",
    "> STATUS: RAN",
    "STATUS:RAN",
    "STATUS: RAN.",
])
def test_the_token_survives_the_decoration_a_model_reaches_for(line):
    assert S.decide(line)[1] == "RAN"


def test_prose_that_merely_mentions_a_status_is_not_a_status_line():
    """Otherwise a sentence explaining the contract would set the exit code."""
    assert S.decide("I would normally print STATUS: RAN here but I will not.")[1] == "NO-STATUS"


def test_only_the_two_good_outcomes_are_zero():
    zero = {k for k, v in S.EXIT.items() if v == 0}
    assert zero == {"RAN", "STOPPED-NOTHING-READY"}


def test_the_self_check_passes():
    assert S.main(["--self-check"]) == 0
