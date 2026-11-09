"""AUDIT Q4 and D2: a later fully green run of a gating workflow on the same SHA may supersede that workflow's
`cancelled` run, and never a `failure`.

Reads the real decision code. This is what lets a manual hosted fallback rescue a commit whose runs were cancelled during
a runner outage. The end-to-end proof at the bottom uses the real gating list.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import promotion_gate as pg  # noqa: E402

GATE = pg.ALWAYS_RUNS
EARLY, LATE, LATER = "2026-11-06T01:00:00Z", "2026-11-06T02:00:00Z", "2026-11-06T03:00:00Z"
ROOT = pathlib.Path(pg.__file__).resolve().parents[1]
RAILS = ["wisdom rails", "term018 guards", "Options Flow guard", "notebook bytes", "Notebook accessibility"]
OTHER = "vite build args"


def run(conclusion, created=None, status="completed", name=GATE):
    r = {"name": name, "status": status, "conclusion": conclusion, "head_branch": "master", "event": "push"}
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


def test_every_gating_workflow_can_supersede_its_own_cancelled_run():
    gating = (GATE, OTHER)
    runs = (run("success", EARLY), run("cancelled", EARLY, name=OTHER), run("success", LATE, name=OTHER))
    assert decide(*runs, gating=gating)[0] == pg.PROMOTE


def test_a_rail_failure_is_never_superseded():
    gating = (GATE, OTHER)
    runs = (run("success", EARLY), run("failure", EARLY, name=OTHER), run("success", LATE, name=OTHER))
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


# ---- AUDIT D2: the whole outage, end to end, through the real decision code and the real gating list

BEFORE, CANCELLED, FALLBACK = "2026-11-06T01:00:00Z", "2026-11-06T02:00:00Z", "2026-11-06T03:00:00Z"


def real_decide(*runs):
    gating = sorted(n for n, v in pg.read_workflow_dir(str(ROOT))[0].items() if v == "yes")
    assert GATE in gating and set(RAILS) <= set(gating), gating
    return pg.decide(gating=gating, runs=list(runs), workflows=[{"name": n, "state": "active"} for n in gating])


def outage():
    """Gate and all five rails stuck on the VPS, then cancelled. The three hosted rails passed: they do not move."""
    runs = [run("cancelled", CANCELLED), *(run("cancelled", CANCELLED, name=r) for r in RAILS)]
    return runs + [run("success", BEFORE, name=n) for n in ("vite build args", "notebook latency", "Clock parity fixture")]


def fallback(*names):
    return [run("success", FALLBACK, name=n) for n in names]


def test_the_outage_refuses():
    assert real_decide(*outage())[0] == pg.REFUSE


def test_the_full_fallback_promotes():
    verdict, why = real_decide(*outage(), *fallback(GATE, *RAILS))
    assert verdict == pg.PROMOTE, why


def test_a_green_gate_alone_does_not_rescue_cancelled_rails():
    """This is D2: with supersede on the gate only, this was the state nothing could clear."""
    verdict, why = real_decide(*outage(), *fallback(GATE))
    assert verdict == pg.REFUSE
    assert all(r in why for r in RAILS), why


@pytest.mark.parametrize("missing", RAILS)
def test_one_rail_left_cancelled_still_refuses(missing):
    rest = [r for r in RAILS if r != missing]
    verdict, why = real_decide(*outage(), *fallback(GATE, *rest))
    assert verdict == pg.REFUSE and missing in why


def test_rails_alone_do_not_rescue_a_cancelled_gate():
    assert real_decide(*outage(), *fallback(*RAILS))[0] == pg.REFUSE


def test_a_fallback_rail_that_fails_refuses():
    runs = [*outage(), *fallback(GATE, *RAILS[1:]), run("failure", FALLBACK, name=RAILS[0])]
    assert real_decide(*runs)[0] == pg.REFUSE


def test_a_real_failure_during_the_outage_survives_the_fallback():
    runs = [run("cancelled", CANCELLED), run("failure", CANCELLED, name=RAILS[0]),
            *(run("cancelled", CANCELLED, name=r) for r in RAILS[1:]), *fallback(GATE, *RAILS)]
    assert real_decide(*runs)[0] == pg.REFUSE


def test_a_fallback_on_a_branch_rescues_nothing():
    runs = [*outage(), *(dict(r, head_branch="agent/x") for r in fallback(GATE, *RAILS))]
    assert real_decide(*runs)[0] == pg.REFUSE


def test_a_fallback_still_running_refuses_until_it_is_green():
    """So the rails go first and the gate last: the promote the green gate triggers must find nothing left unfinished.
    Refused, not waiting, because a cancelled run outranks a pending one. Recovery is a hand promote, which is safe."""
    runs = [*outage(), *fallback(GATE), *(run(None, FALLBACK, name=r, status="in_progress") for r in RAILS)]
    assert real_decide(*runs)[0] == pg.REFUSE
