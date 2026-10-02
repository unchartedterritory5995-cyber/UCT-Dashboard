"""Lane TY7 -- who CALLS the two size-scaling costs lane TY5 left named only by
self time: React's `commitBeforeMutationEffects` and prosemirror-model's
`nodesBetween` / `matchType` / `matchFragment` / `forEach` / `child` /
`posBeforeChild` family (ty5's own README, "LEFT two size-scaling costs").

Self time names the function that RAN, not who ASKED for it. This walks the
CDP CPU profile's call tree UPWARD from each of those leaf functions and
aggregates their self time by the nearest ancestor frame that is NOT itself
one of the same generic prosemirror-model walk functions (a denylist, so the
output is auditable rather than a silent judgment call about what counts as
"app code").

Reuses `notebook_ty5_cpu_profile.py` to CAPTURE the raw .cpuprofile (same
method: attribution-only unminified build, same focus-then-type recipe). This
module is the pure, browser-free ANALYSIS step over the raw profile JSON --
exercised by --self-check with no browser, same convention as its sibling.

R-RAW: run `notebook_ty5_cpu_profile.py --boot ... --raw-dir <scratch>` first
to produce the two raw .cpuprofile.json files, then point this tool at them.
The output table is committed under docs/notebook/perf-runs/ty7/ BEFORE any
interpretation (R-RAW).
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def chunk_of(url: str) -> str:
    """The built chunk's base name, hash stripped, so a rebuild's new content
    hash doesn't break identity matching (`askInsert-ktnvBCjI.js` -> `askInsert`)."""
    if not url:
        return ""
    base = url.rsplit("/", 1)[-1]
    if "-" in base:
        base = base.rsplit("-", 1)[0]
    return base


def load(path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_parent_map(profile: dict) -> tuple[dict, dict]:
    nodes = {n["id"]: n for n in profile["nodes"]}
    parent: dict[int, int] = {}
    for n in profile["nodes"]:
        for c in n.get("children") or []:
            parent[c] = n["id"]
    return nodes, parent


def frame_key(node: dict) -> tuple[str, str, int]:
    cf = node["callFrame"]
    return (cf.get("functionName") or "(anonymous)", cf.get("url") or "", cf.get("lineNumber", -1))


# The SAME machinery the named leaves belong to (prosemirror-model's own
# recursive tree-walk functions) -- climbing past these looks for the first
# frame that is NOT just another layer of the same walk, i.e. who CALLED into
# this machinery in the first place.
GENERIC_DENY = frozenset({
    "matchType", "matchFragment", "nodesBetween", "forEach", "child", "posBeforeChild",
    "get isLeaf", "get nodeSize", "get size", "contentMatchAt", "resolveCached",
    "resolve", "findIndex", "cut", "slice", "nodeAt", "textContent", "(anonymous)",
    "(root)", "(program)", "(idle)",
})


def walk_and_aggregate(profile: dict, keys: int, target_leaves: set[tuple[str, str, int]],
                        max_examples: int = 3, max_chain: int = 20) -> tuple[list[dict], int]:
    nodes, parent = build_parent_map(profile)
    buckets: dict[tuple, dict] = defaultdict(lambda: {"self_us": 0.0, "n_samples": 0, "chain_examples": []})
    samples = profile.get("samples") or []
    deltas = profile.get("timeDeltas") or []
    leaf_hits = 0
    for i, node_id in enumerate(samples):
        dt = deltas[i] if i < len(deltas) else 0
        if dt <= 0:
            continue
        leaf = nodes.get(node_id)
        if leaf is None:
            continue
        lfn, lurl, lline = frame_key(leaf)
        lkey = (lfn, chunk_of(lurl), lline)
        if lkey not in target_leaves:
            continue
        leaf_hits += 1
        chain = []
        cur = parent.get(node_id)
        nearest = None
        depth = 0
        while cur is not None and depth < 200:
            anc = nodes.get(cur)
            if anc is None:
                break
            fn, url, line = frame_key(anc)
            chunk = chunk_of(url)
            chain.append((fn, chunk, line))
            if nearest is None and fn not in GENERIC_DENY:
                nearest = (fn, chunk, line)
            cur = parent.get(cur)
            depth += 1
            if nearest is not None and len(chain) >= max_chain:
                break
        key = nearest if nearest is not None else ("(unresolved: all-generic chain)", "", -1)
        b = buckets[key]
        b["self_us"] += dt
        b["n_samples"] += 1
        if len(b["chain_examples"]) < max_examples:
            b["chain_examples"].append(chain[:max_chain])
    rows = []
    for key, b in buckets.items():
        rows.append({
            "caller_function": key[0], "caller_chunk": key[1], "caller_line": key[2],
            "self_ms": round(b["self_us"] / 1000.0, 4),
            "self_ms_per_key": round((b["self_us"] / 1000.0) / keys, 5) if keys else None,
            "n_samples": b["n_samples"],
            "chain_examples": [[f"{f}@{c}:{l}" for f, c, l in ex] for ex in b["chain_examples"]],
        })
    rows.sort(key=lambda r: -r["self_ms"])
    return rows, leaf_hits


def diff_caller_tables(small_rows: list[dict], big_rows: list[dict]) -> list[dict]:
    small_by = {(r["caller_function"], r["caller_chunk"], r["caller_line"]): r for r in small_rows}
    big_by = {(r["caller_function"], r["caller_chunk"], r["caller_line"]): r for r in big_rows}
    out = []
    for k in set(small_by) | set(big_by):
        s = small_by.get(k)
        b = big_by.get(k)
        s_ms = s["self_ms_per_key"] if s else 0.0
        b_ms = b["self_ms_per_key"] if b else 0.0
        out.append({
            "caller_function": k[0], "caller_chunk": k[1], "caller_line": k[2],
            "ms_per_key_small": s_ms, "ms_per_key_big": b_ms,
            "delta_ms_per_key": round(b_ms - s_ms, 5),
            "n_samples_small": s["n_samples"] if s else 0,
            "n_samples_big": b["n_samples"] if b else 0,
            "chain_examples": (b or s or {}).get("chain_examples", []),
        })
    out.sort(key=lambda r: -r["delta_ms_per_key"])
    return out


def self_check() -> int:
    """No browser: a synthetic profile where a known app-level function calls
    into the generic denylisted machinery, and a second branch where ONLY
    generic frames exist above the leaf (must resolve to the unresolved bucket)."""
    prof = {"nodes": [
        {"id": 1, "callFrame": {"functionName": "(root)", "url": "", "lineNumber": 0}, "children": [2, 6]},
        {"id": 2, "callFrame": {"functionName": "readToolbarFormatState", "url": "NotebookFlagGate-x.js", "lineNumber": 322}, "children": [3]},
        {"id": 3, "callFrame": {"functionName": "isNodeActive", "url": "askInsert-x.js", "lineNumber": 12893}, "children": [4]},
        {"id": 4, "callFrame": {"functionName": "nodesBetween", "url": "askInsert-x.js", "lineNumber": 191}, "children": [5]},
        {"id": 5, "callFrame": {"functionName": "matchType", "url": "askInsert-x.js", "lineNumber": 1632}, "children": []},
        {"id": 6, "callFrame": {"functionName": "forEach", "url": "askInsert-x.js", "lineNumber": 355}, "children": [7]},
        {"id": 7, "callFrame": {"functionName": "child", "url": "askInsert-x.js", "lineNumber": 339}, "children": []},
    ], "samples": [5, 5, 7], "timeDeltas": [0, 100, 100]}
    targets = {("matchType", "askInsert", 1632), ("child", "askInsert", 339)}
    rows, hits = walk_and_aggregate(prof, keys=1, target_leaves=targets)
    assert hits == 2, hits
    by_caller = {r["caller_function"]: r for r in rows}
    assert "isNodeActive" in by_caller, rows  # climbed PAST nodesBetween (denylisted) to find it
    assert by_caller["isNodeActive"]["self_ms"] == 0.1, rows
    assert "(unresolved: all-generic chain)" in by_caller, rows  # id 7's chain is forEach->(root), both generic/deny
    print("SELF-CHECK OK: walk_and_aggregate climbs past denylisted prosemirror-model frames "
          "to the nearest real caller, and falls back to an explicit unresolved bucket "
          "(never a silent miss) when the whole chain is generic.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("small_profile", nargs="?")
    ap.add_argument("big_profile", nargs="?")
    ap.add_argument("--out", default=None)
    ap.add_argument("--keys", type=int, default=200)
    ap.add_argument("--targets", default=None,
                     help="comma-separated fn@chunk:line triples; default is TY5's named set")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.small_profile or not args.big_profile:
        print("pass <small_profile.cpuprofile.json> <big_profile.cpuprofile.json>, or --self-check")
        return 3
    if args.targets:
        targets = set()
        for t in args.targets.split(","):
            fn, rest = t.split("@", 1)
            chunk, line = rest.rsplit(":", 1)
            targets.add((fn, chunk, int(line)))
    else:
        # TY5's own named set (self-time diff, ty5-profile-diff.json), re-derived
        # from this lane's own clean-baseline run rather than hardcoded once and
        # left to drift -- see the README for the exact run this was taken from.
        targets = {
            ("commitBeforeMutationEffects", "vendor-react", 6689),
            ("nodesBetween", "askInsert", 191),
            ("get isLeaf", "askInsert", 2082),
            ("matchType", "askInsert", 1632),
            ("forEach", "askInsert", 355),
            ("child", "askInsert", 339),
            ("matchFragment", "askInsert", 1642),
            ("posBeforeChild", "askInsert", 7398),
            ("get nodeSize", "askInsert", 1174),
            ("get size", "askInsert", 7931),
        }
    small = load(args.small_profile)
    big = load(args.big_profile)
    small_rows, small_hits = walk_and_aggregate(small, args.keys, targets)
    big_rows, big_hits = walk_and_aggregate(big, args.keys, targets)
    diff = diff_caller_tables(small_rows, big_rows)
    out = {
        "method": "walk the call tree upward from each TY5-named leaf; attribute self time "
                  "to the nearest non-generic ancestor frame",
        "target_leaves": sorted(f"{fn}@{chunk}:{line}" for fn, chunk, line in targets),
        "leaf_hits_small": small_hits, "leaf_hits_big": big_hits,
        "rows": diff,
    }
    text = json.dumps(out, indent=1)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {len(diff)} caller rows -> {args.out}")
    else:
        print(text)
    print()
    for r in diff[:25]:
        print(f"  {r['delta_ms_per_key']:+.5f} ms/key  {r['caller_function']}@{r['caller_chunk']}:{r['caller_line']}"
              f"  (small={r['ms_per_key_small']}, big={r['ms_per_key_big']}, n={r['n_samples_big']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
