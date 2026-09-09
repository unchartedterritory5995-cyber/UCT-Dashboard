"""
weighted.py — the same survey, counted two ways.

The fetch walked the catalogue most-boosted-first, so the early slice was
popularity-weighted and the full set is not. Those two populations disagree, and
the disagreement is a finding rather than an artefact: what members actually put
on their charts is not the same distribution as what has merely been published.

A roadmap needs both numbers. "Share of scripts" tells you how much of the
long tail a feature unlocks; "share of the popular cohort" tells you how much of
what people actually use it unlocks.

Writes weighted.json and prints the comparison.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

DRAW = ["label.new", "line.new", "box.new", "polyline.new", "linefill.new", "table.new"]
PLOTFAM = ["plot", "plotshape", "plotchar", "plotarrow", "plotcandle", "plotbar"]
TRACK = ["plot", "label.new", "line.new", "box.new", "fill", "plotshape", "table.new",
         "table.cell", "bgcolor", "barcolor", "hline", "polyline.new", "linefill.new",
         "plotchar", "plotcandle"]


def cnt(r, k):
    return ((r.get("presentation") or {}).get(k) or {}).get("count", 0)


def stats(rows):
    n = len(rows)
    if not n:
        return {}
    out = {"n": n}
    for k in TRACK:
        out[k] = round(100.0 * sum(1 for r in rows if cnt(r, k)) / n, 1)
    out["any_drawing_object"] = round(100.0 * sum(1 for r in rows if any(cnt(r, k) for k in DRAW)) / n, 1)
    out["no_plot_call"] = round(100.0 * sum(1 for r in rows if not cnt(r, "plot")) / n, 1)
    f = lambda key: round(100.0 * sum(1 for r in rows if (r.get("features") or {}).get(key)) / n, 1)  # noqa: E731
    out["for_loop"] = f("for_loops")
    out["udt"] = f("udt_types")
    out["methods"] = f("methods")
    out["varip"] = f("varip_decls")
    out["imports"] = f("imports")
    out["switch"] = f("switch")
    out["arrays"] = round(100.0 * sum(1 for r in rows if (r.get("object_pool") or {}).get("array_new_generic")) / n, 1)
    out["security"] = round(100.0 * sum(1 for r in rows if r.get("security_calls")) / n, 1)
    v = {}
    for r in rows:
        pv = r.get("pine_version") or 1
        v[pv] = v.get(pv, 0) + 1
    out["pine_pre_v5_pct"] = round(100.0 * sum(c for k, c in v.items() if k <= 4) / n, 1)
    out["pine_v6_pct"] = round(100.0 * v.get(6, 0) / n, 1)
    out["median_lines"] = sorted(r.get("lines") or 0 for r in rows)[n // 2]
    return out


def main():
    inv = json.load(open(os.path.join(HERE, "inventory.json"), encoding="utf-8"))
    rows = list(inv.values())
    ranked = sorted(rows, key=lambda r: -(r.get("agreeCount") or 0))

    pops = {
        "all_open_source": rows,
        "top_2000_by_boosts": ranked[:2000],
        "top_1000_by_boosts": ranked[:1000],
        "top_250_by_boosts": ranked[:250],
    }
    res = {k: stats(v) for k, v in pops.items()}
    json.dump(res, open(os.path.join(HERE, "weighted.json"), "w", encoding="utf-8"), indent=1)

    keys = ["any_drawing_object", "no_plot_call", "plot", "label.new", "line.new", "box.new",
            "table.new", "table.cell", "fill", "polyline.new", "for_loop", "arrays", "udt",
            "methods", "security", "switch", "pine_pre_v5_pct", "pine_v6_pct", "median_lines"]
    order = ["all_open_source", "top_2000_by_boosts", "top_1000_by_boosts", "top_250_by_boosts"]
    print("%-22s %12s %12s %12s %12s" % ("", "ALL", "top2000", "top1000", "top250"))
    print("%-22s %12s %12s %12s %12s" % ("n", *[res[o]["n"] for o in order]))
    print("-" * 74)
    for k in keys:
        vals = [res[o].get(k) for o in order]
        suffix = "" if k == "median_lines" else "%"
        print("%-22s %12s %12s %12s %12s" % (
            k, *["%s%s" % (v, suffix) for v in vals]))
    print("\nRead: a feature that climbs left-to-right is under-represented by a flat")
    print("per-script count and matters MORE than the headline suggests.")


if __name__ == "__main__":
    main()
