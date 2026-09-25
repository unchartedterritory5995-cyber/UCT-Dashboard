"""The Notebook semantic-search sweep is REGISTERED in api/main.py, once, with
max_instances=1 — a scheduler job that exists in a service module and is wired to
no scheduler is the "written, documented as scheduled, wired into no scheduler"
class this repo has paid for before (the desk insights pass ran for weeks that
way). Wave 7 lane H wrote `note_semantic.sweep_job`; the controller registers it.

Read by AST over api/main.py, never by importing the app: the registration sits
inside the lifespan's scheduler block, which a bare import does not run, and the
rail must answer the same on a box with no scheduler lock.

Non-vacuity: the probe must also see a job it is NOT looking for
(`desk_session_audit`), or an `add_job` walk that finds nothing would pass every
absence assertion below by silence.
"""
from __future__ import annotations

import ast
from pathlib import Path

MAIN = Path(__file__).resolve().parents[1] / "api" / "main.py"
SWEEP_ID = "notebook_semantic_sweep"
CONTROL_ID = "desk_session_audit"


def _add_job_calls() -> dict[str, dict[str, object]]:
    """{job id: {keyword: literal value}} for every `<x>.add_job(...)` call in main.py
    that carries a literal `id=`."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    found: dict[str, dict[str, object]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "add_job"):
            continue
        kws = {}
        for kw in node.keywords:
            if isinstance(kw.value, ast.Constant):
                kws[kw.arg] = kw.value.value
        job_id = kws.get("id")
        if isinstance(job_id, str):
            found[job_id] = kws
    return found


def test_the_probe_sees_a_job_it_is_not_looking_for():
    jobs = _add_job_calls()
    assert CONTROL_ID in jobs, (
        f"the add_job walk did not find {CONTROL_ID!r}; the probe is broken, not the tree "
        f"(saw {sorted(jobs)[:8]}...)")


def test_the_semantic_sweep_is_registered_once_with_max_instances_1():
    jobs = _add_job_calls()
    assert SWEEP_ID in jobs, (
        f"{SWEEP_ID!r} is not registered in api/main.py — note_semantic.sweep_job exists and "
        f"runs nowhere (saw {sorted(jobs)[:8]}...)")
    assert jobs[SWEEP_ID].get("max_instances") == 1, (
        f"the semantic sweep must run with max_instances=1 (two sweeps race on the same "
        f"members); got {jobs[SWEEP_ID].get('max_instances')!r}")


def test_the_sweep_is_registered_exactly_once_by_source():
    # Two registrations under one id would be a silent replace at runtime
    # (replace_existing=True) — and a sign that a merge duplicated the block.
    src = MAIN.read_text(encoding="utf-8")
    assert src.count(f'id="{SWEEP_ID}"') == 1, "the semantic sweep is registered more than once"


def test_the_registered_callable_is_the_service_modules_sweep_job():
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_job" and node.args):
            ids = {kw.arg: kw.value for kw in node.keywords}
            idv = ids.get("id")
            if isinstance(idv, ast.Constant) and idv.value == SWEEP_ID:
                target = node.args[0]
                assert isinstance(target, ast.Attribute) and target.attr == "sweep_job", (
                    "the registered callable must be note_semantic.sweep_job, the entry point "
                    "that never raises into the scheduler")
                return
    raise AssertionError(f"no add_job call with id={SWEEP_ID!r}")
