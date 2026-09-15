"""Build the published CI record from the two suite summaries — OUTSIDE the workflow file.

⛔⛔ **E CP12 — THE PUBLISHER DIED ON A MISSING DISPLAY FIELD, FOUR RUNS RUNNING.**
`publish` failed in runs #6, #8 and #9 at the step named `Build the record`, always with::

    "runner_line": {"vitest": v["runner_line"], "pytest": p["runner_line"]}
    KeyError: 'runner_line'

`ci_summarize.py` emits `runner_line`; `ci_aggregate.py` — which replaced it for pytest in
E CP6 — did not. Run #3 published because pytest still came from the summarizer. **The
change that sharded the suite is the change that stopped the record from ever landing**,
and the field it died on is a cosmetic one-line string.

⭐⭐ **TWO fixes, because either alone leaves the failure live:**

1. The producer now emits the key (`ci_aggregate` collects each shard's OWN totals line).
2. **A missing key can no longer cost the record.** Every value this module reads out of a
   suite summary goes through :func:`consume`, which on an absence records an UNREADABLE
   marker and NAMES the gap in `record["contract_gaps"]` instead of raising. ⛔ That is not
   tolerance — the gap is loud, it is in the published record and in the phone summary. It
   is the refusal to let a *display string* destroy the measurement it decorates.

⚰️ **And it is a FILE because it was a 50-line Python program inside a YAML heredoc.**
Nothing could run it, so nothing did: the KeyError was reachable from an empty log and a
one-shard aggregate, and four runs of real CI never got a line of it under test.

Usage:
    python tools/ci_record.py --v v.json --p p_suite.json --jobs jobs.json --out record.json
    python tools/ci_record.py --self-check
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ci_outcome  # noqa: E402

OK, FAIL = 0, 1
UNREADABLE = "UNREADABLE"


def consume(d: dict, key: str, where: str, gaps: list):
    """Read `key` out of `d`, or NAME the gap and return an UNREADABLE marker.

    ⛔ Never raises. A publisher that dies reading an optional field loses the whole
    record, which is the exact shape of F-CI-7.
    """
    if not isinstance(d, dict) or key not in d:
        gaps.append("%s has no key %r" % (where, key))
        return "%s: %s has no key %r" % (UNREADABLE, where, key)
    return d[key]


def verify_detail(detail: dict, detail_dir, gaps: list) -> dict:
    """⛔ A RECORD MUST NOT NAME A PATH IT DID NOT WRITE.

    ⚰️ **E CP19 — run #15's record named SIX detail files and THREE did not exist.** All
    three were the pytest ones: `ci_extract` was pointed at `logs/pytest.log`, a path that
    stopped existing when E CP6 sharded pytest, so its whole block was skipped — and the
    record promised the failure text for **136 pytest failures** and delivered none.

    ⭐ Nothing failed. The publish job was green, the record parsed, and the only way to
    find it was to open the branch and look. A named path that does not exist is worse than
    an omitted one: a reader treats it as a file they have not opened yet.

    ⚠️ `detail_dir` is where those files live AT BUILD TIME (the extract directory), before
    they are copied into `results/<run>/`. With no `detail_dir` the paths are **NOT
    VERIFIED**, and that is recorded as a gap rather than passing quietly — an unverified
    claim and a checked one must not look the same.
    """
    if detail_dir is None:
        gaps.append("detail paths were NOT VERIFIED (no --detail-dir given)")
        return dict(detail)
    base = pathlib.Path(detail_dir)
    out = {}
    for key, rel in detail.items():
        if key == "dir":
            out[key] = rel
            continue
        if (base / pathlib.Path(rel).name).is_file():
            out[key] = rel
        else:
            gaps.append("detail '%s' names %s, which was not written" % (key, rel))
            out[key] = "%s: not written (%s)" % (UNREADABLE, rel)
    return out


def build_record(v: dict, p: dict, jobs: dict, env: dict, detail_dir=None) -> dict:
    """The record exactly as it is published to `ci-results`, plus any contract gaps."""
    gaps: list = []
    V = "v.json (tools/ci_summarize.py --suite vitest)"
    P = "p_suite.json (tools/ci_aggregate.py)"

    cap = int(env.get("SUITE_TIMEOUT_MINUTES", "45"))
    vo = ci_outcome.fields(jobs, "vitest", env.get("VITEST_RESULT"), cap)
    po = ci_outcome.fields(jobs, "pytest", env.get("PYTEST_RESULT"), 20)

    vitest_ok = ci_outcome.suite_ok(v, vo)
    # ⛔ the aggregator already folded every shard's runner result into `ok`; re-deriving
    # it from a single job_result here would overwrite N verdicts with one.
    pytest_ok = consume(p, "ok", P, gaps)

    run_id = env["GITHUB_RUN_ID"]
    rec = {
        "run_id": run_id,
        "run_number": env.get("GITHUB_RUN_NUMBER"),
        "sha": env["GITHUB_SHA"],
        "branch": env.get("GITHUB_REF_NAME"),
        "finished": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "vitest": dict(v, ok=vitest_ok),
        "pytest": p,
        "runner_line": {
            "vitest": consume(v, "runner_line", V, gaps),
            "pytest": consume(p, "runner_line", P, gaps),
        },
        # E CP5 — outcome read from the runner, never from log text.
        "outcome": {"vitest": vo, "pytest": po},
        # ⛔ GREEN means both suites actually RAN, the RUNNER agreed, and neither failed.
        # An UNREADABLE `ok` is not True, so a contract gap can only ever make this RED.
        "verdict": "GREEN" if (vitest_ok and pytest_ok is True) else "RED",
        "detail": verify_detail({
            "dir": "results/%s" % run_id,
            "pytest_collect_errors": "results/%s/pytest_collect_errors.txt" % run_id,
            "pytest_error_buckets": "results/%s/pytest_error_buckets.txt" % run_id,
            # E CP19 — pytest failures get the same treatment vitest failures already had.
            "pytest_failures": "results/%s/pytest_failures.txt" % run_id,
            "vitest_failures": "results/%s/vitest_failures.txt" % run_id,
            "vitest_junit": "results/%s/vitest-junit.xml" % run_id,
            "collect_profile": "results/%s/collect_profile.json" % run_id,
        }, detail_dir, gaps),
        # ⭐ Empty is the normal state. Non-empty names a producer that stopped emitting
        # something this builder reads — the E CP6 -> E CP12 failure, made visible
        # instead of fatal.
        "contract_gaps": gaps,
    }
    return rec


def _load(path: str) -> dict:
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def _self_check() -> int:
    """Prove the builder survives a missing key AND still reports GREEN when it is there."""
    import ci_aggregate
    import ci_summarize

    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print("  %-62s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    # Inputs built by THE REAL TOOLS, not hand-written fixtures — the KeyError lived in
    # the gap between two producers, so a fixture written by hand would have hidden it.
    vlog = "Test Files  3 passed (3)\n     Tests  40 passed (40)\n  Duration  9.00s\n"
    v = ci_summarize.summarize("vitest", vlog)
    shard = ci_summarize.summarize(
        "pytest", "==== 2470 passed, 12 skipped in 526.03s ====\n")
    p = ci_aggregate.aggregate({"tests-01": {"job_result": "success", "summary": shard,
                                             "timeouts": 0}})
    print("  v.json keys:       %s" % sorted(v))
    print("  p_suite.json keys: %s" % sorted(p))

    # ⛔ THE REGRESSION RAIL FOR THIS INCIDENT: the producer must emit what the consumer
    # reads. Deleting it from ci_aggregate turns this line red.
    show("ci_aggregate emits 'runner_line'", "runner_line" in p, True)
    show("ci_aggregate emits 'ok'", "ok" in p, True)

    env = {"GITHUB_RUN_ID": "1", "GITHUB_SHA": "deadbeef", "GITHUB_REF_NAME": "b",
           "VITEST_RESULT": "success", "PYTEST_RESULT": "success",
           "SUITE_TIMEOUT_MINUTES": "45"}
    jobs = {"jobs": [
        {"name": "vitest — all files", "conclusion": "success", "status": "completed",
         "started_at": "2026-09-15T10:00:00Z", "completed_at": "2026-09-15T10:05:00Z",
         "steps": [{"name": "Run", "conclusion": "success", "status": "completed"}]},
        {"name": "pytest — tests-01", "conclusion": "success", "status": "completed",
         "started_at": "2026-09-15T10:00:00Z", "completed_at": "2026-09-15T10:05:00Z",
         "steps": [{"name": "Run", "conclusion": "success", "status": "completed"}]},
    ]}

    rec = build_record(v, p, jobs, env)
    # ⛔ Scoped to the PRODUCER contract this case is about. Since E CP19 a build
    # with no --detail-dir also reports NOT VERIFIED, which is correct and is
    # asserted separately below.
    show("intact: no PRODUCER-KEY gaps",
         [g for g in rec["contract_gaps"] if "NOT VERIFIED" not in g], [])
    show("intact: verdict", rec["verdict"], "GREEN")
    show("intact: pytest runner_line is the SHARD's own line",
         rec["runner_line"]["pytest"], shard["runner_line"])

    # ⚰️ MUTATION — the exact break that killed runs #6, #8 and #9.
    hurt = dict(p)
    hurt.pop("runner_line")
    try:
        rec2 = build_record(v, hurt, jobs, env)
        crashed = False
    except Exception as e:  # pragma: no cover - this is the failure being refused
        rec2, crashed = None, True
        print("  builder RAISED on a missing key: %r" % (e,))
    show("missing runner_line: builder does NOT raise", crashed, False)
    if rec2 is not None:
        # ⛔ Count the gap this case is ABOUT. Since E CP19 a run with no
        # --detail-dir also reports NOT VERIFIED, and a bare len() would make this
        # control fail a correct implementation.
        show("missing runner_line: gap is NAMED",
             len([g for g in rec2["contract_gaps"] if "runner_line" in g]), 1)
        show("missing runner_line: field marked UNREADABLE",
             str(rec2["runner_line"]["pytest"]).startswith(UNREADABLE), True)
        # ⛔ A display field must not change the verdict — the suite still passed.
        show("missing runner_line: record still publishable (verdict unchanged)",
             rec2["verdict"], "GREEN")

    # ⛔ E CP19 — A RECORD MUST NOT NAME A PATH IT DID NOT WRITE.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        dd = pathlib.Path(td)
        # nothing written at all: every named detail path must be reported
        rec_none = build_record(v, p, jobs, env, detail_dir=str(dd))
        named = [k for k in rec_none["detail"] if k != "dir"]
        show("with NO detail files, every named path is a gap",
             len([g for g in rec_none["contract_gaps"] if "was not written" in g]),
             len(named))
        show("...and each is marked UNREADABLE, not left looking valid",
             all(str(rec_none["detail"][k]).startswith(UNREADABLE) for k in named), True)
        show("...and it does NOT change the verdict (they are evidence, not counts)",
             rec_none["verdict"], "GREEN")
        # now write them all: no gaps
        for k in named:
            (dd / pathlib.Path(rec_none["detail"][k].split("(")[-1].rstrip(")")).name).write_text(
                "x", encoding="utf-8")
        rec_all = build_record(v, p, jobs, env, detail_dir=str(dd))
        show("with every detail file present, no gaps", rec_all["contract_gaps"], [])
        # ⛔ NON-VACUITY: the two must differ, or "no gaps" proves nothing.
        show("present and absent are distinguishable",
             len(rec_none["contract_gaps"]) != len(rec_all["contract_gaps"]), True)
    # ⛔ An UNVERIFIED claim and a CHECKED one must not look the same.
    rec_unver = build_record(v, p, jobs, env)
    show("no --detail-dir is reported as NOT VERIFIED, not as clean",
         any("NOT VERIFIED" in g for g in rec_unver["contract_gaps"]), True)

    # ⛔ A missing `ok` is NOT a display field: it must fail closed.
    hurt2 = dict(p)
    hurt2.pop("ok")
    rec3 = build_record(v, hurt2, jobs, env)
    show("missing ok: verdict falls to RED", rec3["verdict"], "RED")
    show("missing ok: gap is NAMED",
         len([g for g in rec3["contract_gaps"] if "no key 'ok'" in g]), 1)

    # Non-vacuity: the gap list must come out BOTH ways, or it proves nothing.
    show("gaps distinguish intact from mutated",
         len({len(rec["contract_gaps"]), len(rec3["contract_gaps"])}) == 2, True)

    print("SELF-CHECK", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--v", default="v.json")
    ap.add_argument("--p", default="p_suite.json")
    ap.add_argument("--jobs", default="jobs.json")
    ap.add_argument("--out", default="record.json")
    ap.add_argument("--detail-dir",
                    help="where the detail files live at BUILD time; without it the "
                         "record says its paths were NOT VERIFIED")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    v = _load(a.v)
    p = _load(a.p)
    jobs = _load(a.jobs)
    rec = build_record(v, p, jobs, dict(os.environ), detail_dir=a.detail_dir)
    pathlib.Path(a.out).write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print("timed_out derivation (vitest):", rec["outcome"]["vitest"]["timed_out_basis"])
    print("timed_out derivation (pytest):", rec["outcome"]["pytest"]["timed_out_basis"])
    if rec["contract_gaps"]:
        print("CONTRACT GAPS (record still written):")
        for g in rec["contract_gaps"]:
            print("   -", g)
    print(json.dumps(rec, indent=2))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
