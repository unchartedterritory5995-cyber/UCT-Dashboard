# -*- coding: utf-8 -*-
"""render_gaps.py - which sample scripts leave drawings off the member's chart, and why: the render sweep, joined.

    # 1. the sweep (opt-in, LOCAL like the census: the captures and the library store stay on this PC)
    cd app && PINE_RENDER_GAPS=1 PINE_RENDER_GAPS_OUT=<rows.json> [PINE_RENDER_GAPS_DIR=<dir;dir>] \\
        PINE_LIBRARY_STORE=<the census's store> node node_modules/vitest/vitest.mjs run \\
        src/components/chart/engine/__tests__/vendorHarness/renderGaps.measure.test.js --maxWorkers=1
    # 2. the join (this file): rows -> sample scripts, by normalised source (coverage_map.norm_src, one rule)
    python tools/pine_coverage/render_gaps.py --rows <rows.json> [--rows <more.json>] --cache <census dir> \\
        --out <render-gaps.json>
    # 3. the map: coverage_map.py ... --render-gaps <render-gaps.json>; parity_roadmap.py build then splits
    #    member-served into servedFully / servedWithDisclosedGap / servedUnmeasured and ranks the gap classes.

A capture row (`renderGaps.js::renderGapRow`) is `measured` when our side ran it and its drawings were rebuilt
(or it draws none); its gaps are the render state's own `unplaced`, split by class, and families withheld whole:

    render:coordinate-unplaced         a finite x no bar of the chart places (`coordinate`, by family)
    render:text-withheld:<kind>        a text the run withheld (`textWithheld`), <kind> the run's own name for it
                                       (`format:*`), `unnamed` where it named none
    render:drawings-withheld:<guard>   a family, or the whole drawing program, withheld by that guard

A script's gap is any gap on any of its measured captures; `diverge` counts its captures the harness grades
DIVERGE on the sweep's lane (each row carries `gradeCapture`'s verdict). Captures are deduplicated by id (the first row
read wins: list the committed sweep first). ⛔ KEYS AND COUNTS ONLY: sample keys, capture counts, family names,
guard and `format:*` names. No source, no text, no message is read into the output.
"""
import argparse
import collections
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "vendor_harness"))

import coverage_map as cm  # noqa: E402 -- norm_src (the join's one rule), read_library_store
import licence_held  # noqa: E402 -- a licence-held capture is read where it lives now

SCHEMA = "uct.pine-render-gaps/v1"
ROWS_SCHEMA = "uct.pine-render-gap-rows/v1"
LANE = "runtime-on"
COORDINATE = "render:coordinate-unplaced"
TEXT = "render:text-withheld:"
WITHHELD = "render:drawings-withheld:"
DIVERGE = "DIVERGE"


def gaps_of(row):
    """{gap class: drawings} for one capture row (empty: nothing left off)."""
    out = {}
    coord = sum((row.get("coordinate") or {}).values())
    if coord:
        out[COORDINATE] = coord
    text = sum((row.get("textWithheld") or {}).values())
    if text:
        # a capture whose run named several kinds counts its withheld texts under each (the run does not say
        # which text each name was for)
        for kind in row.get("textKinds") or ["unnamed"]:
            out[TEXT + kind] = text
    for guard, n in sorted((row.get("withheld") or {}).items()):
        if n:
            out[WITHHELD + guard] = n
    return out


def families_of(row, cls):
    if cls == COORDINATE:
        return row.get("coordinate") or {}
    if cls.startswith(TEXT):
        return row.get("textWithheld") or {}
    return {}


def read_rows(paths):
    """(rows deduplicated by capture id, header facts) over every rows file, refusing a mixed sweep."""
    rows, seen, dup = [], set(), 0
    engines, stores = set(), set()
    for p in paths:
        doc = json.load(open(p, encoding="utf-8"))
        if doc.get("schema") != ROWS_SCHEMA:
            sys.exit("%s: not a render-gap rows file (schema %r, expected %r)" % (p, doc.get("schema"), ROWS_SCHEMA))
        if doc.get("lane") != LANE:
            sys.exit("%s: measured on lane %r; the render sweep is the %s lane (the lane members are on)"
                     % (p, doc.get("lane"), LANE))
        engines.add(doc.get("engine"))
        stores.add(json.dumps(sorted(doc.get("libraryStore") or [], key=lambda r: r["path"]), sort_keys=True))
        for r in doc.get("rows") or []:
            key = r.get("id") or r.get("file")
            if key in seen:
                dup += 1
                continue
            seen.add(key)
            rows.append(r)
    if len(engines) != 1 or len(stores) != 1:
        sys.exit("the rows files were measured at different engines (%s) or with different library stores (%d): "
                 "sweep them again together" % (sorted(map(str, engines)), len(stores)))
    return rows, {"engine": engines.pop(), "libraryStore": json.loads(stores.pop()), "duplicates": dup}


def source_of(file):
    try:
        cap = json.load(open(licence_held.resolve(file), encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return (cap.get("source") or {}).get("text") or None


def join(rows, inputs):
    """{sample key: script record} for every key a row joins to, plus the capture tallies."""
    by_norm = {}
    for k in sorted(inputs):
        if not k.startswith("example:"):
            with open(inputs[k]["path"], encoding="utf-8") as f:
                by_norm.setdefault(cm.norm_src(f.read()), k)
    scripts = {}
    tally = collections.Counter()
    for r in rows:
        tally["status:" + str(r.get("status"))] += 1
        src = source_of(r.get("file") or "")
        k = by_norm.get(cm.norm_src(src)) if src else None
        if k is None:
            tally["unmatched"] += 1
            continue
        tally["matched"] += 1
        s = scripts.setdefault(k, {"captures": 0, "measured": 0, "withGap": 0, "diverge": 0, "gaps": {}})
        s["captures"] += 1
        tally["verdict:" + str(r.get("verdict"))] += 1
        # a capture the harness grades DIVERGE (its own grade, on the sweep's lane): the script is never "fully"
        if r.get("verdict") == DIVERGE:
            s["diverge"] += 1
        if r.get("status") != "measured":
            continue
        s["measured"] += 1
        g = gaps_of(r)
        if not g:
            continue
        s["withGap"] += 1
        for cls, n in g.items():
            e = s["gaps"].setdefault(cls, {"captures": 0, "drawings": 0, "families": {}})
            e["captures"] += 1
            e["drawings"] += n
            for fam, m in families_of(r, cls).items():
                e["families"][fam] = e["families"].get(fam, 0) + m
    for s in scripts.values():
        s["gaps"] = {c: {**e, "families": dict(sorted(e["families"].items()))} for c, e in sorted(s["gaps"].items())}
    return {k: scripts[k] for k in sorted(scripts)}, tally


def build(row_paths, cache):
    rows, head = read_rows(row_paths)
    census_store = cm.read_library_store(os.path.abspath(cache), "--cache") or []
    if head["libraryStore"] != census_store:
        sys.exit("the sweep linked from another library store than the census (%d versions vs %d): a gap measured "
                 "on other library code is another product. Sweep again with the census's PINE_LIBRARY_STORE"
                 % (len(head["libraryStore"]), len(census_store)))
    inputs = {i["key"]: i for i in json.load(open(os.path.join(cache, "census_input.json"), encoding="utf-8"))}
    scripts, tally = join(rows, inputs)
    return {
        "schema": SCHEMA, "generatedBy": "tools/pine_coverage/render_gaps.py",
        "engine": head["engine"], "lane": LANE, "libraryStore": head["libraryStore"],
        "note": "keys and counts only: sample keys, capture counts, families, guard and format names; no source, "
                "no text, no message",
        "captures": {"rows": len(rows), "duplicates": head["duplicates"], "matched": tally["matched"],
                     "unmatched": tally["unmatched"],
                     "status": {k[7:]: n for k, n in sorted(tally.items()) if k.startswith("status:")},
                     "verdicts": {k[8:]: n for k, n in sorted(tally.items()) if k.startswith("verdict:")}},
        "scripts": scripts,
    }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rows", action="append", required=True, help="a renderGaps.measure.test.js output (repeatable)")
    ap.add_argument("--cache", required=True, help="the production census cache the map is built from")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = build(a.rows, a.cache)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, a.out)
    c = out["captures"]
    gap = sum(1 for s in out["scripts"].values() if s["withGap"])
    print("render gaps: %d captures (%d duplicates dropped), %d joined to %d sample scripts, %d unmatched; "
          "%d scripts with a gap -> %s" % (c["rows"], c["duplicates"], c["matched"], len(out["scripts"]),
                                           c["unmatched"], gap, a.out))


if __name__ == "__main__":
    main()
