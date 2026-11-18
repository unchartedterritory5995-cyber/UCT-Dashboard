"""The promotion decision for `.github/workflows/promote-production.yml`, as pure functions.

WHY (2026-11-10). A promotion held by the deploy freeze used to wait for a `schedule:` cron to promote "the tip of
master". GitHub delivered those crons 7-12 h late or not at all, and "the tip of master" is not the commit whose gate
was just verified. The held run now records the exact gated SHA as PENDING and waits for the freeze in-job (bounded,
tools/deploy_freeze.py); every later trigger resumes THAT SHA. The workflow does the I/O (git, the GitHub API); every
decision is here, so it is tested once and never re-derived in shell.

THE RULES (each one is a test in tests/test_promote_decision.py and a case in --self-check):
  * The fast-forward target is ALWAYS the candidate. The candidate is the triggering gate's head_sha (workflow_run), the
    dispatch input `sha`, or the PENDING record. Master's tip is never a candidate: it is not even an input to `resolve`.
  * Its own gate must have succeeded (the master deploy gate run for that SHA concluded success with the expected number
    of successful jobs) — re-verified at fire time, never carried over from when it was held.
  * SHA ⊑ master and production ⊑ SHA (fast-forward only). production ⊒ SHA is "Already promoted" (idempotent, and the
    stale-SHA guard: an older SHA never moves production backwards).
  * Frozen ⇒ HOLD: the SHA is recorded PENDING. A newer gated SHA replaces the pending one ONLY if it descends from it.
  * A self re-dispatch (GITHUB_TOKEN workflow_dispatch DOES start runs) is capped at MAX_REDISPATCH per pending SHA, and
    the count lives in the pending record.

CLI (the workflow's interface; JSON in, JSON out, exit 0 unless the input is unreadable):
    python tools/promote_decision.py resolve --facts facts.json
    python tools/promote_decision.py decide  --facts facts.json
    python tools/promote_decision.py gate    --runs runs.json --jobs jobs.json --workflow .github/workflows/master-deploy-gate.yml
    python tools/promote_decision.py redispatch --pending pending.json
    python tools/promote_decision.py --self-check
"""
from __future__ import annotations

import argparse
import json
import sys

MAX_REDISPATCH = 2
GATE_WORKFLOW_NAME = "master deploy gate"

# actions
NOTHING = "NOTHING_PENDING"
REFUSE_GATE = "REFUSE_GATE"
ALREADY = "ALREADY_PROMOTED"
REFUSE_OFF_MASTER = "REFUSE_NOT_ON_MASTER"
REFUSE_DIVERGED = "REFUSE_PRODUCTION_NOT_ANCESTOR"
HOLD = "HOLD"
PROMOTE = "PROMOTE"


FALLBACK_SOURCE = "tip (manual fallback, own gate verified)"
BOT_ACTOR = "github-actions[bot]"


def resolve(*, event: str, trigger_sha: str | None = None, trigger_conclusion: str | None = None,
            input_sha: str | None = None, pending: dict | None = None, resume: bool = False, dry_run: bool = False,
            actor: str | None = None, master_tip: str | None = None, tip_gate_ok: bool = False,
            tip_gate_run: str | None = None) -> dict:
    """{candidate, source, stop, gate_green, fallback}. `gate_green`: the candidate's OWN gate is already known green.

    Master's tip is a candidate in ONE case only, the operator's manual fallback: a HUMAN workflow_dispatch (no `sha`,
    no `resume`, no `dry_run`, actor not github-actions[bot]) with nothing pending, and only when the tip's own master
    deploy gate run is success with every expected job (`tip_gate_ok`, the fire-time check). schedule, workflow_run and
    the resume job's re-dispatch never reach it. The fallback then goes through every fire-time check like any other."""
    if event == "workflow_run":
        if trigger_conclusion != "success":
            return {"candidate": None, "source": "workflow_run", "stop": f"the triggering gate concluded {trigger_conclusion!r}",
                    "gate_green": False, "fallback": False}
        return {"candidate": trigger_sha, "source": f"the gate run that just succeeded for {trigger_sha}", "stop": None,
                "gate_green": True, "fallback": False}
    if input_sha:
        return {"candidate": input_sha, "source": f"dispatch input sha={input_sha}", "stop": None, "gate_green": False, "fallback": False}
    if pending and pending.get("sha"):
        return {"candidate": pending["sha"], "source": f"pending {pending['sha']}", "stop": None, "gate_green": False, "fallback": False}
    human_blank = event == "workflow_dispatch" and not resume and not dry_run and (actor or "") not in ("", BOT_ACTOR)
    if human_blank and master_tip:
        if tip_gate_ok:
            return {"candidate": master_tip, "source": f"{FALLBACK_SOURCE}: tip {master_tip} with green gate run {tip_gate_run}",
                    "stop": None, "gate_green": True, "fallback": True}
        return {"candidate": None, "source": "blank dispatch", "gate_green": False, "fallback": False,
                "stop": f"nothing pending and tip {master_tip} has no green gate; pass sha=<commit>"}
    return {"candidate": None, "source": event, "stop": "nothing is pending", "gate_green": False, "fallback": False}


def decide(f: dict) -> dict:
    """The verdict for one candidate. `f`: candidate, gate_ok, cand_in_prod (candidate ⊑ production), on_master
    (candidate ⊑ master), prod_in_cand (production ⊑ candidate), frozen, pending (record or None), pending_in_cand
    (pending.sha ⊑ candidate). Returns {action, target, reason, pending (the record to keep: dict, None = clear)}."""
    c = f.get("candidate")
    pend = f.get("pending")
    if not c:
        return {"action": NOTHING, "target": None, "reason": "no candidate", "pending": pend}
    same = bool(pend and pend.get("sha") == c)
    if not f.get("gate_ok"):
        # a SHA whose own gate did not succeed never promotes. A gate that FAILED drops it from pending (it cannot
        # pass); a gating poll that merely TIMED OUT (checks still running) keeps it pending for the next run.
        if f.get("gate_unknown"):
            return {"action": REFUSE_GATE, "target": None, "reason": f"{c}: its gating checks did not conclude; still pending",
                    "pending": pend if (pend and not same) else (pend or {"sha": c, "redispatches": 0})}
        return {"action": REFUSE_GATE, "target": None, "reason": f"{c}: its own gate did not succeed",
                "pending": None if same else pend}
    if f.get("cand_in_prod"):
        keep = None if (same or (pend and f.get("pending_in_prod"))) else pend
        return {"action": ALREADY, "target": None, "reason": f"production already contains {c}", "pending": keep}
    if not f.get("on_master"):
        return {"action": REFUSE_OFF_MASTER, "target": None, "reason": f"master does not contain {c}",
                "pending": None if same else pend}
    if not f.get("prod_in_cand"):
        return {"action": REFUSE_DIVERGED, "target": None, "reason": f"production is not an ancestor of {c}; never forced",
                "pending": pend}
    if f.get("frozen"):
        if pend and not same and not f.get("pending_in_cand"):
            return {"action": HOLD, "target": None, "reason": f"held; {c} does not descend from the pending "
                    f"{pend.get('sha')}, which stays pending", "pending": pend}
        # liveness: a newcomer replaces a pending SHA only when its OWN gate is already known green; otherwise a
        # newcomer whose gate later fails would have displaced a promotable SHA
        if pend and not same and not f.get("cand_gate_green"):
            return {"action": HOLD, "target": None, "reason": f"held; {c}'s own gate is not yet known green, so the "
                    f"pending {pend.get('sha')} stays pending", "pending": pend}
        rec = dict(pend) if same else {"sha": c, "redispatches": 0}
        for k in ("gate_run_id", "held_at", "freeze_ends_at"):
            if f.get(k) is not None:
                rec[k] = f[k]
        return {"action": HOLD, "target": None, "reason": f"held by the deploy freeze; {c} is PENDING", "pending": rec}
    keep = None if (same or not pend or f.get("pending_in_cand")) else pend
    return {"action": PROMOTE, "target": c, "reason": f"fast-forward production to {c}", "pending": keep}


def gate_ok(runs: list[dict], jobs: list[dict], expected_jobs: int, sha: str) -> tuple[bool, str]:
    """Did the master deploy gate run for `sha` succeed with `expected_jobs` successful jobs (the newest attempt)?"""
    mine = [r for r in runs if r.get("name") == GATE_WORKFLOW_NAME and r.get("head_sha") == sha
            and r.get("head_branch") == "master" and r.get("event") == "push"]
    if not mine:
        return False, f"no {GATE_WORKFLOW_NAME!r} push run on master for {sha}"
    ok = [r for r in mine if r.get("status") == "completed" and r.get("conclusion") == "success"]
    if not ok:
        return False, f"no successful {GATE_WORKFLOW_NAME!r} run for {sha} ({[r.get('conclusion') for r in mine]})"
    run = max(ok, key=lambda r: (r.get("run_attempt") or 1, r.get("id") or 0))
    good = [j for j in jobs if j.get("run_id") == run.get("id") and j.get("conclusion") == "success"]
    if len(good) != expected_jobs:
        return False, f"run {run.get('id')}: {len(good)} successful jobs, expected {expected_jobs}"
    return True, f"run {run.get('id')}: success, {len(good)}/{expected_jobs} jobs"


def expected_jobs(workflow_text: str) -> int:
    """How many job RUNS a successful run of this workflow has: each top-level job, times its static matrix size
    (the product of the matrix's list-valued keys; `include` / `exclude` are not supported and make it unknowable).
    Needs PyYAML (the workflow installs it). Unknowable -> 0, which no run can match: the check fails CLOSED."""
    try:
        import yaml
        jobs = (yaml.safe_load(workflow_text) or {}).get("jobs") or {}
    except Exception:  # noqa: BLE001
        return 0
    n = 0
    for job in jobs.values():
        m = ((job or {}).get("strategy") or {}).get("matrix")
        if m is None:
            n += 1
            continue
        if not isinstance(m, dict) or "include" in m or "exclude" in m:
            return 0
        size = 1
        for v in m.values():
            if not isinstance(v, list):
                return 0
            size *= len(v)
        n += size
    return n


def may_redispatch(pending: dict | None, cap: int = MAX_REDISPATCH) -> tuple[bool, dict | None, str]:
    """(dispatch?, the record with the count incremented, reason). Only for a pending SHA, at most `cap` times."""
    if not pending or not pending.get("sha"):
        return False, pending, "nothing pending"
    n = int(pending.get("redispatches") or 0)
    if n >= cap:
        return False, pending, f"{pending['sha']}: re-dispatch cap reached ({n}/{cap}); stopping, the pending record stays"
    rec = dict(pending, redispatches=n + 1)
    return True, rec, f"{pending['sha']}: re-dispatch {n + 1}/{cap}"


# ── self-check: the 8 cases, each with the control that the target is never master's tip ──────────────────────────────
def _cases():
    A, B, C, TIP, P = "a" * 40, "b" * 40, "c" * 40, "f" * 40, "e" * 40
    base = dict(gate_ok=True, cand_in_prod=False, on_master=True, prod_in_cand=True, frozen=False, pending=None,
                pending_in_cand=False, pending_in_prod=False)
    out = []

    def case(name, facts, want_action, want_target=None, want_pending="any"):
        out.append((name, facts, want_action, want_target, want_pending))

    # 1 normal promotion: the triggering SHA, not master's newer tip
    r = resolve(event="workflow_run", trigger_sha=A, trigger_conclusion="success")
    case("1 normal promotion: target is the gated SHA", dict(base, candidate=r["candidate"], master_tip=TIP), PROMOTE, A, None)
    # 2 freeze deferral, then resume
    case("2a freeze: HOLD records the SHA pending", dict(base, candidate=A, frozen=True, master_tip=TIP), HOLD, None, {"sha": A, "redispatches": 0})
    r = resolve(event="workflow_dispatch", pending={"sha": A, "redispatches": 0})
    case("2b resume (after the in-job wait): the pending SHA promotes and the record clears",
         dict(base, candidate=r["candidate"], pending={"sha": A, "redispatches": 0}, master_tip=TIP), PROMOTE, A, None)
    # 3 missed cron: no schedule event at all; the held run itself re-checks after its wait and promotes
    case("3 missed cron: the held run's own re-check (frozen=False after the wait) promotes the same SHA",
         dict(base, candidate=A, pending={"sha": A, "redispatches": 0}, master_tip=TIP), PROMOTE, A, None)
    # 4 duplicate events: a second workflow_run on the same SHA after it promoted
    case("4 duplicate event: production already contains it -> Already promoted", dict(base, candidate=A, cand_in_prod=True, master_tip=A), ALREADY, None, None)
    # 5 recovery after an interrupted run: pending present, the resumed dispatch takes the PENDING SHA, not the tip
    r = resolve(event="workflow_dispatch", pending={"sha": A, "redispatches": 1})
    case("5 interrupted run: the resume promotes the pending SHA, master's tip is ignored",
         dict(base, candidate=r["candidate"], pending={"sha": A, "redispatches": 1}, master_tip=TIP), PROMOTE, A, None)
    # 6 master moved during the wait: still promote the candidate (a descendant tip is not substituted)
    case("6a master moved (descendant): the candidate promotes", dict(base, candidate=A, master_tip=B), PROMOTE, A, None)
    case("6b master rewritten (candidate gone): refused", dict(base, candidate=A, on_master=False, master_tip=B), REFUSE_OFF_MASTER)
    case("6c a newer gated SHA that descends from the pending one replaces it",
         dict(base, candidate=B, frozen=True, pending={"sha": A, "redispatches": 1}, pending_in_cand=True, cand_gate_green=True,
              master_tip=TIP), HOLD, None, {"sha": B, "redispatches": 0})
    case("6d a newer SHA that does NOT descend from the pending one leaves it pending",
         dict(base, candidate=C, frozen=True, pending={"sha": A, "redispatches": 0}, pending_in_cand=False, master_tip=TIP), HOLD, None, {"sha": A, "redispatches": 0})
    # 7 the gate failing (at fire time) refuses, and drops that pending record
    case("7 gate failed: refused, pending cleared", dict(base, candidate=A, gate_ok=False, pending={"sha": A}, master_tip=TIP), REFUSE_GATE, None, None)
    case("7b gating poll timed out: refused now, the SHA stays pending",
         dict(base, candidate=A, gate_ok=False, gate_unknown=True, pending={"sha": A, "redispatches": 1}, master_tip=TIP),
         REFUSE_GATE, None, {"sha": A, "redispatches": 1})
    # (B) one pending run per concurrency group: A held and waiting; B queued, then CANCELLED by C's arrival (B's run never
    # happens); C's run promotes C, a descendant of A. Production ends at C; B's gate result is never consulted.
    case("B A held, B cancelled in the queue, C promotes C (A cleared)",
         dict(base, candidate=C, pending={"sha": A, "redispatches": 0}, pending_in_cand=True, master_tip=TIP), PROMOTE, C, None)
    # (C) liveness: A verified pending; an unverified dispatch B arrives in a freeze -> A stays; B's gate fails -> A stays
    case("C1 an unverified newcomer in a freeze does not replace the pending SHA",
         dict(base, candidate=B, frozen=True, pending={"sha": A, "redispatches": 0}, pending_in_cand=True,
              cand_gate_green=False, master_tip=TIP), HOLD, None, {"sha": A, "redispatches": 0})
    case("C2 the newcomer's gate fails at fire time: refused, A still pending",
         dict(base, candidate=B, gate_ok=False, pending={"sha": A, "redispatches": 0}, pending_in_cand=True, master_tip=TIP),
         REFUSE_GATE, None, {"sha": A, "redispatches": 0})
    case("C3 the resume then promotes A", dict(base, candidate=A, pending={"sha": A, "redispatches": 0}, master_tip=TIP), PROMOTE, A, None)
    case("C4 a newcomer whose own gate IS known green replaces it",
         dict(base, candidate=B, frozen=True, pending={"sha": A, "redispatches": 0}, pending_in_cand=True,
              cand_gate_green=True, master_tip=TIP), HOLD, None, {"sha": B, "redispatches": 0})
    # 8 stale SHA: production is ahead of the candidate -> Already (never backwards); diverged -> refused, never forced
    case("8a stale SHA: production already past it", dict(base, candidate=A, cand_in_prod=True, prod_in_cand=False, master_tip=TIP), ALREADY)
    case("8b production not an ancestor: refused", dict(base, candidate=A, prod_in_cand=False, master_tip=TIP), REFUSE_DIVERGED)
    return out


def self_check() -> int:
    bad = 0
    for name, facts, act, target, pend in _cases():
        d = decide(facts)
        ok = d["action"] == act and d["target"] == target and (pend == "any" or d["pending"] == pend)
        # ⛔ the STRICT control, for every source but the manual fallback: the target is the candidate, never master's tip
        ok = ok and (d["target"] is None or (d["target"] == facts["candidate"] and d["target"] != facts.get("master_tip")))
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {d['action']} -> {d['target']}")
        bad += 0 if ok else 1
    # (A) the manual fallback: its own case and its own control (target == the tip ONLY via a verified fallback)
    T = "f" * 40
    fb = resolve(event="workflow_dispatch", actor="owner", master_tip=T, tip_gate_ok=True, tip_gate_run="9")
    d = decide(dict(gate_ok=True, cand_in_prod=False, on_master=True, prod_in_cand=True, frozen=False, pending=None,
                    candidate=fb["candidate"], master_tip=T))
    held = decide(dict(gate_ok=True, cand_in_prod=False, on_master=True, prod_in_cand=True, frozen=True, pending=None,
                       candidate=fb["candidate"], master_tip=T, cand_gate_green=fb["gate_green"]))
    offff = decide(dict(gate_ok=True, cand_in_prod=False, on_master=True, prod_in_cand=False, frozen=False, pending=None,
                        candidate=fb["candidate"], master_tip=T))
    for name, ok in (
            ("A1 fallback: a human blank dispatch, tip gate verified -> the tip, source says so",
             fb["fallback"] and fb["candidate"] == T and fb["source"].startswith(FALLBACK_SOURCE)),
            ("A1 control: the fallback's target is the tip only through the fire-time checks (PROMOTE, FF)",
             d["action"] == PROMOTE and d["target"] == T),
            ("A2 a frozen fallback HOLDs and records the tip PENDING", held["action"] == HOLD and held["pending"]["sha"] == T),
            ("A2 a fallback whose tip production is not under is refused (FF only)", offff["action"] == REFUSE_DIVERGED),
            ("A3 tip gate NOT green: no candidate, and the stop says pass sha=",
             (lambda r: r["candidate"] is None and "pass sha=" in r["stop"])(resolve(event="workflow_dispatch", actor="owner", master_tip=T))),
            ("A4 schedule + tip available + nothing pending -> NO candidate",
             resolve(event="schedule", actor="owner", master_tip=T, tip_gate_ok=True)["candidate"] is None),
            ("A4 workflow_run (failed) + tip available + nothing pending -> NO candidate",
             resolve(event="workflow_run", trigger_conclusion="failure", master_tip=T, tip_gate_ok=True)["candidate"] is None),
            ("A4 the resume job's re-dispatch (resume, github-actions[bot]) + tip available -> NO candidate",
             resolve(event="workflow_dispatch", resume=True, actor=BOT_ACTOR, master_tip=T, tip_gate_ok=True)["candidate"] is None),
            ("A4 a bot dispatch without resume -> NO candidate",
             resolve(event="workflow_dispatch", actor=BOT_ACTOR, master_tip=T, tip_gate_ok=True)["candidate"] is None),
            ("A4 a dry-run dispatch -> NO candidate",
             resolve(event="workflow_dispatch", dry_run=True, actor="owner", master_tip=T, tip_gate_ok=True)["candidate"] is None),
            ("A4 a pending SHA wins over the fallback",
             resolve(event="workflow_dispatch", actor="owner", master_tip=T, tip_gate_ok=True, pending={"sha": "a" * 40})["candidate"] == "a" * 40),
            ("D the gate check rejects a success run for ANOTHER head_sha",
             not gate_ok([{"id": 1, "name": GATE_WORKFLOW_NAME, "head_sha": "b", "head_branch": "master", "event": "push",
                           "status": "completed", "conclusion": "success"}], [{"run_id": 1, "conclusion": "success"}], 1, "a")[0]),
            ("D the gate check rejects a run whose event is not push",
             not gate_ok([{"id": 1, "name": GATE_WORKFLOW_NAME, "head_sha": "a", "head_branch": "master", "event": "workflow_dispatch",
                           "status": "completed", "conclusion": "success"}], [{"run_id": 1, "conclusion": "success"}], 1, "a")[0]),
            ("D the gate check rejects a run off master",
             not gate_ok([{"id": 1, "name": GATE_WORKFLOW_NAME, "head_sha": "a", "head_branch": "feature", "event": "push",
                           "status": "completed", "conclusion": "success"}], [{"run_id": 1, "conclusion": "success"}], 1, "a")[0])):
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1
    # the re-dispatch cap and the resolver
    d0, r0, _ = may_redispatch({"sha": "a" * 40, "redispatches": MAX_REDISPATCH - 1})
    dn, _rn, _ = may_redispatch({"sha": "a" * 40, "redispatches": MAX_REDISPATCH})
    for name, ok in (("re-dispatch below the cap increments the count", d0 and r0["redispatches"] == MAX_REDISPATCH),
                     ("re-dispatch at the cap stops", not dn),
                     ("nothing pending: no re-dispatch", not may_redispatch(None)[0]),
                     ("a schedule with nothing pending does nothing (never the tip)", resolve(event="schedule")["candidate"] is None),
                     ("a failed trigger stops", resolve(event="workflow_run", trigger_sha="a", trigger_conclusion="failure")["candidate"] is None),
                     ("the gate check needs the expected job count",
                      not gate_ok([{"id": 1, "name": GATE_WORKFLOW_NAME, "head_sha": "a", "head_branch": "master", "event": "push",
                                    "status": "completed", "conclusion": "success"}], [{"run_id": 1, "conclusion": "success"}], 2, "a")[0]),
                     ("the gate check passes a full success",
                      gate_ok([{"id": 1, "name": GATE_WORKFLOW_NAME, "head_sha": "a", "head_branch": "master", "event": "push",
                                "status": "completed", "conclusion": "success"}], [{"run_id": 1, "conclusion": "success"}], 1, "a")[0]),
                     ("expected_jobs counts a static matrix (or fails closed without PyYAML)", expected_jobs(
                         "jobs:\n  a:\n    runs-on: x\n  b:\n    strategy:\n      matrix:\n        shard: [1, 2, 3]\n") in (4, 0)),
                     ("expected_jobs fails closed on an include matrix", expected_jobs(
                         "jobs:\n  b:\n    strategy:\n      matrix:\n        include: [{a: 1}]\n") == 0),
                     ("expected_jobs reads the jobs mapping",expected_jobs("on: push\njobs:\n  a:\n    x: 1\n  b-c:  # c\n    y: 2\n") == 2)):
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1
    print("self-check: " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="promotion decision (pure); JSON in, JSON out")
    ap.add_argument("cmd", nargs="?", choices=["resolve", "decide", "gate", "redispatch"])
    ap.add_argument("--facts"); ap.add_argument("--runs"); ap.add_argument("--jobs"); ap.add_argument("--workflow")
    ap.add_argument("--sha"); ap.add_argument("--pending"); ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    load = lambda p: json.load(open(p, encoding="utf-8")) if p else None  # noqa: E731
    if a.cmd == "resolve":
        f = load(a.facts)
        out = resolve(event=f.get("event"), trigger_sha=f.get("trigger_sha"), trigger_conclusion=f.get("trigger_conclusion"),
                      input_sha=f.get("input_sha"), pending=f.get("pending"), resume=bool(f.get("resume")),
                      dry_run=bool(f.get("dry_run")), actor=f.get("actor"), master_tip=f.get("master_tip"),
                      tip_gate_ok=bool(f.get("tip_gate_ok")), tip_gate_run=f.get("tip_gate_run"))
    elif a.cmd == "decide":
        out = decide(load(a.facts))
    elif a.cmd == "gate":
        runs = (load(a.runs) or {}).get("workflow_runs", [])
        jobs = (load(a.jobs) or {}).get("jobs", [])
        ok, why = gate_ok(runs, jobs, expected_jobs(open(a.workflow, encoding="utf-8").read()), a.sha)
        out = {"gate_ok": ok, "reason": why}
    elif a.cmd == "redispatch":
        go, rec, why = may_redispatch(load(a.pending))
        out = {"dispatch": go, "pending": rec, "reason": why}
    else:
        ap.error("a command or --self-check")
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
