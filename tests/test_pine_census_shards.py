"""Rails for `run_census.py --shards N` (2026-11-26): the census in N concurrent processes, merged.

No census runs here: the census loop (`run_census.drive`) is driven with a fake vitest (as
tests/test_pine_coverage_ratchet.py does), and the shard processes are run IN PROCESS by a runner that calls
`worker_main` with the very argv the real runner would start. What must stay true, each a test below:

  * the partition is deterministic (input order never matters), disjoint, complete and balanced, and refuses
    n < 1, a repeated key, and more shards than inputs;
  * --shards 1 (the default) IS today's path: main() calls drive() with today's arguments, no shard directory,
    no shards.json;
  * N shards merge into <cache>: every input exactly once, census_input.json the full inputs, the store record,
    lane.jsonl from every shard, and the rows equal an N=1 census of the same inputs (`ms` dropped);
  * the comparison catches a census whose rows depend on what the same process measured before (warm state);
  * MUTANTS refused, named: a shard dropped, a row double-counted, a row that is no input, a torn row or lane
    line, a shard measured with another store, a shard whose lane proof failed, a shard that exited non-zero;
  * each shard's vitest has a cache directory of its own (app/vite.config.js reads it); N=1 never inherits one;
  * memory: refuses (fail closed) below 6 GB a shard + 2 GB free, or when free RAM cannot be read, before any
    shard directory exists;
  * resume guards: another lane's rows, an unsharded census, another sharding, a stale shard directory;
  * the real runner starts every shard AT ONCE and returns each exit code in order.
"""
from __future__ import annotations

import itertools
import json
import os
import pathlib
import random
import sys
import textwrap

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import run_census as RC  # noqa: E402

PROD, RT = RC.LANE_PRODUCTION, RC.LANE_RUNTIME_ON
PLENTY = 1000.0     # GB: the RAM probe's stand-in when memory is not what a test is about


def _items(n, prefix="committed:x"):
    return [{"key": "%s%03d" % (prefix, i), "path": "unused", "cap": 8} for i in range(n)]


def _fake_vitest(monkeypatch, verdict=None, lane_ok=True, loaded=None, seen=None):
    """Stand in for `node vitest run <census>`: one row per unanswered input of COVERAGE_INPUT (with an `ms`
    that never repeats, as wall clock), a lane.jsonl pass, `libraryStore` = the store's size. `verdict(key, nth)` is
    the row's `clean`, where nth counts the rows THIS process already wrote (warm per-process state)."""
    state = {}
    clock = itertools.count(1)           # wall clock: never the same twice, so a kept `ms` always differs

    def call(cmd, cwd=None, env=None):
        if seen is not None:
            seen.setdefault(env["COVERAGE_OUT"], []).append(env.get(RC.VITEST_CACHE_ENV))
        items = json.loads(open(env["COVERAGE_INPUT"], encoding="utf-8").read())
        out = env["COVERAGE_OUT"]
        lane = PROD if env["COVERAGE_RUNTIME_ON"] == "0" else RT
        store = len(RC.store_manifest(env.get("PINE_LIBRARY_STORE")))
        store = loaded(store) if loaded else store
        done = RC.done_keys(out)
        new = [it for it in items if it["key"] not in done]
        with open(out, "a", encoding="utf-8") as f:
            for it in new:
                nth = state.get(out, 0)
                state[out] = nth + 1
                row = {"key": it["key"], "lane": lane, "ms": next(clock),
                       **({"libraryStore": store} if store else {}),
                       "attached": True, "clean": verdict(it["key"], nth) if verdict else True, "steps": [{}]}
                f.write(json.dumps(row) + "\n")
        if new:
            with open(pathlib.Path(out).parent / "lane.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"requested": lane, "ok": lane_ok, "line": "x", "rows": len(new)}) + "\n")
        return 0
    monkeypatch.setattr(RC.subprocess, "call", call)


def in_process(argvs, logs, skip=(), after=None):
    """The shard runner, in process: each argv is the real one (`<python> run_census.py shard-worker ...`)."""
    rcs = []
    for k, argv in enumerate(argvs):
        assert argv[0] == sys.executable and argv[1].endswith("run_census.py") and argv[2] == "shard-worker"
        if k in skip:
            rcs.append(0)                     # MUTANT: a shard never ran, yet "exited 0"
            continue
        try:
            RC.worker_main(argv[3:])
            rcs.append(0)
        except SystemExit as e:
            rcs.append(e.code if isinstance(e.code, int) else 1)
    if after:
        after()
    return rcs


def _store(tmp_path, paths, name="store"):
    root = tmp_path / name
    for i, p in enumerate(paths):
        f = root / (p + ".json")
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"path": p, "sha256": ("%02d" % i) * 32, "source": "x"}), encoding="utf-8")
    return root


def _keys(path):
    return [json.loads(l)["key"] for l in open(path, encoding="utf-8") if l.strip()]


# ── the partition ─────────────────────────────────────────────────────────────

def test_partition_is_deterministic_disjoint_complete_and_balanced():
    items = _items(10)
    shuffled = list(items)
    random.Random(7).shuffle(shuffled)
    parts = RC.partition(shuffled, 3)
    assert parts == RC.partition(items, 3)                        # the input order never matters
    assert [[it["key"] for it in p] for p in parts] == [
        ["committed:x000", "committed:x003", "committed:x006", "committed:x009"],
        ["committed:x001", "committed:x004", "committed:x007"],
        ["committed:x002", "committed:x005", "committed:x008"]]
    flat = [it["key"] for p in parts for it in p]
    assert sorted(flat) == sorted(it["key"] for it in items) and len(set(flat)) == len(flat)
    assert RC.partition(shuffled, 1) == [sorted(items, key=lambda it: it["key"])]


def test_partition_refuses_a_repeated_key_and_a_bad_count():
    with pytest.raises(RC.CensusRunError, match="repeat 1 key"):
        RC.partition(_items(3) + _items(1), 2)
    for bad in (0, -1, 1.5):
        with pytest.raises(RC.CensusRunError, match="--shards"):
            RC.partition(_items(3), bad)


def test_more_shards_than_inputs_is_refused(monkeypatch, tmp_path):
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="no input proves no lane"):
        RC.drive_sharded(_items(2), str(tmp_path / "c"), PROD, 3, runner=in_process, free=PLENTY)


# ── N=1 is today's path ───────────────────────────────────────────────────────

def _world(tmp_path):
    cache = tmp_path / "cache"
    (cache / "s").mkdir(parents=True)
    rows = []
    for i in range(4):
        p = cache / "s" / ("a%d.pine" % i)
        p.write_text("//@version=5\nindicator('a')\nplot(close)\n", encoding="utf-8")
        rows.append({"key": "sample:a%d" % i, "path": str(p), "status": "ok"})
    (cache / "sample_manifest.json").write_text(json.dumps({"rows": rows}), encoding="utf-8")
    ref = tmp_path / "ref.json"
    ref.write_text(json.dumps({"functions": [{"name": "ta.sma", "examples": ["//@version=5\nindicator('x')\nplot(1)\n"]}]}),
                   encoding="utf-8")
    return cache, ref


def test_main_without_shards_calls_drive_exactly_as_before(monkeypatch, tmp_path):
    cache, ref = _world(tmp_path)
    calls = []
    monkeypatch.setattr(RC, "drive", lambda *a, **k: calls.append(("drive", a, k)))
    monkeypatch.setattr(RC, "drive_sharded", lambda *a, **k: calls.append(("sharded", a, k)))
    for extra in ([], ["--shards", "1"]):
        calls.clear()
        monkeypatch.setattr(sys, "argv", ["run_census.py", "--cache", str(cache), "--ref", str(ref)] + extra)
        RC.main()
        assert len(calls) == 1 and calls[0][0] == "drive"
        _, args, kw = calls[0]
        assert args[1:] == (str(cache), PROD) and len(args[0]) == 5          # 4 sample + 1 example
        assert kw == {"census_test": RC.CENSUS, "max_restarts": 40, "library_store": None}
    calls.clear()
    monkeypatch.setattr(sys, "argv", ["run_census.py", "--cache", str(cache), "--ref", str(ref), "--shards", "3",
                                      "--runtime-on"])
    RC.main()
    assert [c[0] for c in calls] == ["sharded"] and calls[0][1][1:] == (str(cache), RT, 3)


def test_drive_sharded_with_one_shard_is_drive(monkeypatch, tmp_path):
    _fake_vitest(monkeypatch)
    items = _items(5)
    cache = tmp_path / "one"
    assert RC.drive_sharded(items, str(cache), PROD, 1, runner=lambda *a: pytest.fail("no runner for N=1"),
                            free=0.0) == 5                     # and no memory gate: N=1 is untouched
    assert sorted(os.listdir(cache)) == ["census.jsonl", "census_input.json", "lane.jsonl", "library_store.json"]


# ── N shards: the merge ──────────────────────────────────────────────────────

def test_three_shards_merge_into_one_census_equal_to_one_process(monkeypatch, tmp_path):
    root = _store(tmp_path, ["TradingView/ta/11", "TradingView/RelativeValue/3"])
    items = _items(11) + _items(3, "example:functions:ta.sma#")
    _fake_vitest(monkeypatch, verdict=lambda key, nth: not key.endswith("7"))     # a pure function of the script
    one, three = tmp_path / "one", tmp_path / "three"
    assert RC.drive(items, str(one), PROD, library_store=str(root)) == 14
    assert RC.drive_sharded(items, str(three), PROD, 3, library_store=str(root), runner=in_process,
                            free=PLENTY) == 14
    # every input exactly once, shard 0's rows first
    keys = _keys(three / "census.jsonl")
    assert sorted(keys) == sorted(it["key"] for it in items) and len(set(keys)) == 14
    parts = RC.partition(items, 3)
    assert keys == [it["key"] for p in parts for it in p]
    # the full inputs, the store, every shard's lane pass
    assert json.loads((three / "census_input.json").read_text(encoding="utf-8")) == items
    assert [r["path"] for r in json.loads((three / RC.LIBRARY_STORE_FILE).read_text(encoding="utf-8"))] == [
        "TradingView/RelativeValue/3", "TradingView/ta/11"]
    assert len((three / "lane.jsonl").read_text(encoding="utf-8").splitlines()) == 3
    # each shard is a full census of its own
    for k in range(3):
        sd = three / ("shard-%d" % k)
        for f in ("census_input.json", "census.jsonl", "lane.jsonl", "library_store.json"):
            assert (sd / f).exists(), (k, f)
        assert json.loads((sd / "census_input.json").read_text(encoding="utf-8")) == parts[k]
    plan = json.loads((three / RC.SHARDS_FILE).read_text(encoding="utf-8"))
    assert plan["shards"] == 3 and plan["lane"] == PROD
    # THE PROOF the owner runs for real: identical row for row, `ms` dropped (and NOT identical with it)
    r = RC.compare_censuses(str(one), str(three))
    assert r == {"rows": (14, 14), "onlyA": [], "onlyB": [], "differ": [], "fields": {}}
    assert RC.compare_censuses(str(one), str(three), drop=())["fields"] == {"ms": 14}   # ms is wall clock
    # a re-run over the finished shards re-merges the same rows (resumable, idempotent)
    before = (three / "census.jsonl").read_bytes()
    assert RC.drive_sharded(items, str(three), PROD, 3, library_store=str(root), runner=in_process,
                            free=PLENTY) == 14
    assert (three / "census.jsonl").read_bytes() == before


def test_the_comparison_catches_warm_per_process_state(monkeypatch, tmp_path):
    """A census whose verdict depends on how many scripts the SAME process measured before: N=1 and N=3 differ,
    and `compare` says so, by key. This is what the real N=1 vs N=3 proof exists to catch."""
    items = _items(9)
    _fake_vitest(monkeypatch, verdict=lambda key, nth: nth < 4)         # the heap fills after 4 scripts
    one, three = tmp_path / "one", tmp_path / "three"
    RC.drive(items, str(one), PROD)
    RC.drive_sharded(items, str(three), PROD, 3, runner=in_process, free=PLENTY)
    r = RC.compare_censuses(str(one), str(three))
    assert r["differ"] == ["committed:x%03d" % i for i in range(4, 9)] and not r["onlyA"] and not r["onlyB"]
    assert r["fields"] == {"clean": 5}                                  # and it names the field that varies
    assert RC.compare_main([str(one), str(three)]) == 1
    assert RC.compare_main([str(one), str(one)]) == 0


def test_compare_names_a_row_only_one_census_holds(monkeypatch, tmp_path):
    _fake_vitest(monkeypatch)
    a, b = tmp_path / "a", tmp_path / "b"
    RC.drive(_items(3), str(a), PROD)
    RC.drive(_items(4), str(b), PROD)
    r = RC.compare_censuses(str(a), str(b))
    assert r["onlyB"] == ["committed:x003"] and not r["onlyA"] and not r["differ"]


# ── MUTANTS: each refused, named ─────────────────────────────────────────────

def test_a_dropped_shard_is_refused(monkeypatch, tmp_path):
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="shard-1 has no census.jsonl"):
        RC.drive_sharded(_items(9), str(tmp_path / "c"), PROD, 3, free=PLENTY,
                         runner=lambda a, l: in_process(a, l, skip={1}))


def test_a_shard_that_lost_rows_is_refused(monkeypatch, tmp_path):
    cache = tmp_path / "c"

    def truncate():
        p = cache / "shard-2" / "census.jsonl"
        p.write_text("".join(p.read_text(encoding="utf-8").splitlines(True)[:-1]), encoding="utf-8")
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="missing 1"):
        RC.drive_sharded(_items(9), str(cache), PROD, 3, free=PLENTY,
                         runner=lambda a, l: in_process(a, l, after=truncate))


def test_a_double_counted_row_is_refused(monkeypatch, tmp_path):
    cache = tmp_path / "c"

    def double():
        row = (cache / "shard-0" / "census.jsonl").read_text(encoding="utf-8").splitlines(True)[0]
        with open(cache / "shard-2" / "census.jsonl", "a", encoding="utf-8") as f:
            f.write(row)
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="shard-0 and shard-2 \\(double count\\)"):
        RC.drive_sharded(_items(9), str(cache), PROD, 3, free=PLENTY,
                         runner=lambda a, l: in_process(a, l, after=double))


def test_a_row_that_is_no_input_and_a_torn_line_are_refused(monkeypatch, tmp_path):
    for name, tail, match in (("extra", json.dumps({"key": "committed:zzz", "lane": PROD, "steps": []}) + "\n",
                               "not an input 1"),
                              ("torn", '{"key": "committed:x0', "not a row")):
        cache = tmp_path / name

        def tamper(cache=cache, tail=tail):
            with open(cache / "shard-1" / "census.jsonl", "a", encoding="utf-8") as f:
                f.write(tail)
        _fake_vitest(monkeypatch)
        with pytest.raises(RC.CensusRunError, match=match):
            RC.drive_sharded(_items(6), str(cache), PROD, 2, free=PLENTY,
                             runner=lambda a, l, t=tamper: in_process(a, l, after=t))


def test_a_torn_lane_line_is_a_named_merge_refusal(monkeypatch, tmp_path):
    cache = tmp_path / "c"

    def tear():
        with open(cache / "shard-1" / "lane.jsonl", "a", encoding="utf-8") as f:
            f.write('{"requested": "production", "ok": tr')
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="SHARD MERGE: shard-1 lane.jsonl holds a line that is not a lane pass"):
        RC.drive_sharded(_items(6), str(cache), PROD, 2, free=PLENTY,
                         runner=lambda a, l: in_process(a, l, after=tear))
    assert not (cache / "lane.jsonl").exists()                   # refused before anything merged was written


def test_a_shard_measured_with_another_store_is_refused(monkeypatch, tmp_path):
    root = _store(tmp_path, ["TradingView/ta/11"])
    cache = tmp_path / "c"

    def swap():
        (cache / "shard-1" / RC.LIBRARY_STORE_FILE).write_text("[]", encoding="utf-8")
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="shard-1 measured another library store"):
        RC.drive_sharded(_items(6), str(cache), PROD, 2, library_store=str(root), free=PLENTY,
                         runner=lambda a, l: in_process(a, l, after=swap))


def test_the_merged_files_are_proved_again(monkeypatch, tmp_path):
    """A shard whose lane.jsonl was altered after its own drive() passed: the merged lane proof refuses it."""
    cache = tmp_path / "c"

    def unprove():
        (cache / "shard-1" / "lane.jsonl").write_text(json.dumps({"requested": RT, "ok": True, "line": "x"}) + "\n",
                                                      encoding="utf-8")
    _fake_vitest(monkeypatch)
    with pytest.raises(RC.CensusRunError, match="LANE NOT MEASURED"):
        RC.drive_sharded(_items(6), str(cache), PROD, 2, free=PLENTY,
                         runner=lambda a, l: in_process(a, l, after=unprove))


def test_a_shard_whose_own_census_failed_is_refused(monkeypatch, tmp_path):
    root = _store(tmp_path, ["TradingView/ta/11", "TradingView/RelativeValue/3"])
    _fake_vitest(monkeypatch, loaded=lambda n: n - 1)             # every shard's drive() refuses its store
    with pytest.raises(RC.CensusRunError, match="SHARDS FAILED: \\[0, 1\\] of 2"):
        RC.drive_sharded(_items(4), str(tmp_path / "c"), PROD, 2, library_store=str(root), free=PLENTY,
                         runner=in_process)
    _fake_vitest(monkeypatch, lane_ok=False)
    with pytest.raises(RC.CensusRunError, match="SHARDS FAILED"):
        RC.drive_sharded(_items(4), str(tmp_path / "d"), PROD, 2, free=PLENTY, runner=in_process)


# ── each shard's own vitest cache ────────────────────────────────────────────

def test_each_shard_runs_vitest_with_a_cache_directory_of_its_own(monkeypatch, tmp_path):
    """vitest exits 0 when it selects nothing, so a cache N processes share must never decide what one runs."""
    monkeypatch.setenv(RC.VITEST_CACHE_ENV, str(tmp_path / "callers"))    # the caller's: never the measurement's
    seen = {}
    _fake_vitest(monkeypatch, seen=seen)
    cache = tmp_path / "c"
    RC.drive_sharded(_items(9), str(cache), PROD, 3, free=PLENTY, runner=in_process)
    want = {os.path.join(str(cache), "shard-%d" % k, "census.jsonl"):
            [os.path.abspath(os.path.join(str(cache), "shard-%d" % k, RC.SHARD_VITEST_CACHE))] for k in range(3)}
    assert seen == want and len({v[0] for v in seen.values()}) == 3
    # N=1 (today's path): no cache directory is set, and the caller's is not inherited
    seen.clear()
    RC.drive(_items(2), str(tmp_path / "one"), PROD)
    assert list(seen.values()) == [[None]]


def test_vite_config_reads_the_shard_cache_variable_into_cachedir():
    """The other half of the wire: app/vite.config.js sets Vite's cacheDir from the variable drive() sets, and
    only when it is set (unset: Vite's default, so every other vitest run is unchanged)."""
    import re
    text = (ROOT / "app" / "vite.config.js").read_text(encoding="utf-8")
    name = re.escape(RC.VITEST_CACHE_ENV)
    assert re.search(r"\.\.\.\(process\.env\.%s\s*\?\s*\{\s*cacheDir:\s*process\.env\.%s\s*\}\s*:\s*\{\}\)"
                     % (name, name), text), "vite.config.js no longer reads %s into cacheDir" % RC.VITEST_CACHE_ENV


# ── memory: fail closed ──────────────────────────────────────────────────────

def test_memory_gate_refuses_before_any_shard_exists(monkeypatch, tmp_path):
    assert RC.required_free_gb(3) == 20.0
    _fake_vitest(monkeypatch)
    cache = tmp_path / "c"
    with pytest.raises(RC.CensusRunError, match="SHARDS REFUSED: 19.9 GB free, 3 shards need 20 GB"):
        RC.drive_sharded(_items(9), str(cache), PROD, 3, free=19.9, runner=lambda *a: pytest.fail("started"))
    assert not any(d.startswith("shard-") for d in os.listdir(cache)) and not (cache / RC.SHARDS_FILE).exists()
    monkeypatch.setattr(RC, "free_ram_gb", lambda: None)
    with pytest.raises(RC.CensusRunError, match="free RAM cannot be read"):
        RC.drive_sharded(_items(9), str(cache), PROD, 3, runner=lambda *a: pytest.fail("started"))
    monkeypatch.setattr(RC, "free_ram_gb", lambda: 20.0)
    assert RC.drive_sharded(_items(9), str(cache), PROD, 3, runner=in_process) == 9


def test_the_ram_probe_reads_this_machine():
    got = RC.free_ram_gb()
    assert got is not None and 0 < got < 4096


# ── resume guards ────────────────────────────────────────────────────────────

def test_resume_guards(monkeypatch, tmp_path):
    _fake_vitest(monkeypatch)
    items = _items(6)
    plain = tmp_path / "plain"
    RC.drive(items, str(plain), PROD)
    with pytest.raises(RC.CensusRunError, match="holds an unsharded census"):
        RC.drive_sharded(items, str(plain), PROD, 2, free=PLENTY, runner=in_process)
    other = tmp_path / "other"
    RC.drive(items, str(other), RT)
    with pytest.raises(RC.CensusRunError, match="another lane"):
        RC.drive_sharded(items, str(other), PROD, 2, free=PLENTY, runner=in_process)
    two = tmp_path / "two"
    RC.drive_sharded(items, str(two), PROD, 2, free=PLENTY, runner=in_process)
    with pytest.raises(RC.CensusRunError, match="records another sharding"):
        RC.drive_sharded(items, str(two), PROD, 3, free=PLENTY, runner=in_process)
    with pytest.raises(RC.CensusRunError, match="records another sharding"):
        RC.drive_sharded(items + _items(1, "committed:y"), str(two), PROD, 2, free=PLENTY, runner=in_process)
    stale = tmp_path / "stale"
    (stale / "shard-4").mkdir(parents=True)
    with pytest.raises(RC.CensusRunError, match="beyond --shards 2"):
        RC.drive_sharded(items, str(stale), PROD, 2, free=PLENTY, runner=in_process)


# ── the real runner: every shard at once ─────────────────────────────────────

def test_run_processes_starts_every_command_at_once_and_returns_each_exit_code(tmp_path):
    """Each child waits (up to 60 s) for every OTHER child's start marker: only a runner that starts them all
    before waiting on any lets the three finish. Exit codes come back in order, output in each log."""
    script = textwrap.dedent("""
        import os, sys, time
        d, me, n, rc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
        open(os.path.join(d, "start-%d" % me), "w").close()
        t0 = time.time()
        while not all(os.path.exists(os.path.join(d, "start-%d" % k)) for k in range(n)):
            if time.time() - t0 > 60:
                print("ALONE"); sys.exit(9)
            time.sleep(0.05)
        print("together %d" % me); sys.exit(rc)
    """)
    s = tmp_path / "child.py"
    s.write_text(script, encoding="utf-8")
    argvs = [[sys.executable, str(s), str(tmp_path), str(k), "3", str(rc)] for k, rc in enumerate((0, 3, 0))]
    logs = [str(tmp_path / ("log-%d" % k)) for k in range(3)]
    assert RC.run_processes(argvs, logs) == [0, 3, 0]
    for k in range(3):
        assert (tmp_path / ("log-%d" % k)).read_text().strip() == "together %d" % k


def test_worker_argv_carries_the_lane_store_and_test(tmp_path):
    argv = RC.worker_argv(str(tmp_path / "shard-0"), RT, "x.test.js", 7, str(tmp_path / "store"))
    assert argv[:3] == [sys.executable, os.path.abspath(RC.__file__), "shard-worker"]
    assert argv[3:] == ["--dir", str(tmp_path / "shard-0"), "--lane", RT, "--census-test", "x.test.js",
                        "--max-restarts", "7", "--library-store", os.path.abspath(str(tmp_path / "store"))]
    assert "--library-store" not in RC.worker_argv("d", PROD, "t", 1, None)
