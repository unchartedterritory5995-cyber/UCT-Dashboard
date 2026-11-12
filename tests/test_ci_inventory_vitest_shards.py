"""The full-suite workflow's SHARDED vitest record: complete, or INVALID — never partial-green.

The vitest job runs as `--shard=i/4` (.github/workflows/full-suite-report.yml). These tests
pin the record contract end to end, through the same tools `publish` runs:

* 4 of 4 shard logs   -> a valid record whose totals are the SUM of the four shard lines
* 3 of 4 shard logs   -> INVALID (`shards_missing`), never a smaller count shown as whole
* a log with no totals line (killed shard) -> INVALID (`shards_without_totals`)
* a cancelled, never-started run / job -> NOT_RUN, never a result or a timeout
* a manual re-run never overwrites attempt 1, and attempt-1-failed / later-passed is FLAKY
* the plan proof refuses anything that is not a partition
* the workflow keeps one nightly, queue-not-cancel concurrency and no retry automation

Standard library + PyYAML (requirements.txt). Runs in CI only.
"""
from __future__ import annotations

import json
import pathlib
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import ci_aggregate  # noqa: E402
import ci_inventory  # noqa: E402
import ci_outcome  # noqa: E402
import ci_publish  # noqa: E402
import vitest_shards  # noqa: E402

WORKFLOW = REPO / ".github" / "workflows" / "full-suite-report.yml"

#: one shard's real-shaped log: (collected, failed, skipped, files)
#: Derived from vitest_shards.COUNT (the one place the count is written), so changing the count never
#: leaves a fixture describing a different partition.
_SHAPES = [(1000, 2, 30, 300), (1100, 0, 40, 290), (900, 1, 25, 280), (1200, 0, 35, 275)]
IDS = vitest_shards.shard_ids()
SHARDS = {sid: _SHAPES[i % len(_SHAPES)] for i, sid in enumerate(IDS)}


def _log(collected, failed, skipped, files):
    passed = collected - failed - skipped
    fl = "%d failed | " % (1 if failed else 0) if failed else ""
    fp = files - (1 if failed else 0)
    tl = "%d failed | " % failed if failed else ""
    return (" FAIL  src/x.test.jsx > thing\n" if failed else "") + (
        " Test Files  %s%d passed (%d)\n"
        "      Tests  %s%d passed | %d skipped (%d)\n"
        "   Duration  1500.00s\n" % (fl, fp, files, tl, passed, skipped, collected))


def _jobs(ids, started=True):
    jobs = []
    for sid in ids:
        j = {"name": "vitest — shard-%s (report-only)" % sid, "status": "completed",
             "conclusion": "success" if started else "cancelled",
             "started_at": "2026-11-10T07:31:00Z", "completed_at": "2026-11-10T08:01:00Z"}
        if started:
            j.update(runner_name="GitHub Actions 7", runner_id=7,
                     steps=[{"name": "Run", "conclusion": "success", "status": "completed",
                             "started_at": "2026-11-10T07:33:00Z"}])
        else:
            j.update(runner_name=None, runner_id=0, steps=[])
        jobs.append(j)
    return {"jobs": jobs}


def _vitest_record(tmp_path, present, logs=None, jobs=None):
    """Run `ci_aggregate --suite vitest` exactly as `publish` does; return v.json."""
    vs = tmp_path / "vshards"
    for sid in present:
        d = vs / ("vitest-log-" + sid)
        d.mkdir(parents=True)
        (d / "vitest.log").write_text((logs or {}).get(sid) or _log(*SHARDS[sid]),
                                      encoding="utf-8")
    jp = tmp_path / "jobs.json"
    jp.write_text(json.dumps(jobs if jobs is not None else _jobs(present)), encoding="utf-8")
    out = tmp_path / "v.json"
    rc = ci_aggregate.main(["--suite", "vitest", "--shards-dir", str(vs),
                            "--expect", json.dumps(vitest_shards.shard_ids()),
                            "--dir-prefix", "vitest-log-", "--jobs", str(jp),
                            "--out", str(out)])
    assert rc == 0
    return json.loads(out.read_text(encoding="utf-8"))


A = ("pytest", "tests.test_a", "test_one")
B = ("pytest", "tests.test_b", "test_two")
RAN = {A, B}
PYTEST_OK = {"shards_total": 2, "shards_success": 2, "shards_unreadable": [],
             "shards_without_totals": [], "shards_missing": [], "collected": 100}


def _verdict(v):
    return ci_inventory.diff({A, B}, {A, B}, RAN, {"pytest": PYTEST_OK, "vitest": v})


# ── totals ───────────────────────────────────────────────────────────────────────────

def test_all_shards_is_valid_and_the_totals_are_the_sum(tmp_path):
    v = _vitest_record(tmp_path, IDS)
    assert v["collected"] == sum(s[0] for s in SHARDS.values())
    assert v["failed"] == sum(s[1] for s in SHARDS.values())
    assert v["skipped"] == sum(s[2] for s in SHARDS.values())
    assert v["files_collected"] == sum(s[3] for s in SHARDS.values())
    assert v["passed"] == v["collected"] - v["failed"] - v["skipped"]
    assert v["totals_line_found"] is True
    assert v["shards_missing"] == [] and v["shards_without_totals"] == []
    # each shard keeps its OWN line, and its runner wall time
    assert sorted(v["shard_totals"]) == sorted(IDS)
    for sid, (collected, *_rest) in SHARDS.items():
        assert v["shard_totals"][sid]["collected"] == collected
        assert "(%d)" % collected in v["shard_totals"][sid]["tests_line"]
        assert v["shard_totals"][sid]["elapsed_s"] == 1800.0
    d = _verdict(v)
    assert d["verdict"] != "INVALID", d["invalid_because"]
    assert ci_inventory.vitest_shard_problems(v) == []


def test_all_but_one_shard_is_invalid(tmp_path):
    v = _vitest_record(tmp_path, IDS[:-1])
    assert v["shards_missing"] == [IDS[-1]]
    assert v["totals_line_found"] is False
    assert v["ok"] is False
    # the count it DID see is three shards' worth — it must not pass for the suite
    assert v["collected"] == sum(SHARDS[s][0] for s in IDS[:-1])
    d = _verdict(v)
    assert d["verdict"] == "INVALID"
    assert any("shards_missing" in r for r in d["invalid_because"])
    full = dict(v, sharded=True)
    assert ci_inventory.record_is_valid({"pytest": PYTEST_OK, "vitest": full}) is False


def test_a_shard_log_without_a_totals_line_is_invalid(tmp_path):
    killed = "  RUN  v4.0.18\n ✓ src/a.test.js (3 tests)\n"   # cut at the cap, no totals
    v = _vitest_record(tmp_path, IDS, logs={"2": killed})
    assert v["shards_without_totals"] == ["2"]
    assert v["totals_line_found"] is False
    d = _verdict(v)
    assert d["verdict"] == "INVALID"
    assert any("shards_without_totals" in r for r in d["invalid_because"])


def test_a_single_shard_line_never_passes_for_the_whole_suite(tmp_path):
    # Only shard 1 reported, with a perfectly good totals line of its own.
    v = _vitest_record(tmp_path, ["1"])
    assert v["shards_missing"] == IDS[1:]
    assert v["totals_line_found"] is False
    assert _verdict(v)["verdict"] == "INVALID"


def test_an_empty_plan_output_falls_back_to_the_tools_own_shard_list(tmp_path):
    # `--expect ''` is what a failed plan job hands publish: every shard must read MISSING.
    out = tmp_path / "v.json"
    (tmp_path / "vshards").mkdir()
    ci_aggregate.main(["--suite", "vitest", "--shards-dir", str(tmp_path / "vshards"),
                       "--expect", "", "--out", str(out)])
    v = json.loads(out.read_text(encoding="utf-8"))
    assert v["shards_missing"] == vitest_shards.shard_ids()
    assert _verdict(v)["verdict"] == "INVALID"


# ── concurrency: a cancelled, never-started run is NOT_RUN ───────────────────────────

def test_a_queued_run_cancelled_before_it_started_is_not_run():
    run = {"status": "completed", "conclusion": "cancelled"}
    jobs = _jobs(IDS, started=False)
    r = ci_inventory.classify_run(run, jobs)
    assert r["state"] == "NOT_RUN"
    # and each of its jobs is "not run", NOT a timeout
    f = ci_outcome.fields(jobs, "vitest", "cancelled", 60)
    assert f["ran"] is False
    assert f["timed_out"] is False
    # an unreadable jobs payload is not guessed either way
    assert ci_inventory.classify_run(run, None)["state"] == "UNREADABLE"
    # CONTROL: a run cancelled after its jobs started is a different fact
    assert ci_inventory.classify_run(run, _jobs(["1"]))["state"] == "CANCELLED_AFTER_START"
    assert ci_inventory.classify_run({"status": "completed", "conclusion": "failure"},
                                     [])["state"] == "COMPLETED"


def test_a_never_started_shard_is_named_not_run_and_the_record_is_invalid(tmp_path):
    jobs = _jobs(IDS[:-1])
    jobs["jobs"] += _jobs([IDS[-1]], started=False)["jobs"]
    v = _vitest_record(tmp_path, IDS[:-1], jobs=jobs)
    assert v["shards_not_run"] == [IDS[-1]]
    assert _verdict(v)["verdict"] == "INVALID"


# ── no retry laundering ──────────────────────────────────────────────────────────────

def test_a_manual_rerun_never_overwrites_attempt_one(tmp_path):
    d1, why = ci_publish.record_dest(tmp_path, "99", "1")
    assert why is None and d1 == tmp_path / "99"
    d1.mkdir()
    (d1 / "summary.json").write_text("{}", encoding="utf-8")
    d2, why2 = ci_publish.record_dest(tmp_path, "99", "2")
    assert why2 is None and d2 == tmp_path / "99" / "attempt-2"
    again, refusal = ci_publish.record_dest(tmp_path, "99", "1")
    assert again is None and "never overwritten" in refusal


def test_failed_on_attempt_one_and_passed_later_is_flaky_not_green(tmp_path):
    junit = ('<testsuites><testsuite name="s"><testcase classname="src/a.test.js" '
             'name="works"%s</testcase></testsuite></testsuites>')
    rec = tmp_path / "99"
    rec.mkdir()
    (rec / "vitest_failures.txt").write_text(
        "src/a.test.js :: works\n    expected 1 to be 2\n", encoding="utf-8")
    (rec / "vitest-junit.xml").write_text(
        junit % '><failure message="expected 1 to be 2">x</failure>', encoding="utf-8")
    (rec / "summary.json").write_text(json.dumps({"run_attempt": "1"}), encoding="utf-8")
    later = rec / "attempt-2"
    later.mkdir()
    (later / "vitest_failures.txt").write_text("ZERO — no failures\n", encoding="utf-8")
    (later / "vitest-junit.xml").write_text(junit % ">", encoding="utf-8")
    key = ("vitest", "src/a.test.js", "works")
    assert ci_inventory.rerun_flaky(rec) == [key]
    # ⛔ and attempt 1's record still FAILS it: the re-run made nothing greener
    failing, _ran, _s = ci_inventory.load_record(rec)
    assert key in failing
    # attempt-<n>/ is never read as a run of its own
    assert [r["id"] for r in ci_inventory.collect_runs(tmp_path)] == ["99"]


# ── the plan proof ───────────────────────────────────────────────────────────────────

def test_the_partition_proof_accepts_a_partition_and_refuses_everything_else():
    n = vitest_shards.COUNT
    full = ["f%02d" % i for i in range(2 * n)]
    good = {"count": n, "full": full, "shards": {sid: full[2 * i:2 * i + 2] for i, sid in enumerate(IDS)}}
    assert vitest_shards.prove(good)["ok"] is True
    lost = dict(good, shards=dict(good["shards"], **{IDS[-1]: full[-2:-1]}))
    twice = dict(good, shards=dict(good["shards"], **{"1": full[0:4]}))
    absent = dict(good, shards={k: v for k, v in good["shards"].items() if k != "2"})
    copies = dict(good, shards={s: list(full) for s in vitest_shards.shard_ids()})
    for bad in (lost, twice, absent, copies, {}, None):
        assert vitest_shards.prove(bad)["ok"] is False


# ── the workflow shape ───────────────────────────────────────────────────────────────

def _wf():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_the_workflow_shards_vitest_from_the_plan_with_one_artifact_per_shard():
    doc = _wf()
    plan = doc["jobs"]["plan"]
    assert "vitest_shards" in plan["outputs"] and "vitest_shard_count" in plan["outputs"]
    proof = "\n".join(s.get("run", "") for s in plan["steps"])
    assert "vitest_shards.py --prove" in proof
    v = doc["jobs"]["vitest"]
    assert v["needs"] == "plan"
    assert v["timeout-minutes"] == 60
    assert v["continue-on-error"] is True                 # still report-only
    assert "needs.plan.outputs.vitest_shards" in v["strategy"]["matrix"]["shard"]
    assert v["strategy"]["fail-fast"] is False
    run = next(s["run"] for s in v["steps"] if s.get("name") == "Run")
    assert "--shard=${{ matrix.shard }}/${{ needs.plan.outputs.vitest_shard_count }}" in run
    assert any(s.get("name") == "Assert the run produced a totals line" for s in v["steps"])
    up = next(s for s in v["steps"] if "upload-artifact" in (s.get("uses") or ""))
    assert up["with"]["name"] == "vitest-log-${{ matrix.shard }}"
    dl = [s for s in doc["jobs"]["publish"]["steps"]
          if "download-artifact" in (s.get("uses") or "")
          and (s.get("with") or {}).get("pattern") == "vitest-log-*"]
    assert len(dl) == 1 and dl[0]["with"].get("merge-multiple") is False
    assert vitest_shards.COUNT == 6   # 4 -> 6 on 2026-11-12: shard 4 hit the 60-minute cap


def test_one_nightly_queue_not_cancel_and_no_retry_automation():
    doc = _wf()
    on = doc.get("on", doc.get(True))
    assert sorted(on) == ["schedule", "workflow_dispatch"]
    assert len(on["schedule"]) == 1
    assert doc["concurrency"]["cancel-in-progress"] is False
    for name, job in doc["jobs"].items():
        for step in job.get("steps") or []:
            assert "retry" not in (step.get("uses") or "").lower(), (name, step)
            body = step.get("run") or ""
            assert "gh run rerun" not in body and "rerun-failed" not in body, (name, step)
        assert "retry" not in json.dumps(job.get("strategy") or {}).lower(), name
