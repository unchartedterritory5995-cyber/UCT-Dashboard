"""The `remote tests` lane (tools/remote_tests.py + .github/workflows/remote-tests.yml), 2026-11-16.

A session's focused tests run on GitHub runners instead of the one dev PC. These rails pin the parts that make it
safe on a PUBLIC repo: dispatch-only (no push/PR trigger), read-only token, inputs reach shell only through env,
and every input is validated by ONE authority (tools/remote_tests.py, master's copy) before anything runs.
"""
from __future__ import annotations

import pathlib
import re

import pytest
import yaml

from tools import remote_tests as rt

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "remote-tests.yml"


def _wf() -> dict:
    return yaml.safe_load(WF.read_text(encoding="utf-8"))


# ---- the validator: the one authority ---------------------------------------------------------------------------
GOOD_REF = "refs/remote-tests/20261116-180000-abcdef0123-my-change"


def test_good_requests_are_accepted():
    assert rt.validate(GOOD_REF, ["tests/test_a.py", "tests/test_b.py::test_x[p-1]"], [], 1) == []
    assert rt.validate(GOOD_REF, [], ["src/agent", "src/pages/charts/a.test.jsx"], "6") == []
    assert rt.validate("refs/heads/fix/x-y", ["tests/"], ["src/lib"], 4) == []


@pytest.mark.parametrize("ref", ["master", "refs/heads/", "refs/tags/v1", "refs/remote-tests/a b",
                                 "refs/remote-tests/$(x)", "refs/remote-tests/a;b", ""])
def test_bad_refs_are_refused(ref):
    assert rt.validate(ref, ["tests/test_a.py"], [], 1)


@pytest.mark.parametrize("path", ["-k", "--deselect=x", "tests/../api", "tests/a.py;rm", "tests/$(id)", "tests/a b",
                                  "api/../tools/x.py", "api", "apix/test_x.py", "app/test_x.py", "/etc/passwd",
                                  "tests/`x`", "tests/a|b", "api/x.py;rm"])
def test_bad_pytest_paths_are_refused(path):
    assert rt.validate(GOOD_REF, [path], [], 1)


def test_api_suites_are_accepted():
    """⚰️ 2026-11-18: the lane took `tests/` alone, and the 203 suites under api/** -- run by no other job, the nightly
    included -- could not be sent here at all. `api/` is a pytest.ini testpaths root like `tests/`."""
    assert rt.validate(GOOD_REF, ["api/services/journal_two/test_accounts.py",
                                  "api/routers/stream_bars_test.py::test_x[p-1]", "api/"], [], 1) == []


def test_the_pytest_roots_are_exactly_pytest_ini_testpaths():
    """One fact in two files, pinned: the validator's prefixes ARE pytest.ini's testpaths (the plan job has only
    tools/remote_tests.py checked out, so it cannot read pytest.ini itself)."""
    import configparser
    cp = configparser.ConfigParser(interpolation=None)
    cp.read(str(ROOT / "pytest.ini"), encoding="utf-8")
    roots = cp["pytest"]["testpaths"].split()
    assert sorted(r.rstrip("/") + "/" for r in roots) == sorted(rt.PYTEST_ROOTS), (roots, rt.PYTEST_ROOTS)


@pytest.mark.parametrize("path", ["app/src/x", "-t", "src/../../x", "src/a;b", "node_modules/x"])
def test_bad_vitest_paths_are_refused(path):
    assert rt.validate(GOOD_REF, [], [path], 1)


@pytest.mark.parametrize("shards", [0, 7, 11, "x", "", -1])
def test_bad_shard_counts_are_refused(shards):
    assert rt.validate(GOOD_REF, [], ["src/lib"], shards)


def test_an_empty_request_is_refused():
    assert rt.validate(GOOD_REF, [], [], 1)


def test_the_generated_ref_is_one_the_validator_accepts():
    ref = rt.ref_name("0123456789abcdef", "my change / with spaces!", now=0)
    assert ref.startswith(rt.REF_PREFIX) and rt.validate(ref, ["tests/test_a.py"], [], 1) == []


def test_validate_inputs_from_env_writes_the_plan(tmp_path, monkeypatch):
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("RT_REF", GOOD_REF)
    monkeypatch.setenv("RT_PYTEST", "tests/test_a.py")
    monkeypatch.setenv("RT_VITEST", "src/lib src/agent")
    monkeypatch.setenv("RT_SHARDS", "3")
    assert rt.main(["--validate-inputs"]) == rt.OK
    text = out.read_text(encoding="utf-8")
    assert "has_pytest=true" in text and "has_vitest=true" in text and "shards=[1, 2, 3]" in text
    monkeypatch.setenv("RT_PYTEST", "tests/a.py;curl evil")
    assert rt.main(["--validate-inputs"]) == rt.FAIL


def test_failing_tests_reads_junit(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "j.xml").write_text(
        '<testsuites><testsuite><testcase classname="tests.t" name="ok"/>'
        '<testcase classname="tests.t" name="bad"><failure message="boom&#10;more"/></testcase>'
        '<testcase classname="tests.u" name="err"><error message="E"/></testcase></testsuite></testsuites>',
        encoding="utf-8")
    assert rt.failing_tests(tmp_path) == ["tests.t::bad - boom", "tests.u::err - E"]


# ---- the workflow ------------------------------------------------------------------------------------------------
def test_dispatch_only_never_a_push_or_pr():
    doc = _wf()
    on = doc.get("on", doc.get(True))
    assert set(on) == {"workflow_dispatch"}, on


def test_classified_not_a_promotion_gate():
    assert WF.read_text(encoding="utf-8").splitlines()[0].startswith("# promotion-gate: no")


def test_read_only_token_and_no_persisted_credentials():
    doc = _wf()
    assert doc["permissions"] == {"contents": "read"}
    for name, job in doc["jobs"].items():
        assert "permissions" not in job, name
        for s in job["steps"]:
            if "actions/checkout" in (s.get("uses") or ""):
                assert (s.get("with") or {}).get("persist-credentials") is False, (name, s)
    assert "secrets." not in WF.read_text(encoding="utf-8")


def test_inputs_never_reach_shell_by_interpolation():
    """`${{ inputs.x }}` inside `run:` is script injection; inputs reach shell only through `env:`."""
    for name, job in _wf()["jobs"].items():
        for s in job["steps"]:
            run = s.get("run") or ""
            assert not re.search(r"\$\{\{\s*(inputs|github\.event\.inputs)\.", run), (name, s.get("name"))


def test_every_test_job_waits_for_the_validator():
    jobs = _wf()["jobs"]
    plan_run = " ".join(s.get("run") or "" for s in jobs["plan"]["steps"])
    assert "tools/remote_tests.py --validate-inputs" in plan_run
    for name in ("pytest", "vitest"):
        assert jobs[name]["needs"] == "plan", name
        assert "needs.plan.outputs" in jobs[name]["if"], name


def test_test_jobs_fetch_the_ref_under_test_by_name():
    """Live run 43936188940 (2026-11-16): `actions/checkout` with `ref: refs/remote-tests/...` failed in every job
    ("pathspec ... did not match"), because checkout fetches only branches and tags. Each test job must fetch the
    validated ref by name and detach onto it; no checkout step may be handed the ref."""
    for name in ("pytest", "vitest"):
        steps = _wf()["jobs"][name]["steps"]
        for s in steps:
            if "actions/checkout" in (s.get("uses") or ""):
                assert "ref" not in (s.get("with") or {}), (name, s)
        fetch = [s for s in steps if s.get("name") == "Check out the commit under test"]
        assert len(fetch) == 1, name
        run = fetch[0]["run"]
        assert fetch[0]["env"]["RT_REF"] == "${{ inputs.ref }}"
        assert 'git fetch --no-tags --quiet origin "+$RT_REF:refs/rt/under-test"' in run
        assert "git checkout --quiet --detach refs/rt/under-test" in run
        names = [s.get("name") or s.get("uses") for s in steps]
        assert names.index("Check out the commit under test") < next(
            i for i, s in enumerate(steps) if s.get("name") in ("pytest", "vitest", "npm ci", "Install")), name


def test_a_red_test_result_does_not_fail_the_run():
    """2026-11-16: red runs emailed the owner once per session test run. The test step may fail (continue-on-error),
    its outcome is written to a verdict file that is uploaded, and the helper decides from the verdicts."""
    for job, verdict_file in (("pytest", "remote-pytest-verdict.txt"), ("vitest", "remote-vitest-verdict-")):
        steps = _wf()["jobs"][job]["steps"]
        test = [s for s in steps if s.get("name") == job][0]
        assert test.get("id") == "t" and test.get("continue-on-error") is True, job
        rec = [s for s in steps if s.get("name") == "Record the verdict"]
        assert len(rec) == 1 and rec[0]["if"] == "always()", job
        assert rec[0]["env"]["OUTCOME"] == "${{ steps.t.outcome }}" and verdict_file in rec[0]["run"], job
        up = [s for s in steps if "upload-artifact" in (s.get("uses") or "")][0]
        assert verdict_file in up["with"]["path"], job
        for s in steps:   # nothing else may swallow a failure: only the test step is allowed to
            if s is not test:
                assert not s.get("continue-on-error"), (job, s.get("name"))


def test_decide_reads_the_verdicts_not_the_run_colour():
    assert rt.decide("success", 2, {"pytest": "success", "vitest-1": "success"})[0] == rt.OK
    assert rt.decide("success", 2, {"pytest": "success", "vitest-1": "failure"})[0] == rt.FAIL
    assert rt.decide("success", 1, {"pytest": "cancelled"})[0] == rt.FAIL
    assert rt.decide("success", 3, {"pytest": "success", "vitest-1": "success"})[0] == rt.LANE   # a verdict missing
    assert rt.decide("failure", 1, {"pytest": "success"})[0] == rt.LANE                            # the lane broke
    assert rt.decide("cancelled", 1, {})[0] == rt.LANE


def test_read_verdicts(tmp_path):
    (tmp_path / "remote-pytest").mkdir()
    (tmp_path / "remote-pytest" / "remote-pytest-verdict.txt").write_text("failure\n", encoding="utf-8")
    (tmp_path / "remote-vitest-2").mkdir()
    (tmp_path / "remote-vitest-2" / "remote-vitest-verdict-2.txt").write_text("success", encoding="utf-8")
    assert rt.read_verdicts(tmp_path) == {"pytest": "failure", "vitest-2": "success"}


def test_one_remote_run_cannot_crowd_out_the_deploy_gate():
    """2026-11-16: an hour after launch, session runs + PR CI queued two master deploy gates. Bound each run."""
    strategy = _wf()["jobs"]["vitest"]["strategy"]
    assert strategy.get("max-parallel") == 4, strategy
    assert rt.MAX_SHARDS == 6
    assert rt.validate(GOOD_REF, [], ["src/lib"], 6) == [] and rt.validate(GOOD_REF, [], ["src/lib"], 7)


def test_a_vitest_filter_matching_nothing_fails():
    run = [s for s in _wf()["jobs"]["vitest"]["steps"] if s.get("name") == "vitest"][0]["run"]
    assert re.search(r'if \[ "\$total" -eq 0 \]; then [^\n]*exit 1; fi', run), "an empty match must exit 1"
    assert "test -s ../rt-shard.files" in run


def test_both_test_steps_keep_their_exit_code_through_tee():
    for job in ("pytest", "vitest"):
        run = [s for s in _wf()["jobs"][job]["steps"] if s.get("name") == job][0]["run"]
        assert "set -o pipefail" in run and "| tee" in run, job


def test_the_vitest_job_installs_the_python_its_rails_spawn():
    """2026-11-17: seven Notebook bridge rails spawn `python` (conftest -> pytest, the exporter -> anyio, and lazily,
    inside functions, markdown_it and more) and were red on this lane alone, because this job installed no Python
    (run 44066213548). A hand-picked "minimal" list left two of them red (run 44085508213), so the job installs
    requirements.txt -- the same install the nightly's vitest job and this lane's pytest job do -- after the ref
    under test is checked out (its own requirements) and before vitest runs."""
    steps = _wf()["jobs"]["vitest"]["steps"]
    labels = [s.get("name") or s.get("uses") for s in steps]
    setup = [i for i, s in enumerate(steps) if (s.get("uses") or "").startswith("actions/setup-python@")]
    assert len(setup) == 1 and str(steps[setup[0]]["with"]["python-version"]) == "3.12", steps
    install = [i for i, s in enumerate(steps) if "-r requirements.txt" in (s.get("run") or "")]
    assert len(install) == 1, labels
    assert "pip install" in steps[install[0]]["run"], steps[install[0]]
    assert labels.index("Check out the commit under test") < setup[0] < install[0] < labels.index("vitest"), labels


def _pytest_step():
    return [s for s in _wf()["jobs"]["pytest"]["steps"] if s.get("name") == "pytest"][0]


def test_the_pytest_job_continues_past_collection_errors():
    """⚰️ 2026-11-18: a 372-file request ran NOTHING because 6 files could not import a package (run 44307066612).
    The flag keeps the collection error as an ERROR by file (junit, totals, exit code) and runs the rest; its
    behaviour, flag on and off, is proved in tests/test_pytest_shards_balance.py."""
    run = _pytest_step()["run"]
    cmd = run[run.index("python -m pytest $RT_PYTEST"):]
    cmd = cmd[:cmd.index("--junitxml")]
    assert "--continue-on-collection-errors" in cmd, cmd


def test_test_only_packages_install_only_when_the_ref_has_the_file():
    """The workflow comes from master but the ref under test may predate tests/ci-only-packages.txt: an
    unconditional `-r` on a missing file would break the lane for every older branch."""
    install = [s for s in _wf()["jobs"]["pytest"]["steps"] if s.get("name") == "Install"][0]["run"]
    assert "if [ -f tests/ci-only-packages.txt ]; then python -m pip install --quiet -r tests/ci-only-packages.txt; fi"         in install, install
    assert (ROOT / "tests" / "ci-only-packages.txt").is_file()
