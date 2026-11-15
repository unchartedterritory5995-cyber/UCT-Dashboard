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
    assert job["name"] == "UCT Agent browser tests (shard ${{ matrix.shard }}/4)"
    assert job["strategy"]["matrix"]["shard"] == [1, 2, 3, 4] and doc["env"]["AGENT_SHARDS"] == "4"
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
