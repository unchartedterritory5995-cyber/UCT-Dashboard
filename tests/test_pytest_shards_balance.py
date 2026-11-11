"""Rails for the TIME-balanced pytest shard plan (tools/pytest_shards.py).

⚰️ 2026-11-10: every nightly full-suite run since ≥10-31 ended `cancelled` because the root
buckets were equal in FILE COUNT: `tests-10` carried 5,393 tests and hit the job's 20-minute
cap. The plan now cuts the loose root files into contiguous alphabetical buckets by the
per-file seconds recorded in `tools/pytest_shard_timings.json`. These rails pin:

  * it is still a PARTITION (union = all files, pairwise disjoint);
  * no planned shard exceeds the recorded-time rail, and the rail can fire (the old
    count-cut plan, the measured failure shape, is refused);
  * the plan is deterministic and contiguous;
  * files with no timing fall back to a file-count weight, and a missing timing file falls
    back to more, smaller count-cut buckets, never to the cancelled shape;
  * the workflow passes the timing file BY PATH, so `ci_inventory.suite_harness_files`
    sees a timing refresh as a harness change (it decides who shares a process).

Standard library + PyYAML. No pytest run of the suite itself.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "full-suite-report.yml"
TIMINGS = "tools/pytest_shard_timings.json"


def _ps():
    spec = importlib.util.spec_from_file_location("pytest_shards_under_test",
                                                  ROOT / "tools" / "pytest_shards.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ps = _ps()


def _real():
    files = ps.all_test_files()
    timings = ps.load_timings(ROOT / TIMINGS)
    return files, timings, ps.shard_plan(timings=timings)


def _roots(plan):
    return [k for k in sorted(plan) if k.startswith("tests-")]


# ------------------------------------------------------------------ the real plan

def test_real_plan_is_a_partition():
    files, _t, plan = _real()
    rep = ps.partition_report(plan, files)
    assert rep["files_total"] > 1000                     # non-vacuity
    assert rep["duplicated"] == [] and rep["missing"] == [] and rep["extra"] == []
    assert rep["sum_of_shard_sizes"] == rep["files_total"]
    assert rep["is_partition"] is True


def test_timing_file_is_real_and_covers_the_root():
    files, timings, _plan = _real()
    assert len(timings) > 1000
    loose = [f for f in files if f.count("/") == 1]
    covered = sum(1 for f in loose if f in timings) / len(loose)
    assert covered >= ps.MIN_TIMING_COVERAGE, covered


def test_no_planned_shard_exceeds_the_rail():
    _f, timings, plan = _real()
    assert ps.rail_violations(plan, timings) == []
    secs = ps.shard_seconds(plan, timings)
    assert max(s["estimated_s"] for s in secs.values()) <= ps.SHARD_RAIL_S


def test_rail_refuses_the_old_count_cut_plan():
    """The measured failure shape must FAIL the rail, or the rail proves nothing."""
    _f, timings, _plan = _real()
    old = ps.shard_plan(buckets=12, timings=timings)
    bad = ps.rail_violations(old, timings)
    assert "tests-10" in bad, bad


def test_rail_fires_just_under_the_plans_own_max():
    _f, timings, plan = _real()
    worst = max(s["estimated_s"] for s in ps.shard_seconds(plan, timings).values())
    assert ps.rail_violations(plan, timings, rail_s=worst - 1)


def test_root_buckets_are_contiguous_sorted_and_at_least_the_floor():
    files, _t, plan = _real()
    loose = [f for f in files if f.count("/") == 1]
    roots = _roots(plan)
    assert len(roots) >= ps.ROOT_BUCKETS
    joined = [f for k in roots for f in plan[k]]
    assert joined == loose                                 # contiguous, in sorted order
    assert all(plan[k] for k in roots)                     # none empty


def test_plan_is_deterministic_and_independent_of_dict_order():
    _f, timings, plan = _real()
    again = ps.shard_plan(timings=dict(reversed(list(timings.items()))))
    assert again == plan
    assert ps.shard_plan(timings=ps.load_timings(ROOT / TIMINGS)) == plan


def test_timing_file_bytes_are_canonical():
    """Sorted keys, integer ms: a refresh diff is reviewable and the plan a pure function."""
    doc = json.loads((ROOT / TIMINGS).read_text(encoding="utf-8"))
    keys = list(doc["files_ms"])
    assert keys == sorted(keys)
    assert all(isinstance(v, int) and v >= 0 for v in doc["files_ms"].values())
    assert doc["sources"], "the timing file must say which runs it came from"


# ------------------------------------------------------------------ synthetic trees

def _tree(tmp_path, names, subdir_files=()):
    t = tmp_path / "tests"
    t.mkdir()
    for n in names:
        (t / n).write_text("", encoding="utf-8")
    for d, n in subdir_files:
        (t / d).mkdir(exist_ok=True)
        (t / d / n).write_text("", encoding="utf-8")
    return t


def test_time_cut_isolates_heavy_files(tmp_path):
    names = ["test_%03d.py" % i for i in range(40)]
    t = _tree(tmp_path, names, [("api", "test_a.py")])
    timings = {"tests/%s" % n: 1.0 for n in names}
    timings["tests/test_005.py"] = 500.0                   # one heavy file early on
    plan = ps.shard_plan(t, timings=timings)
    files = ps.all_test_files(t)
    assert ps.partition_report(plan, files)["is_partition"]
    secs = ps.shard_seconds(plan, timings)
    heavy = [k for k in plan if "tests/test_005.py" in plan[k]][0]
    # the heavy file's bucket holds little else; a count cut would have given it ~4 files
    assert secs[heavy]["recorded_s"] < 510
    assert "dir-api" in plan


def test_untimed_files_fall_back_to_a_count_weight(tmp_path):
    names = ["test_%03d.py" % i for i in range(30)]
    t = _tree(tmp_path, names)
    timings = {"tests/%s" % n: 2.0 for n in names[:20]}   # last 10 have no timing
    fb = ps.fallback_seconds(timings)
    assert fb == 2.0
    secs = ps.shard_seconds(ps.shard_plan(t, timings=timings), timings)
    assert sum(s["untimed"] for s in secs.values()) == 10
    assert abs(sum(s["estimated_s"] for s in secs.values()) - 60.0) < 1e-6


def test_missing_timing_file_degrades_to_more_count_buckets(tmp_path):
    names = ["test_%03d.py" % i for i in range(96)]
    t = _tree(tmp_path, names)
    assert ps.load_timings(tmp_path / "nope.json") == {}
    plan = ps.shard_plan(t, timings={})
    assert len(_roots(plan)) == ps.ROOT_BUCKETS_NO_TIMINGS
    assert ps.partition_report(plan, ps.all_test_files(t))["is_partition"]


def test_corrupt_timing_file_reads_as_absent(tmp_path):
    p = tmp_path / "t.json"
    p.write_text("{not json", encoding="utf-8")
    assert ps.load_timings(p) == {}
    p.write_text(json.dumps({"files": {}}), encoding="utf-8")
    assert ps.load_timings(p) == {}


def test_record_timings_maps_classes_and_first_run_wins(tmp_path):
    new = tmp_path / "new.xml"
    old = tmp_path / "old.xml"
    new.write_text(
        '<testsuites><testsuite>'
        '<testcase classname="tests.test_a" name="x" time="1.5"/>'
        '<testcase classname="tests.test_a.TestK" name="y" time="0.5"/>'
        '<testcase classname="tests.api.test_b" name="z" time="2"/>'
        '<testcase classname="" name="tests.test_broken" time="0"/>'
        '</testsuite></testsuites>', encoding="utf-8")
    old.write_text(
        '<testsuites><testsuite>'
        '<testcase classname="tests.test_a" name="x" time="99"/>'
        '<testcase classname="tests.test_c" name="w" time="3"/>'
        '</testsuite></testsuites>', encoding="utf-8")
    files = ["tests/api/test_b.py", "tests/test_a.py", "tests/test_broken.py", "tests/test_c.py"]
    ms = ps.record_timings([new, old], files)
    assert ms == {"tests/test_a.py": 2000, "tests/api/test_b.py": 2000, "tests/test_c.py": 3000}
    out = tmp_path / "timings.json"
    ps.write_timings(out, ms, ["run X"])
    assert ps.load_timings(out) == {"tests/test_a.py": 2.0, "tests/api/test_b.py": 2.0,
                                    "tests/test_c.py": 3.0}


# ------------------------------------------------------------------ the workflow

def _pytest_job():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def test_pytest_job_cap_is_30_minutes_headroom():
    jobs = _pytest_job()
    assert jobs["pytest"]["timeout-minutes"] == 30


def test_rail_fits_inside_the_cap_at_the_measured_wall_ratio():
    """720 s recorded × 1.45 (worst measured wall/recorded) + setup must fit in 30 min."""
    jobs = _pytest_job()
    cap_s = jobs["pytest"]["timeout-minutes"] * 60
    assert ps.SHARD_RAIL_S * 1.45 + 300 < cap_s


def test_workflow_passes_the_timing_file_by_path_everywhere():
    jobs = _pytest_job()
    runs = [str(s.get("run") or "") for j in ("plan", "pytest")
            for s in jobs[j]["steps"] if isinstance(s, dict)]
    calls = [ln for r in runs for ln in r.splitlines() if "tools/pytest_shards.py" in ln]
    assert len(calls) >= 4, calls
    assert all("--timings %s" % TIMINGS in ln for ln in calls), calls
