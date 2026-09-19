# -*- coding: utf-8 -*-
"""COMPLEX PINE VISUAL PARITY SET — deterministic, source-only selection.

⛔ PREDECLARED. This file is committed BEFORE any OOS script has been run through
a UCT surface, so the selection cannot be tuned toward whatever UCT turns out to
handle well. The protocol is explicit: "Do NOT choose whichever are easiest for
UCT."

The rule, in full:

  ELIGIBLE  — visual tier V4 or V5 (the two richest predeclared tiers).

  RANK      — by SOURCE richness only, in this order:
              1. number of DISTINCT visual primitive families present (P L F B M C O).
                 Distinct families first, not raw call count, because the set is an
                 ACCEPTANCE SUITE: a set that exercises seven capabilities once each
                 is worth more than one that exercises `label.new` a thousand times.
              2. total visual call sites (emitting + object) — depth, as the tiebreak
                 among equally broad scripts.
              3. ascending SHA-256 of normalised source — a cryptographic tiebreak
                 uncorrelated with anything about the script, so the last places are
                 decided by nothing anyone can steer.

  SPREAD    — at most 4 from any one engagement stratum, and at most 1 per author,
              applied greedily down the ranking. Without this a single prolific
              author's house style could define the whole acceptance suite.

  SIZE      — 10 (inside the protocol's 8-12 band).

Nothing here reads a UCT result. The only inputs are the frozen manifest and the
source-only visual classification.

Usage:
  python tools/oos_parity_set.py --visual <vis.json> --manifest tests/fixtures/pine_oos/MANIFEST.json
"""
import argparse
import json
import sys
from pathlib import Path

TARGET = 10
ELIGIBLE_TIERS = {"V4", "V5"}
MAX_PER_STRATUM = 4
MAX_PER_AUTHOR = 1
FAMILIES = "PLFBMCO"


def norm(name):
    return name[:-5] if name.endswith(".pine") else name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--visual", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out")
    args = ap.parse_args()

    vis = {norm(v["file"]): v for v in json.loads(Path(args.visual).read_text(encoding="utf-8"))}
    man = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    meta = {norm(f"{e['tier']}__{e['file']}"): e for e in man["entries"]}

    cands = []
    for k, e in meta.items():
        v = vis.get(k)
        if not v or v["tier"] not in ELIGIBLE_TIERS:
            continue
        fams = [f for f in FAMILIES if v["families"].get(f, 0) > 0]
        depth = sum(v["families"].get(f, 0) for f in FAMILIES)
        cands.append({
            "key": k, "title": e["title"], "author": e["author"], "url": e["source_url"],
            "stratum": e["tier"], "tier": v["tier"], "loc": e["non_comment_lines"],
            "families": "".join(fams), "distinct_families": len(fams),
            "visual_call_sites": depth,
            "dynamic_colour_sites": v.get("dynamic_color_sites", 0),
            "conditional_visibility": v.get("conditional_visibility", False),
            "sha": e["sha256_normalized"],
        })

    cands.sort(key=lambda c: (-c["distinct_families"], -c["visual_call_sites"], c["sha"]))

    picked, per_stratum, per_author = [], {}, {}
    for c in cands:
        if len(picked) >= TARGET:
            break
        if per_stratum.get(c["stratum"], 0) >= MAX_PER_STRATUM:
            continue
        if per_author.get(c["author"], 0) >= MAX_PER_AUTHOR:
            continue
        picked.append(c)
        per_stratum[c["stratum"]] = per_stratum.get(c["stratum"], 0) + 1
        per_author[c["author"]] = per_author.get(c["author"], 0) + 1

    print(f"eligible (V4/V5): {len(cands)} of {len(meta)} frozen scripts")
    print(f"selected: {len(picked)} (target {TARGET})\n")
    print(f"{'#':>2}  {'tier':<4} {'fams':<8} {'sites':>5} {'loc':>5}  {'stratum':<16} {'author':<20} title")
    for i, c in enumerate(picked, 1):
        print(f"{i:>2}  {c['tier']:<4} {c['families']:<8} {c['visual_call_sites']:>5} "
              f"{c['loc']:>5}  {c['stratum']:<16} {c['author'][:19]:<20} {c['title'][:44]}")

    cov = {}
    for f in FAMILIES:
        cov[f] = sum(1 for c in picked if f in c["families"])
    print("\nCAPABILITY COVERAGE of the selected set (how many exercise each family):")
    names = {"P": "plot()", "L": "hline()", "F": "fill()", "B": "bgcolor/barcolor",
             "M": "plotshape/char/arrow", "C": "plotcandle/plotbar", "O": "label/line/box/table"}
    for f in FAMILIES:
        print(f"  {names[f]:<24} {cov[f]:>2}/{len(picked)}")
    print(f"  {'dynamic colour':<24} {sum(1 for c in picked if c['dynamic_colour_sites']>0):>2}/{len(picked)}")
    print(f"  {'conditional visibility':<24} {sum(1 for c in picked if c['conditional_visibility']):>2}/{len(picked)}")
    uncovered = [names[f] for f in FAMILIES if cov[f] == 0]
    if uncovered:
        print(f"\n  !! NOT exercised by this set: {', '.join(uncovered)}")

    if args.out:
        Path(args.out).write_text(json.dumps(
            {"rule": {"target": TARGET, "eligible_tiers": sorted(ELIGIBLE_TIERS),
                      "max_per_stratum": MAX_PER_STRATUM, "max_per_author": MAX_PER_AUTHOR},
             "selected": picked}, indent=2), encoding="utf-8")
        print(f"\nWrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
