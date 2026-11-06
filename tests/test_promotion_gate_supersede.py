"""AUDIT Q4: a later fully green gate run on the same SHA may supersede a `cancelled` run, and never a `failure`.

Reads the real decision code. This is what lets a manual hosted fallback rescue a commit whose push run was cancelled
during a runner outage, and nothing else about promotion changes.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import promotion_gate as pg  # noqa: E402

GATE = pg.ALWAYS_RUNS
EARLY, LATE, LATER = "2026-11-06T01:00:00Z", "2026-11-06T02:00:00Z", "2026-11-06T03:00:00Z"
OTHER = "vite build args"


def run(conclusion, created=None, status="completed", name=GATE):
    r = {"name": name, "status": status, "conclusion": conclusion}
    if created:
        r["created_at"] = created
    return r


def decide(*runs, gating=(GATE,)):
    wf = [{"name": n, "state": "active"} for n in gating]
    return pg.decide(gating=list(gating), runs=list(runs), workflows=wf)


def test_a_later_green_run_supersedes_a_cancelled_one():
    assert decide(run("cancelled", EARLY), run("success", LATE))[0] == pg.PROMOTE


def test_several_cancelled_runs_are_all_superseded():
    assert decide(run("cancelled", EARLY), run("cancelled", LATE), run("success", LATER))[0] == pg.PROMOTE


@pytest.mark.parametrize("conclusion", ["failure", "timed_out", "startup_failure", "skipped", "stale", "neutral", None])
def test_a_later_green_run_never_supersedes_anything_but_cancelled(conclusion):
    verdict, why = decide(run(conclusion, EARLY), run("success", LATE))
    assert verdict == pg.REFUSE, why


def test_a_failure_still_refuses_with_a_cancelled_run_beside_it():
    assert decide(run("cancelled", EARLY), run("failure", LATE), run("success", LATER))[0] == pg.REFUSE


def test_a_cancelled_run_after_the_green_one_still_refuses():
    assert decide(run("success", EARLY), run("cancelled", LATE))[0] == pg.REFUSE


def test_a_same_instant_is_not_later():
    assert decide(run("cancelled", LATE), run("success", LATE))[0] == pg.REFUSE


def test_a_cancelled_run_alone_still_refuses():
    assert decide(run("cancelled", EARLY))[0] == pg.REFUSE


def test_two_cancelled_runs_alone_still_refuse():
    assert decide(run("cancelled", EARLY), run("cancelled", LATE))[0] == pg.REFUSE


@pytest.mark.parametrize("runs", [
    (run("cancelled"), run("success", LATE)),
    (run("cancelled", EARLY), run("success")),
    (run("cancelled"), run("success")),
])
def test_a_missing_timestamp_supersedes_nothing(runs):
    assert decide(*runs)[0] == pg.REFUSE


def test_a_green_run_still_in_progress_supersedes_nothing():
    verdict = decide(run("cancelled", EARLY), run(None, LATE, status="in_progress"))[0]
    assert verdict == pg.REFUSE


def test_only_the_always_runs_gate_can_supersede():
    """Every other gating workflow keeps today's rule exactly."""
    gating = (GATE, OTHER)
    runs = (run("success", EARLY), run("cancelled", EARLY, name=OTHER), run("success", LATE, name=OTHER))
    assert decide(*runs, gating=gating)[0] == pg.REFUSE


def test_another_workflows_green_run_cannot_supersede_the_gate():
    gating = (GATE, OTHER)
    assert decide(run("cancelled", EARLY), run("success", LATE, name=OTHER), gating=gating)[0] == pg.REFUSE


def test_the_github_timestamp_format_orders_correctly():
    """The API's fixed-width UTC stamps sort as strings, which is the comparison the code uses."""
    assert "2026-11-06T09:59:59Z" < "2026-11-06T10:00:00Z"


def test_the_self_check_covers_both_directions():
    assert pg._self_check() == 0


def test_the_workflow_run_list_carries_the_field():
    """`promote-production.yml` feeds decide() the raw runs API, so nothing has to be added for `created_at` to arrive."""
    text = (pathlib.Path(pg.__file__).parents[1] / ".github" / "workflows" / "promote-production.yml").read_text(encoding="utf-8")
    assert "actions/runs?head_sha=${SHA}" in text
