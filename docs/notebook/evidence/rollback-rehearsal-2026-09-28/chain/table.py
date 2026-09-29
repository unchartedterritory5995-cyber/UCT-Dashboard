"""Mechanical: the chain's JSON lines -> a markdown table. No reading, no verdicts.

    python table.py chain-primary-r2.jsonl chain-primary.jsonl chain-strict.jsonl chain-keepallhotfix.jsonl > step-table.md
"""
import json
import sys


def rows(path):
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        if "n" not in d:
            yield f"| STOPPED at {d.get('stopped_at')} | {d.get('why')} | | | | | | |"
            continue
        raw = d["conflicts"]
        prod = d["product_conflicts"]
        res = "; ".join(f"`{p}`: {r}" for p, r in d["resolutions"].items()) or "none"
        if d.get("unresolved"):
            res += " | UNRESOLVED: " + ", ".join(f"`{p}`" for p in d["unresolved"])
        schema = ("revert would change: " + ", ".join(p.rsplit("/", 1)[-1] for p in d["revert_would_change_schema"])
                  if d["revert_would_change_schema"] else "revert leaves both untouched")
        same = {True: "identical to tip", False: "DIFFERS from tip", None: "n/a (not applied)"}[d.get("schema_identical_to_tip")]
        yield (f"| {d['n']} | {d['op']} `{d['squash']}` ({d['label']}) | {len(raw)}: "
               + (", ".join(f"`{p}`" for p in raw) or "-")
               + f" | {len(prod)} | {res} | {schema}; after rules: {same} | {d['docs_kept']} "
               + f"| `{d['tree'][:10]}`" + (" MEASURED ONLY" if d.get("measure_only") else "")
               + f" | {len(d.get('dangling_imports') or [])} |")


def rows_r2(path):
    """Round 2 is written by tools/notebook_rollback_chain.py (different keys; no docs count)."""
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        if "squash" not in d:
            continue
        same = {True: "identical to tip", False: "DIFFERS from tip"}[d["schema_identical_to_tip"]]
        undone = ", ".join(p.rsplit("/", 1)[-1] for p in d["schema_change_undone"]) or "none"
        yield (f"| {d['key']} | {d['op']} `{d['squash']}` ({d['what']}) | {len(d['conflicts'])}: "
               + (", ".join(f"`{p}`" for p in d["conflicts"]) or "-")
               + f" | {len(d['product_conflicts'])} | put back to the tip's copy: {undone}; after: {same} "
               + f"| `{d['tree'][:10]}` |")


HEAD = ("| step | operation | raw merge-tree conflicts (all paths) | product conflicts | recorded resolution "
        "| schema tables | kept-path files reset to prev | tree | dangling imports (lint) |\n"
        "|---|---|---|---:|---|---|---:|---|---:|")
HEAD_R2 = ("| key | operation | raw merge-tree conflicts (all paths) | product conflicts "
           "| schema tables + their two rails | tree |\n|---|---|---|---:|---|---|")
for path in sys.argv[1:]:
    if path.endswith("-r2.jsonl"):
        print(f"## {path} (round 2: the tables' two rails kept at the tip too)\n\n{HEAD_R2}")
        for r in rows_r2(path):
            print(r)
        print()
        continue
    print(f"## {path}\n\n{HEAD}")
    for r in rows(path):
        print(r)
    print()
