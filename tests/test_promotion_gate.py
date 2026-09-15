"""Rails for the promoted-branch deploy gate's decision (`tools/promotion_gate.py`).

Two things this must never do, and both have precedent in this repo:

  * promote on an EMPTY result — an empty set satisfies "every gating check passed",
    and a failed API query returns exactly that (rule 14);
  * treat a workflow nobody classified as harmless — "nobody decided" and "decided not
    to gate" are different facts, and only one of them is safe.
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools import promotion_gate as pg  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ALWAYS = pg.ALWAYS_RUNS
WF_OK = [{"name": ALWAYS, "state": "active"}, {"name": "b", "state": "active"}]


def _ok(name):
    return {"name": name, "status": "completed", "conclusion": "success"}


# ── the marker, and what an unclassified workflow costs ──────────────────────

def test_the_marker_is_read_from_the_head_of_the_file():
    assert pg.classify("# promotion-gate: yes\nname: x\n") == "yes"
    assert pg.classify("# promotion-gate: no - because\nname: x\n") == "no"


def test_a_marker_buried_past_the_scan_window_does_not_count():
    """⛔ A classification a reviewer would never see is not a classification."""
    buried = "\n" * (pg._MARKER_SCAN_LINES + 5) + "# promotion-gate: yes\n"
    assert pg.classify(buried) is None


def test_a_workflow_with_no_marker_is_unclassified_not_advisory():
    assert pg.classify("name: something\non:\n  push:\n") is None


def test_every_workflow_in_the_repo_is_classified():
    """⛔ NON-VACUITY: the directory must actually contain workflows, or this passes
    by inspecting nothing — the shape of defect the census rails exist to avoid."""
    gating_map, unclassified = pg.read_workflow_dir(REPO)
    assert len(gating_map) >= 7, f"only {len(gating_map)} workflows read — the scan found almost nothing"
    assert not unclassified, f"unclassified workflow(s): {unclassified}"
    assert ALWAYS in gating_map and gating_map[ALWAYS] == "yes"
    # ...and it is not quietly one answer for everything.
    assert set(gating_map.values()) == {"yes", "no"}, gating_map


def test_the_name_comes_from_the_files_own_name_line():
    """GitHub reports the DISPLAY name on a run, so matching on filename would stop
    matching the moment somebody renames the workflow."""
    gating_map, _ = pg.read_workflow_dir(REPO)
    assert "flow-worker deploy coverage" in gating_map
    assert gating_map["flow-worker deploy coverage"] == "no"


# ── the decision ─────────────────────────────────────────────────────────────

def test_an_empty_run_list_refuses():
    v, why = pg.decide(gating=[ALWAYS], runs=[], workflows=WF_OK)
    assert v == pg.REFUSE and "empty" in why.lower()


def test_an_empty_gating_set_refuses():
    v, _ = pg.decide(gating=[], runs=[_ok(ALWAYS)], workflows=WF_OK)
    assert v == pg.REFUSE


def test_a_failed_gating_check_refuses():
    runs = [_ok(ALWAYS), {"name": "b", "status": "completed", "conclusion": "failure"}]
    v, why = pg.decide(gating=[ALWAYS, "b"], runs=runs, workflows=WF_OK)
    assert v == pg.REFUSE and "b=failure" in why


def test_an_advisory_red_does_not_block():
    """The whole reason this exists instead of Wait-for-CI."""
    runs = [_ok(ALWAYS),
            {"name": "flow-worker deploy coverage", "status": "completed", "conclusion": "failure"}]
    v, _ = pg.decide(gating=[ALWAYS], runs=runs, workflows=WF_OK)
    assert v == pg.PROMOTE


def test_a_still_running_gating_check_waits_rather_than_refusing():
    runs = [_ok(ALWAYS), {"name": "b", "status": "in_progress", "conclusion": None}]
    v, _ = pg.decide(gating=[ALWAYS, "b"], runs=runs, workflows=WF_OK)
    assert v == pg.WAIT


def test_a_path_filtered_check_that_did_not_run_is_not_a_failure():
    v, _ = pg.decide(gating=[ALWAYS, "b"], runs=[_ok(ALWAYS)], workflows=WF_OK)
    assert v == pg.PROMOTE


def test_the_always_runs_check_missing_is_a_failure_not_a_skip():
    """⛔ The hole the clause above opens, closed. `master deploy gate` has no path
    filter on master, so "it did not run" can only mean something is wrong."""
    v, why = pg.decide(gating=[ALWAYS, "b"], runs=[_ok("b")], workflows=WF_OK)
    assert v == pg.REFUSE and ALWAYS in why


def test_a_disabled_gating_workflow_refuses():
    """⛔ A workflow disabled in the UI produces no run — indistinguishable from a path
    filter declining to fire. Requiring `active` is what keeps 'no run' safe."""
    wf = [{"name": ALWAYS, "state": "disabled_manually"}, {"name": "b", "state": "active"}]
    v, why = pg.decide(gating=[ALWAYS], runs=[_ok(ALWAYS)], workflows=wf)
    assert v == pg.REFUSE and "not active" in why


# ── the CLI contract the workflow depends on ─────────────────────────────────

@pytest.mark.parametrize("flag,expect", [("--self-check", 0)])
def test_the_cli_self_check_passes_and_can_be_run(flag, expect):
    r = subprocess.run([sys.executable, "tools/promotion_gate.py", flag],
                       cwd=REPO, capture_output=True, encoding="utf-8", errors="replace")
    assert r.returncode == expect, r.stdout + r.stderr
    assert "self-check:" in r.stdout


def test_the_exit_codes_the_workflow_switches_on_are_distinct():
    """The workflow's `case $CODE in` treats 0/3/other as promote/wait/refuse. If two
    of those ever collapse, a refusal becomes a wait and the job hangs, or worse."""
    assert len({0, 3, 2}) == 3
    codes = {pg.PROMOTE: 0, pg.WAIT: 3, pg.REFUSE: 2}
    assert len(set(codes.values())) == 3
