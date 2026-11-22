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
  * (2026-11-16) only the legs that run a test reading an OLDER commit fetch the full history (62 s of
    checkout against 28 s, on every job of a workflow that was half of all runner minutes); the files
    that read history are DERIVED from the test sources and their importers, never listed
  * (2026-11-16) `skip_legs` runs the mutant job alone, and the verdict then needs every leg `skipped`
    AND the mutant job passed: it is never a way to a green run with nothing run (the step is EXECUTED)

Standard library + PyYAML.
"""
from __future__ import annotations

import ast
import functools
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

def _leg_files(doc: dict | None = None, root: pathlib.Path = ROOT) -> dict[str, set[str]]:
    """{leg: {absolute posix path, ...}} -- what each pytest leg RUNS: a `tests:` leg its globs, a `census:` leg the
    shard tools/pine_test_census.py hands it (the step runs that tool; the files are what CI runs, so they come
    from it here too)."""
    if doc is None and root == ROOT and _LEG_FILES:
        return {k: set(v) for k, v in _LEG_FILES.items()}
    import pine_test_census as C  # noqa: E402  (tools/, on sys.path above)
    out: dict[str, set[str]] = {}
    for leg in (doc or _wf())["jobs"]["pytest"]["strategy"]["matrix"]["include"]:
        files: set[str] = set()
        for pat in str(leg.get("tests") or "").split():
            files |= {pathlib.Path(p).as_posix() for p in glob.glob(str(root / pat))}
        if leg.get("census"):
            k, n = C.parse_shard(leg["census"])
            shard = C.plan(C.census(root), n, C.recorded_ms(root))[k - 1]
            files |= {(root / f).as_posix() for f in shard}
        out[leg["leg"]] = files
    if doc is None and root == ROOT:
        _LEG_FILES.update({k: set(v) for k, v in out.items()})
    return out


#: the real workflow's legs, read once per session (the census scan reads every test file)
_LEG_FILES: dict[str, set[str]] = {}


def _covered(doc: dict | None = None, root: pathlib.Path = ROOT) -> set[str]:
    return set().union(*_leg_files(doc, root).values())


def test_the_gates_section8_pytest_list_is_inside_the_pytest_legs():
    covered = _covered()
    section8 = [a for c in G.gate_commands() for a in c if a.startswith("tests/") and a.endswith(".py")]
    assert len(section8) >= 10, section8                       # non-vacuity: the gate list was read
    missing = [f for f in section8 if (ROOT / f).as_posix() not in covered]
    assert not missing, f"section-8 rails no pytest leg runs: {missing}"


def test_the_pine_twins_leg_runs_the_w9_probe_rail():
    """#1554 (2026-11-17): `test_w9_probes.py` pins every W9 queue row to its generated probe; it ran in no
    leg, so a queue row that broke it (W9-NB1) reached master red. The pine-twins leg names it."""
    legs = {leg["leg"]: leg for leg in _wf()["jobs"]["pytest"]["strategy"]["matrix"]["include"]}
    covered = set()
    for pat in legs["pine-twins"]["tests"].split():
        covered |= {pathlib.Path(p).as_posix() for p in glob.glob(str(ROOT / pat))}
    assert (ROOT / "tests/test_w9_probes.py").as_posix() in covered
    assert any(p.endswith("/test_pine_run_half_evidence.py") for p in covered)   # CONTROL: the glob still reads


def test_a_pytest_leg_runs_the_c45_door_rail_and_what_it_reads_triggers_it():
    """2026-11-20: `test_c45_withheld_doors.py` (the C45 doors ask ast_interpret's own whole-series decision) was red
    on master from engine 78 (#1888) and again from engine 90 (#2194), with every check green: no leg ran it. A
    pytest leg names it, and a PR that changes it, the interpreter it asks, or the fixture it reads triggers this."""
    assert (ROOT / "tests/test_c45_withheld_doors.py").as_posix() in _covered()
    rxs = [_glob_rx(p) for p in _on(_wf())["pull_request"]["paths"]]
    for p in ("tests/test_c45_withheld_doors.py", "api/services/ast_interpret.py",
              "tests/fixtures/ast/period_anchor_parity.json"):
        assert any(rx.match(p) for rx in rxs), f"a PR changing {p} does not trigger pine-heavy"


# ── every test that imports the Pine engine runs in a leg (2026-11-20) ─────────
# ⚰️ 67 test files importing the engine ran in no lane at all, and 32 more only in lanes that do not trigger on an
# engine change. Four were red on master for days with every check green. The census legs run them; the rails below
# DERIVE the set from the files' own imports (their own reading, not the tool's: a hole in the tool's definition is
# not a hole in this rail's) and fail by name on a file no leg runs, on a census split that is not a partition, and on
# a module those files import that does not trigger this workflow.

#: a dotted module that is Pine engine code: the interpreter family, the Pine services, the Pine routers, the runtime.
_ENGINE_RX = re.compile(r"^(?:api\.services\.(?:ast|pine)_\w+|api\.routers\.\w*pine\w*|services\.pine_runtime)(?:\.|$)")

#: modules a census file imports, that import the engine themselves, and that deliberately do NOT trigger pine heavy.
TRIGGER_EXEMPT = {
    "api/main.py": "the app's wiring file (it imports the engine to mount its routers): nearly every backend PR "
                   "touches it, and every pine-heavy job on each would buy nothing the engine's own paths do not",
}


@functools.lru_cache(maxsize=None)
def _dotted_imports(path: pathlib.Path) -> frozenset:
    """Every dotted module `path` imports (absolute; a relative import resolved against its package)."""
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        tree = ast.parse(path.read_text(encoding="utf-8"))
    pkg = list(path.relative_to(ROOT).parent.parts) if path.is_relative_to(ROOT) else []
    names: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            names |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            base = n.module or ""
            if n.level:
                up = pkg[:len(pkg) - (n.level - 1)] if n.level > 1 else pkg
                base = ".".join(up + ([n.module] if n.module else []))
            names.add(base)
            names |= {f"{base}.{a.name}" for a in n.names}
    return frozenset(m for m in names if m)


def _imports_the_engine(path: pathlib.Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if not re.search(r"ast_|pine", text):         # every engine module's dotted name holds one: nothing to parse
        return False
    return any(_ENGINE_RX.match(m) for m in _dotted_imports(path))


def _pine_importing_tests(root: pathlib.Path = ROOT) -> set[str]:
    return {p.as_posix() for p in (root / "tests").glob("test_*.py") if _imports_the_engine(p)}


def _module_file(dotted: str):
    p = ROOT.joinpath(*dotted.split("."))
    for c in (p.with_suffix(".py"), p / "__init__.py"):
        if c.is_file():
            return c
    return None


def _census_triggers() -> dict[str, set[str]]:
    """{repo module a census-leg file imports that must trigger pine heavy: {the files importing it}} -- engine code,
    and any module that itself imports the engine (a consumer: an engine change reaches the test through it)."""
    census = set().union(*[f for leg, f in _leg_files().items() if leg.startswith("pine-consumers")])
    out: dict[str, set[str]] = {}
    for test in sorted(census):
        for dotted in _dotted_imports(pathlib.Path(test)):
            if dotted.split(".")[0] not in ("api", "services"):
                continue
            mod = _module_file(dotted)
            if mod is None:
                continue
            if _ENGINE_RX.match(dotted) or _imports_the_engine(mod):
                out.setdefault(mod.relative_to(ROOT).as_posix(), set()).add(pathlib.Path(test).name)
    return out


def test_every_test_file_that_imports_the_pine_engine_is_run_by_a_pytest_leg():
    pine = _pine_importing_tests()
    assert len(pine) >= 150, f"only {len(pine)} Pine-importing test files: the scan is broken, not the suite"
    missing = sorted(_rel(f) for f in pine - _covered())
    assert not missing, (
        "test files that import the Pine engine and that no pine-heavy pytest leg runs (tools/pine_test_census.py "
        f"should have listed them; what does it not see?): {missing}")


def test_the_census_legs_split_the_census_exactly_once_and_overlap_no_other_leg():
    import pine_test_census as C  # noqa: E402
    legs = {leg["leg"]: leg for leg in _wf()["jobs"]["pytest"]["strategy"]["matrix"]["include"] if leg.get("census")}
    specs = sorted(C.parse_shard(leg["census"]) for leg in legs.values())
    n = specs[0][1]
    assert specs == [(k, n) for k in range(1, n + 1)], f"the census legs are not shards 1..N of one N: {specs}"
    files = _leg_files()
    shards = [files[name] for name in legs]
    census = {(ROOT / f).as_posix() for f in C.census(ROOT)}
    assert len(census) >= 60, f"the census holds {len(census)} files: vacuous"
    assert all(shards), "a census shard is empty"
    assert sum(len(s) for s in shards) == len(census) and set().union(*shards) == census, (
        "the census shards are not a partition of the census")
    others = set().union(*[f for name, f in files.items() if name not in legs])
    assert not (census & others), f"files run twice (a census leg and a `tests:` leg): {sorted(map(_rel, census & others))}"
    # one file that fails to import must not hide a shard: 2026-11-20 a collection error ran 0 of shard 1's 49 files
    commands = [l for r in _runs(_wf()["jobs"]["pytest"]) for l in r.splitlines()
                if "-m pytest" in l and not l.lstrip().startswith("#")]
    assert commands and all("--continue-on-collection-errors" in l for l in commands), (
        "the pytest legs stop at the first collection error: every other file in that leg goes unrun")


def test_what_the_census_files_import_triggers_pine_heavy():
    rxs = [_glob_rx(p) for p in _on(_wf())["pull_request"]["paths"]]
    need = _census_triggers()
    assert len(need) >= 25, f"only {len(need)} engine or consumer modules imported: the scan is broken"
    for want in ("api/services/ast_interpret.py", "api/services/scan_definition.py",
                 "api/services/alert_user_series.py", "api/services/user_definitions.py"):
        assert want in need, f"CONTROL: {want} is not seen as imported by a census file"
    stale = sorted(m for m in TRIGGER_EXEMPT if m not in need)
    assert not stale, f"TRIGGER_EXEMPT names modules no census file imports any more: {stale}"
    missing = {m: sorted(t)[:3] for m, t in need.items() if m not in TRIGGER_EXEMPT and not any(rx.match(m) for rx in rxs)}
    assert not missing, f"modules census files import that do not trigger pine-heavy (module: importers): {missing}"


def test_CONTROL_the_leg_rail_names_files_when_the_census_legs_are_gone():
    doc = _wf()
    doc["jobs"]["pytest"]["strategy"]["matrix"]["include"] = [
        leg for leg in doc["jobs"]["pytest"]["strategy"]["matrix"]["include"] if not leg.get("census")]
    missing = _pine_importing_tests() - _covered(doc)
    assert len(missing) >= 60 and (ROOT / "tests/test_scan_definition.py").as_posix() in missing, sorted(missing)[:5]


def test_CONTROL_the_import_reading_tells_an_engine_import_from_another(tmp_path):
    cases = {
        "from api.services import ast_interpret as ai\n": True,
        "import api.services.pine_compare\n": True,
        "from api.routers import pine_runtime\n": True,
        "from services.pine_runtime.client import x\n": True,
        "def f():\n    from api.services.ast_table import TABLE\n": True,     # an import inside a function counts
        "from api.services import cache\n": False,
        "from api.services import scan_definition\n": False,
        "X = 'from api.services import ast_interpret'\n": False,               # prose and strings never count
        "import importlib\nimportlib.import_module('api.services.ast_interpret')\n": False,   # the stated limit
    }
    for i, (src, want) in enumerate(cases.items()):
        p = tmp_path / f"test_probe_{i}.py"
        p.write_text(src, encoding="utf-8")
        assert _imports_the_engine(p) is want, src


def test_CONTROL_the_trigger_rail_names_a_module_whose_glob_is_gone():
    rxs = [_glob_rx(p) for p in _on(_wf())["pull_request"]["paths"] if p != "api/services/scan_*.py"]
    need = _census_triggers()
    missing = [m for m in need if m not in TRIGGER_EXEMPT and not any(rx.match(m) for rx in rxs)]
    assert "api/services/scan_definition.py" in missing, missing


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
if [ -n "${ARGS_LOG:-}" ]; then printf '%s\n' "$*" >> "$ARGS_LOG"; fi
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
    if "GIT_RC" in env:         # a stand-in `git`: logs its arguments, answers GIT_RC
        git = bindir / "git"
        git.write_text('#!/usr/bin/env bash\nprintf \'git %s\\n\' "$*" >> "$ARGS_LOG"\nexit "$GIT_RC"\n',
                       encoding="utf-8", newline="\n")
        os.chmod(git, 0o755)
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


@pytest.mark.parametrize("git_rc,q,want", [(0, 0, 0), (0, 1, "red"), (128, 0, "red")])
def test_on_a_pr_the_queue_check_runs_against_the_prs_base_and_a_base_it_cannot_fetch_fails(tmp_path, git_rc, q, want):
    """⭐ (2026-11-21) `queue --check` passed while a doc edit dropped 3 targets: on a pull request the step fetches the
    base and checks `--against` it. ⛔ A base it cannot fetch is never a pass (the comparison did not run)."""
    run = _step_run("derived-evidence", "queue --check")
    log = tmp_path / "args.log"
    rc = _execute(tmp_path, run, Q_RC=q, P_RC=0, BASE_SHA="0123abcd", GIT_RC=git_rc, ARGS_LOG=log)
    lines = log.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "git fetch --no-tags --depth=1 origin 0123abcd", lines
    queue = [ln for ln in lines if " queue --check" in ln]
    if git_rc == 0:
        assert queue and queue[0].endswith("queue --check --against 0123abcd"), lines
    else:
        assert not queue, lines            # nothing to compare with: the check does not run, and the step fails
    assert (rc == 0) if want == 0 else (rc != 0), f"git {git_rc}, queue {q}: step exit {rc}"


def test_without_a_pr_base_the_queue_check_runs_as_before(tmp_path):
    run = _step_run("derived-evidence", "queue --check")
    log = tmp_path / "args.log"
    assert _execute(tmp_path, run, Q_RC=0, P_RC=0, ARGS_LOG=log) == 0
    lines = log.read_text(encoding="utf-8").splitlines()
    assert [ln for ln in lines if " queue --check" in ln][0].endswith("queue --check"), lines
    assert not [ln for ln in lines if ln.startswith("git ")]
    step = next(s for s in _wf()["jobs"]["derived-evidence"]["steps"] if "queue --check" in str(s.get("run")))
    assert step["env"]["BASE_SHA"] == "${{ github.event.pull_request.base.sha }}"


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


# ── only the legs that read history fetch it (2026-11-16) ─────────────────────
# ⚰️ Every job fetched the FULL history (1.35 GB of git data) for a need two helpers have: ~62 s of checkout
# against ~28 s, 20% of every job, in the workflow that was half of all runner minutes on a saturated account.

VITEST_ROOTS = ("app/src/components/chart/engine", "app/src/components/chart/builder")
#: A call that asks git for something a depth-1 checkout does not hold. `ls-files`, `grep`, `init`, `status`
#: and `rev-parse HEAD` are answered at any depth and are not here.
_HISTORY_VERBS = "show|log|rev-list|merge-base|blame|describe|diff|cat-file|worktree|archive"
_Q = "['\"`]"
HISTORY_READ = re.compile(
    r"(?:exec(?:File)?Sync|spawnSync|spawn|execFile|exec)\(\s*" + _Q + "git" + _Q + r"\s*,\s*\[\s*" + _Q
    + "(?:" + _HISTORY_VERBS + ")" + _Q
    + r"|(?:execSync|exec)\(\s*" + _Q + r"git\s+(?:" + _HISTORY_VERBS + r")\b")
_IMPORT = re.compile(r"(?:from\s*|import\s*\(\s*|require\(\s*|import\s+)['\"](\.{1,2}/[^'\"]+)['\"]")
_SRC_EXT = (".js", ".jsx", ".mjs", ".ts", ".tsx")


def _code(text: str) -> str:
    """The source with comments removed: a rail that hunts a call must not find it in prose."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("//"))


def _resolve(importer: pathlib.Path, spec: str):
    base = importer.parent / spec
    for cand in [base] + [base.with_name(base.name + e) for e in _SRC_EXT] + [base / ("index" + e) for e in _SRC_EXT]:
        if cand.is_file():
            return cand.resolve()
    return None


def _history_readers() -> dict:
    """{test file (repo-relative): the history-reading module it reaches}, over the two vitest roots."""
    files = [f for r in VITEST_ROOTS for f in (ROOT / r).rglob("*") if f.suffix in _SRC_EXT and f.is_file()]
    code = {f.resolve(): _code(f.read_text(encoding="utf-8", errors="replace")) for f in files}
    reaches = {f: f for f, c in code.items() if HISTORY_READ.search(c)}          # file -> the reader it reaches
    imports = {f: {t for t in (_resolve(f, m) for m in _IMPORT.findall(c)) if t} for f, c in code.items()}
    grew = True
    while grew:                                                                  # importers, transitively
        grew = False
        for f, targets in imports.items():
            hit = next((reaches[t] for t in targets if t in reaches), None)
            if hit is not None and f not in reaches:
                reaches[f] = hit
                grew = True
    return {_rel(f): _rel(r) for f, r in reaches.items() if ".test." in f.name}


def _vitest_legs_running(test_rel: str) -> list:
    """The vitest matrix legs whose filter selects this test file (both shards of a split folder do)."""
    app_rel = test_rel[len("app/"):]
    engine = "src/components/chart/engine/"
    out = []
    for leg in _wf()["jobs"]["vitest"]["strategy"]["matrix"]["include"]:
        f = leg["filter"]
        if f == "@top":
            hit = app_rel.startswith(engine) and ("/" not in app_rel[len(engine):] or app_rel.startswith(engine + "__truth__/"))
        else:
            hit = app_rel.startswith(f) and not (leg.get("exclude") and _glob_rx(leg["exclude"]).match(app_rel))
        if hit:
            out.append(leg)
    return out


def test_every_test_that_reads_git_history_runs_in_a_full_history_leg():
    readers = _history_readers()
    # non-vacuity: the two known readers were found, one direct and one through legendProbe.js
    assert "app/src/components/chart/engine/__tests__/enumerationSites.test.js" in readers, sorted(readers)
    assert readers.get("app/src/components/chart/engine/readout.test.js", "").endswith("legendProbe.js"), readers
    bad = []
    for test, reader in sorted(readers.items()):
        legs = _vitest_legs_running(test)
        if not legs:
            bad.append(f"{test}: no vitest leg selects it (reads history through {reader})")
        bad += [f"{test}: leg {l['leg']} is depth 1 but the file reads history through {reader}"
                for l in legs if l.get("history") != "full"]
    assert not bad, "add `history: full` to the leg (pine-heavy.yml):\n" + "\n".join(bad)
    # the runtime-on lane job is depth 1 and picks its files by name: none of them may read history
    lane = [t for t in readers if "HARNESS_RUNTIME_ENV" in (ROOT / t).read_text(encoding="utf-8", errors="replace")]
    assert not lane, f"harness-runtime-on is a depth-1 job, and these lane-reading files read history: {lane}"


def test_the_history_scan_can_tell_a_history_read_from_prose_and_from_a_depth_free_call():
    assert HISTORY_READ.search(_code("src = execFileSync('git', ['show', `${sha}:app/x.jsx`], {})"))
    assert HISTORY_READ.search(_code('const out = execSync("git log -1 --format=%H")'))
    assert not HISTORY_READ.search(_code("// execFileSync('git', ['show', 'abc:x'])\n/* execSync('git log') */\nconst a = 1"))
    assert not HISTORY_READ.search(_code("execFileSync('git', ['ls-files'], {})"))


def _checkout_depth(job: dict):
    """The fetch-depth of the job's checkout of the ref UNDER TEST (the $CI_TOOLS checkout has a `path`)."""
    steps = [s for s in job["steps"] if str(s.get("uses", "")).startswith("actions/checkout") and "path" not in (s.get("with") or {})]
    assert len(steps) == 1, steps
    return (steps[0].get("with") or {}).get("fetch-depth", 1)


def _gh_and_or(expr: str, history):
    """What GitHub's expression engine gives for `${{ matrix.history <op> 'full' && A || B }}`. Its `&&` and
    `||` return an OPERAND, and 0, '', false and null are falsy: `cond && 0 || 1` is 1 whatever `cond` is.
    ⚰️ That trap shipped once (run 43987501549): the rail then compared the expression as TEXT, the three
    history legs checked out at depth 1, and their readers threw by name. So the expression is EVALUATED."""
    m = re.fullmatch(r"\$\{\{ matrix\.history (==|!=) 'full' && (\d+) \|\| (\d+) \}\}", expr)
    assert m, f"an expression this rail cannot evaluate: {expr!r}"
    cond = (history == "full") if m.group(1) == "==" else (history != "full")
    a, b = int(m.group(2)), int(m.group(3))
    left = a if cond else False            # `cond && a`
    return left if left else b             # `left || b`: a falsy left (False, or the number 0) yields b


def test_the_checkout_depths_are_the_ones_the_history_rail_assumes():
    jobs = _wf()["jobs"]
    # the vitest legs: depth follows the leg's own `history` flag, and nothing else. EVALUATED for both values
    expr = _checkout_depth(jobs["vitest"])
    assert _gh_and_or(expr, "full") == 0, f"a `history: full` leg does not get the whole history: {expr}"
    assert _gh_and_or(expr, None) == 1, f"a leg without the flag is not depth 1: {expr}"
    # control: the evaluator sees the trap (the form that reads right and is 1 for every leg)
    assert _gh_and_or("${{ matrix.history == 'full' && 0 || 1 }}", "full") == 1
    full = sorted(l["leg"] for l in jobs["vitest"]["strategy"]["matrix"]["include"] if l.get("history") == "full")
    assert full == ["engine-tests-1", "engine-tests-2", "engine-top-and-truth"], full
    # the mutant job may run ANY rail a manifest names, so it keeps the whole history
    assert _checkout_depth(jobs["mutants"]) == 0
    for name in ("harness-runtime-on", "pytest", "union", "rails", "derived-evidence", "coverage-ratchet"):
        assert _checkout_depth(jobs[name]) == 1, name


# ── skip_legs: the mutant job alone, never a green run with nothing run (2026-11-16) ──────────
# ⚰️ A mutant dispatch on a PR branch re-ran every leg the PR's own run had just run on the same commit:
# three such pairs in three hours on 2026-11-16, ~100 runner-minutes each.

SKIP_EXPR = "github.event_name == 'workflow_dispatch' && inputs.skip_legs"
LEG_JOBS = ("vitest", "harness-runtime-on", "pytest", "union", "rails", "derived-evidence", "coverage-ratchet")


def test_skip_legs_is_an_off_by_default_dispatch_input_and_every_leg_honours_it():
    inp = _on(_wf())["workflow_dispatch"]["inputs"]["skip_legs"]
    assert inp["type"] == "boolean" and inp["default"] is False
    jobs = _wf()["jobs"]
    assert set(jobs) == set(LEG_JOBS) | {"mutants", "verdict"}, sorted(jobs)     # a new job must pick a side
    for name in LEG_JOBS:
        assert f"!({SKIP_EXPR})" in str(jobs[name].get("if", "")), f"{name}: if={jobs[name].get('if')!r}"
    # a PR run can never skip: the expression is false unless the event is a dispatch
    assert SKIP_EXPR.startswith("github.event_name == 'workflow_dispatch' &&")
    assert SKIP_EXPR not in str(jobs["mutants"].get("if", "")) and jobs["verdict"]["if"] == "always()"


def _verdict(tmp_path, results: dict, skip: bool, mutants: str) -> int:
    step = _wf()["jobs"]["verdict"]["steps"][0]
    assert step["env"]["SKIP_LEGS"] == "${{ " + SKIP_EXPR + " }}" and step["env"]["MUTANTS"] == "${{ needs.mutants.result }}"
    run = step["run"]
    for job in LEG_JOBS:
        assert "${{ needs.%s.result }}" % job in run, job
        run = run.replace("${{ needs.%s.result }}" % job, results.get(job, "success"))
    assert "${{" not in run, run
    return _execute(tmp_path, run, SKIP_LEGS="true" if skip else "false", MUTANTS=mutants)


ALL_SKIPPED = {j: "skipped" for j in LEG_JOBS}


@pytest.mark.parametrize("results,skip,mutants,green", [
    ({}, False, "skipped", True),                       # the control: a PR run, every leg passed, no mutant job
    ({}, False, "success", True),                       # a full dispatch with a manifest
    ({"pytest": "failure"}, False, "skipped", False),   # one red leg
    ({"union": "cancelled"}, False, "skipped", False),
    ({"vitest": "skipped"}, False, "skipped", False),   # ⛔ a leg that did not run is not a pass
    ({}, False, "failure", False),                      # a surviving mutant
    (ALL_SKIPPED, True, "success", True),               # skip_legs: the mutant job alone, and it passed
    (ALL_SKIPPED, True, "skipped", False),              # ⛔ skip_legs with no manifest: nothing ran at all
    (ALL_SKIPPED, True, "failure", False),
    (dict(ALL_SKIPPED, pytest="failure"), True, "success", False),
    (dict(ALL_SKIPPED, rails="cancelled"), True, "success", False),
])
def test_the_verdict_is_green_only_when_what_was_asked_for_ran_and_passed(tmp_path, results, skip, mutants, green):
    rc = _verdict(tmp_path, results, skip, mutants)
    assert (rc == 0) is green, f"results={results} skip_legs={skip} mutants={mutants}: step exit {rc}"
