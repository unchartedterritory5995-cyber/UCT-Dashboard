"""A job's outcome comes from the RUNNER, not from its log.

⛔⛔ **E CP5 — THIS REPLACES A FLAG THAT WAS WRONG IN BOTH DIRECTIONS.**
`ci_summarize.oom_or_timeout` grepped the runner log for `timed out|timeout|Killed|…`.
Measured across three real runs:

| run | what happened | the flag said |
|---|---|---|
| #2, #3 | both suites completed with totals lines | **true** (wrong) |
| #4 | the pytest job was CANCELLED at its 45-minute cap | **false** (wrong) |

⭐ **It fired on the WORD without the EVENT, and missed the EVENT without the WORD** —
GitHub's own cancellation never writes "timeout" into the captured log. **A flag wrong in
both directions is worse than absent**: absent, nobody consults it.

⛔ **So outcome is read from the runner's own verdict and nothing else.** `needs.<job>.result`
for the job, the step's `outcome`/`conclusion` for the step, and the run's `jobs` API for
timings. A log line may be QUOTED as evidence; it may never be the SOURCE of a flag.

`timed_out` is DERIVED and its two numbers are printed, because a boolean nobody can check
is the thing this file exists to delete:

    timed_out  ==  job_result == "cancelled"  AND  elapsed_s >= (timeout_minutes*60 - 60)

⭐ The one-minute slack separates a job the RUNNER cut at its cap from a job a HUMAN
cancelled early — both report `cancelled`, and they are not the same fact.

Usage:
    python tools/ci_outcome.py --jobs jobs.json --job-name pytest --needs-result cancelled \\
                              --timeout-minutes 45
    python tools/ci_outcome.py --self-check
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib

OK, FAIL = 0, 1

UNREADABLE = "UNREADABLE"


def _parse(ts):
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def elapsed_seconds(job: dict):
    """Wall seconds for one job, or None when the API did not give both ends."""
    s, c = _parse(job.get("started_at")), _parse(job.get("completed_at"))
    if not s or not c:
        return None
    return (c - s).total_seconds()


def find_job(jobs_json: dict, name_fragment: str):
    """The first job whose name contains `name_fragment` (case-insensitive)."""
    for j in (jobs_json or {}).get("jobs", []) or []:
        if name_fragment.lower() in (j.get("name") or "").lower():
            return j
    return None


def test_step_outcome(job: dict, step_name: str = "Run"):
    """The `outcome` of the step that actually ran the suite.

    ⛔ `outcome` NOT `conclusion`: `continue-on-error: true` rewrites `conclusion` to
    `success` for a step that failed, which is precisely the mask this file removes."""
    for st in (job or {}).get("steps", []) or []:
        if (st.get("name") or "").strip().lower() == step_name.lower():
            return st.get("outcome") or st.get("conclusion") or UNREADABLE
    return UNREADABLE


def fields(jobs_json, job_name_fragment, needs_result, timeout_minutes, step_name="Run"):
    """The conclusion-keyed block for one suite. Never raises."""
    job = find_job(jobs_json, job_name_fragment)
    out = {
        "job_result": needs_result or UNREADABLE,
        "test_step_outcome": UNREADABLE,
        "elapsed_s": None,
        "timeout_minutes": timeout_minutes,
        "timed_out": False,
        "timed_out_basis": "",
    }
    if job is None:
        out["timed_out_basis"] = ("no job matching %r in the jobs payload — UNREADABLE, "
                                  "not false" % job_name_fragment)
        out["timed_out"] = UNREADABLE
        return out

    out["test_step_outcome"] = test_step_outcome(job, step_name)
    el = elapsed_seconds(job)
    out["elapsed_s"] = el

    cap = (timeout_minutes or 0) * 60
    if el is None or not timeout_minutes:
        out["timed_out"] = UNREADABLE
        out["timed_out_basis"] = ("elapsed or cap unreadable (elapsed=%r cap=%r) — "
                                  "UNREADABLE, not false" % (el, cap))
        return out

    threshold = cap - 60
    hit = (out["job_result"] == "cancelled") and (el >= threshold)
    out["timed_out"] = bool(hit)
    # ⛔ THE DERIVATION IS PRINTED. A boolean nobody can check is what this file deletes.
    out["timed_out_basis"] = ("job_result=%s, elapsed_s=%.0f, cap_s=%d, threshold_s=%d "
                              "(cap-60) -> %s" % (out["job_result"], el, cap, threshold,
                                                  "TIMED OUT" if hit else "not a cap cut"))
    return out


def suite_ok(summary: dict, outcome: dict) -> bool:
    """⛔ ok requires the runner AGREED the job succeeded.

    Every clause is a way a suite has actually lied in this repository:
      totals_line_found  -- run #4 was cancelled and printed none
      collected > 0      -- run #3 collected 2 of 481 and reported 0 failed
      job_result success -- a cancelled job reports no failures because it ran none
      failed == 0        -- the ordinary meaning
    """
    return bool(summary.get("totals_line_found")
                and (summary.get("collected") or 0) > 0
                and outcome.get("job_result") == "success"
                and not summary.get("failed"))


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    def jobs(name, started, completed, step_outcome="success"):
        return {"jobs": [{"name": name, "started_at": started, "completed_at": completed,
                          "steps": [{"name": "Run", "outcome": step_outcome,
                                     "conclusion": "success"}]}]}

    # 1 SUCCESS
    j = jobs("pytest — all files", "2026-09-15T05:00:00Z", "2026-09-15T05:20:00Z")
    f = fields(j, "pytest", "success", 45)
    show("SUCCESS: job_result", f["job_result"], "success")
    show("SUCCESS: timed_out is False", f["timed_out"], False)

    # 2 FAILURE
    j = jobs("pytest — all files", "2026-09-15T05:00:00Z", "2026-09-15T05:05:00Z", "failure")
    f = fields(j, "pytest", "failure", 45)
    show("FAILURE: step outcome survives continue-on-error",
         (f["job_result"], f["test_step_outcome"]), ("failure", "failure"))
    show("FAILURE: timed_out is False", f["timed_out"], False)

    # 3 CANCELLED AT THE CAP (run #4's real shape: 2,716 s against a 45-minute cap)
    j = jobs("pytest — all files", "2026-09-15T05:00:00Z", "2026-09-15T05:45:16Z", "cancelled")
    f = fields(j, "pytest", "cancelled", 45)
    show("CANCELLED AT CAP: timed_out is True", f["timed_out"], True)
    show("...and the basis names both numbers",
         ("elapsed_s=2716" in f["timed_out_basis"] and "cap_s=2700" in f["timed_out_basis"]), True)

    # 4 CANCELLED EARLY (a human pressed cancel) -- same job_result, different fact
    j = jobs("pytest — all files", "2026-09-15T05:00:00Z", "2026-09-15T05:03:00Z", "cancelled")
    f = fields(j, "pytest", "cancelled", 45)
    show("CANCELLED EARLY: timed_out is False", f["timed_out"], False)
    show("...distinguished from the cap cut by elapsed alone", f["job_result"], "cancelled")

    # 5 SKIPPED
    f = fields({"jobs": []}, "pytest", "skipped", 45)
    show("SKIPPED: no job in payload -> timed_out UNREADABLE", f["timed_out"], UNREADABLE)

    # 6 EMPTY payload
    f = fields({}, "pytest", None, 45)
    show("EMPTY jobs JSON: job_result UNREADABLE", f["job_result"], UNREADABLE)
    show("EMPTY jobs JSON: timed_out UNREADABLE, never False", f["timed_out"], UNREADABLE)

    # ok() semantics
    good = {"totals_line_found": True, "collected": 10, "failed": 0}
    show("ok TRUE only when the runner agrees", suite_ok(good, {"job_result": "success"}), True)
    show("ok FALSE when the job was cancelled",
         suite_ok(good, {"job_result": "cancelled"}), False)
    show("ok FALSE with no totals line",
         suite_ok({"totals_line_found": False, "collected": 10, "failed": 0},
                  {"job_result": "success"}), False)
    show("ok FALSE when zero collected",
         suite_ok({"totals_line_found": True, "collected": 0, "failed": 0},
                  {"job_result": "success"}), False)

    # ⛔ NON-VACUITY — and the FIRST version of this control was itself wrong, which is
    # worth keeping. It varied only `needs_result` while holding elapsed at 20 minutes
    # against a 45-minute cap, where EVERY correct answer is False. It therefore demanded
    # a spread the implementation must not produce, and satisfying it would have meant
    # deleting the elapsed test — the one thing that separates a cap cut from a human
    # cancel. ⭐ A control that fails a correct implementation is a defect in the control;
    # the fix is to vary the input that actually discriminates.
    spread = {
        "success@20m": fields(jobs("p", "2026-09-15T05:00:00Z", "2026-09-15T05:20:00Z"),
                              "p", "success", 45)["timed_out"],
        "cancelled@cap": fields(jobs("p", "2026-09-15T05:00:00Z", "2026-09-15T05:45:16Z"),
                                "p", "cancelled", 45)["timed_out"],
        "cancelled@3m": fields(jobs("p", "2026-09-15T05:00:00Z", "2026-09-15T05:03:00Z"),
                               "p", "cancelled", 45)["timed_out"],
        "no-job": fields({"jobs": []}, "p", "skipped", 45)["timed_out"],
    }
    show("timed_out takes all three values across real shapes",
         sorted({str(v) for v in spread.values()}), ["False", "True", "UNREADABLE"])

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--jobs")
    ap.add_argument("--job-name")
    ap.add_argument("--needs-result")
    ap.add_argument("--timeout-minutes", type=int)
    ap.add_argument("--step-name", default="Run")
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    payload = {}
    if a.jobs and pathlib.Path(a.jobs).is_file():
        try:
            payload = json.loads(pathlib.Path(a.jobs).read_text(encoding="utf-8"))
        except ValueError:
            payload = {}
    f = fields(payload, a.job_name or "", a.needs_result, a.timeout_minutes, a.step_name)
    blob = json.dumps(f, indent=2)
    if a.out:
        pathlib.Path(a.out).write_text(blob + "\n", encoding="utf-8")
    print(blob)
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
