"""Rails for .github/workflows/pine-heavy.yml and its tools (2026-11-15).

The workflow moves the heavy, licence-free Pine verification off the dev PC onto parallel runners.
What must stay true, each a test below:

  * it is advisory CI on PRs: no secrets, no pull_request_target, read-only token, never a master push
  * licence-held stores are pinned to empty directories, and every test command runs under the
    no-network wrapper (tools/ci_offline.sh)
  * every job fits the 30-minute budget
  * the master gate's section-8 pytest list is a SUBSET of what the pytest legs run
  * the union rail (tools/ci_vitest_union.py) refuses a missing, a doubled and a stray file, and a
    vacuous expected list
  * the mutant runner (tools/ci_mutant_runner.py) refuses a malformed manifest, and reports a mutant
    that survives
  * (2026-11-16) the derived evidence is checked (`evidence_engine.py queue --check` and `pins --check`,
    offline, the job red when either is) and the coverage ratchet runs on each lane (offline, its exit
    unable to hide a run that measured fewer scripts than the corpus holds); the PR trigger covers every
    path those tools read, DERIVED from the tools' own path constants; both jobs gate the verdict; the
    ratchet's artifacts stay out of the union rail. The two jobs' steps are EXECUTED here with a stub
    wrapper, so "the job fails when X" is a run, not a reading of the YAML.

Standard library + PyYAML.
"""
from __future__ import annotations

import glob
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_mutant_runner as M  # noqa: E402
import ci_vitest_union as U  # noqa: E402
import run_gate_pine_rails as G  # noqa: E402

WF_PATH = ROOT / ".github" / "workflows" / "pine-heavy.yml"
ACTION = ROOT / ".github" / "actions" / "pine-heavy-setup" / "action.yml"


def _wf() -> dict:
    return yaml.safe_load(WF_PATH.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


def _runs(job: dict) -> list[str]:
    return [str(s.get("run") or "") for s in job.get("steps") or []]


# ── trigger and trust ─────────────────────────────────────────────────────────

def test_it_is_pr_and_dispatch_only_with_no_secrets_and_a_read_only_token():
    text = WF_PATH.read_text(encoding="utf-8")
    on = _on(_wf())
    assert set(on) == {"pull_request", "workflow_dispatch"}, sorted(on)
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
    assert "pull_request_target" not in code
    assert "secrets." not in text and "secrets." not in ACTION.read_text(encoding="utf-8")
    assert _wf()["permissions"] == {"contents": "read"}
    assert text.splitlines()[0].startswith("# promotion-gate: no")


def test_the_pr_trigger_covers_the_heavy_paths():
    paths = _on(_wf())["pull_request"]["paths"]
    for p in ("app/src/components/chart/engine/**", "api/services/ast_*.py", "services/pine_runtime/**",
              "tests/fixtures/vendor/**", "tools/vendor_harness/**", ".github/workflows/pine-heavy.yml",
              ".github/actions/pine-heavy-setup/**"):
        assert p in paths, p


def test_every_job_fits_the_30_minute_budget():
    for name, job in _wf()["jobs"].items():
        t = job.get("timeout-minutes")
        assert isinstance(t, int) and 0 < t <= 30, f"{name}: timeout-minutes={t!r}"


# ── committed fixtures only ───────────────────────────────────────────────────

def test_the_licence_held_stores_are_pinned_and_checked_empty():
    env = _wf()["env"]
    for v in ("UCT_VENDOR_CAPTURE_STORE", "UCT_HARNESS_SUPPLY_STORE"):
        assert str(env.get(v, "")).startswith("/tmp/"), v
    action = ACTION.read_text(encoding="utf-8")
    for v in ("UCT_VENDOR_CAPTURE_STORE", "UCT_HARNESS_SUPPLY_STORE", "PINE_LIBRARY_STORE", "LOCALAPPDATA"):
        assert v in action, v
    assert "is not empty" in action and "ci_offline.sh\" --self-check" in action


def test_every_test_command_runs_offline():
    """Each step that runs vitest, pytest or the mutant runner goes through ci_offline.sh. (`vitest list
    --filesOnly` globs files and executes none, so it is exempt.)"""
    bad = []
    for name, job in _wf()["jobs"].items():
        if job.get("uses"):
            continue
        steps = job.get("steps") or []
        if any(str(s.get("uses", "")).endswith("pine-heavy-setup") for s in steps) is False and name not in ("rails", "verdict"):
            bad.append(f"{name}: no pine-heavy-setup step")
        for run in _runs(job):
            for line in run.splitlines():
                m = re.search(r"vitest run|-m pytest|ci_mutant_runner|evidence_engine\.py|coverage_ratchet\.py", line)
                # (a command named inside an `echo`'d hint is prose, not a run)
                if m and "echo " not in line[:m.start()] and name != "rails" and "ci_offline.sh" not in line:
                    bad.append(f"{name}: {line.strip()}")
    assert not bad, "test commands outside the no-network wrapper:\n" + "\n".join(bad)


def test_the_wrapper_unshares_the_network_and_drops_root():
    sh = (ROOT / "tools" / "ci_offline.sh").read_text(encoding="utf-8")
    assert "unshare --net" in sh and "setpriv --reuid" in sh and "ip link set lo up" in sh
    # the self-check has a control (egress works WITHOUT the wrapper), or it could pass on a dead runner
    assert "INCONCLUSIVE" in sh


# ── the section-8 list ⊆ the pytest legs ──────────────────────────────────────

def test_the_gates_section8_pytest_list_is_inside_the_pytest_legs():
    legs = _wf()["jobs"]["pytest"]["strategy"]["matrix"]["include"]
    covered = set()
    for leg in legs:
        for pat in leg["tests"].split():
            covered |= {pathlib.Path(p).as_posix() for p in glob.glob(str(ROOT / pat))}
    section8 = [a for c in G.gate_commands() for a in c if a.startswith("tests/") and a.endswith(".py")]
    assert len(section8) >= 10, section8                       # non-vacuity: the gate list was read
    missing = [f for f in section8 if (ROOT / f).as_posix() not in covered]
    assert not missing, f"section-8 rails no pytest leg runs: {missing}"


# ── the union rail ────────────────────────────────────────────────────────────

def _report(tmp, name, files, failed=0):
    d = tmp / "shards"
    d.mkdir(exist_ok=True)
    (d / f"{name}.json").write_text(json.dumps({
        "numFailedTests": failed, "testResults": [{"name": f"/w/app/{f}"} for f in files]}), encoding="utf-8")
    return d


def test_union_passes_an_exact_partition(tmp_path):
    d = _report(tmp_path, "a", ["src/x.test.js"])
    _report(tmp_path, "b", ["src/y.test.js"])
    ran = U.ran_by_report(d, pathlib.Path("/w/app"))
    assert U.judge(["src/x.test.js", "src/y.test.js"], ran, 2, ["src/x.test.js"]) == []


def test_union_refuses_a_missing_a_doubled_and_a_stray_file(tmp_path):
    d = _report(tmp_path, "a", ["src/x.test.js", "src/stray.test.js"])
    _report(tmp_path, "b", ["src/x.test.js"])
    problems = U.judge(["src/x.test.js", "src/y.test.js"], U.ran_by_report(d, pathlib.Path("/w/app")), 1, [])
    text = "\n".join(problems)
    assert "no shard ran: src/y.test.js" in text
    assert "ran by 2 shards" in text and "src/x.test.js" in text
    assert "ran but not in the expected list: src/stray.test.js" in text


def test_union_refuses_a_vacuous_expected_list(tmp_path):
    d = _report(tmp_path, "a", [])
    problems = U.judge([], U.ran_by_report(d, pathlib.Path("/w/app")), 1000, ["src/must.test.js"])
    assert any("under the floor" in p for p in problems)
    assert any("missing a named member" in p for p in problems)


def test_union_cli_exit_codes(tmp_path):
    root = str(tmp_path / "app")
    d = tmp_path / "shards"
    d.mkdir()
    (d / "a.json").write_text(json.dumps({"testResults": [{"name": f"{root}/src/x.test.js"}]}), encoding="utf-8")
    exp = tmp_path / "exp.txt"
    exp.write_text("src/x.test.js\n", encoding="utf-8")
    assert U.main(["--expected", str(exp), "--reports", str(d), "--root", root]) == 0
    exp.write_text("src/x.test.js\nsrc/y.test.js\n", encoding="utf-8")
    assert U.main(["--expected", str(exp), "--reports", str(d), "--root", root]) == 1
    assert U.main(["--expected", str(exp), "--reports", str(tmp_path / "none"), "--root", root]) == 2


# ── the mutant runner ─────────────────────────────────────────────────────────

def _repo(tmp):
    (tmp / "impl.py").write_text("LIMIT = 3\n", encoding="utf-8")
    return tmp


def test_mutant_manifest_validation(tmp_path):
    root = _repo(tmp_path)
    good = {"schema": M.SCHEMA, "mutants": [{"id": "M1", "mutant": "m", "file": "impl.py", "from": "LIMIT = 3",
                                             "to": "LIMIT = 4", "rail": "true"}]}
    assert M.validate(good, root) == []
    assert M.validate({"schema": "other"}, root)
    absent = json.loads(json.dumps(good))
    absent["mutants"][0]["from"] = "LIMIT = 9"
    assert any("occurs 0 times" in p for p in M.validate(absent, root))
    outside = json.loads(json.dumps(good))
    outside["mutants"][0]["file"] = "../escape.py"
    assert any("not a file inside the repo" in p for p in M.validate(outside, root))
    same = json.loads(json.dumps(good))
    same["mutants"][0]["to"] = "LIMIT = 3"
    assert any("nothing is mutated" in p for p in M.validate(same, root))


def test_the_mutant_job_names_the_workspace_as_the_repo():
    """pine-heavy runs the runner from a sparse tools checkout ($CI_TOOLS); without --repo every
    manifest file under app/ read "not a file inside the repo" (run 43830888172, 62 of 62)."""
    line = next(l for l in WF_PATH.read_text(encoding="utf-8").splitlines() if "ci_mutant_runner.py" in l and "run:" in l)
    assert '--repo "$GITHUB_WORKSPACE"' in line, line


def test_the_runner_reads_the_manifest_against_the_named_repo(tmp_path):
    other = tmp_path / "work"
    other.mkdir()
    (other / "impl.py").write_text("LIMIT = 3" + chr(10), encoding="utf-8")
    man = tmp_path / "m.json"
    man.write_text(json.dumps({"schema": M.SCHEMA, "mutants": [{"id": "A", "mutant": "a", "file": "impl.py",
                                                              "from": "LIMIT = 9", "to": "LIMIT = 4", "rail": "true"}]}),
                   encoding="utf-8")
    # resolved against --repo: the file IS found there (so the complaint is about `from`, not the path) ...
    assert M.main(["--manifest", str(man), "--out", str(tmp_path / "o.json"), "--repo", str(other)]) == 2
    assert any("occurs 0 times" in p for p in M.validate(json.loads(man.read_text(encoding="utf-8")), other))
    # ... and against the tool's own repo it is not a file at all
    assert any("not a file inside the repo" in p for p in M.validate(json.loads(man.read_text(encoding="utf-8")), M.ROOT))
    assert M.main(["--manifest", str(man), "--out", str(tmp_path / "o.json"), "--repo", str(tmp_path / "nope")]) == 2


def test_mutant_runner_kills_restores_and_reports_a_survivor(tmp_path, monkeypatch):
    root = _repo(tmp_path)
    rail = f'"{sys.executable}" -c "import sys; sys.exit(0 if open(\'impl.py\').read() == \'LIMIT = 3\\n\' else 1)"'
    killed = M.run_one({"id": "K", "mutant": "k", "file": "impl.py", "from": "LIMIT = 3", "to": "LIMIT = 4", "rail": rail}, root)
    assert killed["killed"] and killed["restoredByteEqual"] and killed["greenAfterRestore"] and killed["rc"] == 0
    assert (root / "impl.py").read_text(encoding="utf-8") == "LIMIT = 3\n"
    survivor = M.run_one({"id": "S", "mutant": "s", "file": "impl.py", "from": "LIMIT = 3", "to": "LIMIT = 4",
                          "rail": f'"{sys.executable}" -c "pass"'}, root)
    assert not survivor["killed"] and survivor["rc"] != 0
    assert (root / "impl.py").read_text(encoding="utf-8") == "LIMIT = 3\n"


# ── the derived evidence and the coverage ratchet (2026-11-16) ────────────────
# ⚰️ The docs-only #1435 changed coverage-map.json; capture-queue.json (derived from it) went stale on
# master and no check noticed: nothing ran `queue --check` and this workflow did not trigger on the
# paths that feed it. And a script that transferred could stop transferring with every check green.

def _glob_rx(g: str):
    """A GitHub `paths` filter pattern as a regex: `**` crosses `/`, `*` and `?` do not."""
    out, i = "", 0
    while i < len(g):
        if g.startswith("**", i):
            out, i = out + ".*", i + 2
        elif g[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif g[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(g[i]), i + 1
    return re.compile(out + r"\Z")


def _rel(p) -> str:
    return pathlib.Path(p).resolve().relative_to(ROOT).as_posix()


def _inputs_the_new_jobs_read() -> list[str]:
    """Every path `evidence_engine.py queue` / `pins` and the coverage ratchet read, from the tools' OWN
    constants (never a list typed here: a moved input must move this rail)."""
    sys.path.insert(0, str(ROOT / "tools" / "vendor_harness"))
    sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))
    import coverage_ratchet as R  # noqa: E402
    import evidence_engine as E  # noqa: E402
    import corpus_licence  # noqa: E402  (tools/pine_survey, put on sys.path by evidence_engine)
    out = [_rel(E.DOCS / "capture-queue-2099-01-01-any.md"), _rel(E.COVERAGE), _rel(E.LEDGER), _rel(E.QUEUE_OUT),
           _rel(E.CORPUS / "committed" / "any.pine"), _rel(E.FIXTURE_ROOT / "harness" / "any.json"),
           _rel(E.PINS_SRC), _rel(E.PINS_OUT), _rel(E.STRATEGY_VERDICTS_DIR / "any.json"), _rel(E.STRATEGY_CAPTURE_MJS),
           _rel(corpus_licence.__file__), _rel(E.__file__)]
    out += [_rel(pathlib.Path(d) / "any.pine") for d in E.PROBE_DIRS]
    out += [_rel(R.SNAPSHOT), _rel(pathlib.Path(R.CORPUS) / "any.pine"), _rel(R.CORPUS_INDEX), _rel(R.__file__),
            _rel(R.RC.__file__), _rel(R.CM.__file__), _rel(pathlib.Path(R.RC.APP) / R.RC.CENSUS),
            _rel(sys.modules[R.CM.usage_of.__module__].__file__),   # api/services/pine_capabilities.py
            "app/src/components/chart/builder/memberPane/memberPaneDefinition.js",   # the member door the census asks
            "tools/pine_coverage/runtime_lane.mjs", "tools/pine_coverage/census_peel.mjs"]   # the census imports them
    return out


def test_the_pr_trigger_covers_every_path_the_derived_checks_and_the_ratchet_read():
    rxs = [_glob_rx(p) for p in _on(_wf())["pull_request"]["paths"]]
    inputs = _inputs_the_new_jobs_read()
    assert len(inputs) >= 20, inputs                               # non-vacuity: the constants were read
    missing = [p for p in inputs if not any(rx.match(p) for rx in rxs)]
    assert not missing, f"paths the derived checks / the ratchet read that do not trigger pine-heavy: {missing}"


def test_the_glob_reading_can_tell_a_covered_path_from_an_uncovered_one():
    """Control for the rail above: `*` does not cross a directory, `**` does."""
    assert _glob_rx("docs/pine/capture-queue-*.md").match("docs/pine/capture-queue-2026-11-16-x.md")
    assert not _glob_rx("docs/pine/capture-queue-*.md").match("docs/pine/sub/capture-queue-x.md")
    assert _glob_rx("corpus/**").match("corpus/committed/a.pine")
    assert not _glob_rx("tools/pine_survey/corpus_licence.py").match("tools/pine_survey/other.py")


def test_the_new_jobs_gate_the_verdict_and_fit_the_budget():
    jobs = _wf()["jobs"]
    for name in ("derived-evidence", "coverage-ratchet"):
        assert name in jobs, name
        assert name in jobs["verdict"]["needs"], name
        assert f"needs.{name}.result" in _runs(jobs["verdict"])[0].split("for r in", 1)[1], \
            f"{name} is not in the verdict's every-leg-passed loop"
        assert 0 < jobs[name]["timeout-minutes"] <= 30
        assert "continue-on-error" not in json.dumps(jobs[name])
    assert sorted(jobs["coverage-ratchet"]["strategy"]["matrix"]["lane"]) == ["production", "runtime-on"]


def test_the_ratchet_artifacts_stay_out_of_the_union_rail():
    """The ratchet's vitest run is a measurement, not a leg: an artifact matching the union job's download
    patterns would put the census file in the union twice (or a verdicts file where a lane's belongs)."""
    jobs = _wf()["jobs"]
    patterns = [s["with"]["pattern"] for s in jobs["union"]["steps"] if "download-artifact" in str(s.get("uses"))]
    assert patterns, "the union job downloads nothing"
    names = [str(s["with"]["name"]) for s in jobs["coverage-ratchet"]["steps"] if "upload-artifact" in str(s.get("uses"))]
    assert names == ["pine-coverage-ratchet-${{ matrix.lane }}"], names
    for n in names:
        for lane in ("production", "runtime-on"):
            got = n.replace("${{ matrix.lane }}", lane)
            assert not any(_glob_rx(p).match(got) for p in patterns), (got, patterns)


# ── the two steps, EXECUTED with a stub wrapper ───────────────────────────────

STUB_WRAPPER = r"""#!/usr/bin/env bash
# a stand-in for tools/ci_offline.sh: answers each tool by name, from the environment
case " $* " in
  *" queue --check "*) exit "${Q_RC:-0}" ;;
  *" pins --check "*) exit "${P_RC:-0}" ;;
esac
out=""; prev=""
for a in "$@"; do if [ "$prev" = "--out" ]; then out="$a"; fi; prev="$a"; done
if [ -n "$out" ]; then
  mkdir -p "$out"
  if [ -n "${RESULT:-}" ]; then printf '%s' "$RESULT" > "$out/ratchet-result.json"; fi
  exit "${TOOL_RC:-0}"
fi
echo "stub wrapper: unexpected command: $*" >&2
exit 97
"""


def _step_run(job: str, needle: str) -> str:
    runs = [r for r in _runs(_wf()["jobs"][job]) if needle in r]
    assert len(runs) == 1, (job, needle, len(runs))
    return runs[0]


def _execute(tmp_path, run: str, **env) -> int:
    """Run a workflow step's script under bash with the stub wrapper and a `python3` that is this Python."""
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("no bash on this machine (the CI rails job has one)")
    ci = tmp_path / "ci" / "tools"
    ci.mkdir(parents=True)
    (ci / "ci_offline.sh").write_text(STUB_WRAPPER, encoding="utf-8", newline="\n")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    shim = bindir / "python3"
    shim.write_text('#!/usr/bin/env bash\nexec "%s" "$@"\n' % sys.executable.replace("\\", "/"), encoding="utf-8",
                    newline="\n")
    os.chmod(shim, 0o755)
    script = tmp_path / "step.sh"
    script.write_text(run, encoding="utf-8", newline="\n")
    full = dict(os.environ, CI_TOOLS=str(tmp_path / "ci"), GITHUB_STEP_SUMMARY=str(tmp_path / "summary.md"),
                PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""), **{k: str(v) for k, v in env.items()})
    work = tmp_path / "work"
    work.mkdir()
    return subprocess.run([bash, str(script)], cwd=str(work), env=full, capture_output=True, text=True).returncode


@pytest.mark.parametrize("q,p,ok", [(0, 0, True), (1, 0, False), (0, 1, False), (1, 1, False)])
def test_the_derived_evidence_step_fails_when_either_check_does(tmp_path, q, p, ok):
    run = _step_run("derived-evidence", "queue --check")
    assert "pins --check" in run
    rc = _execute(tmp_path, run, Q_RC=q, P_RC=p)
    assert (rc == 0) is ok, f"queue rc {q}, pins rc {p}: step exit {rc}"


def _result(verdict, measured, expected=266):
    return json.dumps({"verdict": verdict, "measured": measured, "expected": expected})


@pytest.mark.parametrize("tool_rc,result,want", [
    (0, _result("PASS", 266), 0),          # the control: a whole PASS passes
    (1, _result("LOST", 266), 1),          # a lost script fails with the tool's own code
    (2, _result("REFUSED", 12), 2),        # a refusal fails with the tool's own code
    (0, _result("PASS", 200), "red"),      # ⛔ exit 0, but it measured fewer scripts than the corpus holds
    (0, _result("PASS", 0, 0), "red"),     # ⛔ exit 0 over an empty corpus
    (0, "", "red"),                        # ⛔ exit 0 and no result at all
])
def test_the_ratchet_step_cannot_pass_on_an_undermeasured_run(tmp_path, tool_rc, result, want):
    run = _step_run("coverage-ratchet", "coverage_ratchet.py")
    rc = _execute(tmp_path, run, LANE="production", TOOL_RC=tool_rc, RESULT=result)
    if want == "red":
        assert rc != 0, "the ratchet step passed a run its result says did not measure the whole corpus"
    else:
        assert rc == want, f"step exit {rc}, wanted {want}"


def test_the_ratchet_step_runs_the_lane_it_is_named_for():
    run = _step_run("coverage-ratchet", "coverage_ratchet.py")
    line = next(l for l in run.splitlines() if "coverage_ratchet.py" in l)
    assert '--lane "$LANE"' in line and "ci_offline.sh" in line and '--out "$out"' in line, line
    step = next(s for s in _wf()["jobs"]["coverage-ratchet"]["steps"] if "coverage_ratchet.py" in str(s.get("run")))
    assert step["env"]["LANE"] == "${{ matrix.lane }}"
