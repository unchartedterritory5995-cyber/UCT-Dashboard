"""
rank.py — derive the visual-complexity ranking and emit the demand tables.

Complexity here is MEASURED, not judged: it is a function of how many distinct
drawing primitives a script uses, how many call sites it has, how big its object
pools are, and whether it manages them with arrays/loops. Agents then rate
rendering difficulty; this only decides WHICH scripts are worth their attention.

Outputs (all into this folder):
  lane3_candidates.json / .md   top-N most visually complex, with snapshot links
  table_presentation.md         demand-weighted primitive table
  table_computation.md          demand-weighted language/runtime table
  table_constants.md            demand-weighted enumerated-constant table
"""

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))

DRAW = ["label.new", "line.new", "box.new", "polyline.new", "linefill.new", "table.new"]
PLOTFAM = ["plot", "plotshape", "plotchar", "plotarrow", "plotcandle", "plotbar"]
PAINT = ["fill", "bgcolor", "barcolor", "hline"]


def load(n):
    p = os.path.join(HERE, n)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def score(r):
    pres = r.get("presentation") or {}
    def c(k):
        return (pres.get(k) or {}).get("count", 0)

    draw_sites = sum(c(k) for k in DRAW)
    plot_sites = sum(c(k) for k in PLOTFAM)
    paint_sites = sum(c(k) for k in PAINT)
    distinct_draw = sum(1 for k in DRAW if c(k))
    distinct_all = sum(1 for k in DRAW + PLOTFAM + PAINT if c(k))
    setters = sum((pres.get("_setters") or {}).values())
    cells = c("table.cell")
    pool = r.get("object_pool") or {}
    feats = r.get("features") or {}

    s = 0.0
    s += 6.0 * distinct_draw          # breadth of the drawing surface
    s += 2.0 * distinct_all
    s += 0.30 * min(draw_sites, 200)  # depth, capped so one loop-heavy file can't dominate
    s += 0.10 * min(plot_sites, 100)
    s += 0.20 * min(paint_sites, 60)
    s += 0.12 * min(setters, 300)
    s += 0.25 * min(cells, 200)
    s += 10.0 if c("polyline.new") else 0
    s += 6.0 * min(pool.get("array_of_drawings", 0), 5)
    s += 3.0 * min(pool.get("matrix_new", 0) + pool.get("map_new", 0), 4)
    s += 2.0 * min(feats.get("for_loops", 0), 10)
    s += 4.0 if feats.get("udt_types") else 0
    s += 2.0 if feats.get("methods") else 0
    s += 0.004 * min(r.get("lines", 0), 2000)
    return round(s, 2)


def digest(r):
    pres = r.get("presentation") or {}
    bits = []
    for k in DRAW + PLOTFAM + PAINT + ["table.cell"]:
        n = (pres.get(k) or {}).get("count", 0)
        if n:
            bits.append("%s×%d" % (k, n))
    f = r.get("features") or {}
    extra = []
    for k, lbl in (("for_loops", "for"), ("while_loops", "while"), ("udt_types", "UDT"),
                   ("methods", "method"), ("varip_decls", "varip"), ("imports", "import")):
        if f.get(k):
            extra.append("%s×%d" % (lbl, f[k]))
    pool = r.get("object_pool") or {}
    if pool.get("array_of_drawings"):
        extra.append("arr<draw>×%d" % pool["array_of_drawings"])
    if pool.get("deletes"):
        extra.append("delete×%d" % pool["deletes"])
    return ", ".join(bits), ", ".join(extra)


def main(top=150):
    inv = load("inventory.json")
    if not inv:
        print("no inventory.json — run inventory.py first")
        return
    snapman = load("snap_manifest.json") or {}
    by_sid = {v.get("scriptIdPart"): v for v in snapman.values()} if snapman else {}

    rows = []
    for slug, r in inv.items():
        rows.append((score(r), slug, r))
    rows.sort(key=lambda x: -x[0])

    cands = []
    for s, slug, r in rows[:int(top)]:
        d, e = digest(r)
        iid = r.get("imageUrl")
        cands.append({
            "rank": len(cands) + 1,
            "score_measured": s,
            "slug": slug,
            "title": r.get("title"),
            "author": r.get("author"),
            "agreeCount": r.get("agreeCount"),
            "editorsPick": r.get("editorsPick"),
            "pine_version": r.get("pine_version"),
            "declaration": r.get("declaration"),
            "lines": r.get("lines"),
            "license": r.get("license"),
            "scriptIdPart": r.get("scriptIdPart"),
            "source_file": os.path.join(HERE, "sources", slug + ".pine"),
            "snapshot_url": ("https://www.tradingview.com/i/%s/" % iid) if iid else None,
            "snapshot_file": os.path.join(HERE, "snapshots", iid + ".png") if iid else None,
            "primitives": d,
            "language": e,
            "tv_stats": r.get("tv_stats"),
            "overlay_per_tv": r.get("tv_is_price_study"),
        })
    json.dump(cands, open(os.path.join(HERE, "lane3_candidates.json"), "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)

    with open(os.path.join(HERE, "lane3_candidates.md"), "w", encoding="utf-8") as f:
        f.write("# Most visually complex open-source scripts (measured)\n\n")
        f.write("Score is mechanical (see rank.py). n=%d surveyed.\n\n" % len(inv))
        f.write("| # | score | title | author | boosts | v | lines | primitives | language |\n")
        f.write("|---|---|---|---|---|---|---|---|---|\n")
        for c in cands:
            f.write("| %d | %s | %s | %s | %s | %s | %s | %s | %s |\n" % (
                c["rank"], c["score_measured"], (c["title"] or c["slug"])[:52],
                c["author"] or "?", c["agreeCount"] or "?", c["pine_version"] or "?",
                c["lines"] or "?", c["primitives"][:90], c["language"][:50]))

    # ---------------- demand tables ----------------
    ap = load("agg_presentation.json")
    if ap:
        with open(os.path.join(HERE, "table_presentation.md"), "w", encoding="utf-8") as f:
            f.write("# Demand-weighted presentation primitives\n\n")
            f.write("Surveyed open-source TradingView community scripts: **n=%d**.\n" % ap["n_scripts"])
            f.write("Sorted by share of scripts. `named args seen` is the actual argument demand.\n\n")
            f.write("| primitive | %% scripts | call sites | named args seen (by frequency) |\n")
            f.write("|---|---|---|---|\n")
            for r in ap["primitives"]:
                args = ", ".join("%s(%d)" % (k, v) for k, v in list(r["named_args"].items())[:14])
                f.write("| `%s` | %.1f%% | %d | %s |\n" % (r["primitive"], r["pct_scripts"],
                                                           r["call_sites"], args or "—"))
    ac = load("agg_computation.json")
    if ac:
        with open(os.path.join(HERE, "table_computation.md"), "w", encoding="utf-8") as f:
            f.write("# Demand-weighted computation / language features\n\n")
            f.write("n=%d surveyed scripts. `feat:` rows are language constructs; " % ac["n_scripts"])
            f.write("`bare:` rows are un-namespaced pre-v5 builtins.\n\n")
            f.write("| feature | %% scripts | call sites |\n|---|---|---|\n")
            for r in ac["features"]:
                f.write("| `%s` | %.1f%% | %d |\n" % (r["feature"], r["pct_scripts"], r["call_sites"]))
    ak = load("agg_constants.json")
    if ak:
        with open(os.path.join(HERE, "table_constants.md"), "w", encoding="utf-8") as f:
            f.write("# Demand-weighted enumerated constants\n\n")
            f.write("n=%d surveyed scripts. This is the build order for constant support.\n\n" % ak["n_scripts"])
            f.write("| constant | %% scripts | call sites |\n|---|---|---|\n")
            for r in ak["constants"]:
                f.write("| `%s` | %.1f%% | %d |\n" % (r["constant"], r["pct_scripts"], r["call_sites"]))

    # ---------------- headline stats ----------------
    n = len(inv)
    vers = Counter(r.get("pine_version") for r in inv.values())
    decls = Counter(r.get("declaration") for r in inv.values())
    any_draw = sum(1 for r in inv.values()
                   if any((r.get("presentation") or {}).get(k) for k in DRAW))
    only_plot = sum(1 for r in inv.values()
                    if not any((r.get("presentation") or {}).get(k) for k in DRAW)
                    and any((r.get("presentation") or {}).get(k) for k in PLOTFAM))
    loops = sum(1 for r in inv.values() if (r.get("features") or {}).get("for_loops"))
    udts = sum(1 for r in inv.values() if (r.get("features") or {}).get("udt_types"))
    sec = sum(1 for r in inv.values() if r.get("security_calls"))
    arrs = sum(1 for r in inv.values() if (r.get("object_pool") or {}).get("array_new_generic"))
    print("n scripts                      : %d" % n)
    print("pine version mix               : %s" % dict(sorted(vers.items(), key=lambda x: (x[0] is None, x[0]))))
    print("declaration mix                : %s" % dict(decls.most_common()))
    print("uses ANY drawing object        : %d  (%.1f%%)" % (any_draw, 100.0 * any_draw / n))
    print("plot-family only (no drawings) : %d  (%.1f%%)" % (only_plot, 100.0 * only_plot / n))
    print("has a for loop                 : %d  (%.1f%%)" % (loops, 100.0 * loops / n))
    print("declares a UDT                 : %d  (%.1f%%)" % (udts, 100.0 * udts / n))
    print("calls request.*/security       : %d  (%.1f%%)" % (sec, 100.0 * sec / n))
    print("uses arrays                    : %d  (%.1f%%)" % (arrs, 100.0 * arrs / n))
    print("\nwrote lane3_candidates.{json,md} + table_{presentation,computation,constants}.md")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else 150)
