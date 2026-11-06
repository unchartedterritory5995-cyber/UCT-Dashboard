"""tools/ci_equivalence.py must be able to say no. Synthetic fixtures only; no network, no real run data."""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import ci_equivalence as ce  # noqa: E402

SHA = "a" * 40


def vitest(tests=None, root="/home/runner/work/UCT-Dashboard/UCT-Dashboard"):
    tests = tests if tests is not None else {"src/agent/a.test.js": {"one": "passed", "two": "passed"},
                                             "src/agent/b.test.js": {"three": "passed", "four": "pending"}}
    flat = [s for f in tests.values() for s in f.values()]
    return {"numTotalTests": len(flat),
            "numPassedTests": flat.count("passed"),
            "numFailedTests": flat.count("failed"),
            "numPendingTests": flat.count("pending"),
            "numTodoTests": flat.count("todo"),
            "numFailedTestSuites": sum(1 for f in tests.values() if "failed" in f.values()),
            "testResults": [{"name": f"{root}/app/{path}", "status": "passed",
                             "assertionResults": [{"fullName": n, "status": s} for n, s in cases.items()]}
                            for path, cases in tests.items()]}


def job(name="shard", conclusion="success", steps=(("Run tests", "success"),), sha=SHA, runner="GitHub Actions 1"):
    return {"name": name, "status": "completed", "conclusion": conclusion, "head_sha": sha, "runner_name": runner,
            "labels": ["ubuntu-latest"], "started_at": "2026-11-06T00:00:00Z",
            "steps": [{"name": n, "conclusion": c} for n, c in steps]}


def write(tmp_path, side, files):
    d = tmp_path / side
    d.mkdir()
    for name, content in files.items():
        (d / name).write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
    return d


def verdict(tmp_path, a, b, sha_a=SHA, sha_b=SHA, **kw):
    return ce.compare(ce.read_dir(write(tmp_path, "a", a)), ce.read_dir(write(tmp_path, "b", b)),
                      sha_a=sha_a, sha_b=sha_b, **kw)


def test_identical_runs_are_equivalent_across_different_checkout_paths(tmp_path):
    out = verdict(tmp_path, {"s.json": vitest()}, {"s.json": vitest(root="/home/runner/_work/x/x")})
    assert out["verdict"] == ce.EQUIVALENT, out
    assert out["compared"] == ["vitest_json"]


def test_shards_are_summed_so_a_different_split_still_matches(tmp_path):
    whole = vitest()
    one = vitest({"src/agent/a.test.js": {"one": "passed", "two": "passed"}})
    two = vitest({"src/agent/b.test.js": {"three": "passed", "four": "pending"}})
    out = verdict(tmp_path, {"all.json": whole}, {"s1.json": one, "s2.json": two})
    assert out["verdict"] == ce.EQUIVALENT, out


# ---- the deliberately different pairs: each one is a way a self-hosted run could look fine and not be

@pytest.mark.parametrize("label,other,fragment", [
    ("a test fails", {"src/agent/a.test.js": {"one": "failed", "two": "passed"},
                      "src/agent/b.test.js": {"three": "passed", "four": "pending"}}, "vitest failed"),
    ("a test silently skips", {"src/agent/a.test.js": {"one": "pending", "two": "passed"},
                               "src/agent/b.test.js": {"three": "passed", "four": "pending"}}, "vitest skipped"),
    ("a file never ran", {"src/agent/a.test.js": {"one": "passed", "two": "passed"}}, "only in A"),
    ("an extra file ran", {"src/agent/a.test.js": {"one": "passed", "two": "passed"},
                           "src/agent/b.test.js": {"three": "passed", "four": "pending"},
                           "src/agent/c.test.js": {"five": "passed"}}, "only in B"),
])
def test_a_different_vitest_run_is_refused(tmp_path, label, other, fragment):
    out = verdict(tmp_path, {"s.json": vitest()}, {"s.json": vitest(other)})
    assert out["verdict"] == ce.DIFFERENT, (label, out)
    assert any(fragment in r for r in out["reasons"]), out["reasons"]


def test_equal_counts_with_swapped_outcomes_are_refused(tmp_path):
    """The counts match exactly and the runs are not the same: only the per-test comparison sees it."""
    a = vitest({"src/agent/a.test.js": {"one": "passed", "two": "failed"}})
    b = vitest({"src/agent/a.test.js": {"one": "failed", "two": "passed"}})
    out = verdict(tmp_path, {"s.json": a}, {"s.json": b})
    assert out["verdict"] == ce.DIFFERENT
    assert any("changed outcome" in r for r in out["reasons"]), out["reasons"]


def test_equal_counts_with_renamed_tests_are_refused(tmp_path):
    a = vitest({"src/agent/a.test.js": {"one": "passed"}})
    b = vitest({"src/agent/a.test.js": {"other": "passed"}})
    assert verdict(tmp_path, {"s.json": a}, {"s.json": b})["verdict"] == ce.DIFFERENT


def test_both_sides_failing_alike_is_equivalent_but_never_reads_as_green(tmp_path):
    bad = vitest({"src/agent/a.test.js": {"one": "failed"}})
    out = verdict(tmp_path, {"s.json": bad}, {"s.json": bad})
    assert out["verdict"] == ce.EQUIVALENT
    assert any("does not mean green" in n for n in out["notes"]), out["notes"]


# ---- evidence that cannot answer: never a pass, and never quietly a smaller match

def test_different_commits_cannot_be_compared(tmp_path):
    out = verdict(tmp_path, {"s.json": vitest()}, {"s.json": vitest()}, sha_b="b" * 40)
    assert out["verdict"] == ce.INCOMPARABLE


def test_an_unknown_commit_cannot_be_compared(tmp_path):
    out = verdict(tmp_path, {"s.json": vitest()}, {"s.json": vitest()}, sha_a=None, sha_b=None)
    assert out["verdict"] == ce.INCOMPARABLE


def test_job_data_supplies_and_can_contradict_the_commit(tmp_path):
    a = {"jobs.json": {"jobs": [job()]}}
    b = {"jobs.json": {"jobs": [job(sha="c" * 40)]}}
    assert verdict(tmp_path, a, b, sha_a=None, sha_b=None)["verdict"] == ce.INCOMPARABLE


def test_an_empty_side_is_not_a_match(tmp_path):
    assert verdict(tmp_path, {"s.json": vitest()}, {})["verdict"] == ce.INCOMPARABLE


def test_a_truncated_report_is_not_a_smaller_report(tmp_path):
    good = json.dumps(vitest())
    out = verdict(tmp_path, {"s.json": good}, {"s.json": good[: len(good) // 2]})
    assert out["verdict"] == ce.INCOMPARABLE
    assert any("unreadable" in r for r in out["reasons"]), out["reasons"]


def test_no_shared_result_kind_is_not_a_match(tmp_path):
    out = verdict(tmp_path, {"s.json": vitest()}, {"p.log": "12 passed in 3.00s\n"})
    assert out["verdict"] == ce.INCOMPARABLE


def test_a_required_kind_missing_from_one_side_refuses(tmp_path):
    a = {"s.json": vitest(), "p.log": "12 passed in 3.00s\n"}
    b = {"s.json": vitest()}
    assert verdict(tmp_path, a, b)["verdict"] == ce.EQUIVALENT      # reported, not compared
    a2 = {"s.json": vitest(), "p.log": "12 passed in 3.00s\n"}
    (tmp_path / "second").mkdir()
    out = ce.compare(ce.read_dir(write(tmp_path / "second", "a", a2)), ce.read_dir(write(tmp_path / "second", "b", b)),
                     sha_a=SHA, sha_b=SHA, kinds=["pytest_log"])
    assert out["verdict"] == ce.INCOMPARABLE


# ---- pytest logs, vitest logs, JUnit, job data

def test_pytest_totals_sum_every_run_in_a_job_log_and_ignore_timing(tmp_path):
    a = "2026-11-06T00:00:00Z 6 passed, 2 warnings in 1.18s\n2026-11-06T00:01:00Z 3654 passed, 23 warnings in 120.57s (0:02:00)\n"
    b = "6 passed, 9 warnings in 9.99s\n3654 passed in 300.00s (0:05:00)\n"
    out = verdict(tmp_path, {"g.log": a}, {"g.log": b})
    assert out["verdict"] == ce.EQUIVALENT, out


@pytest.mark.parametrize("b", ["3650 passed, 4 skipped in 1.00s\n", "3653 passed, 1 failed in 1.00s\n",
                               "3653 passed, 1 error in 1.00s\n"])
def test_pytest_differences_are_refused(tmp_path, b):
    assert verdict(tmp_path, {"g.log": "3654 passed in 1.00s\n"}, {"g.log": b})["verdict"] == ce.DIFFERENT


def test_a_vitest_log_is_read_through_ansi_colour(tmp_path):
    coloured = ("\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m15 passed\x1b[39m\x1b[22m\x1b[90m (15)\x1b[39m\n"
                "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m3535 passed\x1b[39m\x1b[22m\x1b[90m (3535)\x1b[39m\n")
    plain = "  Test Files  15 passed (15)\n       Tests  3535 passed (3535)\n"
    assert verdict(tmp_path, {"r.log": coloured}, {"r.log": plain})["verdict"] == ce.EQUIVALENT
    short = "  Test Files  15 passed (15)\n       Tests  3534 passed | 1 skipped (3535)\n"
    (tmp_path / "x").mkdir()
    out = ce.compare(ce.read_dir(write(tmp_path / "x", "a", {"r.log": plain})),
                     ce.read_dir(write(tmp_path / "x", "b", {"r.log": short})), sha_a=SHA, sha_b=SHA)
    assert out["verdict"] == ce.DIFFERENT, out


def junit(*cases):
    body = "".join(f'<testcase classname="t" name="{n}">{inner}</testcase>' for n, inner in cases)
    return f"<testsuites><testsuite>{body}</testsuite></testsuites>"


def test_junit_catches_a_changed_outcome(tmp_path):
    good = junit(("a", ""), ("b", "<skipped/>"))
    bad = junit(("a", "<failure/>"), ("b", "<skipped/>"))
    out = verdict(tmp_path, {"j.xml": good}, {"j.xml": bad})
    assert out["verdict"] == ce.DIFFERENT, out
    assert any("junit failed" in r for r in out["reasons"]), out["reasons"]


def test_job_data_ignores_runner_identity(tmp_path):
    a = {"jobs.json": {"jobs": [job()]}}
    b = {"jobs.json": {"jobs": [job(runner="uct-ci-1-abcd")]}}
    assert verdict(tmp_path, a, b, sha_a=None, sha_b=None)["verdict"] == ce.EQUIVALENT


def test_a_shadow_job_matches_its_deciding_job_by_its_own_name(tmp_path):
    a = {"jobs.json": {"jobs": [job(name="rails")]}}
    b = {"jobs.json": {"jobs": [job(name="wisdom / rails", runner="uct-ci-1-abcd")]}}
    assert verdict(tmp_path, a, b, sha_a=None, sha_b=None)["verdict"] == ce.EQUIVALENT


@pytest.mark.parametrize("label,other", [
    ("cancelled job", job(conclusion="cancelled")),
    ("skipped job", job(conclusion="skipped")),
    ("step dropped", job(steps=())),
    ("step failed", job(steps=(("Run tests", "failure"),))),
    ("renamed job", job(name="other")),
])
def test_job_differences_are_refused(tmp_path, label, other):
    out = verdict(tmp_path, {"jobs.json": {"jobs": [job()]}}, {"jobs.json": {"jobs": [other]}}, sha_a=None, sha_b=None)
    assert out["verdict"] == ce.DIFFERENT, (label, out)


def test_the_cli_exit_codes_distinguish_all_three_answers(tmp_path, capsys):
    a = write(tmp_path, "a", {"s.json": vitest()})
    b = write(tmp_path, "b", {"s.json": vitest({"src/agent/a.test.js": {"one": "failed"}})})
    c = write(tmp_path, "c", {"s.json": vitest()})
    assert ce.main(["--a", str(a), "--b", str(c), "--sha-a", SHA, "--sha-b", SHA]) == 0
    assert ce.main(["--a", str(a), "--b", str(b), "--sha-a", SHA, "--sha-b", SHA]) == 1
    assert ce.main(["--a", str(a), "--b", str(c)]) == 2
    assert "INCOMPARABLE" in capsys.readouterr().out


def test_the_self_check_passes():
    assert ce.main(["--self-check"]) == 0
