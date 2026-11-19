"""Rails for the cross-folder VITEST rails: tools/ci_app_src_vitest_rails.py and the `app-src-vitest` job of
.github/workflows/whole-app-engine-rails.yml (2026-11-19).

WHY: app/src/components/chart/pane/attachedPineDisclosures.noGuardIds.test.jsx is a drift rail that walks all of
app/src for guard namespaces. #2023 minted `data:*` in engine/pineDataCatalog.js; its PR's vitest legs (pine heavy:
engine/ and builder/) never ran the pane test, and master went red. The pytest half of this hole is #2033
(tools/ci_app_src_rails.py). What must stay true, each a test:

  * every vitest file that reads OTHER folders' sources runs on the PR that changes what it reads, or is EXEMPT /
    KNOWN_RED with a reason: the census is RECOMPUTED here and judged against every pull_request job;
  * the census sees its controls (the #2023 pane rail, a fixture reader through `process.cwd()`, a reader through an
    imported helper) and is not vacuous;
  * a PR touching engine/pineDataCatalog.js selects the pane rail; a PR touching nothing they read selects none;
  * the job runs the planned shards offline in pine heavy's environment, checks that every listed file ran, and runs
    the KNOWN_RED files expecting them to fail;
  * the scan reads code, not prose, and tells a read from a mocked argument (synthetic modules, both ways);
  * the judgement can fail, both ways (a synthetic repo).

Standard library + PyYAML.
"""
from __future__ import annotations

import pathlib
import sys
import textwrap

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_app_src_vitest_rails as V  # noqa: E402

WF = ROOT / ".github" / "workflows" / V.HOME_WORKFLOW
PANE_RAIL = "app/src/components/chart/pane/attachedPineDisclosures.noGuardIds.test.jsx"
CATALOG = "app/src/components/chart/engine/pineDataCatalog.js"
#: well under the 1,321 cross-folder readers measured on 2026-11-19
CENSUS_FLOOR = 900


@pytest.fixture(scope="module")
def model():
    return V.Census(ROOT)


@pytest.fixture(scope="module")
def census(model):
    return model.census()


@pytest.fixture(scope="module")
def all_tests(model):
    return model.test_files()


def _on(doc):
    return doc.get("on", doc.get(True))


# ── the real repository ───────────────────────────────────────────────────────

def test_every_cross_folder_reader_runs_on_the_pr_that_changes_what_it_reads(census, all_tests):
    bad = V.judge(ROOT, census, all_tests)
    assert not bad, "\n".join(bad[:40])


def test_the_census_sees_its_controls_and_is_not_vacuous(census, all_tests):
    assert len(all_tests) > 4000 and len(census) >= CENSUS_FLOOR, (len(all_tests), len(census))
    assert "app/src" in census[PANE_RAIL], "the #2023 rail walks all of app/src"
    harness = [t for t in census if any(r.startswith("tests/fixtures/vendor") for r in census[t])]
    assert len(harness) > 50, "the vendor-harness fixture readers (via process.cwd() and a helper) vanished"
    assert any("->" in how or how.endswith(".js") for t in harness for how in census[t].values()), \
        "no read charged through an imported helper"


def test_a_pr_minting_a_namespace_in_the_engine_runs_the_pane_rail(model, census, all_tests):
    home = V.print_list(ROOT, census, all_tests)
    assert PANE_RAIL in home, "the pane rail must run on the PR (no other PR job covers its app/src walk)"
    chosen, why = V.select(home, census, [CATALOG], model)
    assert PANE_RAIL in chosen, why
    assert V.select(home, census, ["docs/somewhere/notes.md"], model)[0] == [], "nothing they read: none"
    assert V.select(home, census, ["tools/ci_app_src_vitest_rails.py"], model)[0] == home, "the tool: everything"
    assert V.select(home, census, [], model)[0] == home, "an unknown diff: everything"
    assert V.select(home, census, [PANE_RAIL], model)[0] == [PANE_RAIL] or PANE_RAIL in \
        V.select(home, census, [PANE_RAIL], model)[0], "the rail itself"


def test_every_exemption_and_known_red_names_a_reader(census):
    for t, why in {**V.EXEMPT, **V.KNOWN_RED}.items():
        assert t in census, t
        assert len(why.strip()) >= 40, t


# ── the job ───────────────────────────────────────────────────────────────────

def _jobs():
    return yaml.safe_load(WF.read_text(encoding="utf-8"))["jobs"]


def test_the_plan_selects_the_vitest_half_from_the_same_diff():
    plan = _jobs()["app-src-plan"]
    for k in ("count", "n", "shards", "known_red"):
        assert plan["outputs"]["v" + k] == "${{ steps.vplan.outputs.%s }}" % k
    names = [s.get("id") for s in plan["steps"]]
    assert names.index("plan") < names.index("vplan"), "changed.txt is written by the pytest plan step"
    step = next(s for s in plan["steps"] if s.get("id") == "vplan")
    assert 'python tools/ci_app_src_vitest_rails.py --plan --changed changed.txt | tee -a "$GITHUB_OUTPUT"' in step["run"]


def test_the_job_runs_the_planned_shards_offline_and_checks_every_file_ran():
    job = _jobs()[V.HOME_JOB]
    assert job["needs"] == "app-src-plan"
    assert "vcount != '0'" in job["if"] and "vknown_red != '0'" in job["if"]
    assert job["strategy"]["matrix"]["shard"] == "${{ fromJSON(needs.app-src-plan.outputs.vshards) }}"
    assert job["strategy"]["fail-fast"] is False and 0 < job["timeout-minutes"] <= 20
    steps = job["steps"]
    home = next(s for s in steps if s.get("name") == V.HOME_STEP)
    run = home["run"]
    assert home["env"] == {"SHARD": "${{ matrix.shard }}", "N": "${{ needs.app-src-plan.outputs.vn }}"}
    assert "git diff --name-only HEAD^1 HEAD > changed.txt" in run and ": > changed.txt" in run
    assert ('python tools/ci_app_src_vitest_rails.py --write-files vitest-files.txt --shard "$SHARD/$N" '
            '--changed changed.txt') in run
    assert 'bash "../$CI_TOOLS/tools/ci_offline.sh" npx vitest run "${files[@]}"' in run, "not under the wrapper"
    assert 'if [ "${#files[@]}" -eq 0 ]' in run and "vcount }}\" = 0" in run, \
        "an empty shard passes only when the plan selected no listed rail (known reds alone)"
    assert "--outputFile=../vitest-rails.json" in run and "testResults" in run, "every listed file must have run"
    assert run.rstrip().endswith("exit $rc")
    assert any(str(s.get("uses", "")).endswith("pine-heavy-setup") for s in steps)
    red = next(s for s in steps if "--write-known-red" in str(s.get("run")))
    assert "matrix.shard == 1" in red["if"] and "PASSES now: delete its line" in red["run"]


def test_the_workflow_triggers_on_the_vitest_half():
    globs = _on(yaml.safe_load(WF.read_text(encoding="utf-8")))["pull_request"]["paths"]
    import ci_app_src_rails as P
    for p in (PANE_RAIL, CATALOG, "tools/ci_app_src_vitest_rails.py", "tests/test_ci_app_src_vitest_rails.py"):
        assert P.triggers(globs, p), p
    rails = _jobs()["rails"]
    assert any("tests/test_ci_app_src_vitest_rails.py" in str(s.get("run")) for s in rails["steps"])


def test_the_shards_are_a_partition(census, all_tests):
    import ci_app_src_rails as P
    home = V.print_list(ROOT, census, all_tests)
    t = V.load_timings(ROOT)
    n = V.shard_count(home, t)
    assert 1 <= n <= V.MAX_SHARDS
    parts = P.partition(home, n, t)
    flat = [f for p in parts for f in p]
    assert sorted(flat) == sorted(home) and len(flat) == len(set(flat)) and all(parts)


# ── the scan: code, not prose; a read, not a mocked argument ──────────────────

def _scan(src: str, rel: str = "app/src/pages/x/y.test.js") -> set:
    return V.analyse(V.strip_comments(textwrap.dedent(src)), rel)[0]


@pytest.mark.parametrize("src, want", [
    ("""
     import fs from 'node:fs'
     import path from 'node:path'
     const SRC = path.resolve(__dirname, '../..')
     const text = fs.readFileSync(path.join(SRC, 'components/StockChart.jsx'), 'utf8')
     """, {"app/src/components/StockChart.jsx"}),
    ("""
     import fs from 'node:fs'
     import path from 'node:path'
     const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
     const cap = JSON.parse(fs.readFileSync(path.join(H, 'a.json'), 'utf8'))
     """, {"tests/fixtures/vendor/harness/a.json"}),
    ("""
     import fs from 'node:fs'
     import path from 'node:path'
     import { fileURLToPath } from 'node:url'
     const HERE = path.dirname(fileURLToPath(import.meta.url))
     const read = (rel) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8')
     read('lib/a.js'); read('lib/b.js')
     """, {"app/src/pages/lib/a.js", "app/src/pages/lib/b.js"}),
    ("""
     import fs from 'node:fs'
     import path from 'node:path'
     const SRC = path.join(process.cwd(), 'src')
     function walk(dir) { for (const e of fs.readdirSync(dir)) { const f = path.join(dir, e); fs.readFileSync(f) } }
     walk(SRC)
     """, {"app/src"}),
    ("""
     const mods = import.meta.glob('../../components/**/*.jsx', { as: 'raw' })
     """, {"app/src/components"}),
    ("""
     import chart from '../../components/StockChart.jsx?raw'
     """, {"app/src/components/StockChart.jsx"}),
])
def test_the_scan_finds_each_way_a_vitest_file_reads(src, want):
    assert _scan(src) >= want, _scan(src)


@pytest.mark.parametrize("src", [
    """
    // const t = fs.readFileSync(path.join(SRC, 'components/StockChart.jsx'))   (a comment)
    /* fs.readdirSync(path.join(process.cwd(), 'src')) */
    it('x', () => {})
    """,
    """
    const store = { readFile: (id) => id }
    store.readFile('u_strategy-armed-census')
    """,
    """
    it('reads nothing', () => { expect(readFileSync).toBeDefined() })
    """,
])
def test_the_scan_refuses_prose_and_mocked_reads(src):
    assert _scan(src) == set()


# ── the judgement can fail, both ways (a synthetic repo) ──────────────────────

def _repo(tmp: pathlib.Path, *, home: bool, paths=("app/**",), extra=None) -> pathlib.Path:
    repo = tmp / "repo"
    (repo / ".github" / "workflows").mkdir(parents=True)
    (repo / "app" / "src" / "a").mkdir(parents=True)
    (repo / "app" / "src" / "b").mkdir(parents=True)
    (repo / "app" / "src" / "b" / "data.json").write_text("{}", encoding="utf-8")
    (repo / "app" / "src" / "a" / "reader.test.js").write_text(textwrap.dedent("""
        import fs from 'node:fs'
        import path from 'node:path'
        const B = path.resolve(__dirname, '../b')
        it('reads b', () => { fs.readFileSync(path.join(B, 'data.json')) })
        """), encoding="utf-8")
    (repo / "app" / "src" / "a" / "plain.test.js").write_text("it('x', () => {})\n", encoding="utf-8")
    steps = [{"uses": "actions/checkout@v4"}]
    if home:
        steps.append({"name": V.HOME_STEP, "run": "python tools/ci_app_src_vitest_rails.py --write-files f.txt\n"})
    doc = {"on": {"pull_request": {"paths": list(paths)}}, "jobs": {V.HOME_JOB: {"steps": steps}}}
    (repo / ".github" / "workflows" / V.HOME_WORKFLOW).write_text(yaml.safe_dump(doc), encoding="utf-8")
    for name, (wf_paths, run) in (extra or {}).items():
        other = {"on": {"pull_request": {"paths": list(wf_paths)}}, "jobs": {"j": {"steps": [{"run": run}]}}}
        (repo / ".github" / "workflows" / f"{name}.yml").write_text(yaml.safe_dump(other), encoding="utf-8")
    return repo


def _judge(repo, **kw):
    m = V.Census(repo)
    return V.judge(repo, m.census(), m.test_files(), **{"exempt": {}, "known_red": {}, **kw})


def test_a_reader_with_no_step_is_not_run_and_with_the_step_is_green(tmp_path):
    bare = _repo(tmp_path / "a", home=False)
    m = V.Census(bare)
    assert set(m.census()) == {"app/src/a/reader.test.js"}, "the plain test reads no other folder"
    bad = _judge(bare)
    assert any("has no step" in b for b in bad) and any("NOT RUN ON THE PR: app/src/a/reader.test.js" in b for b in bad)
    assert _judge(_repo(tmp_path / "b", home=True)) == []


def test_a_job_whose_trigger_misses_the_read_does_not_count(tmp_path):
    narrow = {"narrow": (["app/src/a/**"], "cd app && npx vitest run src/a/")}
    repo = _repo(tmp_path / "a", home=False, extra=narrow)
    bad = _judge(repo)
    assert any("named only by narrow.yml/j" in b for b in bad), bad
    wide = {"wide": (["app/src/**"], "cd app && npx vitest run src/a/")}
    taken = _repo(tmp_path / "b", home=True, extra=wide)
    m = V.Census(taken)
    assert V.print_list(taken, m.census(), m.test_files(), {}, {}) == [], "covered elsewhere: not run twice"
    assert _judge(taken) == []


def test_a_new_reader_joins_the_list_and_a_stale_entry_is_red(tmp_path):
    repo = _repo(tmp_path, home=True)
    (repo / "app" / "src" / "a" / "new.test.js").write_text(
        "import fs from 'node:fs'\nit('x', () => fs.readFileSync('src/b/data.json'))\n", encoding="utf-8")
    m = V.Census(repo)
    assert V.print_list(repo, m.census(), m.test_files(), {}, {}) == ["app/src/a/new.test.js",
                                                                       "app/src/a/reader.test.js"]
    why = "red on master on a clean runner: the fixture it pins moved, regenerate it"
    assert any("reads no other folder" in b for b in _judge(repo, known_red={"app/src/a/gone.test.js": why}))
    assert any("without a reason" in b for b in _judge(repo, exempt={"app/src/a/reader.test.js": "flaky"}))
