"""The promotion catch-up's decision (tools/promote_decision.py) and its wiring (promote-production.yml).

The 8 cases the review asked for, EACH with a control: the fast-forward target is the candidate and is never master's
tip (unless the tip IS the candidate). Pure functions, loaded by path; no network, no git.
Runs in: the nightly `full-suite report` (tests/), and, at promote time, `promote_decision.py --self-check` (the same
cases) is a step of promote-production.yml itself, before any decision is used.
"""
from __future__ import annotations

import importlib.util
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("_promote_decision", ROOT / "tools" / "promote_decision.py")
pd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pd)

A, B, C, TIP = "a" * 40, "b" * 40, "c" * 40, "f" * 40
BASE = dict(gate_ok=True, cand_in_prod=False, on_master=True, prod_in_cand=True, frozen=False, pending=None,
            pending_in_cand=False, pending_in_prod=False)


def never_the_tip(facts, d):
    """The control on every case: a target, if any, is the candidate, and is not master's tip."""
    if d["target"] is not None:
        assert d["target"] == facts["candidate"]
        assert d["target"] != facts["master_tip"] or facts["master_tip"] == facts["candidate"]


def run(**kw):
    f = dict(BASE, **{"master_tip": TIP, **kw})
    d = pd.decide(f)
    never_the_tip(f, d)
    return d


def test_1_normal_promotion_targets_the_gated_sha_not_the_tip():
    r = pd.resolve(event="workflow_run", trigger_sha=A, trigger_conclusion="success")
    d = run(candidate=r["candidate"])
    assert (d["action"], d["target"]) == (pd.PROMOTE, A)


def test_2_freeze_defers_then_the_pending_sha_resumes():
    held = run(candidate=A, frozen=True)
    assert held["action"] == pd.HOLD and held["target"] is None and held["pending"]["sha"] == A
    r = pd.resolve(event="workflow_dispatch", pending=held["pending"])
    d = run(candidate=r["candidate"], pending=held["pending"])
    assert (d["action"], d["target"], d["pending"]) == (pd.PROMOTE, A, None)


def test_3_missed_cron_the_held_run_itself_promotes_after_its_wait():
    # no schedule event exists in this case at all: the same run re-checks (frozen False) and promotes ITS sha
    d = run(candidate=A, pending={"sha": A, "redispatches": 0})
    assert (d["action"], d["target"]) == (pd.PROMOTE, A)
    assert pd.resolve(event="schedule")["candidate"] is None   # and a cron with nothing pending never picks the tip


def test_4_duplicate_workflow_runs_on_the_same_sha_are_idempotent():
    first = run(candidate=A)
    second = pd.decide(dict(BASE, candidate=A, cand_in_prod=True, master_tip=A))
    never_the_tip(dict(BASE, candidate=A, master_tip=A), second)
    assert first["action"] == pd.PROMOTE and second["action"] == pd.ALREADY and second["target"] is None


def test_5_recovery_after_an_interrupted_run_resumes_the_pending_sha():
    pend = {"sha": A, "redispatches": 1}
    r = pd.resolve(event="workflow_dispatch", pending=pend)
    assert r["candidate"] == A
    d = run(candidate=A, pending=pend)
    assert (d["action"], d["target"]) == (pd.PROMOTE, A)
    go, rec, _ = pd.may_redispatch({"sha": A, "redispatches": pd.MAX_REDISPATCH - 1})
    assert go and rec["redispatches"] == pd.MAX_REDISPATCH
    assert not pd.may_redispatch(rec)[0]                          # the cap, counted in the record


def test_6_master_moving_during_the_wait():
    assert run(candidate=A, master_tip=B)["target"] == A                          # descendant tip: still A
    assert run(candidate=A, on_master=False, master_tip=B)["action"] == pd.REFUSE_OFF_MASTER
    rep = run(candidate=B, frozen=True, pending={"sha": A, "redispatches": 1}, pending_in_cand=True)
    assert rep["action"] == pd.HOLD and rep["pending"] == {"sha": B, "redispatches": 0}   # replaced: B descends from A
    keep = run(candidate=C, frozen=True, pending={"sha": A, "redispatches": 0}, pending_in_cand=False)
    assert keep["pending"] == {"sha": A, "redispatches": 0}                                # not a descendant: A stays


def test_7_a_failed_gate_never_promotes():
    d = run(candidate=A, gate_ok=False, pending={"sha": A})
    assert (d["action"], d["target"], d["pending"]) == (pd.REFUSE_GATE, None, None)
    t = run(candidate=A, gate_ok=False, gate_unknown=True, pending={"sha": A, "redispatches": 0})
    assert t["action"] == pd.REFUSE_GATE and t["pending"] == {"sha": A, "redispatches": 0}   # a timeout keeps it pending


def test_8_stale_sha_never_moves_production_backwards_or_by_force():
    assert run(candidate=A, cand_in_prod=True, prod_in_cand=False)["action"] == pd.ALREADY
    assert run(candidate=A, prod_in_cand=False)["action"] == pd.REFUSE_DIVERGED


def test_the_gate_check_needs_every_expected_job():
    runs = [{"id": 7, "name": pd.GATE_WORKFLOW_NAME, "head_sha": A, "head_branch": "master", "event": "push",
             "status": "completed", "conclusion": "success"}]
    jobs = [{"run_id": 7, "conclusion": "success"}] * 7 + [{"run_id": 7, "conclusion": "skipped"}]
    assert not pd.gate_ok(runs, jobs, 8, A)[0]
    assert pd.gate_ok(runs, [{"run_id": 7, "conclusion": "success"}] * 8, 8, A)[0]
    assert pd.expected_jobs((ROOT / ".github" / "workflows" / "master-deploy-gate.yml").read_text(encoding="utf-8")) >= 5


def test_the_self_check_passes():
    out = subprocess.run([sys.executable, str(ROOT / "tools" / "promote_decision.py"), "--self-check"],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0 and "self-check: PASS" in out.stdout, out.stdout + out.stderr


def test_the_workflow_is_wired_to_the_decision_and_bounded():
    wf = (ROOT / ".github" / "workflows" / "promote-production.yml").read_text(encoding="utf-8")
    assert "python tools/promote_decision.py --self-check" in wf
    assert "promote_decision.py decide" in wf and "promote_decision.py resolve" in wf
    assert "timeout-minutes: 200" in wf and "timeout-minutes: 130" in wf        # job < 6 h; the wait step bounded
    assert "cancel-in-progress: false" in wf and "cancel-in-progress: true" not in wf
    assert "--force" not in wf.replace("never `--force`", "").replace("NEVER `--force`", "")
    assert "git push origin \"$TARGET\":refs/heads/production" in wf
    assert "actions: write" in wf.split("\n  resume:")[1]                     # only the resume job may dispatch
    assert "actions: write" not in wf.split("\n  resume:")[0].split("permissions:")[1].split("jobs:")[0]
