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
    ap.add_argument("--runtime-on", action="store_true",
                    help="measure the RUNTIME-ON lane (runtime pane on at every peel step)")
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
    inp = os.path.join(cache, "census_input.json")
    write_json(inp, items)
    out = os.path.join(cache, "census.jsonl")
    cur = os.path.join(cache, "current.txt")
    print("census lane requested: %s" % lane, flush=True)
    # ⛔ never resume one lane's census on top of the other's rows
    other = {k: v for k, v in lanes_in(out).items() if k != lane}
    if other:
        sys.exit("%s already holds rows of another lane %s - use a separate --cache per lane" % (out, other))
    print("census inputs: %d (%d sample, %d examples)" % (
        len(items), sum(1 for i in items if not i["key"].startswith("example:")),
        sum(1 for i in items if i["key"].startswith("example:"))), flush=True)

    def done_keys():
        ks = set()
        if os.path.exists(out):
            for l in open(out, encoding="utf-8"):
                try:
                    ks.add(json.loads(l)["key"])
                except Exception:  # noqa: BLE001
                    pass
        return ks

    env = dict(os.environ, COVERAGE_INPUT=inp, COVERAGE_OUT=out,
               COVERAGE_RUNTIME_ON="1" if lane == LANE_RUNTIME_ON else "0",
               NODE_OPTIONS="--max-old-space-size=6144")
    for attempt in range(a.max_restarts):
        before = done_keys()
        if len(before) >= len(items):
            break
        if os.path.exists(cur):
            os.remove(cur)
        rc = subprocess.call(["node", "node_modules/vitest/vitest.mjs", "run", CENSUS],
                             cwd=APP, env=env)
        after = done_keys()
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
            sys.exit("no progress and no named killer - stopping rather than looping")
    n = len(done_keys())
    print("census rows: %d / %d" % (n, len(items)))
    if n < len(items):
        sys.exit(1)
    # ⛔ the rows must say the lane that was asked for (the census also asserts it
    # from what the door did; this catches a census file from an older test)
    lane_log = os.path.join(cache, "lane.jsonl")
    passes = [json.loads(l) for l in open(lane_log, encoding="utf-8") if l.strip()] if os.path.exists(lane_log) else []
    bad = [p for p in passes if not p.get("ok") or p.get("requested") != lane]
    if bad or not passes:
        sys.exit("LANE NOT MEASURED: %s" % (bad[0].get("line") if bad else "no pass recorded its lane (lane.jsonl)"))
    got = lanes_in(out)
    if set(got) != {lane}:
        sys.exit("LANE MISMATCH: requested %s, census rows say %s" % (lane, dict(got)))
    print("LANE MEASURED: %s (%d rows)" % (lane, got[lane]))


if __name__ == "__main__":
    main()
