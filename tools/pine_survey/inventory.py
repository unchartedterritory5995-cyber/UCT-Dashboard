"""
inventory.py — mechanical feature inventory over fetched Pine sources.

Reads  sources/*.pine  (+ catalog.json, fetch_log.json)
Writes inventory.json  (per-script feature vectors)
       agg_presentation.json / agg_computation.json / agg_constants.json

Design notes
------------
* Comments and string CONTENTS are stripped before analysis, but quotes are kept
  so that commas inside strings never split an argument list.
* Call sites are found by identifier-boundary match, then the argument list is
  extracted by paren matching, then split on TOP-LEVEL commas. Named arguments
  are detected as `name=` at top level. This gives exact arg-name demand.
* Nothing here makes a judgment call. Counts only. Ratings are for agents.
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "sources")
CATALOG = os.path.join(HERE, "catalog.json")
FETCHLOG = os.path.join(HERE, "fetch_log.json")

# ---------------------------------------------------------------- primitives
PRESENTATION = [
    "plot", "plotshape", "plotchar", "plotarrow", "plotcandle", "plotbar",
    "fill", "hline", "bgcolor", "barcolor",
    "label.new", "line.new", "box.new", "polyline.new", "linefill.new",
    "table.new", "table.cell", "table.merge_cells", "table.clear",
    "label.delete", "line.delete", "box.delete", "polyline.delete", "table.delete",
    "label.copy", "line.copy", "box.copy",
    "chart.point.new", "chart.point.from_index", "chart.point.from_time", "chart.point.now",
]
SETTER_NS = ["label", "line", "box", "table", "linefill", "polyline"]

COMPUTE_NS = ["ta", "math", "str", "array", "matrix", "map", "request", "ticker",
              "color", "input", "strategy", "runtime", "syminfo", "timeframe",
              "session", "barstate", "chart", "currency", "dayofweek", "time"]

CONST_NS = ["shape", "location", "size", "extend", "xloc", "yloc", "position",
            "display", "format", "scale", "text", "font", "alert", "plot",
            "hline", "label", "line", "barmerge", "color", "math", "dayofweek",
            "currency", "session", "adjustment", "backadjustment", "settlement_as_close",
            "earnings", "dividends", "splits", "order", "strategy"]

DECL_ARGS = ["title", "shorttitle", "overlay", "format", "precision", "scale",
             "max_bars_back", "max_lines_count", "max_labels_count",
             "max_boxes_count", "max_polylines_count", "explicit_plot_zorder",
             "timeframe", "timeframe_gaps", "behind_chart", "calc_bars_count"]


def strip_noise(src):
    """Remove // comments and the CONTENTS of string literals (keep the quotes)."""
    out = []
    i, n = 0, len(src)
    in_s = None
    while i < n:
        ch = src[i]
        if in_s:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == in_s:
                out.append(ch)
                in_s = None
                i += 1
                continue
            i += 1  # drop string content
            continue
        if ch in ('"', "'"):
            in_s = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def arg_list(text, open_idx):
    """Given index of '(', return (inner_text, index_after_close)."""
    depth = 0
    i = open_idx
    n = len(text)
    in_s = None
    while i < n:
        c = text[i]
        if in_s:
            if c == "\\":
                i += 2
                continue
            if c == in_s:
                in_s = None
            i += 1
            continue
        if c in ('"', "'"):
            in_s = c
        elif c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i], i + 1
        i += 1
    return "", n


def split_top(inner):
    parts, buf, depth, in_s = [], [], 0, None
    for c in inner:
        if in_s:
            buf.append(c)
            if c == in_s:
                in_s = None
            continue
        if c in ('"', "'"):
            in_s = c
            buf.append(c)
            continue
        if c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        if c == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(c)
    if buf:
        parts.append("".join(buf))
    return [p.strip() for p in parts if p.strip()]


NAMED = re.compile(r"^([A-Za-z_]\w*)\s*=(?!=)")


def find_calls(clean, name):
    """Yield (inner_arg_text) for each call site of `name(`."""
    pat = re.compile(r"(?<![\w.])" + re.escape(name) + r"\s*\(")
    for m in pat.finditer(clean):
        inner, _ = arg_list(clean, m.end() - 1)
        yield inner


def analyse(path, clean):
    r = {}
    # --- version + declaration
    mv = re.search(r"//\s*@version\s*=\s*(\d+)", open(path, encoding="utf-8", errors="replace").read())
    r["pine_version"] = int(mv.group(1)) if mv else None
    decl = None
    for d in ("indicator", "strategy", "library", "study"):
        if re.search(r"(?<![\w.])" + d + r"\s*\(", clean):
            decl = d
            break
    r["declaration"] = decl
    r["declaration_args"] = {}
    if decl:
        for inner in find_calls(clean, decl):
            for p in split_top(inner):
                m = NAMED.match(p)
                if m and m.group(1) in DECL_ARGS:
                    r["declaration_args"][m.group(1)] = p[m.end():].strip()[:40]
            break
    # --- presentation primitives: counts + named args + positional count
    pres = {}
    for prim in PRESENTATION:
        sites = list(find_calls(clean, prim))
        if not sites:
            continue
        names = Counter()
        pos = Counter()
        for inner in sites:
            parts = split_top(inner)
            npos = 0
            for p in parts:
                m = NAMED.match(p)
                if m:
                    names[m.group(1)] += 1
                else:
                    npos += 1
            pos[npos] += 1
        pres[prim] = {"count": len(sites),
                      "named_args": dict(names.most_common()),
                      "positional_arity": dict(sorted(pos.items()))}
    # --- setters (label.set_*, line.set_*, ...)
    setters = Counter()
    for ns in SETTER_NS:
        for m in re.finditer(r"(?<![\w.])" + ns + r"\.(set_\w+|get_\w+)\s*\(", clean):
            setters[ns + "." + m.group(1)] += 1
    if setters:
        pres["_setters"] = dict(setters.most_common())
    r["presentation"] = pres

    # --- constants actually used (demand over enumerated values)
    consts = Counter()
    for ns in CONST_NS:
        for m in re.finditer(r"(?<![\w.])" + ns + r"\.([A-Za-z_]\w*)", clean):
            consts[ns + "." + m.group(1)] += 1
    r["constants"] = dict(consts.most_common())

    # --- computation namespaces
    comp = defaultdict(Counter)
    for ns in COMPUTE_NS:
        for m in re.finditer(r"(?<![\w.])" + ns + r"\.([A-Za-z_]\w*)\s*\(", clean):
            comp[ns][m.group(1)] += 1
    r["computation_calls"] = {k: dict(v.most_common()) for k, v in comp.items() if v}

    # --- bare (un-namespaced, pre-v5) TA builtins
    BARE = ["sma", "ema", "rma", "wma", "vwma", "hma", "rsi", "macd", "stoch", "atr",
            "tr", "stdev", "dev", "highest", "lowest", "crossover", "crossunder",
            "cross", "change", "linreg", "sum", "cum", "barssince", "valuewhen",
            "pivothigh", "pivotlow", "security", "nz", "na", "iff", "roc", "cci",
            "mfi", "obv", "sar", "supertrend", "vwap", "percentile_linear_interpolation"]
    bare = Counter()
    for b in BARE:
        c = len(re.findall(r"(?<![\w.])" + b + r"\s*\(", clean))
        if c:
            bare[b] = c
    r["bare_builtins"] = dict(bare.most_common())

    # --- request.* detail
    req = []
    for fn in ["request.security", "request.security_lower_tf", "request.financial",
               "request.dividends", "request.splits", "request.earnings",
               "request.quandl", "request.economic", "request.seed", "request.currency_rate",
               "security"]:
        for inner in find_calls(clean, fn):
            parts = split_top(inner)
            entry = {"fn": fn, "argc": len(parts),
                     "named": [NAMED.match(p).group(1) for p in parts if NAMED.match(p)]}
            entry["tuple_return"] = False
            req.append(entry)
    r["security_calls"] = req
    # tuple-return detection: [a, b] = request.security(...)
    r["security_tuple_returns"] = len(re.findall(r"\[[^\]\n]{2,120}\]\s*=\s*(?:request\.)?security", clean))

    # --- language features
    feats = {
        "var_decls": len(re.findall(r"(?<![\w.])var\s+", clean)),
        "varip_decls": len(re.findall(r"(?<![\w.])varip\s+", clean)),
        "for_loops": len(re.findall(r"(?<![\w.])for\s+", clean)),
        "while_loops": len(re.findall(r"(?<![\w.])while\s+", clean)),
        "switch": len(re.findall(r"(?<![\w.])switch(?:\s|\n)", clean)),
        "if_blocks": len(re.findall(r"(?<![\w.])if\s+", clean)),
        "udt_types": len(re.findall(r"(?m)^\s*type\s+\w+", clean)),
        "methods": len(re.findall(r"(?m)^\s*method\s+", clean)),
        "udf": len(re.findall(r"(?m)^\s*\w+\s*\([^)]*\)\s*=>", clean)),
        "imports": len(re.findall(r"(?m)^\s*import\s+", clean)),
        "exports": len(re.findall(r"(?m)^\s*export\s+", clean)),
        "alertcondition": len(re.findall(r"(?<![\w.])alertcondition\s*\(", clean)),
        "alert_calls": len(re.findall(r"(?<![\w.])alert\s*\(", clean)),
        "ternaries": clean.count("?"),
        "history_refs": len(re.findall(r"\]\s*\[|\w\s*\[\s*\d+\s*\]", clean)),
        "max_history_ref": max([int(x) for x in re.findall(r"\w\[\s*(\d+)\s*\]", clean)] or [0]),
        "na_guards": len(re.findall(r"(?<![\w.])(?:na|nz)\s*\(", clean)),
    }
    r["features"] = feats

    # --- inputs
    inputs = Counter()
    for m in re.finditer(r"(?<![\w.])input\.(\w+)\s*\(", clean):
        inputs["input." + m.group(1)] += 1
    bare_input = len(re.findall(r"(?<![\w.])input\s*\(", clean))
    if bare_input:
        inputs["input() legacy"] = bare_input
    r["inputs"] = dict(inputs.most_common())
    r["inputs_count"] = sum(inputs.values())

    # --- barstate / timeframe / syminfo / session vars
    for ns in ["barstate", "timeframe", "syminfo", "session", "chart", "strategy"]:
        vals = Counter()
        for m in re.finditer(r"(?<![\w.])" + ns + r"\.(\w+)", clean):
            vals[ns + "." + m.group(1)] += 1
        if vals:
            r.setdefault("namespace_vars", {})[ns] = dict(vals.most_common())

    # --- drawing-object pool management
    pool = {
        "array_of_drawings": len(re.findall(r"array\.new<\s*(?:line|label|box|polyline|linefill|table)\s*>", clean))
                             + len(re.findall(r"array<\s*(?:line|label|box|polyline|linefill|table)\s*>", clean))
                             + len(re.findall(r"(?:line|label|box|polyline)\[\]", clean)),
        "array_new_generic": len(re.findall(r"array\.new(?:_\w+)?\s*\(|array\.new<", clean)),
        "matrix_new": len(re.findall(r"matrix\.new<", clean)),
        "map_new": len(re.findall(r"map\.new<", clean)),
        "deletes": sum(len(re.findall(r"(?<![\w.])" + t + r"\.delete\s*\(", clean))
                       for t in ["label", "line", "box", "polyline", "linefill", "table"]),
        "all_arrays": sum(len(re.findall(r"(?<![\w.])" + t + r"\.all(?![\w])", clean))
                          for t in ["label", "line", "box", "polyline", "table"]),
    }
    r["object_pool"] = pool
    return r


def main():
    if not os.path.isdir(SRC_DIR):
        print("no sources dir yet:", SRC_DIR)
        return
    catalog = {}
    if os.path.exists(CATALOG):
        catalog = json.load(open(CATALOG, encoding="utf-8"))
    log = {}
    if os.path.exists(FETCHLOG):
        log = json.load(open(FETCHLOG, encoding="utf-8"))
    by_slug = {v.get("slug"): (sid, v) for sid, v in log.items() if v.get("slug")}

    files = sorted(f for f in os.listdir(SRC_DIR) if f.endswith(".pine"))
    inv = {}
    for i, fn in enumerate(files, 1):
        path = os.path.join(SRC_DIR, fn)
        raw = open(path, encoding="utf-8", errors="replace").read()
        clean = strip_noise(raw)
        slug = fn[:-5]
        rec = analyse(path, clean)
        rec["slug"] = slug
        rec["chars"] = len(raw)
        rec["lines"] = len(raw.splitlines())
        sid, lg = by_slug.get(slug, (None, {}))
        rec["license"] = lg.get("license")
        rec["scriptIdPart"] = sid
        cat = catalog.get(sid, {}) if sid else {}
        rec["title"] = cat.get("title") or lg.get("scriptName")
        rec["author"] = cat.get("author")
        rec["agreeCount"] = cat.get("agreeCount")
        rec["editorsPick"] = cat.get("editorsPick")
        rec["imageUrl"] = cat.get("imageUrl")
        rec["found_by"] = cat.get("found_by")
        rec["tv_stats"] = (cat.get("extra") or {}).get("stats")
        rec["tv_is_price_study"] = (cat.get("extra") or {}).get("is_price_study")
        rec["tv_isMTF"] = (cat.get("extra") or {}).get("isMTFResolution")
        inv[slug] = rec
        if i % 200 == 0:
            print("analysed %d/%d" % (i, len(files)), flush=True)

    with open(os.path.join(HERE, "inventory.json"), "w", encoding="utf-8") as f:
        json.dump(inv, f, indent=1, ensure_ascii=False)

    # ---- aggregates
    N = len(inv)
    pres_scripts = Counter()
    pres_sites = Counter()
    argname = defaultdict(Counter)
    for r in inv.values():
        for prim, d in (r.get("presentation") or {}).items():
            if prim == "_setters":
                for k, c in d.items():
                    pres_scripts[k] += 1
                    pres_sites[k] += c
                continue
            pres_scripts[prim] += 1
            pres_sites[prim] += d["count"]
            for a, c in d["named_args"].items():
                argname[prim][a] += c
    agg_p = {"n_scripts": N, "primitives": [
        {"primitive": p, "scripts": pres_scripts[p], "pct_scripts": round(100.0 * pres_scripts[p] / N, 1),
         "call_sites": pres_sites[p], "named_args": dict(argname[p].most_common())}
        for p in sorted(pres_scripts, key=lambda k: -pres_scripts[k])]}
    json.dump(agg_p, open(os.path.join(HERE, "agg_presentation.json"), "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)

    comp_scripts = Counter()
    comp_sites = Counter()
    for r in inv.values():
        seen = set()
        for ns, d in (r.get("computation_calls") or {}).items():
            for fn, c in d.items():
                k = ns + "." + fn
                comp_sites[k] += c
                seen.add(k)
        for fn, c in (r.get("bare_builtins") or {}).items():
            k = "bare:" + fn
            comp_sites[k] += c
            seen.add(k)
        for k, v in (r.get("features") or {}).items():
            if v:
                comp_sites["feat:" + k] += v
                seen.add("feat:" + k)
        for k in seen:
            comp_scripts[k] += 1
    agg_c = {"n_scripts": N, "features": [
        {"feature": k, "scripts": comp_scripts[k], "pct_scripts": round(100.0 * comp_scripts[k] / N, 1),
         "call_sites": comp_sites[k]}
        for k in sorted(comp_scripts, key=lambda x: -comp_scripts[x])]}
    json.dump(agg_c, open(os.path.join(HERE, "agg_computation.json"), "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)

    cs_scripts = Counter()
    cs_sites = Counter()
    for r in inv.values():
        for k, c in (r.get("constants") or {}).items():
            cs_scripts[k] += 1
            cs_sites[k] += c
    agg_k = {"n_scripts": N, "constants": [
        {"constant": k, "scripts": cs_scripts[k], "pct_scripts": round(100.0 * cs_scripts[k] / N, 1),
         "call_sites": cs_sites[k]} for k in sorted(cs_scripts, key=lambda x: -cs_scripts[x])]}
    json.dump(agg_k, open(os.path.join(HERE, "agg_constants.json"), "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)

    print("\nINVENTORY DONE scripts=%d" % N)
    print("top presentation primitives:")
    for row in agg_p["primitives"][:18]:
        print("  %-22s %5.1f%% of scripts   %6d sites" % (row["primitive"], row["pct_scripts"], row["call_sites"]))


if __name__ == "__main__":
    sys.exit(main())
