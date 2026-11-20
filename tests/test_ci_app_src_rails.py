"""Rails for the app/src pytest rails: tools/ci_app_src_rails.py and the two steps of
.github/workflows/whole-app-engine-rails.yml that run its list (2026-11-19).

WHY: #1998, a browser-only change, added the refusal-guard literal 'runtime:objects-withheld' to
app/src/components/chart/builder/runsHere.js without registering it in supportLoop/refusalCodes.json. All 52 of its
PR checks were green; master then went red on tests/test_support_loop_refusal_codes.py (and the
`tools/support_loop/refusal_codes.py --check` it wraps). That rail lives in tests/ but READS app/src, and no
pull-request job ran it, so a PR that changed app/src never met it. What must stay true, each a test:

  * every pytest file under tests/ that reads app/src runs on the PR that changes what it reads, or is EXEMPT with a
    reason: the census is RECOMPUTED here and judged against every pull_request job's steps and triggers;
  * the census sees its controls (#1998's rail through a tool import, a direct reader, a helper-parameter reader, a
    reader through a node process run in app/) and is not vacuous (a floor);
  * the home job runs the derived list in shards that partition it (each file once, the known reds deselected by id),
    under the no-network wrapper, after the production set is installed; its workflow triggers on app/** and on this
    rail;
  * the scan reads code, not prose, and tells a path from a string that only names one (synthetic modules, both ways);
  * the judgement can fail, both ways (a synthetic repo): a reader with no step is NOT RUN, the same reader with the
    step is green, a reader named only by a job whose trigger misses its read still needs the step, a NEW reader joins
    the list with no edit, and a stale or reasonless exemption is red.

Standard library + PyYAML: it imports nothing from api/ and runs before the production set is installed.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sys
import textwrap

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_app_src_rails as C  # noqa: E402

WF = ROOT / ".github" / "workflows" / C.HOME_WORKFLOW
#: the rail #1998 slipped past, and the tool it reads app/src through
REFUSAL_RAIL = "tests/test_support_loop_refusal_codes.py"
CONTROLS = {
    REFUSAL_RAIL: "tools/support_loop/refusal_codes.py",                  # through a tool import
    "tests/test_script_engine_version_gate.py": "direct",                 # a path built from the repo root
    "tests/test_notebook_writing_help.py": "direct",                      # a helper's parameter: _js("app/src/...")
    "tests/test_render_pages_read_reachable_doors.py": "direct",          # a parametrized list of app/src paths
    "tests/test_ast_math_parity.py": "direct",                            # node run with cwd=app/
}
#: well under the 347 measured on 2026-11-19: a scan that silently stops seeing readers must not pass
CENSUS_FLOOR = 250


@pytest.fixture(scope="module")
def census():
    return C.Census.of(ROOT).census()


def _load(p: pathlib.Path) -> dict:
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


# ── the real repository ───────────────────────────────────────────────────────

def test_every_app_src_reader_runs_on_the_pr_that_changes_what_it_reads(census):
    bad = C.judge(ROOT, census)
    assert not bad, "\n".join(bad)


def test_the_census_sees_its_controls_and_is_not_vacuous(census):
    assert len(census) >= CENSUS_FLOOR, f"only {len(census)} app/src readers found: the scan stopped seeing them"
    for test, how in CONTROLS.items():
        assert test in census, f"{test} is no longer seen reading app/src"
        hows = set(census[test].values())
        assert any(h == how or h.startswith(how) for h in hows), (test, hows)


def test_the_rail_1998_slipped_past_runs_on_the_pr(census):
    home = C.print_list(ROOT, census)
    cov = C.coverage(census, C.pr_jobs(ROOT, home=home))
    assert cov[REFUSAL_RAIL]["runs"], f"{REFUSAL_RAIL} runs on no PR"
    assert REFUSAL_RAIL in home, "the refusal-codes rail left the home list: say which PR job runs it now"
    assert any(r.startswith("app/src/components/chart") for r in census[REFUSAL_RAIL])


def test_every_exemption_names_a_reader_and_argues_its_case(census):
    for t, why in C.EXEMPT.items():
        assert t in census, f"EXEMPT names {t}, which reads no app/src"
        assert len(why.strip()) >= 40, f"EXEMPT {t}: {why!r} is not a reason"


# ── the home step and its workflow ────────────────────────────────────────────

def _job(name: str = C.HOME_JOB) -> dict:
    return _load(WF)["jobs"][name]


_DIFF = ('if git rev-parse -q --verify HEAD^2 >/dev/null; then git diff --name-only HEAD^1 HEAD > changed.txt; '
         'else : > changed.txt; fi')


def test_the_plan_job_reads_the_prs_own_diff_and_hands_count_n_and_shards_on():
    job = _job("app-src-plan")
    want = {k: "${{ steps.plan.outputs.%s }}" % k for k in ("count", "n", "shards")}
    assert {k: job["outputs"].get(k) for k in want} == want      # (the vitest half adds its own v* outputs)
    assert next(s for s in job["steps"] if s.get("uses") == "actions/checkout@v4")["with"]["fetch-depth"] == 2
    plan = next(s for s in job["steps"] if s.get("id") == "plan")
    assert _DIFF in plan["run"], "the diff must be the merge commit against its base, and unknown -> empty -> ALL"
    assert 'python tools/ci_app_src_rails.py --plan --changed changed.txt | tee -a "$GITHUB_OUTPUT"' in plan["run"]
    assert "set -euo pipefail" in plan["run"] and 0 < job["timeout-minutes"] <= 10


def test_the_home_job_runs_the_planned_shards_offline_in_the_production_set():
    job = _job()
    assert job["needs"] == "app-src-plan" and job["if"] == "needs.app-src-plan.outputs.count != '0'"
    assert job["strategy"]["matrix"]["shard"] == "${{ fromJSON(needs.app-src-plan.outputs.shards) }}"
    assert job["strategy"].get("fail-fast") is False, "one red shard must not cancel the others' answers"
    assert "${{ needs.app-src-plan.outputs.n }}" in job["name"] and 0 < job["timeout-minutes"] <= 20
    steps = job["steps"]
    names = [s.get("name") for s in steps]
    home = steps[names.index(C.HOME_STEP)]
    run = home["run"]
    assert home["env"] == {"SHARD": "${{ matrix.shard }}", "N": "${{ needs.app-src-plan.outputs.n }}"}
    assert _DIFF in run, "a shard must select from the same diff the plan did"
    assert ('python tools/ci_app_src_rails.py --write-args app-src-args.txt --shard "$SHARD/$N" '
            '--changed changed.txt') in run
    assert 'mapfile -t args < app-src-args.txt' in run and 'test "${#args[@]}" -gt 0' in run
    assert 'bash "$CI_TOOLS/tools/ci_offline.sh" python -m pytest "${args[@]}"' in run, "not under the offline wrapper"
    assert "|| rc=$?" in run and run.rstrip().endswith("exit $rc") and "set -euo pipefail" in run
    deps = next(s for s in steps if "requirements.txt" in str(s.get("run")))
    assert names.index(deps.get("name")) < names.index(C.HOME_STEP)
    assert "tests/ci-only-packages.txt" in deps["run"] and "/data" in deps["run"]
    assert any(str(s.get("uses", "")).endswith("pine-heavy-setup") for s in steps), "not pine heavy's environment"
    assert next(s for s in steps if s.get("uses") == "actions/checkout@v4")["with"]["fetch-depth"] == 0


def test_the_shards_are_a_partition_of_the_list_and_load_the_known_red_plugin(census):
    home = C.print_list(ROOT, census)
    timings = C.load_timings(ROOT)
    assert timings, "no recorded timings: every shard would be cut by count"
    n = C.shard_count(home, timings)
    assert n == C.MAX_SHARDS, "the whole list must use every shard"
    parts = C.partition(home, n, timings)
    flat = [f for p in parts for f in p]
    assert sorted(flat) == sorted(home) and len(flat) == len(set(flat)), "a file in no shard, or in two"
    assert all(parts), "an empty shard"
    loads = [sum(timings.get(f, C.UNKNOWN_MS) for f in p) for p in parts]
    assert max(loads) <= 1.5 * (sum(loads) / n) + max(timings.get(f, C.UNKNOWN_MS) for f in home), loads
    for k in range(1, n + 1):
        args = C.shard_args(home, k, n, timings)
        assert args[:-2] == parts[k - 1] and args[-2:] == ["-p", C.PLUGIN]
    assert C.PLUGIN == "tools.ci_app_src_rails" and C.shard_args([], 1, 1, timings) == []
    for node in C.KNOWN_RED:
        f = node.split("::", 1)[0]
        assert ("::" not in node) == (f not in home), f"{node}: a whole-file entry must leave the list, a test must not"
    assert C.shard_count([], timings) == 0 and C.shard_count(home[:1], timings) == 1


def test_a_known_red_runs_as_a_strict_xfail_so_it_goes_red_when_it_goes_green():
    class _Item:
        def __init__(self, nodeid):
            self.nodeid, self.marks = nodeid, []

        def add_marker(self, mark):
            self.marks.append(mark)

    red = next(k for k in C.KNOWN_RED if "::" in k)
    items = [_Item(red), _Item("tests/test_reader.py::test_green")]
    C.pytest_collection_modifyitems(None, items)
    assert [m.name for m in items[0].marks] == ["xfail"] and items[0].marks[0].kwargs["strict"] is True
    assert "delete its line" in items[0].marks[0].kwargs["reason"]
    assert items[1].marks == [], "a test not on KNOWN_RED is left alone"


def test_a_known_red_that_passes_turns_the_run_red(tmp_path):
    """End to end, under pytest itself: the plugin xfails a KNOWN_RED id strictly, so a test that now PASSES fails the
    run (XPASS strict), and one that still fails keeps it green."""
    (tmp_path / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
    (tmp_path / "test_k.py").write_text("def test_now_green():\n    assert True\n\n"
                                        "def test_still_red():\n    assert False\n", encoding="utf-8")
    (tmp_path / "conftest.py").write_text(
        "import sys\nsys.path.insert(0, %r)\nimport ci_app_src_rails as C\n"
        "C.KNOWN_RED.update({'test_k.py::test_now_green': 'x' * 40, 'test_k.py::test_still_red': 'x' * 40})\n"
        "pytest_collection_modifyitems = C.pytest_collection_modifyitems\n" % str(ROOT / "tools"), encoding="utf-8")
    import subprocess
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_k.py"],
                       cwd=tmp_path, capture_output=True, text=True)
    assert r.returncode == 1 and "XPASS(strict)" in r.stdout and "1 xfailed" in r.stdout, r.stdout[-600:]


def test_every_known_red_still_names_a_test(census):
    for node in C.KNOWN_RED:
        if "::" in node:
            assert C._test_exists(ROOT, node), node
    assert not C._test_exists(ROOT, REFUSAL_RAIL + "::test_that_was_never_written")
    assert not C._test_exists(ROOT, next(k for k in C.KNOWN_RED if "[" in k).split("[")[0] + "[no such param]")


# ── path-aware: a PR runs the rails that read, or depend on, what it changes ──

@pytest.mark.parametrize("changed, want_refusal_rail, want_all", [
    (["app/src/components/chart/builder/runsHere.js"], True, False),     # #1998's change
    (["app/src/components/chart/supportLoop/refusalCodes.json"], True, False),
    (["tools/support_loop/refusal_codes.py"], True, False),              # the helper it reads through
    (["tests/test_support_loop_refusal_codes.py"], True, False),         # the rail itself
    (["docs/somewhere/notes.md"], False, False),                         # nothing any rail reads
    (["tools/ci_app_src_rails.py"], True, True),                         # the tool: everything
    ([".github/workflows/whole-app-engine-rails.yml"], True, True),      # the job: everything
    ([], True, True),                                                    # the diff is unknown: everything
])
def test_a_pr_selects_the_rails_that_read_or_depend_on_what_it_changes(census, changed, want_refusal_rail, want_all):
    home = C.print_list(ROOT, census)
    chosen, why = C.select(home, census, changed, C.Census.of(ROOT))
    assert (REFUSAL_RAIL in chosen) is want_refusal_rail, why
    assert (chosen == home) is want_all, why
    if changed == ["docs/somewhere/notes.md"]:
        assert chosen == [], f"a PR touching nothing a rail reads must run none: {chosen[:5]}"
    if changed == ["tools/support_loop/refusal_codes.py"]:
        assert len(chosen) < len(home) // 10, "a helper change must not run the world"


def test_a_change_to_a_helper_or_an_imported_product_module_selects_the_rail(tmp_path):
    repo = _repo(tmp_path, home=True)
    (repo / "api" / "services").mkdir(parents=True)
    for p in ("api/__init__.py", "api/services/__init__.py", "api/services/codes.py", "api/services/far.py"):
        (repo / p).write_text("", encoding="utf-8")
    (repo / "api" / "services" / "codes.py").write_text("from api.services import far\n", encoding="utf-8")
    (repo / "tools" / "helper.py").write_text("from api.services import codes\n", encoding="utf-8")
    (repo / "tests" / "test_reader.py").write_text(
        "import sys\nfrom pathlib import Path\nsys.path.insert(0, 'tools')\nimport helper\n"
        "ROOT = Path(__file__).resolve().parents[1]\n"
        "def test(): (ROOT / 'app' / 'src' / 'pages' / 'x.js').read_text()\n", encoding="utf-8")
    model = C.Census(repo)
    census = model.census()
    home = C.print_list(repo, census, exempt={}, known_red={})
    pick = lambda changed: C.select(home, census, changed, model)[0]  # noqa: E731
    assert pick(["app/src/pages/x.js"]) == ["tests/test_reader.py"]          # what it reads
    assert pick(["app/src/pages/y.js"]) == []                                # a sibling it does not read
    assert pick(["tools/helper.py"]) == ["tests/test_reader.py"]             # a helper it imports
    assert pick(["api/services/codes.py"]) == ["tests/test_reader.py"]       # a product module the helper imports
    assert pick(["api/services/far.py"]) == [], "the product's own imports are one hop, not followed"
    assert pick(["tests/test_reader.py"]) == ["tests/test_reader.py"]        # the rail itself


def test_the_plan_prints_what_github_output_takes(tmp_path, capsys):
    changed = tmp_path / "changed.txt"
    changed.write_text("docs/somewhere/notes.md\n", encoding="utf-8")
    assert C.main(["--plan", "--changed", str(changed)]) == 0
    assert capsys.readouterr().out.splitlines() == ["count=0", "n=0", "shards=[]"]
    changed.write_text("app/src/components/chart/builder/runsHere.js\n", encoding="utf-8")
    assert C.main(["--plan", "--changed", str(changed)]) == 0
    out = dict(line.split("=", 1) for line in capsys.readouterr().out.splitlines())
    assert int(out["count"]) > 0 and json.loads(out["shards"]) == list(range(1, int(out["n"]) + 1))


def test_the_rails_step_runs_this_file_without_the_production_set():
    runs = [str(s.get("run") or "") for s in _job("rails")["steps"]]
    step = next(r for r in runs if "tests/test_ci_app_src_rails.py" in r)
    assert "-r requirements.txt" not in step, "this rail is stdlib + PyYAML; it must not need the app installed"


def test_the_workflow_triggers_on_app_src_and_on_this_rail():
    globs = _on(_load(WF))["pull_request"]["paths"]
    for p in ("app/src/components/chart/builder/runsHere.js", "app/src/components/chart/supportLoop/refusalCodes.json",
              "app/src/pages/journal-2-0/lib/x.js", "tools/ci_app_src_rails.py", "tests/test_ci_app_src_rails.py",
              ".github/workflows/whole-app-engine-rails.yml"):
        assert C.triggers(globs, p), p
    assert not C.triggers(globs, "docs/somewhere/else.md"), "the trigger reading cannot say no"


# ── the scan: code, not prose; a path, not a string ───────────────────────────

def _reads(src: str, rel: str = "tests/test_x.py") -> set:
    return C._read_targets(ast.parse(textwrap.dedent(src)), rel)[0]


@pytest.mark.parametrize("src, want", [
    ("""
     from pathlib import Path
     ROOT = Path(__file__).resolve().parents[1]
     JS = ROOT / "app" / "src" / "a.js"
     def test(): JS.read_text()
     """, {"app/src/a.js"}),
    ("""
     import os
     P = os.path.join(os.path.dirname(__file__), "..", "app", "src", "b.json")
     def test(): open(P).read()
     """, {"app/src/b.json"}),
    ("""
     from pathlib import Path
     def test(): Path("app/src/c.js").read_text()
     """, {"app/src/c.js"}),
    ("""
     from pathlib import Path
     ROOT = Path(__file__).resolve().parents[1]
     def test():
         for rel in ("app/src/d.js", "app/src/e.js"):
             (ROOT / rel).read_text()
     """, {"app/src/d.js", "app/src/e.js"}),
    ("""
     import pytest
     from pathlib import Path
     REPO = Path(__file__).resolve().parents[1]
     PAGES = ("app/src/f.jsx", "app/src/g.jsx")
     @pytest.mark.parametrize("rel", PAGES)
     def test(rel): (REPO / rel).read_text()
     """, {"app/src/f.jsx", "app/src/g.jsx"}),
    ("""
     from pathlib import Path
     REPO = Path(__file__).resolve().parents[1]
     def _js(path): return (REPO / path).read_text()
     def test(): _js("app/src/h.js")
     """, {"app/src/h.js"}),
    ("""
     import subprocess
     from pathlib import Path
     ROOT = Path(__file__).resolve().parents[1]
     APP = ROOT / "app"
     def test(): subprocess.run(["node", "probe.mjs"], cwd=APP)
     """, {"app/src (a process run in app/)"}),
    ("""
     from pathlib import Path
     ROOT = Path(__file__).resolve().parents[1]
     def test(): list((ROOT / "app" / "src").rglob("*.js"))
     """, {"app/src"}),
])
def test_the_scan_finds_each_way_a_test_reads_app_src(src, want):
    assert _reads(src) == want


@pytest.mark.parametrize("src", [
    '''
    """The rail reads app/src/x.js and ROOT / "app" / "src" in prose only."""
    def test(): pass
    ''',
    """
    # (ROOT / "app" / "src" / "x.js").read_text()  -- a comment
    def test(): pass
    """,
    """
    AGENT_FILE = "app/src/agent/nl/router.js"
    def _decide(paths): return "success" if paths else "skip"
    def test(): assert _decide([AGENT_FILE]) == "success"
    """,
    """
    def test(tmp_path):
        (tmp_path / "app" / "src" / "x.js").write_text("")
    """,
])
def test_the_scan_refuses_prose_strings_and_other_trees(src):
    assert _reads(src) == set()


def test_a_tool_that_reads_app_src_charges_the_test_that_imports_it(tmp_path):
    repo = _repo(tmp_path, home=True)
    (repo / "tools" / "reads_client.py").write_text(textwrap.dedent("""
        from pathlib import Path
        ROOT = Path(__file__).resolve().parents[1]
        def codes(): return (ROOT / "app" / "src" / "codes.json").read_text()
        """), encoding="utf-8")
    (repo / "tests" / "test_via_tool.py").write_text(
        "import sys\nsys.path.insert(0, 'tools')\nimport reads_client\ndef test(): reads_client.codes()\n",
        encoding="utf-8")
    got = C.Census(repo).census()
    assert got["tests/test_via_tool.py"] == {"app/src/codes.json": "tools/reads_client.py"}


# ── the judgement can fail, both ways (a synthetic repository) ────────────────

def _judge(repo, **kw):
    """judge() over a synthetic repo: no TOOL_CHECKS (they name the real repo's tools)."""
    return C.judge(repo, tool_checks=(), **kw)


_HOME_RUN = 'python tools/ci_app_src_rails.py --write-args app-src-args.txt --shard "$SHARD/2"\n'


def _repo(tmp: pathlib.Path, *, home: bool, extra_jobs: dict | None = None,
          paths: tuple = ("app/**", "tools/**")) -> pathlib.Path:
    repo = tmp / "repo"
    (repo / ".github" / "workflows").mkdir(parents=True, exist_ok=True)
    (repo / "tests").mkdir(exist_ok=True)
    (repo / "tools").mkdir(exist_ok=True)
    steps = [{"uses": "actions/checkout@v4"}]
    if home:
        steps.append({"name": C.HOME_STEP, "run": _HOME_RUN})
    doc = {"name": "home", "on": {"pull_request": {"branches": ["master"], "paths": list(paths)}},
           "jobs": {C.HOME_JOB: {"runs-on": "ubuntu-latest", "steps": steps}}}
    (repo / ".github" / "workflows" / C.HOME_WORKFLOW).write_text(yaml.safe_dump(doc, sort_keys=False),
                                                                  encoding="utf-8")
    for name, (wf_paths, run) in (extra_jobs or {}).items():
        other = {"name": name, "on": {"pull_request": {"paths": list(wf_paths)}},
                 "jobs": {"j": {"runs-on": "ubuntu-latest", "steps": [{"run": run}]}}}
        (repo / ".github" / "workflows" / f"{name}.yml").write_text(yaml.safe_dump(other), encoding="utf-8")
    (repo / "tests" / "test_reader.py").write_text(textwrap.dedent("""
        from pathlib import Path
        ROOT = Path(__file__).resolve().parents[1]
        def test(): (ROOT / "app" / "src" / "pages" / "x.js").read_text()
        """), encoding="utf-8")
    (repo / "tests" / "test_bystander.py").write_text("def test(): assert 'app/src/y.js'\n", encoding="utf-8")
    return repo


def test_a_reader_with_no_step_is_not_run_and_the_same_reader_with_the_step_is_green(tmp_path):
    bare = _repo(tmp_path / "a", home=False)
    bad = _judge(bare, exempt={}, known_red={})
    assert any("has no step named" in b for b in bad), bad
    assert any(b.startswith("NOT RUN ON THE PR: tests/test_reader.py") for b in bad), bad
    assert not any("test_bystander" in b for b in bad), "a string that only names app/src is not a read"
    good = _repo(tmp_path / "b", home=True)
    assert _judge(good, exempt={}, known_red={}) == []
    assert C.print_list(good, exempt={}, known_red={}) == ["tests/test_reader.py"]


def test_a_job_whose_trigger_misses_the_read_does_not_count(tmp_path):
    jobs = {"narrow": (["app/src/components/**"], "python -m pytest tests/test_reader.py")}
    bare = _repo(tmp_path / "a", home=False, extra_jobs=jobs)
    bad = _judge(bare, exempt={}, known_red={})
    assert any("tests/test_reader.py" in b and "named only by narrow.yml/j" in b for b in bad), bad
    with_home = _repo(tmp_path / "b", home=True, extra_jobs=jobs)
    assert C.print_list(with_home, exempt={}, known_red={}) == ["tests/test_reader.py"], "the home job takes it over"
    assert _judge(with_home, exempt={}, known_red={}) == []
    covering = {"wide": (["app/src/**"], "python -m pytest tests/test_reader.py")}
    taken = _repo(tmp_path / "c", home=True, extra_jobs=covering)
    assert C.print_list(taken, exempt={}, known_red={}) == [], "run by another job under a covering trigger: not twice"
    assert _judge(taken, exempt={}, known_red={}) == []


def test_a_new_reader_joins_the_list_with_no_edit(tmp_path):
    repo = _repo(tmp_path, home=True)
    assert C.print_list(repo, exempt={}, known_red={}) == ["tests/test_reader.py"]
    (repo / "tests" / "test_new_reader.py").write_text(
        "import json\nfrom pathlib import Path\n"
        "def test(): json.loads(Path('app/src/components/chart/supportLoop/refusalCodes.json').read_text())\n",
        encoding="utf-8")
    assert C.print_list(repo, exempt={}, known_red={}) == ["tests/test_new_reader.py", "tests/test_reader.py"]
    assert _judge(repo, exempt={}, known_red={}) == []


def test_the_home_workflow_must_trigger_on_what_the_list_reads(tmp_path):
    repo = _repo(tmp_path, home=True, paths=("app/src/components/**",))
    bad = _judge(repo, exempt={}, known_red={})
    assert any(b.startswith("NOT RUN ON THE PR: tests/test_reader.py") for b in bad), bad


def test_an_exemption_must_be_live_and_argued(tmp_path):
    repo = _repo(tmp_path, home=True)
    why = "deliberately master-only: needs the licence-held capture store, which no CI runner has"
    assert _judge(repo, exempt={"tests/test_reader.py": why}, known_red={}) == []
    assert "tests/test_reader.py" not in C.print_list(repo, exempt={"tests/test_reader.py": why}, known_red={})
    assert any("EXEMPT but not an app/src reader" in b
               for b in _judge(repo, exempt={"tests/test_gone.py": why}, known_red={}))
    assert any("without a reason" in b for b in _judge(repo, exempt={"tests/test_reader.py": "flaky"}, known_red={}))
    jobs = {"wide": (["app/**"], "python -m pytest tests/test_reader.py")}
    run_anyway = _repo(tmp_path / "b", home=True, extra_jobs=jobs)
    assert any("EXEMPT but run" in b for b in _judge(run_anyway, exempt={"tests/test_reader.py": why}, known_red={}))


def test_a_known_red_must_name_a_live_test_the_home_job_runs(tmp_path):
    repo = _repo(tmp_path, home=True)
    why = "red on master on a clean runner: the fixture this pins moved (regenerate it)"
    node = "tests/test_reader.py::test"
    assert _judge(repo, exempt={}, known_red={node: why}) == []
    assert C.print_list(repo, exempt={}, known_red={node: why}) == ["tests/test_reader.py"], "a test id keeps its file"
    assert any("no longer defines" in b for b in _judge(repo, exempt={}, known_red={node + "_renamed": why}))
    assert C.print_list(repo, exempt={}, known_red={"tests/test_reader.py": why}) == [], "a whole-file entry drops it"
    assert _judge(repo, exempt={}, known_red={"tests/test_reader.py": why}) == []
    assert any("reads no app/src" in b for b in _judge(repo, exempt={}, known_red={"tests/test_bystander.py::t": why}))
    assert any("without the failure" in b for b in _judge(repo, exempt={}, known_red={node: "red"}))
    other = _repo(tmp_path / "b", home=True, extra_jobs={"wide": (["app/**"], "python -m pytest tests/test_reader.py")})
    assert any("does not run" in b for b in _judge(other, exempt={}, known_red={node: why}))
    assert any("runs it anyway" in b for b in _judge(other, exempt={}, known_red={"tests/test_reader.py": why}))


# ── the tool checks: commands, run on the PR, offline ─────────────────────────

def test_every_tool_check_runs_on_the_pr_and_the_refusal_codes_check_is_one():
    assert "python tools/support_loop/refusal_codes.py --check" in C.TOOL_CHECKS
    assert C.judge_tool_checks(ROOT) == []
    step = next(s for s in _job("rails")["steps"] if "refusal_codes.py --check" in str(s.get("run")))
    assert step.get("if") == "${{ !cancelled() }}"
    assert step["run"].startswith('bash "$CI_TOOLS/tools/ci_offline.sh" python tools/support_loop/refusal_codes.py')


def test_a_tool_check_with_no_step_is_red(tmp_path):
    repo = _repo(tmp_path, home=True)
    (repo / "tools" / "codes_check.py").write_text(
        "from pathlib import Path\nROOT = Path(__file__).resolve().parents[1]\n"
        "def main(): return (ROOT / 'app' / 'src' / 'codes.json').read_text()\n", encoding="utf-8")
    cmd = "python tools/codes_check.py --check"
    assert any("TOOL CHECK NOT RUN" in b for b in C.judge_tool_checks(repo, (cmd,)))
    run = _repo(tmp_path / "b", home=True, extra_jobs={"wide": (["app/**", "tools/**"], cmd)})
    (run / "tools" / "codes_check.py").write_text((repo / "tools" / "codes_check.py").read_text(), encoding="utf-8")
    assert C.judge_tool_checks(run, (cmd,)) == []
    narrow = _repo(tmp_path / "c", home=True, extra_jobs={"narrow": (["app/src/pages/**"], cmd)})
    (narrow / "tools" / "codes_check.py").write_text((repo / "tools" / "codes_check.py").read_text(), encoding="utf-8")
    assert any("TOOL CHECK NOT RUN" in b for b in C.judge_tool_checks(narrow, (cmd,))), "a trigger that misses its read"
    assert any("reads no app/src" in b for b in C.judge_tool_checks(repo, ("python tools/gone.py --check",)))
