"""Every backend test file pytest can discover is in the nightly's shard plan: none joins NO job.

⚰️⚰️ MEASURED 2026-11-18 on master b4358d492a: of 3,329 files under tests/, 2,982 (89.6%) ran in
no per-push or per-PR job, and the one job meant to run them all (`full-suite-report.yml`, the
nightly) had not run for two nights. The 203 collectable files under `api/**` were worse: no job
of any kind ran them, nightly included, because `tools/pytest_shards.py` partitioned `tests/`
and pytest.ini's `testpaths` is `tests api`. Nothing failed, so nothing said so.

This rail runs in the master deploy gate's `gate` job, on every master push. It fails BY NAME when
a test file exists that the nightly's plan does not hold, whatever the reason: a planner that
narrowed, a root nobody declared, a file named for the other `python_files` pattern.

  * the planner reads pytest's OWN discovery config (`testpaths`, `python_files`) and prunes the
    same folders as tests/test_test_discovery_coverage.py — asserted, so neither can drift;
  * every test-named file in the repo is in the plan exactly once, or is a NOT_A_SUITE exemption
    (each of which already carries its reason in that file);
  * CONTROLS: a planted file in a synthetic repo is found, a file planted after the plan was built
    is named as missing, and the OLD planner (tests/ only) is caught missing the api file.

Stdlib + pytest. No suite run, no app import: the gate pays a filesystem walk, about a second.
"""
from __future__ import annotations

import importlib.util
import pathlib

from tests.test_test_discovery_coverage import NOT_A_SUITE, _PRUNED, _discover

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load_planner():
    spec = importlib.util.spec_from_file_location("pytest_shards_for_the_plan_rail",
                                                  ROOT / "tools" / "pytest_shards.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ps = _load_planner()


def in_plan(plan: dict) -> set:
    return {f for members in plan.values() for f in members}


def missing_from_plan(found, plan: dict) -> list:
    """The test files the plan does not hold, sorted: the rail's whole question."""
    return sorted(set(found) - in_plan(plan))


def doubled_in_plan(plan: dict) -> list:
    seen, twice = set(), set()
    for members in plan.values():
        for f in members:
            (twice if f in seen else seen).add(f)
    return sorted(twice)


def _found(root: pathlib.Path, patterns) -> set:
    return {f for f in _discover(root, patterns) if f not in NOT_A_SUITE}


def test_the_planner_reads_pytests_own_discovery_config(pytestconfig):
    roots, patterns = ps.pytest_discovery()
    assert roots == list(pytestconfig.getini("testpaths")), roots
    assert patterns == list(pytestconfig.getini("python_files")), patterns
    assert set(ps.PRUNED_DIRS) == set(_PRUNED), (sorted(ps.PRUNED_DIRS), sorted(_PRUNED))


def test_every_discoverable_backend_test_file_is_in_exactly_one_shard(pytestconfig):
    found = _found(ROOT, list(pytestconfig.getini("python_files")))
    plan = ps.shard_plan()
    # ⛔ NON-VACUITY: a walk that found nothing, or a plan with no api shard, proves nothing.
    assert len(found) > 3000, len(found)
    for r in pytestconfig.getini("testpaths"):
        assert any(f.startswith(r + "/") for f in found), r
        assert any(f.startswith(r + "/") for f in in_plan(plan)), r
    missing = missing_from_plan(found, plan)
    assert not missing, (
        "%d test file(s) are in NO shard of the nightly, so no CI job ever runs them:\n  %s\n\n"
        "Put the folder under a `testpaths` root in pytest.ini (tools/pytest_shards.py reads it), "
        "or, if the file is a script and not a suite, add it to NOT_A_SUITE in "
        "tests/test_test_discovery_coverage.py with the reason." % (len(missing), "\n  ".join(missing)))
    assert doubled_in_plan(plan) == []


def _synthetic_repo(tmp_path, roots="tests api"):
    (tmp_path / "pytest.ini").write_text("[pytest]\n# a comment line, as the real file has\n"
                                         "testpaths =\n    " + "\n    ".join(roots.split()) + "\n",
                                         encoding="utf-8")
    for rel in ("tests/test_loose.py", "tests/sub/test_in_dir.py", "api/svc/thing_test.py",
                "api/svc/test_other.py", "api/node_modules/test_pruned.py", "tests/.cache/test_dot.py"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("def test_x():\n    pass\n", encoding="utf-8")
    return tmp_path


def test_control_a_planted_file_in_a_synthetic_repo_is_in_the_plan(tmp_path, monkeypatch):
    repo = _synthetic_repo(tmp_path)
    monkeypatch.setattr(ps, "_repo_root", lambda: repo)
    plan = ps.shard_plan(timings={})
    found = _found(repo, list(ps.PYTEST_DEFAULT_PYTHON_FILES))
    assert found == {"tests/test_loose.py", "tests/sub/test_in_dir.py", "api/svc/thing_test.py",
                     "api/svc/test_other.py"}                     # pruned + dot folders excluded
    assert missing_from_plan(found, plan) == []
    # ⛔ the comparison can FIRE: a file planted after the plan was built is named
    late = repo / "api" / "svc" / "test_planted_late.py"
    late.write_text("", encoding="utf-8")
    assert missing_from_plan(_found(repo, ps.PYTEST_DEFAULT_PYTHON_FILES), plan) == [
        "api/svc/test_planted_late.py"]
    # ...and a fresh plan holds it
    assert missing_from_plan(_found(repo, ps.PYTEST_DEFAULT_PYTHON_FILES), ps.shard_plan(timings={})) == []


def test_control_a_new_testpaths_root_joins_the_plan_without_touching_the_planner(tmp_path, monkeypatch):
    repo = _synthetic_repo(tmp_path, roots="tests api services")
    p = repo / "services" / "x" / "test_new_root.py"
    p.parent.mkdir(parents=True)
    p.write_text("", encoding="utf-8")
    monkeypatch.setattr(ps, "_repo_root", lambda: repo)
    plan = ps.shard_plan(timings={})
    assert "services/x/test_new_root.py" in in_plan(plan)
    assert any(k.startswith("services-") for k in plan), sorted(plan)


def test_control_the_old_tests_only_planner_is_caught_missing_the_api_files(tmp_path, monkeypatch):
    """The exact 2026-11-18 hole: a plan over tests/ alone. The rail must name the api files."""
    repo = _synthetic_repo(tmp_path)
    monkeypatch.setattr(ps, "_repo_root", lambda: repo)
    old_plan = ps.shard_plan(root=repo / "tests", timings={})
    assert missing_from_plan(_found(repo, ps.PYTEST_DEFAULT_PYTHON_FILES), old_plan) == [
        "api/svc/test_other.py", "api/svc/thing_test.py"]
