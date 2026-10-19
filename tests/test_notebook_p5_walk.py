"""The P5 walk's own verdict rules (tools/notebook_p5_walk.py), P5 final fix items 10-13.

The walk is a real-browser tool and its run of record is evidence; these rails pin the four rules it reads
that evidence by, with fakes standing in for Playwright so no browser and no sandbox are needed:

  * item 10 (Task 10 review I-1): an absence is counted only after the offer decision SETTLED. A decision that
    arrives late must be counted, and one that never settles must not produce a count at all;
  * item 11 (Minor 3): a sandbox that is not CLEAN makes the exit code non-zero, whatever the steps said;
  * item 12 (Minor 4): a step that times out with no failed check is a FAIL, not INCONCLUSIVE;
  * item 13 (Minor 5): a press whose click reported an error is a problem even when the card moved on.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_p5_walk as w  # noqa: E402


# ── item 10: count only after the decision settled ────────────────────────────────────────

class FakeTimeout(Exception):
    pass


FakeTimeout.__name__ = "TimeoutError"


class FakeScope:
    """A sheet/dialog. Its offer decision settles `late` (on the first wait for the marker, the way a slow
    preferences read lands while Playwright waits), or never. Counting reads what is on screen NOW."""

    def __init__(self, settles: bool, offers_when_settled: int):
        self.settled = False
        self.settles = settles
        self.offers_when_settled = offers_when_settled
        self.waited_for: list[str] = []

    def locator(self, sel):
        scope = self

        class _First:
            def wait_for(self, timeout=None):
                scope.waited_for.append(sel)
                if sel != w.SETTLED or not scope.settles:
                    raise FakeTimeout(f"{sel} never appeared")
                scope.settled = True

        class _Loc:
            first = _First()
        return _Loc()

    def get_by_role(self, role, name=None):
        scope = self
        assert role == "region" and name == w.OFFER_TITLE

        class _Count:
            def count(self):
                return scope.offers_when_settled if scope.settled else 0
        return _Count()


def test_a_late_decision_is_counted_not_read_as_an_absence():
    scope = FakeScope(settles=True, offers_when_settled=1)
    assert w.offers_once_settled(scope) == 1
    assert scope.waited_for == ['[data-starter-offer="settled"]']


def test_a_decision_that_never_settles_produces_no_count():
    with pytest.raises(FakeTimeout):
        w.offers_once_settled(FakeScope(settles=False, offers_when_settled=1))


def test_the_count_can_be_page_wide_while_the_wait_is_on_the_scope():
    sheet = FakeScope(settles=True, offers_when_settled=0)
    page = FakeScope(settles=True, offers_when_settled=1)
    page.settled = True
    assert w.offers_once_settled(sheet, count_in=page) == 1
    assert sheet.waited_for == [w.SETTLED]


def test_the_marker_the_walk_waits_for_is_the_one_the_product_writes():
    """Non-vacuity: the selector names an attribute KindSection and the Styles manager actually render."""
    j2 = REPO / "app/src/pages/journal-2-0/components/notebook/styles"
    for f in ("KindSection.jsx", "StylesManager.jsx"):
        src = (j2 / f).read_text(encoding="utf-8")
        assert "data-starter-offer={" in src and "'settled'" in src, f
    assert w.SETTLED == '[data-starter-offer="settled"]'


def test_step_4_no_longer_sleeps_and_samples():
    src = (REPO / "tools/notebook_p5_walk.py").read_text(encoding="utf-8")
    body = src[src.index("    def s4(st):"):src.index("    def s5(st):")]
    assert "wait_for_timeout" not in body
    assert body.count("offers_once_settled(") == 2


# ── item 11: the exit code carries the sandbox verdict ────────────────────────────────────

ALL_PASS = {"PASS": 24, "FAIL": 0, "INCONCLUSIVE": 0}


@pytest.mark.parametrize("status", ["NOT CLEAN", "INCOMPLETE", "MISSING"])
def test_a_sandbox_that_is_not_clean_is_non_zero_even_on_all_pass(status):
    assert w.exit_code({"status": status, "clean": False}, None, None, ALL_PASS) == 4


def test_a_clean_sandbox_and_all_pass_is_zero():
    assert w.exit_code({"status": "CLEAN", "clean": True}, None, None, ALL_PASS) == 0


def test_a_clean_sandbox_still_reports_steps_and_not_run():
    clean = {"status": "CLEAN", "clean": True}
    assert w.exit_code(clean, None, None, {**ALL_PASS, "INCONCLUSIVE": 1}) == 1
    assert w.exit_code(clean, None, None, {**ALL_PASS, "FAIL": 1}) == 1
    assert w.exit_code(clean, None, "RuntimeError: x", ALL_PASS) == 1
    assert w.exit_code(clean, "the sandbox never answered", None, ALL_PASS) == 3


def test_main_returns_the_exit_code_helper():
    src = (REPO / "tools/notebook_p5_walk.py").read_text(encoding="utf-8")
    tail = src[src.index("def main("):]
    assert "code = exit_code(integ, not_run, failure, counts)" in tail and "return code" in tail


# ── item 12: a timeout is a FAIL ──────────────────────────────────────────────────────────

def test_a_timeout_with_no_failed_check_is_a_fail():
    assert w.verdict_after_error([{"ok": True}], FakeTimeout("x")) == "FAIL"
    assert w.verdict_after_error([], TimeoutError("x")) == "FAIL"


def test_playwrights_own_timeout_is_a_fail():
    pw = pytest.importorskip("playwright.sync_api")
    assert w.verdict_after_error([], pw.TimeoutError("x")) == "FAIL"


def test_any_other_unfinished_read_stays_inconclusive_and_a_failed_check_is_a_fail():
    assert w.verdict_after_error([{"ok": True}], KeyError("x")) == "INCONCLUSIVE"
    assert w.verdict_after_error([{"ok": False}], KeyError("x")) == "FAIL"


# ── item 13: a reported click is a problem ────────────────────────────────────────────────

def test_a_click_that_reported_an_error_is_a_problem_even_when_the_card_moved_on():
    notes = ["step 2: the click reported TimeoutError; the card then read step 3"]
    assert w.press_problems(notes) == notes


def test_a_forced_press_is_a_problem_and_an_allowed_step_is_excused_by_number():
    notes = ["step 1: the click reported Error; the card then read step 1",
             "step 1: pressed again with force (recorded, not a member's tap)"]
    assert w.press_problems(notes) == notes
    assert w.press_problems(notes, allowed=(1,)) == []
    assert w.press_problems(["no card: {}"]) == []


def test_the_phrases_press_problems_reads_are_the_ones_run_tour_writes():
    src = (REPO / "tools/notebook_p5_walk.py").read_text(encoding="utf-8")
    tour = src[src.index("def run_tour("):src.index("# ── the story")]
    assert 'f"step {n}: the click reported' in tour
    assert "pressed again with force" in tour


def test_the_offers_on_page_assertion_and_step_0_are_declared():
    assert [n for n, _ in w.STEPS] == [0, 1, 2, 3, 4, 5, 6, 7]
    src = (REPO / "tools/notebook_p5_walk.py").read_text(encoding="utf-8")
    assert 'S["offers_on_page"] == 1' in src
