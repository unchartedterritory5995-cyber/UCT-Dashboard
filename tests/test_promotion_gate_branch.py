"""AUDIT D1: only runs ON MASTER speak for master.

The runs query filters by commit, not branch, so a run dispatched on a branch sitting at master's tip has master's SHA.
B4 makes such a gate dispatch conclude `failure` on purpose, and that must not refuse master's commit. Through the real
decision code, with a real gating list where it matters.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import promotion_gate as pg  # noqa: E402

GATE = pg.ALWAYS_RUNS
RAILS = ["wisdom rails", "term018 guards", "Options Flow guard", "notebook bytes", "Notebook accessibility"]


def run(conclusion="success", branch="master", name=GATE, status="completed", event="push"):
    return {"name": name, "status": status, "conclusion": conclusion, "head_branch": branch, "event": event}


def no_branch(name=GATE):
    r = run(name=name)
    del r["head_branch"]
    return r


def decide(*runs):
    gating = sorted(n for n, v in pg.read_workflow_dir(str(ROOT))[0].items() if v == "yes")
    return pg.decide(gating=gating, runs=list(runs), workflows=[{"name": n, "state": "active"} for n in gating])


def test_the_real_gating_list_holds_what_these_tests_name():
    gating = [n for n, v in pg.read_workflow_dir(str(ROOT))[0].items() if v == "yes"]
    assert GATE in gating and set(RAILS) <= set(gating)


# ---- a branch run at master's SHA

def test_a_refused_branch_dispatch_at_masters_tip_does_not_refuse_master():
    verdict, why = decide(run(), run("failure", branch="agent/x"))
    assert verdict == pg.PROMOTE, why


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out", "skipped"])
def test_no_branch_conclusion_can_refuse_master(conclusion):
    assert decide(run(), run(conclusion, branch="agent/x"))[0] == pg.PROMOTE


def test_a_branch_run_in_progress_does_not_hold_master():
    assert decide(run(), run(None, branch="agent/x", status="in_progress"))[0] == pg.PROMOTE


def test_a_green_branch_run_does_not_promote():
    verdict, why = decide(run(branch="agent/x"))
    assert verdict == pg.REFUSE and "did not run on master" in why


def test_a_green_branch_run_does_not_outvote_a_failed_master_run():
    assert decide(run("failure"), run(branch="agent/x"))[0] == pg.REFUSE


def test_a_green_branch_run_does_not_clear_a_running_master_gate():
    assert decide(run(None, status="in_progress"), run(branch="agent/x"))[0] == pg.WAIT


def test_the_never_ran_refusal_still_holds():
    verdict, why = decide(run(name=RAILS[0]))
    assert verdict == pg.REFUSE and "did not run on master" in why


def test_a_run_on_main_does_not_count_as_master():
    assert decide(run(branch="main"))[0] == pg.REFUSE


# ---- the same for a rail dispatched on a branch

@pytest.mark.parametrize("rail", RAILS)
def test_a_failed_rail_on_a_branch_at_masters_tip_does_not_refuse(rail):
    assert decide(run(), run("failure", branch="agent/x", name=rail))[0] == pg.PROMOTE


@pytest.mark.parametrize("rail", RAILS)
def test_a_green_rail_on_a_branch_does_not_clear_a_failed_master_rail(rail):
    assert decide(run(), run("failure", name=rail), run(branch="agent/x", name=rail))[0] == pg.REFUSE


@pytest.mark.parametrize("rail", RAILS)
def test_a_failed_rail_on_master_still_refuses(rail):
    assert decide(run(), run("failure", name=rail))[0] == pg.REFUSE


# ---- a fork's branch can be named master: the branch alone does not place a run

def fork(conclusion="success", name=GATE, event="pull_request"):
    return run(conclusion, name=name, event=event)


def test_a_green_fork_pr_on_a_branch_named_master_does_not_promote():
    verdict, why = decide(fork())
    assert verdict == pg.REFUSE and "did not run on master" in why


def test_a_failed_fork_pr_on_a_branch_named_master_does_not_refuse_master():
    verdict, why = decide(run(), fork("failure"))
    assert verdict == pg.PROMOTE, why


def test_a_green_fork_pr_does_not_outvote_a_failed_master_run():
    assert decide(run("failure"), fork())[0] == pg.REFUSE


def test_a_green_fork_pr_cannot_supersede_a_cancelled_gate():
    cancelled = dict(run("cancelled"), created_at="2026-11-06T01:00:00Z")
    assert decide(cancelled, dict(fork(), created_at="2026-11-06T02:00:00Z"))[0] == pg.REFUSE


@pytest.mark.parametrize("rail", RAILS)
def test_a_green_fork_pr_does_not_clear_a_failed_rail(rail):
    assert decide(run(), run("failure", name=rail), fork(name=rail))[0] == pg.REFUSE


@pytest.mark.parametrize("event", ["pull_request", "pull_request_target", "schedule", "workflow_run", "workflow_call"])
def test_only_a_push_or_a_dispatch_counts(event):
    assert decide(run(event=event))[0] == pg.REFUSE


@pytest.mark.parametrize("event", ["push", "workflow_dispatch"])
def test_a_push_and_a_dispatch_on_master_both_count(event):
    assert decide(run(event=event))[0] == pg.PROMOTE


def test_every_gating_workflow_is_reachable_by_a_counted_event():
    """A gating workflow with neither trigger could never be counted, and its absence would read as not relevant."""
    import yaml
    for path in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
        text = path.read_text(encoding="utf-8")
        if pg.classify(text) == "yes":
            doc = yaml.safe_load(text)
            assert "push" in doc.get("on", doc.get(True)), path.name


# ---- a run that cannot be placed

@pytest.mark.parametrize("bad", [no_branch(), dict(run(), head_branch=None), dict(run(), head_branch="")])
def test_a_gate_run_with_no_branch_refuses(bad):
    verdict, why = decide(bad)
    assert verdict == pg.REFUSE and "head_branch" in why


@pytest.mark.parametrize("value", [None, ""])
def test_a_master_run_with_no_event_refuses(value):
    verdict, why = decide(dict(run(), event=value))
    assert verdict == pg.REFUSE and "event" in why


def test_a_branch_run_with_no_event_is_simply_not_counted():
    """Only a run we would otherwise count has to be placed."""
    assert decide(run(), dict(run(branch="agent/x"), event=None))[0] == pg.PROMOTE


def test_a_rail_run_with_no_branch_refuses_even_beside_a_green_gate():
    assert decide(run(), no_branch(RAILS[0]))[0] == pg.REFUSE


def test_an_advisory_run_with_no_branch_is_ignored():
    """Only a run we would otherwise count has to be placed."""
    assert decide(run(), no_branch("flow-worker deploy coverage"))[0] == pg.PROMOTE


def test_the_runs_api_carries_the_field_promotion_now_needs():
    """promote-production.yml passes the raw runs API through, which is where head_branch comes from."""
    text = (ROOT / ".github" / "workflows" / "promote-production.yml").read_text(encoding="utf-8")
    assert "actions/runs?head_sha=${SHA}" in text and "--jq" not in text.split("actions/runs?head_sha=${SHA}")[1].splitlines()[0]
