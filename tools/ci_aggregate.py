"""Roll N shard results into one suite result, without letting an absence read as zero.

⛔⛔ **E CP6 — THE FAILURE THIS EXISTS TO REFUSE.** Sharding turns one number into twelve,
and the dangerous arithmetic is `sum()`. A shard that never reported contributes **0
collected and 0 failed** to a naive sum — which is indistinguishable from a shard that ran
cleanly. **A missing shard must make the suite NOT ok and be named**, or sharding converts
one honest red into a quiet green.

⛔ **`ok` requires every shard to have SUCCEEDED, every shard to have a totals line, and
zero failures.** Three clauses because each has been a separate lie in this repository:
a cancelled job reports no failures (run #4), a collected-nothing job reports no failures
(run #3), and a genuine failure is a failure.

⭐ `per_test_timeouts` is counted from the junit `<failure message=...>` text written by
**pytest-timeout**, which is a message the plugin authors, not a log line we guessed at —
a hang now fails **by name** instead of taking the whole shard down with it.

Usage:
    python tools/ci_aggregate.py --shards-dir results/<run>/shards --out suite.json
    python tools/ci_aggregate.py --self-check
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import xml.etree.ElementTree as ET

OK, FAIL = 0, 1
UNREADABLE = "UNREADABLE"

#: pytest-timeout writes e.g. "Failed: Timeout >120.0s" into the junit failure message.
_TIMEOUT_MSG = re.compile(r"Timeout\s*>\s*[\d.]+s", re.I)


def count_timeout_failures(junit_text: str) -> int:
    """How many testcases pytest-timeout killed. 0 on an unparseable report."""
    try:
        root = ET.fromstring(junit_text)
    except ET.ParseError:
        return 0
    n = 0
    for tc in root.iter("testcase"):
        for bad in list(tc.iter("failure")) + list(tc.iter("error")):
            blob = (bad.get("message") or "") + " " + (bad.text or "")
            if _TIMEOUT_MSG.search(blob):
                n += 1
    return n


def aggregate(shards: dict) -> dict:
    """`shards` maps shard_id -> {job_result, summary{...}, timeouts:int} or None when missing.

    A None value means THE SHARD DID NOT REPORT and is treated as such, never as zero.
    """
    expected = sorted(shards)
    missing, cancelled, failed_jobs, ok_jobs, no_totals = [], [], [], [], []
    collected = failed = passed = timeouts = 0

    for sid in expected:
        rec = shards[sid]
        if not rec:
            missing.append(sid)
            continue
        res = (rec.get("job_result") or UNREADABLE)
        s = rec.get("summary") or {}
        if res == "success":
            ok_jobs.append(sid)
        elif res == "cancelled":
            cancelled.append(sid)
        else:
            failed_jobs.append(sid)
        if not s.get("totals_line_found"):
            no_totals.append(sid)
        collected += int(s.get("collected") or 0)
        failed += int(s.get("failed") or 0)
        passed += int(s.get("passed") or 0)
        timeouts += int(rec.get("timeouts") or 0)

    reported = len(expected) - len(missing)
    out = {
        "shards_total": len(expected),
        "shards_reported": reported,
        "shards_success": len(ok_jobs),
        "shards_cancelled": len(cancelled),
        "shards_failed": len(failed_jobs),
        "shards_missing": missing,
        "shards_without_totals": no_totals,
        "collected": collected,
        "passed": passed,
        "failed": failed,
        "per_test_timeouts": timeouts,
    }
    if not expected:
        # ⛔ Zero shards is UNREADABLE, never a clean sweep.
        out["ok"] = False
        out["ok_basis"] = "no shards declared at all — UNREADABLE, not a pass"
        return out

    all_success = len(ok_jobs) == len(expected)
    every_totals = not no_totals
    out["ok"] = bool(all_success and every_totals and failed == 0 and not missing)
    out["ok_basis"] = (
        "all_success=%s (%d/%d) · every_shard_has_totals=%s · failed=%d · missing=%d"
        % (all_success, len(ok_jobs), len(expected), every_totals, failed, len(missing)))
    return out


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-8s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    def shard(res="success", collected=100, failed=0, totals=True, timeouts=0):
        return {"job_result": res, "timeouts": timeouts,
                "summary": {"collected": collected, "failed": failed, "passed": collected - failed,
                            "totals_line_found": totals}}

    # 1 ALL SUCCESS
    a = aggregate({"s1": shard(), "s2": shard(), "s3": shard()})
    print("  [all success] " + json.dumps({k: a[k] for k in
          ("shards_total", "shards_success", "collected", "failed", "ok")}))
    show("all success: ok", a["ok"], True)
    show("all success: collected sums", a["collected"], 300)

    # 2 ONE CANCELLED
    b = aggregate({"s1": shard(), "s2": shard(res="cancelled", collected=0, totals=False), "s3": shard()})
    print("  [one cancelled] " + json.dumps({k: b[k] for k in
          ("shards_cancelled", "shards_without_totals", "collected", "ok")}))
    show("one cancelled: ok is False", b["ok"], False)
    show("one cancelled: it is counted", b["shards_cancelled"], 1)
    show("one cancelled: named as lacking totals", b["shards_without_totals"], ["s2"])

    # 3 ONE MISSING -- the dangerous one
    c = aggregate({"s1": shard(), "s2": None, "s3": shard()})
    print("  [one missing] " + json.dumps({k: c[k] for k in
          ("shards_total", "shards_reported", "shards_missing", "collected", "ok")}))
    show("one missing: ok is False", c["ok"], False)
    show("one missing: it is NAMED, not silently zero", c["shards_missing"], ["s2"])
    show("one missing: reported < total", (c["shards_reported"], c["shards_total"]), (2, 3))

    # 4 PER-TEST TIMEOUTS
    d = aggregate({"s1": shard(failed=2, timeouts=2), "s2": shard(), "s3": shard()})
    print("  [per-test timeouts] " + json.dumps({k: d[k] for k in
          ("per_test_timeouts", "failed", "ok")}))
    show("per-test timeouts are counted", d["per_test_timeouts"], 2)
    show("a hang fails by name, suite not ok", d["ok"], False)

    # 5 EMPTY
    e = aggregate({})
    show("EMPTY: ok is False", e["ok"], False)
    show("EMPTY: says UNREADABLE rather than passing", "UNREADABLE" in e["ok_basis"], True)

    # junit timeout counting
    xml = ('<testsuites><testsuite><testcase classname="t" name="a">'
           '<failure message="Failed: Timeout &gt;120.0s">x</failure></testcase>'
           '<testcase classname="t" name="b"><failure message="assert 1 == 2">y</failure>'
           '</testcase></testsuite></testsuites>')
    show("junit: only the timeout failure is counted", count_timeout_failures(xml), 1)
    show("junit: unparseable yields 0, never a crash", count_timeout_failures("<nope"), 0)

    # ⛔ NON-VACUITY: the four shapes must not all produce one verdict
    show("the four shapes do not collapse to one ok value",
         len({a["ok"], b["ok"], c["ok"], d["ok"]}) >= 2, True)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--shards-dir")
    ap.add_argument("--expect")          # JSON array of shard ids that SHOULD have reported
    ap.add_argument("--jobs")            # the run's jobs API payload (runner-sourced)
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    if not a.shards_dir:
        print("need --shards-dir (or --self-check)")
        return FAIL

    base = pathlib.Path(a.shards_dir)
    expected = json.loads(a.expect) if a.expect else [p.name for p in base.glob("*") if p.is_dir()]

    # ⛔ THE SHARD'S RESULT COMES FROM THE RUNNER (E CP5's rule), not from a file the shard
    # wrote about itself. A shard cancelled at its cap may never reach its own final step,
    # so a self-reported outcome is exactly the evidence that goes missing when it matters.
    jobs_payload = {}
    if a.jobs and pathlib.Path(a.jobs).is_file():
        try:
            jobs_payload = json.loads(pathlib.Path(a.jobs).read_text(encoding="utf-8"))
        except ValueError:
            jobs_payload = {}

    def job_result_for(shard_id):
        for j in (jobs_payload or {}).get("jobs", []) or []:
            name = (j.get("name") or "")
            if shard_id in name and "pytest" in name.lower():
                return j.get("conclusion") or UNREADABLE
        return UNREADABLE

    shards = {}
    for sid in expected:
        d = base / sid
        rec = None
        summary = d / "summary.json"
        if summary.is_file():
            try:
                rec = {"summary": json.loads(summary.read_text(encoding="utf-8"))}
                rec["job_result"] = job_result_for(sid)
                j = d / "pytest-junit.xml"
                rec["timeouts"] = count_timeout_failures(
                    j.read_text(encoding="utf-8", errors="replace")) if j.is_file() else 0
            except ValueError:
                rec = None
        shards[sid] = rec

    out = aggregate(shards)
    blob = json.dumps(out, indent=2)
    if a.out:
        pathlib.Path(a.out).write_text(blob + "\n", encoding="utf-8")
    print(blob)
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
