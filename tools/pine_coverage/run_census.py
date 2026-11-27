# -*- coding: utf-8 -*-
"""run_census.py - drive the member-door census over the coverage-map sample.

  python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label pine-coverage -- \
      python tools/pine_coverage/run_census.py --cache <cache> --ref <pine_v6_reference.json>
  # sharded: run a sharded census under heavy_lock --solo; N=2 peaks ~12 GB, N=3 peaks ~18 GB
  python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --solo --label pine-coverage run -- \
      python tools/pine_coverage/run_census.py --cache <fresh cache> --ref <pine_v6_reference.json> --shards 2

Inputs
  <cache>/sample_manifest.json   from fetch_sample.py (committed + reference + builtin)
  --ref                          TradingView's own v6 reference, extracted by
                                 tools/pine_survey/pine_reference_extract.js
Writes
  <cache>/examples/*.pine        every reference EXAMPLE that is a whole script
                                 (TradingView's own usage of each item: the door is
                                 asked with THEIR code, never a probe we construct)
  <cache>/census_input.json
  <cache>/census.jsonl           one row per script, appended (resumable)

The census itself is app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js.
It is restarted here until every input has a row: a process death (OOM, native
stall) is attributed to the script named in current.txt and recorded as `killed`.

⛔ vitest exits 0 when it selects nothing, so success is judged by the ROW COUNT,
never by the exit code.

⭐⭐ TWO LANES (Phase 3, WS-0; tools/pine_coverage/runtime_lane.mjs):
  default        PRODUCTION: objects-only pane armed, runtime pane dark (plus the
                 census's step-0 runtime counterfactual, `row.runtime`)
  --runtime-on   RUNTIME-ON: the runtime pane on at EVERY peel step, as a permitted
                 member with every script graded; the peel follows the runtime
                 lane's own refusal. Use a SEPARATE --cache directory per lane.
The lane is set here explicitly (COVERAGE_RUNTIME_ON='1' or '0'), never inherited
from the caller's environment. Every row names the lane it measured, the census
refuses to finish when the lane it measured is not the one asked for, and this
driver refuses a census.jsonl that holds rows of the other lane.

⭐⭐ THE LIBRARY STORE IS PART OF THE MEASUREMENT (libraries chain L1, 2026-11-19).
Production's store serves the `promote` rows of tools/pine_library/promotion_allowlist.json,
and the host lane links them for members with no runtime admission. A census run with
an EMPTY store counts every importer of a promoted version as walled (the 11-18 map
counted five scripts production serves). So:
  --library-store <dir>   the store the door links from (`<dir>/<Author>/<Lib>/<N>.json`,
                          the layout `pine_library_store.py` writes): PINE_LIBRARY_STORE
                          for the census, set here explicitly, never inherited
  (left out)              the census measures an EMPTY store, and says so
Either way the driver writes `<cache>/library_store.json` ([{path, sha256}], what the
store held), which coverage_map.py records in the map, and it refuses a census whose
rows did not load every entry the store holds. The official measurement is the
promoted store (production's truth): build it with
  PINE_LIBRARY_DIR=<dir> python tools/pine_library/promotion_check.py install --from <scratch store> --apply

⭐ SHARDS (2026-11-26): `--shards N` runs the same census in N concurrent processes inside the caller's ONE
heavy_lock hold: the inputs sorted by key, input i to <cache>/shard-<i % N>/, each shard a full drive() (its own
restarts, killer rows, lane and store proofs), then the shards' census.jsonl and lane.jsonl are concatenated into
<cache> and proved again (lane, store, every input exactly once). Refuses unless 6 GB a shard + 2 GB is free.
Each shard's vitest gets its own cache directory (<cache>/shard-<k>/vitest-cache, via UCT_VITEST_CACHE_DIR, which
app/vite.config.js reads), so no shared cache decides what a shard runs. Default 1: one process, the path above.
On this box --shards 2 is the documented choice (~12 GB at the census's p90 peak); 3 only with >= 20 GB free.
Run it under heavy_lock --solo: a --shared partner's memory is not in the free-RAM check taken at the start. ⛔ Trust a sharded map only after an N=1 and an N>1 census of the same
tree and lane agreed row for row (by key, `ms` dropped): see drive_sharded.
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "app")
CENSUS = "src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js"
LANE_PRODUCTION = "production"
LANE_RUNTIME_ON = "runtime-on"


def row_lane(row):
    """A row's lane. Rows written before WS-0 carry none and were production."""
    return row.get("lane") or LANE_PRODUCTION


def lanes_in(path):
    """Counter of lanes over a census.jsonl (a killed-script row carries none: skipped)."""
    import collections
    c = collections.Counter()
    if os.path.exists(path):
        for l in open(path, encoding="utf-8"):
            try:
                d = json.loads(l)
            except Exception:  # noqa: BLE001
                continue
            if d.get("stuck") == "killed" and "lane" not in d:
                continue
            c[row_lane(d)] += 1
    return c


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def safe(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:80]


LIBRARY_STORE_FILE = "library_store.json"


def store_manifest(root):
    """[{path, sha256}] of every version a library store directory holds (`<root>/<Author>/<Lib>/<N>.json`, the
    layout `api/services/pine_library_store.py` writes), sorted by path. None (or "") is the EMPTY store: [].
    Identifiers only: the library source never leaves the store. A store that names a missing directory, or an
    entry that cannot be read as {path, sha256}, refuses the census (CensusRunError): a measurement must never
    say which store it used from a guess."""
    if not root:
        return []
    if not os.path.isdir(root):
        raise CensusRunError("--library-store %s is not a directory" % root)
    out = []
    for author in sorted(os.listdir(root)):
        adir = os.path.join(root, author)
        if not os.path.isdir(adir):
            continue
        for name in sorted(os.listdir(adir)):
            ndir = os.path.join(adir, name)
            if not os.path.isdir(ndir):
                continue
            for f in sorted(os.listdir(ndir)):
                if not re.match(r"^[1-9][0-9]*\.json$", f):
                    continue
                try:
                    e = json.load(open(os.path.join(ndir, f), encoding="utf-8"))
                    path, sha = e["path"], str(e["sha256"]).lower()
                except Exception as err:  # noqa: BLE001
                    raise CensusRunError("library store entry %s cannot be read: %s" % (os.path.join(ndir, f), err))
                if path != "%s/%s/%s" % (author, name, f[:-5]) or not re.match(r"^[0-9a-f]{64}$", sha):
                    raise CensusRunError("library store entry %s names %r / %r" % (os.path.join(ndir, f), path, sha))
                out.append({"path": path, "sha256": sha})
    return sorted(out, key=lambda x: x["path"])


def assert_store_loaded(cache, expected):
    """⛔ Every row the census measured must have loaded every version the store holds (the census writes
    `libraryStore`, the count it loaded, on each row measured with a store; a row of an empty store carries
    none). A store entry the registry refused (a sha that is not its source's, a malformed entry) would
    otherwise measure a smaller store than the one named. A killed row is the driver's, not the census's."""
    want = len(expected)
    bad = []
    for l in open(os.path.join(cache, "census.jsonl"), encoding="utf-8"):
        if not l.strip():
            continue
        d = json.loads(l)
        if d.get("stuck") == "killed":
            continue
        got = d.get("libraryStore", 0)
        if got != want:
            bad.append((d.get("key"), got))
    if bad:
        raise CensusRunError("LIBRARY STORE NOT LOADED: the store holds %d version(s), %d row(s) loaded another "
                             "number (first: %s)" % (want, len(bad), bad[0]))


def build_examples(ref_path, out_dir):
    """Every example that DECLARES a script (indicator/strategy/library/study)."""
    ref = json.load(open(ref_path, encoding="utf-8"))
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    seen = {}
    for coll in ("functions", "methods", "variables", "constants", "keywords", "types", "operators", "annotations"):
        for e in ref.get(coll, []):
            for i, ex in enumerate(e.get("examples") or []):
                if not isinstance(ex, str):
                    continue
                if not re.search(r"^\s*(indicator|strategy|library|study)\s*\(", ex, re.M):
                    continue
                key = "example:%s:%s#%d" % (coll, e["name"], i)
                if ex in seen:            # identical example text is one script
                    continue
                seen[ex] = key
                p = os.path.join(out_dir, safe("%s__%s__%d" % (coll, e["name"], i)) + ".pine")
                with open(p, "w", encoding="utf-8", newline="") as f:
                    f.write(ex)
                rows.append({"key": key, "path": p, "cap": 1, "item": e["name"], "collection": coll})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--max-restarts", type=int, default=40)
    ap.add_argument("--census-test", default=CENSUS,
                    help="the census test file, relative to app/ (default: the committed one). A before/after "
                         "measurement of the instrument itself runs the OLD file beside the new")
    ap.add_argument("--runtime-on", action="store_true",
                    help="measure the RUNTIME-ON lane (runtime pane on at every peel step)")
    ap.add_argument("--library-store", default=None,
                    help="the library store the door links from (the official measurement: the promoted store, "
                         "production's truth). Left out: an EMPTY store, recorded as such")
    ap.add_argument("--shards", type=int, default=1,
                    help="run the census in N concurrent processes (<cache>/shard-<k>/, merged into <cache>), "
                         "inside the caller's ONE heavy_lock hold (run it --solo). Needs %.0f GB free a shard + %.0f "
                         "GB; refuses below. Default 1: one process, today's path. On this box: 2" % (SHARD_HEAP_GB, SHARD_HEADROOM_GB))
    a = ap.parse_args()
    lane = LANE_RUNTIME_ON if a.runtime_on else LANE_PRODUCTION
    cache = os.path.abspath(a.cache)
    man = json.load(open(os.path.join(cache, "sample_manifest.json"), encoding="utf-8"))["rows"]
    items = []
    for r in man:
        if r["status"] != "ok":
            continue
        p = r["path"].replace("<cache>", cache)
        if not os.path.isabs(p):
            p = os.path.join(ROOT, p)
        items.append({"key": r["key"], "path": os.path.abspath(p), "cap": 8})
    items += build_examples(a.ref, os.path.join(cache, "examples"))
    print("census lane requested: %s" % lane, flush=True)
    print("census inputs: %d (%d sample, %d examples)" % (
        len(items), sum(1 for i in items if not i["key"].startswith("example:")),
        sum(1 for i in items if i["key"].startswith("example:"))), flush=True)
    if a.shards == 1:
        drive(items, cache, lane, census_test=a.census_test, max_restarts=a.max_restarts,
              library_store=a.library_store)
    else:
        drive_sharded(items, cache, lane, a.shards, census_test=a.census_test, max_restarts=a.max_restarts,
                      library_store=a.library_store)


class CensusRunError(SystemExit):
    """A census run that did not answer every input, or did not measure the lane it was asked for.
    A SystemExit, so `run_census.py`'s own exits are what they were (the message, exit 1); the coverage
    ratchet (`coverage_ratchet.py`) drives the same loop and lets it end the run the same way."""


def done_keys(out):
    """The keys a census.jsonl answers (a torn tail line is skipped)."""
    ks = set()
    if os.path.exists(out):
        for l in open(out, encoding="utf-8"):
            try:
                ks.add(json.loads(l)["key"])
            except Exception:  # noqa: BLE001
                pass
    return ks


def assert_lane_measured(cache, lane):
    """⛔ The census's own per-pass record (`lane.jsonl`) and every row must say the lane that was asked
    for (the census asserts it from what the door did; this catches a census file from an older test).
    Returns the row count of that lane."""
    out = os.path.join(cache, "census.jsonl")
    lane_log = os.path.join(cache, "lane.jsonl")
    passes = [json.loads(l) for l in open(lane_log, encoding="utf-8") if l.strip()] if os.path.exists(lane_log) else []
    bad = [p for p in passes if not p.get("ok") or p.get("requested") != lane]
    if bad or not passes:
        raise CensusRunError("LANE NOT MEASURED: %s" % (
            bad[0].get("line") if bad else "no pass recorded its lane (lane.jsonl)"))
    got = lanes_in(out)
    if set(got) != {lane}:
        raise CensusRunError("LANE MISMATCH: requested %s, census rows say %s" % (lane, dict(got)))
    return got[lane]


def drive(items, cache, lane, census_test=CENSUS, max_restarts=40, library_store=None, vitest_cache_dir=None):
    """THE CENSUS LOOP, in one place (run_census.py's sample census and the coverage ratchet over the
    committed corpus both call it): write `items` ([{key, path, cap}]) as the census input, run the
    census test until every item has a row in <cache>/census.jsonl, restarting past a process death
    (the script named in current.txt is recorded `killed`), then prove the lane.
    ⛔ vitest exits 0 when it selects nothing, so success is the ROW COUNT, never the exit code.
    Raises CensusRunError when a row is missing or the lane is not the one asked for.
    `vitest_cache_dir` (a shard's): vitest's cache directory, set explicitly; left out, vitest's default and
    never the caller's environment."""
    os.makedirs(cache, exist_ok=True)
    inp = os.path.join(cache, "census_input.json")
    write_json(inp, items)
    out = os.path.join(cache, "census.jsonl")
    cur = os.path.join(cache, "current.txt")
    # ⛔ never resume one lane's census on top of the other's rows
    other = {k: v for k, v in lanes_in(out).items() if k != lane}
    if other:
        raise CensusRunError("%s already holds rows of another lane %s - use a separate --cache per lane" % (out, other))
    env = dict(os.environ, COVERAGE_INPUT=inp, COVERAGE_OUT=out,
               COVERAGE_RUNTIME_ON="1" if lane == LANE_RUNTIME_ON else "0",
               NODE_OPTIONS="--max-old-space-size=6144")
    # ⭐ THE LIBRARY STORE, SET HERE EXPLICITLY (never inherited, as the lane): the store named, or none
    store = store_manifest(library_store)
    env.pop("PINE_LIBRARY_STORE", None)
    if library_store:
        env["PINE_LIBRARY_STORE"] = os.path.abspath(library_store)
    write_json(os.path.join(cache, LIBRARY_STORE_FILE), store)
    env.pop(VITEST_CACHE_ENV, None)
    if vitest_cache_dir:
        env[VITEST_CACHE_ENV] = os.path.abspath(vitest_cache_dir)
    for attempt in range(max_restarts):
        before = done_keys(out)
        if len(before) >= len(items):
            break
        if os.path.exists(cur):
            os.remove(cur)
        rc = subprocess.call(["node", "node_modules/vitest/vitest.mjs", "run", census_test],
                             cwd=APP, env=env)
        after = done_keys(out)
        print("attempt %d rc=%s rows %d -> %d / %d" % (attempt, rc, len(before), len(after), len(items)), flush=True)
        if len(after) >= len(items):
            break
        killer = open(cur, encoding="utf-8").read().strip() if os.path.exists(cur) else ""
        if killer and killer not in after:
            with open(out, "a", encoding="utf-8") as f:
                f.write(json.dumps({"key": killer, "lane": lane, "attached": False, "clean": False,
                                    "stuck": "killed", "steps": [{"threw": "process died (rc=%s)" % rc}]}) + "\n")
            print("  recorded killer:", killer, flush=True)
        elif len(after) == len(before):
            raise CensusRunError("no progress and no named killer - stopping rather than looping")
    n = len(done_keys(out))
    print("census rows: %d / %d" % (n, len(items)))
    if n < len(items):
        raise CensusRunError("census rows: %d / %d - the census did not answer every input" % (n, len(items)))
    rows = assert_lane_measured(cache, lane)
    assert_store_loaded(cache, store)
    print("LANE MEASURED: %s (%d rows)" % (lane, rows))
    print("LIBRARY STORE: %d version(s)%s" % (len(store), (" from " + library_store) if library_store else " (empty)"))
    return rows


# ── SHARDS (2026-11-26): the same census, N processes, one heavy_lock hold ──────────────────────────────────
# One census process walks ~967 scripts x a lane in ~70 min at ~33% of a 24-core box while holding the shared
# heavy_lock. `--shards N` splits `items` into N disjoint shards (sorted by key, i % N), runs each as a FULL
# drive() in its own process under <cache>/shard-<k>/ (its own census_input.json, census.jsonl, lane.jsonl,
# current.txt, library_store.json; the same restarts, killer rows, lane and store proofs), then merges them into
# <cache> and proves the merged files again (lane, store, every input exactly once).
# ⛔ N=1 (the default) never reaches this code: main() calls drive() exactly as before.
# ⛔ A shard's rows are only the unsharded rows if no census row depends on what the SAME process measured
#    before it (warm per-process state). That is a measured claim, not an assumption: compare an N=1 and an
#    N>1 census of the same tree and lane by key, `ms` dropped, before trusting a sharded map.
SHARD_HEAP_GB = 6.0          # NODE_OPTIONS --max-old-space-size=6144 per census process (drive() sets it)
SHARD_HEADROOM_GB = 2.0      # the OS, the parent and the vitest host beside N heaps
SHARDS_FILE = "shards.json"
VITEST_CACHE_ENV = "UCT_VITEST_CACHE_DIR"   # app/vite.config.js: Vite's cacheDir, only when set
SHARD_VITEST_CACHE = "vitest-cache"
MERGED_FILES = ("census.jsonl", "lane.jsonl")


def shard_dir(cache, k):
    return os.path.join(cache, "shard-%d" % k)


def partition(items, n):
    """N disjoint shards of `items`: sorted by key, item i goes to shard i % n. Deterministic (the input order
    never matters), and every key lands in exactly one shard. Refuses n < 1 and a duplicate key (two inputs
    one row could answer)."""
    if not isinstance(n, int) or n < 1:
        raise CensusRunError("--shards must be a whole number >= 1, not %r" % (n,))
    keys = [it["key"] for it in items]
    if len(set(keys)) != len(keys):
        import collections
        dup = sorted(k for k, c in collections.Counter(keys).items() if c > 1)
        raise CensusRunError("census inputs repeat %d key(s) (first: %s) - one row cannot answer two inputs"
                             % (len(dup), dup[0]))
    out = [[] for _ in range(n)]
    for i, it in enumerate(sorted(items, key=lambda it: it["key"])):
        out[i % n].append(it)
    return out


def required_free_gb(n):
    """RAM a census of n concurrent processes needs free before it starts (census p90 peak ~6 GB a process)."""
    return SHARD_HEAP_GB * n + SHARD_HEADROOM_GB


def free_ram_gb():
    """Physical RAM free now, in GB, or None when it cannot be read (None refuses: an unreadable figure is no)."""
    try:
        if sys.platform == "win32":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = MEMORYSTATUSEX()
            st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
                return None
            return st.ullAvailPhys / float(1 << 30)
        with open("/proc/meminfo", encoding="ascii") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / float(1 << 20)
    except Exception:  # noqa: BLE001
        return None
    return None


def assert_memory_for(n, free=None):
    """⛔ FAIL CLOSED: refuse to start n census processes unless required_free_gb(n) is free now."""
    got = free_ram_gb() if free is None else free
    need = required_free_gb(n)
    if got is None:
        raise CensusRunError("SHARDS REFUSED: free RAM cannot be read, and %d shards need %.0f GB free" % (n, need))
    if got < need:
        raise CensusRunError("SHARDS REFUSED: %.1f GB free, %d shards need %.0f GB (%.0f GB a census process + "
                             "%.0f GB headroom) - run fewer shards or wait" % (got, n, need, SHARD_HEAP_GB,
                                                                              SHARD_HEADROOM_GB))
    return got


def worker_argv(sdir, lane, census_test, max_restarts, library_store):
    """The command one shard runs: this file, `shard-worker`, which is drive() over <sdir>/census_input.json."""
    argv = [sys.executable, os.path.abspath(__file__), "shard-worker", "--dir", sdir, "--lane", lane,
            "--census-test", census_test, "--max-restarts", str(max_restarts)]
    if library_store:
        argv += ["--library-store", os.path.abspath(library_store)]
    return argv


def run_processes(argvs, logs):
    """Start every command at once (each with its stdout+stderr in its own log), wait for ALL of them, and
    return their exit codes in order. ⛔ A failed shard never kills the others: each census.jsonl is resumable,
    and a process killed mid-append would leave a torn line in its shard."""
    procs = []
    try:
        for argv, log in zip(argvs, logs):
            f = open(log, "ab")
            procs.append((subprocess.Popen(argv, stdout=f, stderr=subprocess.STDOUT, cwd=ROOT), f))
        return [p.wait() for p, _ in procs]
    finally:
        for _, f in procs:
            f.close()


def merge_shards(cache, items, n, lane, store):
    """Concatenate the n shards' census.jsonl and lane.jsonl (shard 0 first, each line's bytes unchanged) into
    <cache>, write the full census_input.json and the store record, then prove the merge: every shard recorded
    the same store, every row parses, no key repeats, the keys are exactly the inputs' keys, and the merged files
    pass assert_lane_measured and assert_store_loaded. Returns the merged row count."""
    want = {it["key"] for it in items}
    seen = {}
    merged = {name: [] for name in MERGED_FILES}
    for k in range(n):
        sdir = shard_dir(cache, k)
        for name in MERGED_FILES:
            p = os.path.join(sdir, name)
            if not os.path.exists(p):
                raise CensusRunError("SHARD MERGE: shard-%d has no %s" % (k, name))
            for line in open(p, encoding="utf-8"):
                if not line.strip():
                    continue
                line = line if line.endswith("\n") else line + "\n"
                try:
                    d = json.loads(line)
                    if not isinstance(d, dict):
                        raise ValueError("not a JSON object")
                    key = d["key"] if name == "census.jsonl" else None
                except Exception as err:  # noqa: BLE001
                    raise CensusRunError("SHARD MERGE: shard-%d %s holds a line that is not a %s (%s)"
                                         % (k, name, "row" if name == "census.jsonl" else "lane pass", err))
                if name == "census.jsonl":
                    if key in seen:
                        raise CensusRunError("SHARD MERGE: %s has a row in shard-%d and shard-%d (double count)"
                                             % (key, seen[key], k))
                    seen[key] = k
                merged[name].append(line)
        sp = os.path.join(sdir, LIBRARY_STORE_FILE)
        got = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else None
        if got != store:
            raise CensusRunError("SHARD MERGE: shard-%d measured another library store (%s)" % (
                k, "none recorded" if got is None else "%d version(s), want %d" % (len(got), len(store))))
    missing = sorted(want - set(seen))
    extra = sorted(set(seen) - want)
    if missing or extra or len(seen) != len(items):
        raise CensusRunError("SHARD MERGE: %d row(s) for %d input(s); missing %d (first: %s), not an input %d "
                             "(first: %s)" % (len(seen), len(items), len(missing), missing[:1], len(extra), extra[:1]))
    for name in MERGED_FILES:
        tmp = os.path.join(cache, name + ".tmp")
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.writelines(merged[name])
        os.replace(tmp, os.path.join(cache, name))
    write_json(os.path.join(cache, "census_input.json"), items)
    write_json(os.path.join(cache, LIBRARY_STORE_FILE), store)
    rows = assert_lane_measured(cache, lane)
    assert_store_loaded(cache, store)
    return rows


def drive_sharded(items, cache, lane, shards, census_test=CENSUS, max_restarts=40, library_store=None,
                  runner=None, free=None):
    """drive() over `items` in `shards` concurrent processes, then merge_shards(). shards == 1 IS drive().
    `runner(argvs, logs) -> [rc]` starts the shards (default run_processes: one OS process each); `free` (GB)
    stands in for the RAM probe in tests. Raises CensusRunError on any refusal, named."""
    if shards == 1:
        return drive(items, cache, lane, census_test=census_test, max_restarts=max_restarts,
                     library_store=library_store)
    parts = partition(items, shards)
    if shards > len(items):
        raise CensusRunError("--shards %d for %d input(s): a shard with no input proves no lane" % (shards, len(items)))
    cache = os.path.abspath(cache)
    os.makedirs(cache, exist_ok=True)
    out = os.path.join(cache, "census.jsonl")
    # ⛔ never resume one lane on top of the other's rows, nor a sharded census on an unsharded one, nor a
    #    census sharded another way (a key would move shards and be measured twice)
    other = {k: v for k, v in lanes_in(out).items() if k != lane}
    if other:
        raise CensusRunError("%s already holds rows of another lane %s - use a separate --cache per lane" % (out, other))
    rec_path = os.path.join(cache, SHARDS_FILE)
    plan = {"shards": shards, "lane": lane, "keys": [[it["key"] for it in p] for p in parts]}
    if os.path.exists(rec_path):
        old = json.load(open(rec_path, encoding="utf-8"))
        if {k: old.get(k) for k in plan} != plan:
            raise CensusRunError("%s records another sharding (%s shards, lane %s) - use a fresh --cache"
                                 % (rec_path, old.get("shards"), old.get("lane")))
    elif os.path.exists(out) or os.path.exists(os.path.join(cache, "current.txt")):
        raise CensusRunError("%s holds an unsharded census - use a fresh --cache for a sharded one" % cache)
    stale = sorted(d for d in os.listdir(cache) if re.match(r"^shard-\d+$", d) and int(d[6:]) >= shards)
    if stale:
        raise CensusRunError("%s holds %s beyond --shards %d - use a fresh --cache" % (cache, stale, shards))
    store = store_manifest(library_store)       # a bad store refuses before any process starts
    got = assert_memory_for(shards, free)
    write_json(rec_path, plan)
    argvs, logs = [], []
    for k, part in enumerate(parts):
        sdir = shard_dir(cache, k)
        os.makedirs(sdir, exist_ok=True)
        write_json(os.path.join(sdir, "census_input.json"), part)
        argvs.append(worker_argv(sdir, lane, census_test, max_restarts, library_store))
        logs.append(os.path.join(sdir, "drive.log"))
    print("census shards: %d x ~%d inputs, %.1f GB free (need %.0f), logs %s" % (
        shards, -(-len(items) // shards), got, required_free_gb(shards), os.path.join(cache, "shard-*", "drive.log")),
        flush=True)
    import time
    t0 = time.time()
    rcs = (runner or run_processes)(argvs, logs)
    secs = time.time() - t0
    for k, rc in enumerate(rcs):
        print("shard-%d rc=%s rows %d / %d" % (k, rc, len(done_keys(os.path.join(shard_dir(cache, k), "census.jsonl"))),
                                               len(parts[k])), flush=True)
    failed = [k for k, rc in enumerate(rcs) if rc != 0]
    if len(rcs) != shards or failed:
        raise CensusRunError("SHARDS FAILED: %s of %d shard(s) did not finish (see %s)" % (
            failed or "%d returned" % len(rcs), shards, os.path.join(cache, "shard-<k>", "drive.log")))
    rows = merge_shards(cache, items, shards, lane, store)
    print("census rows: %d / %d (merged from %d shards in %.0fs)" % (rows, len(items), shards, secs))
    print("LANE MEASURED: %s (%d rows)" % (lane, rows))
    print("LIBRARY STORE: %d version(s)%s" % (len(store), (" from " + library_store) if library_store else " (empty)"))
    return rows


def census_rows(cache, drop=("ms",)):
    """{key: row without the `drop` fields} of <cache>/census.jsonl. Refuses a repeated key or a torn line."""
    rows = {}
    for line in open(os.path.join(cache, "census.jsonl"), encoding="utf-8"):
        if not line.strip():
            continue
        try:
            d = json.loads(line)
        except Exception as err:  # noqa: BLE001
            raise CensusRunError("%s: a line that is not a row (%s)" % (cache, err))
        if d["key"] in rows:
            raise CensusRunError("%s: %s has two rows" % (cache, d["key"]))
        rows[d["key"]] = {k: v for k, v in d.items() if k not in drop}
    return rows


def compare_censuses(a_cache, b_cache, drop=("ms",)):
    """THE SHARDING PROOF: two censuses of the same tree and lane (e.g. --shards 1 and --shards 3), row for row
    by key, the `drop` fields (wall-clock) left out. Returns {"rows": (n_a, n_b), "onlyA": [...], "onlyB": [...],
    "differ": [...], "fields": {field: rows it differs in}}, keys sorted; identical means the three lists are empty.
    `fields` names WHICH top-level fields vary (a noise floor that is not zero says where the noise is)."""
    a, b = census_rows(a_cache, drop), census_rows(b_cache, drop)
    differ = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    fields = {}
    for k in differ:
        for f in sorted(set(a[k]) | set(b[k])):
            if a[k].get(f, KeyError) != b[k].get(f, KeyError):
                fields[f] = fields.get(f, 0) + 1
    return {"rows": (len(a), len(b)), "onlyA": sorted(set(a) - set(b)), "onlyB": sorted(set(b) - set(a)),
            "differ": differ, "fields": dict(sorted(fields.items()))}


def compare_main(argv):
    """`run_census.py compare <cacheA> <cacheB>`: exit 0 when the two censuses are identical row for row (by key,
    `ms` dropped), else 1, naming every key that differs."""
    ap = argparse.ArgumentParser(prog="run_census.py compare")
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--drop", nargs="*", default=["ms"], help="top-level row fields left out (default: ms)")
    a = ap.parse_args(argv)
    r = compare_censuses(os.path.abspath(a.a), os.path.abspath(a.b), tuple(a.drop))
    same = not (r["onlyA"] or r["onlyB"] or r["differ"])
    print("%s: %d rows vs %d rows; only in A %d, only in B %d, differ %d (dropped: %s)" % (
        "IDENTICAL" if same else "DIFFERENT", r["rows"][0], r["rows"][1], len(r["onlyA"]), len(r["onlyB"]),
        len(r["differ"]), ", ".join(a.drop) or "nothing"))
    if r["fields"]:
        print("  fields that differ (rows): %s" % ", ".join("%s %d" % kv for kv in r["fields"].items()))
    for name in ("onlyA", "onlyB", "differ"):
        for k in r[name]:
            print("  %s %s" % (name, k))
    return 0 if same else 1


def worker_main(argv):
    """`run_census.py shard-worker --dir <shard> --lane L ...`: drive() over <shard>/census_input.json, unchanged.
    A refusal exits 1 with its message (CensusRunError is a SystemExit), which the parent reads as a failed shard."""
    ap = argparse.ArgumentParser(prog="run_census.py shard-worker")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--lane", required=True, choices=(LANE_PRODUCTION, LANE_RUNTIME_ON))
    ap.add_argument("--census-test", default=CENSUS)
    ap.add_argument("--max-restarts", type=int, default=40)
    ap.add_argument("--library-store", default=None)
    a = ap.parse_args(argv)
    items = json.load(open(os.path.join(a.dir, "census_input.json"), encoding="utf-8"))
    print("shard %s: %d inputs, lane %s" % (a.dir, len(items), a.lane), flush=True)
    drive(items, a.dir, a.lane, census_test=a.census_test, max_restarts=a.max_restarts,
          library_store=a.library_store, vitest_cache_dir=os.path.join(a.dir, SHARD_VITEST_CACHE))


if __name__ == "__main__":
    if sys.argv[1:2] == ["shard-worker"]:
        worker_main(sys.argv[2:])
    elif sys.argv[1:2] == ["compare"]:
        sys.exit(compare_main(sys.argv[2:]))
    else:
        main()
