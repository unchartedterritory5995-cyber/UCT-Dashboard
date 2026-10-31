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
    a = ap.parse_args()
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
                f.write(json.dumps({"key": killer, "attached": False, "clean": False,
                                    "stuck": "killed", "steps": [{"threw": "process died (rc=%s)" % rc}]}) + "\n")
            print("  recorded killer:", killer, flush=True)
        elif len(after) == len(before):
            sys.exit("no progress and no named killer - stopping rather than looping")
    n = len(done_keys())
    print("census rows: %d / %d" % (n, len(items)))
    if n < len(items):
        sys.exit(1)


if __name__ == "__main__":
    main()
