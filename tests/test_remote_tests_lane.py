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
    assert rt.validate(GOOD_REF, [], ["src/agent", "src/pages/charts/a.test.jsx"], "10") == []
    assert rt.validate("refs/heads/fix/x-y", ["tests/"], ["src/lib"], 4) == []


@pytest.mark.parametrize("ref", ["master", "refs/heads/", "refs/tags/v1", "refs/remote-tests/a b",
                                 "refs/remote-tests/$(x)", "refs/remote-tests/a;b", ""])
def test_bad_refs_are_refused(ref):
    assert rt.validate(ref, ["tests/test_a.py"], [], 1)


@pytest.mark.parametrize("path", ["-k", "--deselect=x", "tests/../api", "tests/a.py;rm", "tests/$(id)", "tests/a b",
                                  "api/test_x.py", "/etc/passwd", "tests/`x`", "tests/a|b"])
def test_bad_pytest_paths_are_refused(path):
    assert rt.validate(GOOD_REF, [path], [], 1)


@pytest.mark.parametrize("path", ["app/src/x", "-t", "src/../../x", "src/a;b", "node_modules/x"])
def test_bad_vitest_paths_are_refused(path):
    assert rt.validate(GOOD_REF, [], [path], 1)


@pytest.mark.parametrize("shards", [0, 11, "x", "", -1])
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


def test_a_vitest_filter_matching_nothing_fails():
    run = [s for s in _wf()["jobs"]["vitest"]["steps"] if s.get("name") == "vitest"][0]["run"]
    assert re.search(r'if \[ "\$total" -eq 0 \]; then [^\n]*exit 1; fi', run), "an empty match must exit 1"
    assert "test -s ../rt-shard.files" in run


def test_both_test_steps_keep_their_exit_code_through_tee():
    for job in ("pytest", "vitest"):
        run = [s for s in _wf()["jobs"][job]["steps"] if s.get("name") == job][0]["run"]
        assert "set -o pipefail" in run and "| tee" in run, job
