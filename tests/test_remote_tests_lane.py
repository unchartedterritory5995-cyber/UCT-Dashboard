"""The `remote tests` lane (tools/remote_tests.py + .github/workflows/remote-tests.yml), 2026-11-16.

A session's focused tests run on GitHub runners instead of the one dev PC. These rails pin the parts that make it
safe on a PUBLIC repo: dispatch-only (no push/PR trigger), read-only token, inputs reach shell only through env,
and every input is validated by ONE authority (tools/remote_tests.py, master's copy) before anything runs.
"""
from __future__ import annotations

import json
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


# ---- D1 (2026-11-18): allowlisted measurement variables in, remote-out/ back -------------------------------------
GOOD_ENV = ["VENDOR_HARNESS_RUNTIME_ON=1", "VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness",
            "VENDOR_HARNESS_OUT=../remote-out/runtime-on"]


def test_D1_allowlisted_measurement_variables_are_accepted():
    assert rt.validate(GOOD_REF, [], ["src/lib"], 1, GOOD_ENV) == []
    assert rt.validate_env(["CAPABILITY_CENSUS_OUT=remote-out/cap.json"]) == []


@pytest.mark.parametrize("pair", ["ANTHROPIC_API_KEY=x", "GITHUB_TOKEN=x", "PATH=/usr/bin", "PINE_LIBRARY_STORE=/s",
                                  "NODE_OPTIONS=--require=evil", "LD_PRELOAD=x.so"])
def test_D1_a_name_off_the_allowlist_is_refused_whatever_it_is(pair):
    """Never a secret, never a variable that changes how a program loads: only the measurement switches."""
    assert rt.validate_env([pair]), pair


@pytest.mark.parametrize("value", ["$(id)", "`id`", "x;$HOME", "x\ny", "'q'", '"q"', "x*", "a\\b", "x" * 201])
def test_D1_a_value_cannot_carry_shell_or_a_newline(value):
    assert rt.validate_env([f"VENDOR_HARNESS_DIR={value}"]), value


def test_D1_an_out_variable_must_land_in_remote_out():
    assert rt.validate_env(["VENDOR_HARNESS_OUT=../docs/pine/vendor-harness/runtime-on"])
    assert rt.validate_env(["RUN_HALF_OUT=/tmp/x"])
    assert rt.validate_env(["VENDOR_HARNESS_OUT=../remote-out/rt"]) == []


def test_D1_malformed_duplicated_or_too_many_pairs_are_refused():
    assert rt.validate_env(["VENDOR_HARNESS_DIR"])
    assert rt.validate_env(["VENDOR_HARNESS_DIR=a", "VENDOR_HARNESS_DIR=b"])
    assert rt.validate_env([f"VOCAB_CENSUS={i}" for i in range(rt.MAX_ENV + 1)])


def test_D1_the_plan_job_emits_only_validated_env(tmp_path, monkeypatch):
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("RT_REF", GOOD_REF)
    monkeypatch.setenv("RT_PYTEST", "")
    monkeypatch.setenv("RT_VITEST", "src/lib")
    monkeypatch.setenv("RT_SHARDS", "1")
    monkeypatch.setenv("RT_ENV", " ".join(GOOD_ENV))
    assert rt.main(["--validate-inputs"]) == rt.OK
    assert "env=" + " ".join(GOOD_ENV) in out.read_text(encoding="utf-8").splitlines()
    out.unlink()
    monkeypatch.setenv("RT_ENV", "GITHUB_TOKEN=x")
    assert rt.main(["--validate-inputs"]) == rt.FAIL
    assert not out.exists() or "env=" not in out.read_text(encoding="utf-8"), "a refused request emitted env"


def test_D1_every_allowlisted_name_is_really_read_somewhere():
    """An allowlist entry nobody reads is noise that will drift: each name must appear in app/src or tools/."""
    import subprocess
    unread = []
    for n in sorted(rt.ENV_ALLOWLIST):
        r = subprocess.run(["git", "grep", "-l", "-F", n, "--", "app/src", "tools"], capture_output=True, text=True,
                           cwd=ROOT)
        if not [f for f in r.stdout.split() if f != "tools/remote_tests.py"]:
            unread.append(n)
    assert unread == []


def test_D1_env_reaches_the_tests_only_through_GITHUB_ENV():
    wf = _wf()
    assert wf["jobs"]["plan"]["outputs"]["env"] == "${{ steps.v.outputs.env }}"
    for name in ("pytest", "vitest"):
        steps = wf["jobs"][name]["steps"]
        exp = [s for s in steps if (s.get("env") or {}).get("RT_ENV") == "${{ needs.plan.outputs.env }}"]
        assert len(exp) == 1, name
        assert "set -f" in exp[0]["run"] and '>> "$GITHUB_ENV"' in exp[0]["run"], name
        test_step = next(i for i, s in enumerate(steps) if s.get("id") == "t")
        assert steps.index(exp[0]) < test_step, f"{name}: the variables are exported after the tests ran"
    for name, job in wf["jobs"].items():
        for s in job["steps"]:
            assert "outputs.env" not in (s.get("run") or ""), (name, s.get("name"))


def test_D1_every_test_job_uploads_remote_out():
    for name in ("pytest", "vitest"):
        ups = [s for s in _wf()["jobs"][name]["steps"]
               if str(s.get("uses", "")).startswith("actions/upload-artifact")
               and (s.get("with") or {}).get("path") == "remote-out/"]
        assert len(ups) == 1 and str(ups[0]["with"]["name"]).startswith("remote-out-"), name
        assert ups[0].get("if") == "always()", name


def test_D1_outputs_are_collected_and_never_read_as_junit(tmp_path):
    art = tmp_path / "art"
    (art / "remote-out-vitest-1" / "runtime-on").mkdir(parents=True)
    (art / "remote-out-vitest-1" / "runtime-on" / "verdicts.json").write_text("{}", encoding="utf-8")
    (art / "remote-out-vitest-1" / "runtime-on" / "report.xml").write_text("<not junit", encoding="utf-8")
    dest = tmp_path / "dest"
    got = rt.collect_outputs(art, dest)
    assert got == [dest / "remote-out-vitest-1"]
    assert (dest / "remote-out-vitest-1" / "runtime-on" / "verdicts.json").read_text(encoding="utf-8") == "{}"
    assert rt.failing_tests(art) == [], "a test's own output was parsed as a junit file"


# ---- the GitHub API budget (2026-11-19): the account's 5,000/hour quota hit 0, this tool was the main spender ------
class _FakeGh:
    """Stands in for `gh api`: answers from a script, records what was sent, never touches the network."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []                   # (method, path, headers, body)

    def __call__(self, method, path, headers, body):
        self.calls.append((method, path, dict(headers), body))
        ans = self.answers.pop(0)
        return ans(method, path, headers, body) if callable(ans) else ans


class _Clock:
    def __init__(self, t=1_000_000.0):
        self.t, self.sleeps = t, []

    def now(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


def _api(answers, clock=None):
    clock = clock or _Clock()
    fake = _FakeGh(answers)
    return rt.GitHubApi(runner=fake, sleep=clock.sleep, now=clock.now, log=lambda *_: None), fake, clock


def _ok(body, etag=None, remaining=4000):
    h = {"x-ratelimit-remaining": str(remaining), "x-ratelimit-reset": "1000900"}
    if etag:
        h["etag"] = etag
    return 200, h, json.dumps(body)


def test_api_poll_schedule_backs_off_30_60_90_and_speeds_up_at_the_finish():
    assert [rt.poll_interval(t) for t in (0, 60, 119)] == [30, 30, 30]
    assert [rt.poll_interval(t) for t in (120, 300, 599)] == [60, 60, 60]
    assert [rt.poll_interval(t) for t in (600, 1800, 3600)] == [90, 90, 90]
    assert {rt.poll_interval(t, near_done=True) for t in (0, 300, 3600)} == {15}
    # a 40-minute run costs at most ~32 polls (it was 160 polls x 3 requests at a flat 15 s)
    t, polls = 0.0, 0
    while t < 40 * 60:
        t += rt.poll_interval(t)
        polls += 1
    assert polls <= 32, polls


def test_api_near_done_means_every_unfinished_job_is_past_its_test_step():
    plan = {"name": "plan", "status": "completed", "steps": []}
    running = {"name": "pytest", "status": "in_progress", "steps": [{"name": "pytest", "status": "in_progress"}]}
    uploading = {"name": "pytest", "status": "in_progress",
                 "steps": [{"name": "pytest", "status": "completed"}, {"name": "upload", "status": "in_progress"}]}
    queued = {"name": "vitest (5)", "status": "queued", "steps": []}
    assert not rt.near_done([])
    assert not rt.near_done([plan, running])
    assert rt.near_done([plan, uploading])
    assert not rt.near_done([plan, uploading, queued])
    assert rt.near_done([plan, dict(uploading, status="completed")])


def test_api_parse_include_reads_status_headers_and_body():
    out = 'HTTP/2.0 200 OK\nEtag: W/"abc"\nX-Ratelimit-Remaining: 42\r\n\r\n{"a": 1}'
    assert rt.parse_include(out) == (200, {"etag": 'W/"abc"', "x-ratelimit-remaining": "42"}, '{"a": 1}')
    assert rt.parse_include('HTTP/2.0 304 Not Modified\nEtag: "abc"\n\n')[0] == 304
    assert rt.parse_include("error connecting to api.github.com")[0] == 0


def test_api_a_repeat_poll_is_conditional_and_a_304_is_free():
    api, fake, _ = _api([_ok({"jobs": [1]}, etag='W/"e1"'), (304, {"etag": '"e1"'}, ""),
                         _ok({"jobs": [2]}, etag='W/"e2"')])
    assert api.request("GET", "p", conditional=True) == (200, {"jobs": [1]})
    assert fake.calls[0][2] == {}
    assert api.request("GET", "p", conditional=True) == (200, {"jobs": [1]})      # the cached copy
    assert fake.calls[1][2] == {"If-None-Match": 'W/"e1"'}
    assert api.request("GET", "p", conditional=True) == (200, {"jobs": [2]})
    assert (api.sent, api.not_modified) == (2, 1)


def test_api_a_primary_rate_limit_sleeps_until_the_reset_then_retries():
    limited = (403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000300"},
               '{"message": "API rate limit exceeded for user ID 1."}')
    api, fake, clock = _api([limited, _ok({"status": "completed"})], _Clock(t=1_000_000.0))
    assert api.request("GET", "run") == (200, {"status": "completed"})
    assert clock.sleeps == [305.0], clock.sleeps                                  # reset + 5 s, not a spin
    assert len(fake.calls) == 2 and api.rate_limit_waits == 1


def test_api_429_and_secondary_limits_honour_retry_after_or_wait_a_minute():
    api, _, clock = _api([(429, {"retry-after": "17"}, ""), _ok({})])
    assert api.request("GET", "x")[0] == 200 and clock.sleeps == [17.0]
    secondary = (403, {"x-ratelimit-remaining": "3000"}, '{"message": "You have exceeded a secondary rate limit."}')
    api, _, clock = _api([secondary, _ok({})])
    assert api.request("GET", "x")[0] == 200 and clock.sleeps == [rt.SECONDARY_LIMIT_WAIT_S]


def test_api_a_403_that_is_not_a_rate_limit_is_returned_not_slept_on():
    api, fake, clock = _api([(403, {"x-ratelimit-remaining": "4000"}, '{"message": "Resource not accessible"}')])
    status, data = api.request("GET", "x")
    assert status == 403 and "not accessible" in data["message"] and clock.sleeps == [] and len(fake.calls) == 1


def test_api_a_limit_that_never_lifts_ends_in_an_error_not_a_spin():
    limited = (403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000060"}, "rate limit")
    api, fake, clock = _api([limited] * (rt.RATE_LIMIT_RETRIES + 1))
    with pytest.raises(RuntimeError, match="rate limited"):
        api.request("GET", "x")
    assert len(clock.sleeps) == rt.RATE_LIMIT_RETRIES and all(s >= 5 for s in clock.sleeps)


def test_api_wait_for_budget_sleeps_to_the_reset_only_when_short():
    api, _, clock = _api([])
    api.remaining, api.reset = 3, int(clock.t) + 100
    api.wait_for_budget(10)
    assert clock.sleeps == [105.0]
    api.remaining = 50
    api.wait_for_budget(10)
    assert clock.sleeps == [105.0]


def test_api_dispatch_returns_the_run_in_one_request():
    api, fake, _ = _api([_ok({"workflow_run_id": 77, "html_url": "https://x/runs/77"})])
    assert rt.dispatch(api, {"ref": GOOD_REF}) == ("77", "https://x/runs/77")
    method, path, _, body = fake.calls[0]
    assert method == "POST" and path.endswith(f"/actions/workflows/{rt.WORKFLOW}/dispatches")
    assert body["ref"] == "master" and body["return_run_details"] is True and body["inputs"] == {"ref": GOOD_REF}
    assert len(fake.calls) == 1


def test_api_dispatch_without_run_details_finds_the_run_by_its_ref():
    runs = {"workflow_runs": [{"id": 1, "display_title": "remote tests: other"},
                              {"id": 9, "display_title": f"remote tests: {GOOD_REF}", "html_url": "u9"}]}
    api, fake, clock = _api([(204, {}, ""), _ok({"workflow_runs": []}, etag='"a"'), _ok(runs, etag='"b"')])
    assert rt.dispatch(api, {"ref": GOOD_REF}) == ("9", "u9")
    assert clock.sleeps == [rt.FIND_RUN_POLL_S] and fake.calls[2][2] == {"If-None-Match": '"a"'}


def _job(name, status, conclusion=None, steps=()):
    return {"name": name, "status": status, "conclusion": conclusion, "steps": list(steps)}


def test_api_a_whole_wait_costs_one_request_per_poll():
    """A 20-minute run: one jobs request per poll on the 30/60/90 schedule, the run read once at the end."""
    running = {"jobs": [_job("plan", "completed", "success"),
                        _job("pytest", "in_progress", steps=[{"name": "pytest", "status": "in_progress"}])]}
    finished = {"jobs": [_job("plan", "completed", "success"), _job("pytest", "completed", "success")]}
    clock = _Clock()

    def answer(method, path, headers, body):
        if path.endswith("/jobs?per_page=100"):
            if clock.t - 1_000_000.0 < 20 * 60:
                return (304, {}, "") if headers else _ok(running, etag='"r"')
            return _ok(finished, etag='"f"')
        if clock.t - 1_000_000.0 < 20 * 60:
            return _ok({"status": "in_progress", "conclusion": None})
        return _ok({"status": "completed", "conclusion": "success"}, etag='"run"')

    api, fake, clock = _api([answer] * 100, clock)
    run, jobs = rt.wait_for_run(api, "5", timeout_s=3600, log=lambda *_: None)
    assert run["conclusion"] == "success" and [j["conclusion"] for j in jobs] == ["success", "success"]
    polls = [c for c in fake.calls if c[1].endswith("/jobs?per_page=100")]
    assert len(fake.calls) - len(polls) <= 1 + len(polls) // rt.RUN_CHECK_EVERY   # the run itself, rarely
    assert len(fake.calls) <= 25, len(fake.calls)            # the old loop: 80 polls x 3 requests = 240
    assert api.sent <= 4, (api.sent, api.not_modified)       # every unchanged poll was a free 304
    assert set(clock.sleeps) <= {30, 60, 90}, clock.sleeps


def test_api_wait_for_run_times_out_with_none():
    queued = {"jobs": [_job("plan", "queued")]}
    api, _, _clock = _api([])
    api._runner = lambda m, p, h, b: _ok(queued) if p.endswith("/jobs?per_page=100") else _ok({"status": "queued"})
    assert rt.wait_for_run(api, "5", timeout_s=600, log=lambda *_: None) is None


# ---- a just-dispatched run (2026-11-19, e83 train, run 44506488391) ------------------------------------------------
# GitHub answered 404 for the run the dispatch had just returned; the tool exited 2, deleted its ref and stranded
# the run. A fresh run's 404 is retried for a grace window, and the ref is never deleted under a live run.
_NOT_FOUND = (404, {}, '{"message": "Not Found"}')
_DONE_JOBS = {"jobs": [_job("plan", "completed", "success"), _job("pytest", "completed", "success")]}


def test_fresh_run_a_404_then_200_keeps_waiting():
    def answer(method, path, headers, body):
        if path.endswith("/jobs?per_page=100"):
            return _NOT_FOUND if clock.t - 1_000_000.0 < 40 else _ok(_DONE_JOBS)
        return _ok({"status": "completed", "conclusion": "success"})

    clock = _Clock()
    api, fake, clock = _api([answer] * 20, clock)
    run, jobs = rt.wait_for_run(api, "5", timeout_s=3600, log=lambda *_: None)
    assert run["conclusion"] == "success" and len(jobs) == 2
    assert clock.sleeps[:2] == [rt.POLL_EARLY_S, rt.POLL_EARLY_S]       # retried on the backoff schedule


def test_fresh_run_a_404_past_the_window_is_fatal():
    api, _, clock = _api([_NOT_FOUND] * 20)
    with pytest.raises(RuntimeError, match="HTTP 404"):
        rt.wait_for_run(api, "5", timeout_s=3600, log=lambda *_: None)
    assert clock.t - 1_000_000.0 <= rt.FRESH_RUN_GRACE_S + rt.POLL_EARLY_S   # gave up right after the window


def test_fresh_run_a_404_after_the_run_has_answered_is_fatal_at_once():
    running = {"jobs": [_job("plan", "in_progress")]}
    api, _, clock = _api([_ok(running), _NOT_FOUND])
    with pytest.raises(RuntimeError, match="HTTP 404"):
        rt.wait_for_run(api, "5", timeout_s=3600, log=lambda *_: None)
    assert clock.sleeps == [rt.POLL_EARLY_S]


def _state(dispatched=True, run_id="7", done=False):
    s = rt.RunState()
    s.dispatched, s.run_id, s.done = dispatched, run_id, done
    return s


@pytest.mark.parametrize("cancel_status", [202, 409])                 # 409: the run had already finished
def test_release_ref_cancels_a_live_run_before_deleting_its_ref(cancel_status):
    events = []

    def runner(method, path, headers, body):
        events.append(("api", method, path))
        return cancel_status, {}, ""

    api = rt.GitHubApi(runner=runner, sleep=lambda s: None, now=lambda: 0.0, log=lambda *_: None)
    out = rt.release_ref(api, GOOD_REF, _state(), False, delete=lambda r: events.append(("delete", r)),
                         log=lambda *_: None)
    assert out == "deleted"
    assert events == [("api", "POST", "repos/{owner}/{repo}/actions/runs/7/cancel"), ("delete", GOOD_REF)]


@pytest.mark.parametrize("state,answer", [
    (_state(), (500, {}, "boom")),                                                   # cancel not confirmed
    (_state(), (403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1"}, "rate limit")),   # no sleeping here
    (_state(run_id=None), None),                                                     # the run's id is unknown
])
def test_release_ref_keeps_the_ref_when_the_run_cannot_be_stopped(state, answer):
    deleted, said, sleeps = [], [], []
    api = rt.GitHubApi(runner=lambda *a: answer, sleep=sleeps.append, now=lambda: 0.0, log=lambda *_: None)
    assert rt.release_ref(api, GOOD_REF, state, False, delete=deleted.append, log=said.append) == "kept"
    assert deleted == [] and sleeps == []
    assert f"git push origin :{GOOD_REF}" in said[-1]


@pytest.mark.parametrize("state", [_state(done=True), _state(dispatched=False, run_id=None)])
def test_release_ref_deletes_without_a_cancel_when_no_run_is_live(state):
    deleted, calls = [], []
    api = rt.GitHubApi(runner=lambda *a: calls.append(a), sleep=lambda s: None, now=lambda: 0.0, log=lambda *_: None)
    assert rt.release_ref(api, GOOD_REF, state, False, delete=deleted.append, log=lambda *_: None) == "deleted"
    assert deleted == [GOOD_REF] and calls == []


def test_fresh_run_a_lasting_404_exits_2_with_the_run_cancelled_before_the_ref_is_deleted(monkeypatch):
    """The e83 failure end to end: dispatch answers a run id, every read of it is 404."""
    events, clock, budget = [], _Clock(), [200]

    def runner(method, path, headers, body):
        budget[0] -= 1
        assert budget[0] > 0, "the wait on a 404 never ended"      # a loop must go red, never hang the suite
        if path == "rate_limit":
            return 200, {}, json.dumps({"resources": {"core": {"remaining": 4000, "limit": 5000, "reset": 1}}})
        if path.endswith("/dispatches"):
            return _ok({"workflow_run_id": 7, "html_url": "u7"})
        if path.endswith("/cancel"):
            events.append("cancel")
            return 202, {}, ""
        return _NOT_FOUND

    class _Proc:
        def __init__(self, stdout=""):
            self.stdout, self.stderr, self.returncode = stdout, "", 0

    monkeypatch.setattr(rt.shutil, "which", lambda t: t)
    monkeypatch.setattr(rt, "_run", lambda cmd, check=True, capture=True:
                        _Proc("0123456789abcdef0123\n" if cmd[:2] == ["git", "rev-parse"] else ""))
    real_api = rt.GitHubApi
    monkeypatch.setattr(rt, "GitHubApi",
                        lambda: real_api(runner=runner, sleep=clock.sleep, now=clock.now, log=lambda *_: None))
    monkeypatch.setattr(rt, "_delete_ref", lambda ref: events.append("delete"))
    assert rt.main(["--pytest", "tests/test_a.py"]) == rt.LANE
    assert events == ["cancel", "delete"], events
    assert clock.t - 1_000_000.0 <= rt.FRESH_RUN_GRACE_S + rt.POLL_EARLY_S


# ---- a dispatch answered 5xx (2026-11-19, run 44552655327) ---------------------------------------------------------
# GitHub answered HTTP 500 to the dispatch; the tool exited 2 and abandoned the ref, but the run HAD started and ran
# with nobody watching. A 5xx means the answer failed, not the dispatch: the tool looks for a run on its own ref for
# DISPATCH_5XX_GRACE_S and follows one that appears; with none, it fails and KEEPS the ref (a late run must find it).
_SERVER_ERROR = (500, {}, '{"message": "Server Error"}')


@pytest.mark.parametrize("status", [500, 502, 503])
def test_dispatch_a_5xx_then_a_run_on_our_ref_is_followed(status):
    mine = {"workflow_runs": [{"id": 1, "display_title": "remote tests: someone else's ref"},
                              {"id": 9, "display_title": f"remote tests: {GOOD_REF}", "html_url": "u9"}]}
    api, fake, clock = _api([(status, {}, "oops"), _ok({"workflow_runs": []}, etag='"a"'), _ok(mine, etag='"b"')])
    state = rt.RunState()
    assert rt.dispatch(api, {"ref": GOOD_REF}, state=state) == ("9", "u9")
    assert state.dispatched and state.run_id == "9"
    assert [c[0] for c in fake.calls] == ["POST", "GET", "GET"]                   # one dispatch, never a second
    assert clock.sleeps == [rt.FIND_RUN_POLL_S]


def test_dispatch_a_5xx_and_no_run_fails_after_the_grace_and_keeps_the_ref():
    api, fake, clock = _api([_SERVER_ERROR] + [_ok({"workflow_runs": []})] * 200)
    state = rt.RunState()
    with pytest.raises(RuntimeError, match=r"HTTP 500\) and no run on .* appeared within"):
        rt.dispatch(api, {"ref": GOOD_REF}, state=state)
    assert rt.DISPATCH_5XX_GRACE_S <= clock.t - 1_000_000.0 <= rt.DISPATCH_5XX_GRACE_S + rt.FIND_RUN_POLL_S
    assert sum(1 for c in fake.calls if c[0] == "POST") == 1
    assert state.dispatched and state.run_id is None
    deleted = []
    assert rt.release_ref(api, GOOD_REF, state, False, delete=deleted.append, log=lambda *_: None) == "kept"
    assert deleted == []


@pytest.mark.parametrize("status", [401, 404, 422])
def test_dispatch_a_4xx_is_still_fatal_at_once_and_starts_nothing(status):
    api, fake, clock = _api([(status, {}, '{"message": "no"}')])
    state = rt.RunState()
    with pytest.raises(RuntimeError, match=rf"dispatch failed \(HTTP {status}\)"):
        rt.dispatch(api, {"ref": GOOD_REF}, state=state)
    assert len(fake.calls) == 1 and clock.sleeps == [] and not state.dispatched


def test_a_5xx_dispatch_whose_run_exists_is_waited_on_end_to_end(monkeypatch):
    """Run 44552655327 end to end: the dispatch answers 500, the run is on our ref; main() must wait on THAT run,
    and on the way out cancel it before deleting the ref (here the wait times out, so the run is still live)."""
    events, clock, refs = [], _Clock(), []

    def runner(method, path, headers, body):
        if path == "rate_limit":
            return 200, {}, json.dumps({"resources": {"core": {"remaining": 4000, "limit": 5000, "reset": 1}}})
        if path.endswith("/dispatches"):
            refs.append(body["inputs"]["ref"])
            return _SERVER_ERROR
        if "/runs?event=workflow_dispatch" in path:
            return _ok({"workflow_runs": [{"id": 31, "display_title": f"remote tests: {refs[0]}", "html_url": "u31"}]})
        if path.endswith("/cancel"):
            events.append("cancel 31" if "/runs/31/" in path else f"cancel {path}")
            return 202, {}, ""
        raise AssertionError(f"unexpected request {method} {path}")

    class _Proc:
        def __init__(self, stdout=""):
            self.stdout, self.stderr, self.returncode = stdout, "", 0

    monkeypatch.setattr(rt.shutil, "which", lambda t: t)
    monkeypatch.setattr(rt, "_run", lambda cmd, check=True, capture=True:
                        _Proc("0123456789abcdef0123\n" if cmd[:2] == ["git", "rev-parse"] else ""))
    real_api = rt.GitHubApi
    monkeypatch.setattr(rt, "GitHubApi",
                        lambda: real_api(runner=runner, sleep=clock.sleep, now=clock.now, log=lambda *_: None))
    monkeypatch.setattr(rt, "wait_for_run", lambda api, run_id, timeout_s, log=print: events.append(f"wait {run_id}"))
    monkeypatch.setattr(rt, "_delete_ref", lambda ref: events.append("delete"))
    assert rt.main(["--pytest", "tests/test_a.py"]) == rt.LANE        # the stubbed wait answers "still running"
    assert events == ["wait 31", "cancel 31", "delete"], events


# ---- admission (2026-11-20): wait for CI room before enqueueing -------------------------------------------------------
# 11/20 the 40-job pool was full and master deploy gate jobs waited up to 21.6 min for a runner (a 16 min gate took 44).
# GitHub has no job priority, so the client holds back instead. Plan: docs/superpowers/plans/2026-11-20-remote-tests-admission.md
def _now():
    return rt._epoch("2026-11-21T03:10:00Z")


def _run(i, status, at="2026-11-21T03:00:00Z"):
    return {"id": i, "status": status, "created_at": at}


def test_admission_empty_pool_dispatches():
    assert rt.room_to_dispatch([], {}, [], [], _now()) == (True, "room")


def test_admission_gate_job_waiting_for_a_runner_waits():
    ok, why = rt.room_to_dispatch([_run(9, "in_progress")],
                                  {"9": [{"status": "in_progress"}, {"status": "queued"}]}, [], [], _now())
    assert not ok and "deploy gate run 9" in why and "1 job(s) waiting" in why


def test_admission_gate_running_with_no_job_queued_dispatches():
    assert rt.room_to_dispatch([_run(9, "in_progress")], {"9": [{"status": "in_progress"}]}, [], [], _now())[0]


def test_admission_a_queued_gate_run_waits():
    ok, why = rt.room_to_dispatch([_run(9, "queued")], {}, [], [], _now())
    assert not ok and "is queued" in why


def test_admission_a_pending_gate_run_does_not_wait():
    """`pending` = waiting on the previous gate's `master-deploy` concurrency group, not on a runner."""
    assert rt.room_to_dispatch([_run(9, "pending")], {}, [], [], _now())[0]


def test_admission_a_stale_queued_gate_run_is_ignored():
    """The 11/11 ghost gate run (0 jobs, queued forever, GitHub refuses cancel and delete) must not hold it shut."""
    assert rt.room_to_dispatch([_run(43096652068, "queued", "2026-11-11T20:32:25Z")], {}, [], [], _now())[0]


def test_admission_four_remote_runs_and_a_queued_run_waits():
    remote = [_run(i, "in_progress") for i in range(4)]
    ok, why = rt.room_to_dispatch([], {}, remote, [_run(50, "queued")], _now())
    assert not ok and "4 remote runs in flight" in why


def test_admission_four_remote_runs_and_nothing_queued_dispatches():
    assert rt.room_to_dispatch([], {}, [_run(i, "in_progress") for i in range(4)], [], _now())[0]


def test_admission_three_remote_runs_and_queued_runs_dispatches():
    assert rt.room_to_dispatch([], {}, [_run(i, "queued") for i in range(3)], [_run(50, "queued")], _now())[0]


def test_admission_stale_remote_and_queued_runs_are_ignored():
    old = "2026-11-11T20:32:25Z"
    assert rt.room_to_dispatch([], {}, [_run(i, "queued", old) for i in range(6)], [_run(50, "queued", old)], _now())[0]


_GATE_RUNS = "repos/{owner}/{repo}/actions/workflows/master-deploy-gate.yml/runs?per_page=10"
_REMOTE_RUNS = "repos/{owner}/{repo}/actions/workflows/remote-tests.yml/runs?per_page=50"
_QUEUED_RUNS = "repos/{owner}/{repo}/actions/runs?status=queued&per_page=100"


def _at(clock):
    import time as _t
    return _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime(clock.t))


def test_read_load_sends_the_four_reads_in_order():
    clock = _Clock()
    gate = {"id": 9, "status": "in_progress", "created_at": _at(clock)}
    api, fake, _ = _api([_ok({"workflow_runs": [gate]}), _ok({"jobs": [{"status": "queued"}]}),
                         _ok({"workflow_runs": []}), _ok({"workflow_runs": []})], clock)
    load = rt.read_load(api)
    assert [c[1] for c in fake.calls] == [_GATE_RUNS, "repos/{owner}/{repo}/actions/runs/9/jobs?per_page=100",
                                          _REMOTE_RUNS, _QUEUED_RUNS]
    assert {c[0] for c in fake.calls} == {"GET"} and len(fake.calls) == 4
    assert load.gate_runs == [gate] and load.gate_jobs == {"9": [{"status": "queued"}]}
    assert load.remote_runs == [] and load.queued_runs == []


def test_read_load_skips_jobs_when_no_gate_is_running():
    api, fake, _ = _api([_ok({"workflow_runs": []}), _ok({"workflow_runs": []}), _ok({"workflow_runs": []})])
    assert rt.read_load(api) is not None
    assert len(fake.calls) == 3 and not any("/jobs" in c[1] for c in fake.calls)


@pytest.mark.parametrize("answer", [
    (403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000900"}, "rate limit"),
    (500, {}, ""),
    (0, {}, ""),
    _ok({"unexpected": 1}),
])
def test_read_load_returns_none_on_any_error_and_never_sleeps(answer):
    api, fake, clock = _api([answer])
    assert rt.read_load(api) is None
    assert clock.sleeps == [] and len(fake.calls) == 1


def test_read_load_repeat_check_is_conditional():
    empty = {"workflow_runs": []}
    api, fake, _ = _api([_ok(empty, etag='W/"g"'), _ok(empty, etag='W/"r"'), _ok(empty, etag='W/"q"'),
                         (304, {}, ""), (304, {}, ""), (304, {}, "")])
    assert rt.read_load(api) is not None and rt.read_load(api) is not None
    assert fake.calls[3][2] == {"If-None-Match": 'W/"g"'}
    assert api.not_modified == 3
