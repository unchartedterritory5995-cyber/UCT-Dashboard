"""The landing direction rail (SD-1.2 B1.1 / SD-1.3 C2.4).

The gate scans `git diff HEAD^ HEAD` — the FIRST parent — so a branch-first merge
puts MASTER's files in front of the secret scan instead of ours. Measured with a
controlled A/B on this repo: master-first scanned 2 files, branch-first 62.

This was used live on L1 before it was encoded; C2.4 is the encoding. The check is a
pure function so the failing direction can be exercised without building a repository
for each case — and every case below is a direction the merge machinery can actually
produce.
"""
from __future__ import annotations

import subprocess
import sys

import pytest

from tools.land_master_first import check_direction, self_check

BEFORE = "a" * 40   # master's tip before the merge
TIP = "b" * 40      # the branch being landed
OTHER = "c" * 40    # anything else


def test_master_first_is_accepted():
    ok, why = check_direction(BEFORE, TIP, BEFORE, TIP)
    assert ok, why
    assert "master-first" in why


def test_branch_first_is_refused_and_says_why():
    ok, why = check_direction(TIP, BEFORE, BEFORE, TIP)
    assert not ok
    assert "BRANCH-FIRST" in why
    # The reason must name the CONSEQUENCE, not just the shape: a refusal that
    # says "wrong" teaches nobody why the direction matters.
    assert "gate" in why.lower()


@pytest.mark.parametrize("p1,p2", [
    (OTHER, TIP),      # merged onto something that is not master's tip
    (BEFORE, OTHER),   # merged something that is not the branch
    (OTHER, OTHER),
])
def test_unrecognised_parents_are_refused_rather_than_guessed(p1, p2):
    ok, why = check_direction(p1, p2, BEFORE, TIP)
    assert not ok
    assert "UNRECOGNISED" in why


def test_the_check_can_distinguish_all_three_outcomes():
    """Non-vacuity: a predicate that answered the same way every time would pass
    every assertion above except this one."""
    verdicts = {
        check_direction(BEFORE, TIP, BEFORE, TIP)[0],
        check_direction(TIP, BEFORE, BEFORE, TIP)[0],
        check_direction(OTHER, OTHER, BEFORE, TIP)[0],
    }
    assert verdicts == {True, False}
    reasons = {
        check_direction(BEFORE, TIP, BEFORE, TIP)[1].split(":")[0],
        check_direction(TIP, BEFORE, BEFORE, TIP)[1].split(":")[0],
        check_direction(OTHER, OTHER, BEFORE, TIP)[1].split(":")[0],
    }
    assert len(reasons) == 3, reasons


def test_a_symmetric_merge_of_one_commit_onto_itself_is_not_silently_ok():
    """If master and the branch were the same commit there is nothing to land;
    the check must not report a healthy master-first merge for it."""
    ok, _ = check_direction(BEFORE, BEFORE, BEFORE, TIP)
    assert not ok


def test_self_check_passes_and_is_runnable_standalone():
    assert self_check() == 0
    r = subprocess.run([sys.executable, "tools/land_master_first.py", "--self-check"],
                       capture_output=True, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "PASS" in r.stdout
