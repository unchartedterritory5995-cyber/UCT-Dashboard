"""tools/agent_vitest_shards.py — the runtime-balanced UCT Agent browser shards (owner D27 #2, 2026-11-15).

The assignment must be a deterministic PARTITION of the `vitest list` output (every file in exactly one shard,
new files included, deleted files harmless), and agent-ci.yml's union rail must still fail closed when a shard
drops a file. The last tests run the union rail's own script (extracted from the workflow) against mutants."""
from __future__ import annotations

import json
import pathlib
import random
import shutil
import subprocess

import pytest
import yaml

from tools import agent_vitest_shards as avs

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "agent-ci.yml"


def _files(n, prefix="src/agent/f"):
    return ["%s%03d.test.jsx" % (prefix, i) for i in range(n)]


def _is_partition(plan, files):
    flat = [f for b in plan for f in b]
    return sorted(flat) == sorted(set(files)) and len(flat) == len(set(flat))


# ---- the pure assignment ------------------------------------------------------------------------------------------
def test_union_equals_input_and_shards_are_disjoint_over_random_inputs():
    rng = random.Random(1275)
    for trial in range(200):
        files = _files(rng.randint(1, 120))
        timings = {f: rng.randint(0, 600_000) for f in files if rng.random() < 0.8}
        timings["src/agent/deleted.test.jsx"] = 999_999            # stale entry
        n = rng.randint(1, 6)
        plan = avs.assign(files, timings, n)
        assert len(plan) == n
        assert _is_partition(plan, files), trial
        assert avs.partition_report(plan, files)["is_partition"]
        assert all(b == sorted(b) for b in plan)


def test_deterministic_regardless_of_input_order():
    files = _files(60)
    timings = {f: (i * 7919) % 50_000 for i, f in enumerate(files)}
    a = avs.assign(files, timings, 4)
    shuffled = list(files)
    random.Random(3).shuffle(shuffled)
    assert avs.assign(shuffled, dict(reversed(list(timings.items()))), 4) == a
    assert avs.assign(files, timings, 4) == a


def test_new_untimed_file_runs_in_exactly_one_shard_the_lightest():
    files = _files(8)
    timings = {f: 10_000 for f in files}
    timings[files[0]] = 100_000                     # shard 1 gets the heavy one
    new = "src/agent/brandNew.test.jsx"
    plan = avs.assign(files + [new], timings, 2)
    holders = [i for i, b in enumerate(plan) if new in b]
    assert len(holders) == 1
    # weight = p90 of recorded; placed by LPT, it lands on the shard that was lightest when it was placed
    assert _is_partition(plan, files + [new])
    loads = avs.shard_loads(plan, timings)
    assert loads[holders[0]]["untimed"] == 1 and sum(s["untimed"] for s in loads) == 1


def test_new_file_goes_to_lightest_shard_when_it_is_the_lightest_item():
    timings = {"src/agent/a.test.jsx": 50_000, "src/agent/b.test.jsx": 10_000, "src/agent/c.test.jsx": 20_000}
    files = sorted(timings) + ["src/agent/z.test.jsx"]
    # fallback (p90 of 3 values) = the max = 50_000, so z is placed second, onto the empty shard 2
    plan = avs.assign(files, timings, 2)
    assert "src/agent/z.test.jsx" in plan[1]
    assert _is_partition(plan, files)


def test_removed_file_with_a_stale_timing_is_ignored():
    files = _files(10)
    timings = {f: 1000 * (i + 1) for i, f in enumerate(files)}
    gone = files.pop(3)
    plan = avs.assign(files, timings, 3)
    assert gone not in [f for b in plan for f in b]
    assert _is_partition(plan, files)


def test_empty_timings_split_evenly_by_count():
    files = _files(41)
    plan = avs.assign(files, {}, 4)
    assert _is_partition(plan, files)
    assert sorted(len(b) for b in plan) == [10, 10, 10, 11]


def test_more_shards_than_files_leaves_empty_shards_but_still_a_partition():
    plan = avs.assign(_files(2), {}, 4)
    assert _is_partition(plan, _files(2)) and [len(b) for b in plan] == [1, 1, 0, 0]


def test_greedy_longest_first_balances_a_skewed_load():
    # the count-cut shape: one shard holding all the heavy files
    files = _files(40)
    timings = {f: (300_000 if i >= 30 else 10_000) for i, f in enumerate(files)}
    loads = [s["ms"] for s in avs.shard_loads(avs.assign(files, timings, 4), timings)]
    assert max(loads) - min(loads) <= 300_000 and max(loads) <= 1.1 * sum(loads) / 4


def test_substring_colliding_paths_share_a_shard():
    # vitest's positional filter is a substring match: "x.test.js" also runs "x.test.jsx"
    files = ["src/agent/x.test.js", "src/agent/x.test.jsx", "src/agent/y.test.jsx", "src/agent/w.test.jsx"]
    timings = {f: 10_000 for f in files}
    plan = avs.assign(files, timings, 4)
    holder = [b for b in plan if "src/agent/x.test.js" in b][0]
    assert "src/agent/x.test.jsx" in holder
    assert _is_partition(plan, files)
    assert avs.filter_groups(files) == [["src/agent/w.test.jsx"], ["src/agent/x.test.js", "src/agent/x.test.jsx"],
                                        ["src/agent/y.test.jsx"]]


def test_bad_shard_count_is_refused():
    with pytest.raises(ValueError):
        avs.assign(_files(3), {}, 0)


def test_mutant_plan_missing_or_duplicating_a_file_is_not_a_partition():
    files = _files(12)
    plan = avs.assign(files, {}, 4)
    dropped = [list(b) for b in plan]
    dropped[0] = dropped[0][1:]
    assert avs.partition_report(dropped, files)["missing"] and not avs.partition_report(dropped, files)["is_partition"]
    dup = [list(b) for b in plan]
    dup[1] = dup[1] + dup[0][:1]
    assert avs.partition_report(dup, files)["duplicated"] and not avs.partition_report(dup, files)["is_partition"]


# ---- inputs / timings -------------------------------------------------------------------------------------------
def test_files_list_normalizes_and_fails_closed_on_junk():
    text = "src/agent/b.test.jsx\r\n\nsrc\\agent\\a.test.jsx\n./src/agent/b.test.jsx\n"
    assert avs.read_files_list(text) == ["src/agent/a.test.jsx", "src/agent/b.test.jsx"]
    with pytest.raises(ValueError):
        avs.read_files_list("src/agent/a.test.jsx\nwarning: something happened\n")
    assert avs.norm("/home/runner/work/UCT-Dashboard/UCT-Dashboard/app/src/agent/a.test.jsx") == "src/agent/a.test.jsx"


def test_unreadable_timing_file_is_empty_not_an_error(tmp_path):
    assert avs.load_timings(tmp_path / "missing.json") == {}
    assert avs.read_timings(tmp_path / "missing.json")[1].startswith("cannot read timings")
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    assert avs.load_timings(tmp_path / "bad.json") == {}


def test_record_timings_takes_the_median_per_file(tmp_path):
    def run(name, ms_a, ms_b):
        doc = {"testResults": [
            {"name": "/r/app/src/agent/a.test.jsx", "startTime": 1000, "endTime": 1000 + ms_a},
            {"name": "/r/app/src/agent/b.test.jsx", "startTime": 5, "endTime": 5 + ms_b}]}
        p = tmp_path / name
        p.write_text(json.dumps(doc), encoding="utf-8")
        return str(p)
    paths = [run("1.json", 100, 7), run("2.json", 300, 9), run("3.json", 200, 8)]
    assert avs.record_timings(paths) == {"src/agent/a.test.jsx": 200, "src/agent/b.test.jsx": 8}
    out = tmp_path / "t.json"
    avs.write_timings(out, avs.record_timings(paths), ["test"])
    assert avs.load_timings(out) == {"src/agent/a.test.jsx": 200, "src/agent/b.test.jsx": 8}


def test_committed_timing_file_is_real_and_balances_its_own_files():
    timings = avs.load_timings()
    assert len(timings) >= 300, "seed timings missing or truncated"
    assert all(k.startswith("src/") and avs.TEST_PATH.match(k) for k in timings)
    loads = [s["ms"] for s in avs.shard_loads(avs.assign(sorted(timings), timings, 4), timings)]
    assert max(loads) <= 1.05 * min(loads), loads


# ---- the CLI the workflow calls ---------------------------------------------------------------------------------
def test_cli_shards_union_equals_the_list(tmp_path, capsys):
    files = _files(50)
    lst = tmp_path / "files.txt"
    lst.write_text("\n".join(files) + "\n", encoding="utf-8")
    seen = []
    for i in range(1, 5):
        assert avs.main(["--files-list", str(lst), "--of", "4", "--shard", str(i)]) == avs.OK
        seen += [l for l in capsys.readouterr().out.splitlines() if l]
    assert sorted(seen) == files and len(seen) == len(set(seen))


def test_cli_fails_closed(tmp_path, capsys):
    empty = tmp_path / "empty.txt"
    empty.write_text("\n", encoding="utf-8")
    assert avs.main(["--files-list", str(empty), "--of", "4", "--shard", "1"]) == avs.FAIL
    one = tmp_path / "one.txt"
    one.write_text("src/agent/a.test.jsx\n", encoding="utf-8")
    assert avs.main(["--files-list", str(one), "--of", "4", "--shard", "5"]) == avs.FAIL
    assert avs.main(["--files-list", str(one), "--of", "4", "--shard", "2"]) == avs.FAIL   # empty shard
    junk = tmp_path / "junk.txt"
    junk.write_text("src/agent/a.test.jsx\nnpm WARN x\n", encoding="utf-8")
    assert avs.main(["--files-list", str(junk), "--of", "4", "--shard", "1"]) == avs.FAIL


# ---- the workflow wiring ----------------------------------------------------------------------------------------
def _wf():
    return yaml.safe_load(WF.read_text(encoding="utf-8"))


def test_browser_job_runs_the_balanced_plan_and_keeps_its_contract():
    doc = _wf()
    job = doc["jobs"]["browser"]
    # 4 -> 8 (2026-11-16, GitHub Pro: 40 concurrent jobs); 8 -> 12 (2026-11-17, critical path). The name, the matrix and
    # AGENT_SHARDS must agree.
    assert job["name"] == "UCT Agent browser tests (shard ${{ matrix.shard }}/12)"
    assert job["strategy"]["matrix"]["shard"] == list(range(1, 13)) and doc["env"]["AGENT_SHARDS"] == "12"
    assert job["timeout-minutes"] == 40
    step = [s for s in job["steps"] if s.get("name") == "vitest shard"][0]["run"]
    assert "npx vitest list $AGENT_VITEST_PATHS --filesOnly" in step
    assert "tools/agent_vitest_shards.py" in step and "--shard ${{ matrix.shard }}" in step
    assert "--shard=" not in step, "vitest's file-count --shard must not come back alongside the plan"
    assert "test -s ../shard-${{ matrix.shard }}.files" in step     # never an unfiltered vitest run
    up = [s for s in job["steps"] if "upload-artifact" in (s.get("uses") or "")][0]["with"]
    assert "shard-${{ matrix.shard }}.json" in up["path"] and up["if-no-files-found"] == "error"


def _union_script():
    steps = _wf()["jobs"]["union"]["steps"]
    run = [s for s in steps if (s.get("name") or "").startswith("Union of executed files")][0]["run"]
    body = run.split("<<'EOF'\n", 1)[1].rsplit("EOF", 1)[0]
    return body


def _fixture(tmp_path, files, shards):
    (tmp_path / "expected-files.txt").write_text("\n".join(files) + "\n", encoding="utf-8")
    sd = tmp_path / "shards"
    sd.mkdir()
    for i, members in enumerate(shards, 1):
        doc = {"numFailedTests": 0, "numPassedTests": len(members),
               "testResults": [{"name": "/runner/w/app/" + f, "startTime": 0, "endTime": 1} for f in members]}
        (sd / ("shard-%d.json" % i)).write_text(json.dumps(doc), encoding="utf-8")
    (tmp_path / "union.js").write_text(_union_script(), encoding="utf-8")
    return subprocess.run(["node", "union.js"], cwd=tmp_path, capture_output=True, text=True)


NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("mutant", ["none", "drop_one", "duplicate_one", "drop_shard"])
def test_union_rail_fails_closed_on_a_mutant_plan(tmp_path, mutant):
    files = _files(40)
    plan = avs.assign(files, {f: 1000 + i for i, f in enumerate(files)}, 4)
    if mutant == "drop_one":
        plan[2] = plan[2][1:]
    elif mutant == "duplicate_one":
        plan[3] = plan[3] + plan[0][:1]
    elif mutant == "drop_shard":
        plan = plan[:3]
    r = _fixture(tmp_path, files, plan)
    if mutant == "none":
        assert r.returncode == 0, r.stdout + r.stderr
    else:
        assert r.returncode == 1, r.stdout + r.stderr
        assert "::error::" in r.stdout


# ---- fallback: unreadable / invalid timings (AUDIT, PR #1352) ---------------------------------------------------
BAD_TIMINGS = {
    "malformed_json": "{not json",
    "empty_object": "{}",
    "top_level_list": "[1, 2]",
    "files_ms_is_a_list": '{"files_ms": ["src/agent/f000.test.jsx", 1]}',
    "files_ms_empty": '{"files_ms": {}}',
    "string_duration": '{"files_ms": {"src/agent/f000.test.jsx": "1500"}}',
    "list_duration": '{"files_ms": {"src/agent/f000.test.jsx": [1500]}}',
    "negative_duration": '{"files_ms": {"src/agent/f000.test.jsx": 1500, "src/agent/f001.test.jsx": -1}}',
    "nan_duration": '{"files_ms": {"src/agent/f000.test.jsx": NaN}}',
    "float_duration": '{"files_ms": {"src/agent/f000.test.jsx": 1.5}}',
    "bool_duration": '{"files_ms": {"src/agent/f000.test.jsx": true}}',
    "missing_file": None,
}


def _bad_timings(tmp_path, case):
    p = tmp_path / ("timings-%s.json" % case)
    if BAD_TIMINGS[case] is not None:
        p.write_text(BAD_TIMINGS[case], encoding="utf-8")
    return p


def _annotation_path(p):
    return p.as_posix().replace("%", "%25").replace(":", "%3A").replace(",", "%2C")


@pytest.mark.parametrize("case", sorted(BAD_TIMINGS))
@pytest.mark.parametrize("nfiles", [4, 5, 37, 440])
def test_invalid_timings_fall_back_to_a_full_disjoint_partition_with_every_shard_non_empty(tmp_path, case, nfiles):
    p = _bad_timings(tmp_path, case)
    timings, err = avs.read_timings(p)
    assert timings == {} and err, (case, err)
    files = _files(nfiles)
    plan = avs.assign(files, timings, 4)
    assert _is_partition(plan, files) and avs.partition_report(plan, files)["is_partition"]
    assert all(plan), [len(b) for b in plan]
    assert max(map(len, plan)) - min(map(len, plan)) <= 1        # the count split


@pytest.mark.parametrize("case", sorted(BAD_TIMINGS))
def test_invalid_timings_cli_slices_cover_the_list_and_annotate(tmp_path, capsys, case):
    p = _bad_timings(tmp_path, case)
    _t, err = avs.read_timings(p)
    want = "::warning file=%s::%s (splitting the Agent shards by count)" % (_annotation_path(p), err)
    files = _files(9)
    lst = tmp_path / "files.txt"
    lst.write_text("\n".join(files) + "\n", encoding="utf-8")
    seen = []
    for i in range(1, 5):
        assert avs.main(["--files-list", str(lst), "--of", "4", "--shard", str(i), "--timings", str(p)]) == avs.OK
        cap = capsys.readouterr()
        slice_ = [l for l in cap.out.splitlines() if l]
        assert slice_ and all(l in files for l in slice_), "annotation leaked into the file list: %r" % cap.out
        assert want in cap.err.splitlines(), cap.err
        seen += slice_
    assert sorted(seen) == files and len(seen) == len(set(seen))
    assert avs.main(["--files-list", str(lst), "--of", "4", "--plan", "--timings", str(p)]) == avs.OK
    assert want in capsys.readouterr().out.splitlines()       # the --plan line in the workflow log


def test_exact_annotation_text(tmp_path, capsys):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    lst = tmp_path / "files.txt"
    lst.write_text("\n".join(_files(4)) + "\n", encoding="utf-8")
    assert avs.main(["--files-list", str(lst), "--of", "4", "--plan", "--timings", str(p)]) == avs.OK
    out = capsys.readouterr().out.splitlines()
    assert out[0] == ("::warning file=%s::timings are not valid JSON: Expecting property name enclosed in double "
                      "quotes%s line 1 column 2 (char 1) (splitting the Agent shards by count)"
                      % (_annotation_path(p), ":"))
    # inside the repo the path is repo-relative (links the annotation to the file); % and newlines are escaped
    assert avs.timings_warning(ROOT / avs.TIMINGS_FILE, "50% bad\nline 2") == (
        "::warning file=tools/agent_vitest_shard_timings.json::50%25 bad%0Aline 2 (splitting the Agent shards by count)")


def test_valid_committed_timings_emit_no_annotation(tmp_path, capsys):
    lst = tmp_path / "files.txt"
    lst.write_text("\n".join(_files(8)) + "\n", encoding="utf-8")
    assert avs.read_timings()[1] is None
    assert avs.main(["--files-list", str(lst), "--of", "4", "--plan"]) == avs.OK
    cap = capsys.readouterr()
    assert "::warning" not in cap.out + cap.err


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("mutant,code", [("none", 0), ("drop_one", 1), ("duplicate_one", 1)])
def test_union_rail_is_identical_in_fallback_mode(tmp_path, capsys, mutant, code):
    """The plan built by the CLI with UNREADABLE timings goes through the real union script from agent-ci.yml."""
    files = _files(40)
    lst = tmp_path / "files.txt"
    lst.write_text("\n".join(files) + "\n", encoding="utf-8")
    missing = tmp_path / "no-such-timings.json"
    plan = []
    for i in range(1, 5):
        assert avs.main(["--files-list", str(lst), "--of", "4", "--shard", str(i), "--timings", str(missing)]) == avs.OK
        plan.append([l for l in capsys.readouterr().out.splitlines() if l])
    assert sorted(len(b) for b in plan) == [10, 10, 10, 10]
    if mutant == "drop_one":
        plan[1] = plan[1][1:]
    elif mutant == "duplicate_one":
        plan[2] = plan[2] + plan[3][:1]
    work = tmp_path / "union"
    work.mkdir()
    r = _fixture(work, files, plan)
    assert r.returncode == code, r.stdout + r.stderr
    assert "expected 40 files" in r.stdout
    if code:
        want = "files no shard ran" if mutant == "drop_one" else "files more than one shard ran"
        assert "::error::" + want in r.stdout, r.stdout


# ---- refreshed timings + the committed file as fallback (2026-11-17) ----------------------------------------------
def _tjson(tmp_path, name, files_ms):
    p = tmp_path / name
    p.write_text(json.dumps({"files_ms": files_ms}), encoding="utf-8")
    return p


def test_fallback_timings_weigh_only_the_files_the_primary_lacks(tmp_path):
    prim = _tjson(tmp_path, "week.json", {"src/agent/a.test.jsx": 5000, "src/agent/b.test.jsx": 1000})
    fb = _tjson(tmp_path, "committed.json", {"src/agent/a.test.jsx": 1, "src/agent/c.0.test.jsx": 9000})
    t, errs = avs.read_timings_with_fallback(prim, fb)
    assert errs == [] and t == {"src/agent/a.test.jsx": 5000, "src/agent/b.test.jsx": 1000, "src/agent/c.0.test.jsx": 9000}
    assert avs.read_timings_with_fallback(prim, None) == avs.read_timings_with_fallback(prim, prim) == (avs.read_timings(prim)[0], [])


@pytest.mark.parametrize("bad", ["primary", "fallback", "both"])
def test_an_invalid_timing_file_contributes_nothing_and_is_annotated(tmp_path, capsys, bad):
    good_p = {"src/agent/a.test.jsx": 5000}
    good_f = {"src/agent/b.test.jsx": 7000}
    prim = _tjson(tmp_path, "week.json", good_p) if bad == "fallback" else _bad_timings(tmp_path, "malformed_json")
    fb = _tjson(tmp_path, "committed.json", good_f) if bad == "primary" else tmp_path / "no-such.json"
    t, errs = avs.read_timings_with_fallback(prim, fb)
    want = {"primary": good_f, "fallback": good_p, "both": {}}[bad]
    assert t == want and len(errs) == (2 if bad == "both" else 1)
    files = _files(9) + ["src/agent/a.test.jsx", "src/agent/b.test.jsx"]
    lst = tmp_path / "files.txt"
    lst.write_text("\n".join(files) + "\n", encoding="utf-8")
    seen = []
    for i in range(1, 4):
        assert avs.main(["--files-list", str(lst), "--of", "3", "--shard", str(i), "--timings", str(prim),
                         "--timings-fallback", str(fb)]) == avs.OK
        cap = capsys.readouterr()
        seen += [l for l in cap.out.splitlines() if l]
        then = "splitting the Agent shards by count" if bad == "both" else "using the other timing file"
        assert sum(1 for l in cap.err.splitlines() if l.startswith("::warning") and l.endswith("(%s)" % then)) == len(errs)
    assert sorted(seen) == sorted(files) and len(seen) == len(set(seen))


def test_browser_shards_plan_with_the_committed_file_as_fallback():
    step = [s for s in _wf()["jobs"]["browser"]["steps"] if s.get("name") == "vitest shard"][0]["run"]
    assert 'F=../tools/agent_vitest_shard_timings.json' in step
    assert step.count('--timings "$T" --timings-fallback "$F"') == 2      # the --plan line and the --shard line


# ---- split test files (2026-11-17): the slices together are exactly the old file --------------------------------
AGENT = ROOT / "app" / "src" / "agent"
#: old file -> (suite module, slice count). A split moves the old file's body verbatim into the module; each slice file
#: calls the suite with its index. Adding a split here is how the rails below learn about it.
SPLITS = {
    "agentTickerCompoundExclusion.test.jsx": ("testing/tickerCompoundExclusionSuite.jsx", 3),
}


@pytest.mark.parametrize("old", sorted(SPLITS))
def test_a_split_file_is_gone_and_every_slice_calls_its_suite_once(old):
    module, n = SPLITS[old]
    stem = old[: -len(".test.jsx")]
    assert not (AGENT / old).exists(), "the old file came back beside its slices: its tests would run twice"
    src = (AGENT / module).read_text(encoding="utf-8")
    assert "export const SLICES = %d\n" % n in src
    assert "const mine = (rows) => rows.filter((_, i) => i % SLICES === SLICE)" in src
    fn = src.split("export function ", 1)[1].split("(", 1)[0]
    slices = sorted(p.name for p in AGENT.glob(stem + ".*.test.jsx"))
    assert slices == ["%s.%d.test.jsx" % (stem, k) for k in range(n)], slices
    for k in range(n):
        body = (AGENT / ("%s.%d.test.jsx" % (stem, k))).read_text(encoding="utf-8")
        calls = [l for l in body.splitlines() if l.startswith(fn + "(")]
        assert calls == ["%s(%d)" % (fn, k)], (k, calls)


@pytest.mark.parametrize("old", sorted(SPLITS))
def test_a_split_suite_slices_every_table_and_keeps_each_single_test_once(old):
    """Every it.each table goes through mine(); every other test is in slice 0 only; describe names never vary."""
    module, _n = SPLITS[old]
    src = (AGENT / module).read_text(encoding="utf-8")
    assert src.count("it.each(") == src.count("it.each(mine(") > 0
    lines = src.splitlines()
    in_slice0_describe = False           # inside `if (SLICE === 0) describe(...)`, up to its closing `})` at column 0
    singles = 0
    for l in lines:
        s = l.strip()
        if l.startswith("if (SLICE === 0) describe("):
            in_slice0_describe = True
        elif in_slice0_describe and l.startswith("})"):
            in_slice0_describe = False
        if s.startswith("it(") or s.startswith("test("):
            assert in_slice0_describe, "a single test outside the slice-0 guard: %r" % s
            singles += 1
        elif s.startswith("if (SLICE === 0) it("):
            singles += 1
        if "describe(" in s:
            assert "SLICE" not in s.split("describe(", 1)[1].split("',", 1)[0], "a describe name that varies by slice: %r" % s
    assert singles, "the single tests are not guarded"


@pytest.mark.parametrize("old", sorted(SPLITS))
def test_a_split_files_slices_are_timed_and_the_old_entry_is_gone(old):
    module, n = SPLITS[old]
    stem = "src/agent/" + old[: -len(".test.jsx")]
    t, err = avs.read_timings()
    assert err is None and stem + ".test.jsx" not in t
    assert all(t.get("%s.%d.test.jsx" % (stem, k), 0) > 0 for k in range(n))


# ---- capreg @ rth legs (2026-11-17) -----------------------------------------------------------------------------
def _capreg():
    doc = _wf()
    return doc, doc["jobs"]["capability-regression-clock"], doc["jobs"]["capability-regression"]


def test_capreg_rth_runs_as_legs_that_agree_with_the_leg_count():
    doc, job, _join = _capreg()
    legs = int(doc["env"]["CAPREG_RTH_LEGS"])
    clocks = job["strategy"]["matrix"]["clock"]
    assert clocks == ["post"] + ["rth-%d" % k for k in range(1, legs + 1)] and legs >= 2
    assert job["env"]["CAPREG_CLOCK"] == "${{ startsWith(matrix.clock, 'rth') && 'rth' || matrix.clock }}"
    step = [s for s in job["steps"] if "vitest run" in (s.get("run") or "")]
    assert len(step) == 1 and step[0]["if"] == "matrix.clock != 'post'"
    run = step[0]["run"]
    assert "npx vitest list src/agent/qa/capabilityRegression --filesOnly" in run
    assert '--of "${CAPREG_RTH_LEGS}"' in run and '--shard "$K"' in run and 'K="${LEG#rth-}"' in run
    assert 'test -s "../capreg-$LEG.files"' in run                       # never an unfiltered vitest run
    assert '--reporter=json --outputFile="../capreg-$LEG.json"' in run   # the join job's union reads it on every event
    up = [s for s in job["steps"] if "upload-artifact" in (s.get("uses") or "") and "agent-capreg-" in str(s["with"].get("name"))]
    assert len(up) == 1 and up[0]["with"]["name"] == "agent-capreg-${{ matrix.clock }}"
    assert up[0]["with"]["if-no-files-found"] == "error"
    for part in ("capreg-${{ matrix.clock }}.json", "capreg-${{ matrix.clock }}.expected.txt"):
        assert part in up[0]["with"]["path"]


def test_capreg_post_keeps_the_history_and_rth_legs_take_a_shallow_checkout():
    _doc, job, _join = _capreg()
    co = [s for s in job["steps"] if str(s.get("uses", "")).startswith("actions/checkout@")][0]
    assert co["with"]["fetch-depth"] == "${{ matrix.clock != 'post' && 1 || 0 }}"


def _rth_union_script():
    _doc, _job, join = _capreg()
    run = [s for s in join["steps"] if (s.get("name") or "").startswith("The rth legs ran the whole suite once")][0]["run"]
    return run.split("<<'EOF'\n", 1)[1].rsplit("EOF", 1)[0]


def _rth_fixture(tmp_path, files, legs, lists=None, failed=0, n=None, n_lists=None):
    d = tmp_path / "capreg"
    d.mkdir()
    for i, members in enumerate(legs, 1):
        doc = {"numFailedTests": failed if i == 1 else 0, "numPassedTests": len(members),
               "testResults": [{"name": "/runner/w/app/" + f, "startTime": 0, "endTime": 1} for f in members]}
        (d / ("capreg-rth-%d.json" % i)).write_text(json.dumps(doc), encoding="utf-8")
        if n_lists is not None and i > n_lists:
            continue                      # a report with no expected list (only the report count is wrong)
        lst = files if lists is None else lists[i - 1]
        (d / ("capreg-rth-%d.expected.txt" % i)).write_text("\n".join(lst) + "\n", encoding="utf-8")
    (tmp_path / "rth.js").write_text(_rth_union_script(), encoding="utf-8")
    env = dict(__import__("os").environ, CAPREG_RTH_LEGS=str(len(legs) if n is None else n))
    return subprocess.run(["node", "rth.js"], cwd=tmp_path, capture_output=True, text=True, env=env)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("mutant", ["none", "drop_one", "duplicate_one", "drop_leg", "extra_leg", "lists_differ",
                                    "failed", "too_few_files", "outside_list"])
def test_capreg_rth_union_rail_fails_closed(tmp_path, mutant):
    files = _files(17, "src/agent/qa/capabilityRegression/c")
    legs = avs.assign(files, {f: 1000 + i for i, f in enumerate(files)}, 2)
    kw = {}
    if mutant == "drop_one":
        legs[1] = legs[1][1:]
    elif mutant == "duplicate_one":
        legs[0] = legs[0] + legs[1][:1]
    elif mutant == "drop_leg":
        kw["n"] = 2
        legs = legs[:1]
    elif mutant == "extra_leg":
        kw["n"] = 1
    elif mutant == "lists_differ":
        kw["lists"] = [files, files[:-1]]
    elif mutant == "failed":
        kw["failed"] = 1
    elif mutant == "too_few_files":
        files = files[:9]
        legs = avs.assign(files, {}, 2)
    elif mutant == "outside_list":
        legs[0] = legs[0] + ["src/agent/elsewhere.test.jsx"]
    r = _rth_fixture(tmp_path, files, legs, **kw)
    if mutant == "none":
        assert r.returncode == 0 and "::error::" not in r.stdout, r.stdout + r.stderr
        assert "17 files listed; 2 legs ran 17 distinct" in r.stdout
    else:
        assert r.returncode == 1 and "::error::" in r.stdout, (mutant, r.stdout + r.stderr)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_capreg_rth_union_rail_fails_a_correct_union_over_the_wrong_number_of_reports(tmp_path):
    """AUDIT #1839: the union is exactly right (every file once, nothing outside the list, none failed) and there are
    exactly CAPREG_RTH_LEGS identical expected lists, but THREE reports for two legs. Only the report-count check can
    catch it; with that check removed the rail would pass it."""
    files = _files(17, "src/agent/qa/capabilityRegression/c")
    legs = [files[:1], files[1:2], files[2:]]
    assert sorted(f for leg in legs for f in leg) == sorted(files) and len(set(files)) == 17   # a correct union, no dupes
    r = _rth_fixture(tmp_path, files, legs, n=2, n_lists=2)
    assert sorted(p.name for p in (tmp_path / "capreg").iterdir()) == [
        "capreg-rth-1.expected.txt", "capreg-rth-1.json", "capreg-rth-2.expected.txt", "capreg-rth-2.json",
        "capreg-rth-3.json"]
    assert r.returncode == 1, r.stdout + r.stderr
    assert [ln for ln in r.stdout.splitlines() if ln.startswith("::error::")] == [
        "::error::expected 2 rth leg reports, got 3"], r.stdout + r.stderr


def test_capreg_join_downloads_the_rth_legs_and_still_requires_every_leg_success():
    _doc, _job, join = _capreg()
    assert join["needs"] == "capability-regression-clock"
    names = [s.get("name") or s.get("uses") for s in join["steps"]]
    # P2c: step 0 is the payload validation every job starts with; the all-legs-success check follows it
    assert join["steps"][0]["id"] == "payload"
    first = [s for s in join["steps"] if s.get("name") == "Both pinned clocks passed"]
    assert len(first) == 1 and names.index("Both pinned clocks passed") == 1
    assert 'test "${{ needs.capability-regression-clock.result }}" = "success"' in first[0]["run"]
    dl = [s for s in join["steps"] if "download-artifact" in (s.get("uses") or "")]
    assert len(dl) == 1 and dl[0]["with"]["pattern"] == "agent-capreg-rth-*" and dl[0]["with"]["merge-multiple"] is True
    assert names.index(dl[0].get("uses")) < [i for i, n in enumerate(names) if str(n).startswith("The rth legs")][0]
