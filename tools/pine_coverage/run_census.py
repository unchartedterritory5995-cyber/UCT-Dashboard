# -*- coding: utf-8 -*-
"""run_census.py - drive the member-door census over the coverage-map sample.

  python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label pine-coverage -- \
      python tools/pine_coverage/run_census.py --cache <cache> --ref <pine_v6_reference.json>

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
    drive(items, cache, lane, census_test=a.census_test, max_restarts=a.max_restarts,
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


def drive(items, cache, lane, census_test=CENSUS, max_restarts=40, library_store=None):
    """THE CENSUS LOOP, in one place (run_census.py's sample census and the coverage ratchet over the
    committed corpus both call it): write `items` ([{key, path, cap}]) as the census input, run the
    census test until every item has a row in <cache>/census.jsonl, restarting past a process death
    (the script named in current.txt is recorded `killed`), then prove the lane.
    ⛔ vitest exits 0 when it selects nothing, so success is the ROW COUNT, never the exit code.
    Raises CensusRunError when a row is missing or the lane is not the one asked for."""
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


if __name__ == "__main__":
    main()
