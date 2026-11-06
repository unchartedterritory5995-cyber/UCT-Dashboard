# -*- coding: utf-8 -*-
"""w9_strategy_walls.py - W9 T0: name each strategy script's real wall, reproducibly.

  python tools/pine_coverage/w9_strategy_walls.py --cache <pine-sample dir> [--map docs/pine/coverage-map.json]
      [--out walls.json]

Reads the sample's STRATEGY scripts (a `strategy(` declaration): corpus/committed in the repo plus, when
--cache names the licence-held local cache, its builtin/ and reference/ folders. Only counts, names and
sha256 prefixes are written; no script text leaves this process (docs/pine/LICENSING.md).

Every wall is a regex over the script's comment- and string-stripped code (coverage_map.strip_code), so a
word in a comment or a string never counts. The ORDER set is coverage_map.STRATEGY_ORDERS (the engine's
own STRATEGY_ORDER_CALLS): one authority. The wall list and its tasks are W9-STRATEGY-DESIGN section 1.
"""
import argparse
import collections
import glob
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.pine_coverage import coverage_map as CM  # noqa: E402

STRATEGY_DECL_RX = re.compile(r"^\s*strategy\s*\(", re.M)


def call_args(code, open_idx):
    """The text between the parens of the call whose '(' is at open_idx (balanced)."""
    depth = 0
    for i in range(open_idx, len(code)):
        c = code[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return code[open_idx + 1:i]
    return code[open_idx + 1:]


def declaration_args(code):
    m = STRATEGY_DECL_RX.search(code)
    return call_args(code, m.end() - 1) if m else ""


def arg_value(args, name):
    """The raw text of a named argument at the call's top level, or None."""
    depth, parts, cur = 0, [], []
    for ch in args:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    for p in parts:
        m = re.match(r"\s*(\w+)\s*=(?!=)\s*(.*)$", p, re.S)
        if m and m.group(1) == name:
            return m.group(2).strip()
    return None


def calls_of(code, name):
    """The argument text of every call to `name` (`strategy.exit`), whitespace around dots allowed."""
    rx = r"(?<![\w.])" + r"\s*\.\s*".join(re.escape(p) for p in name.split(".")) + r"\s*\("
    return [call_args(code, m.end() - 1) for m in re.finditer(rx, code)]


def nonzero(v):
    """A declared value that is not the literal default 0 (a `0` or `0.0` changes nothing)."""
    return v is not None and re.fullmatch(r"[-+]?0*\.?0*", v.strip()) is None


def truthy(v):
    return v is not None and re.match(r"true\b", v) is not None


def walls_of_script(code, version):
    """{wall id: bool} for one strategy's stripped code. Ids are the design's section 1 rows."""
    d = declaration_args(code)
    qty_type, qty_val = arg_value(d, "default_qty_type"), arg_value(d, "default_qty_value")
    declared_pct = qty_type is not None and "percent_of_equity" in qty_type
    order_args = [a for n in ("strategy.entry", "strategy.order", "strategy.exit", "strategy.close",
                              "strategy.close_all", "strategy.cancel") for a in calls_of(code, n)]
    exits = calls_of(code, "strategy.exit")
    has = lambda args, keys: any(arg_value(a, k) is not None for a in args for k in keys)  # noqa: E731
    return {
        "sizing-percent": declared_pct or (version >= 6 and qty_type is None and qty_val is None),
        "sizing-v1-v4-default-qty": version <= 4 and qty_val is None,
        "currency": arg_value(d, "currency") is not None,
        "v5-defaults-capital-margin": version == 5 and arg_value(d, "initial_capital") is None,
        "risk": bool(re.search(r"(?<![\w.])strategy\s*\.\s*risk\s*\.", code)),
        "v5-when": version == 5 and has(order_args, ("when",)),
        "order": bool(calls_of(code, "strategy.order")),
        "oca": has(order_args, ("oca_name", "oca_type")),
        "trailing": has(exits, ("trail_price", "trail_points", "trail_offset")),
        "commission": nonzero(arg_value(d, "commission_value")),
        "partial-exit": any(arg_value(a, "qty") is not None or (arg_value(a, "qty_percent") not in (None, "100")) for a in exits),
        "slippage": nonzero(arg_value(d, "slippage")),
        "partial-close": has(calls_of(code, "strategy.close"), ("qty", "qty_percent")),
        "calc-on-every-tick": truthy(arg_value(d, "calc_on_every_tick")),
        "process-orders-on-close": truthy(arg_value(d, "process_orders_on_close")),
        "calc-on-order-fills": truthy(arg_value(d, "calc_on_order_fills")),
        "close-entries-margin-fill": arg_value(d, "close_entries_rule") is not None or any(nonzero(arg_value(d, k)) for k in (
            "margin_long", "margin_short", "backtest_fill_limits_assumption")),
        "close-all-immediately": any(truthy(arg_value(a, "immediately")) for a in calls_of(code, "strategy.close_all")),
        "pyramiding-default": arg_value(d, "pyramiding") is None,
    }


WALL_ROWS = [
    ("sizing-percent", "sizing: percent of equity (declared + v6 default)", "Q-S1a", "T4"),
    ("sizing-v1-v4-default-qty", "sizing: v1-v4 default quantity", "Q-S1a", "T4"),
    ("currency", "`currency =` (identity only)", "W9-D2", "T4"),
    ("v5-defaults-capital-margin", "v5 defaults: capital and margin", "Q-S1b", "T4"),
    ("risk", "`strategy.risk.*`", "W9-R1", "T8"),
    ("v5-when", "v5 `when =`", "Q-S1p", "T1"),
    ("order", "`strategy.order`", "W9-X4", "T7"),
    ("oca", "OCA groups", "W9-X3", "T7"),
    ("trailing", "trailing exits", "W9-X1", "T7"),
    ("commission", "commission", "W9-K1..K3", "T5"),
    ("partial-exit", "partial exits", "W9-X2", "T7"),
    ("slippage", "slippage", "W9-K4", "T5"),
    ("partial-close", "partial `strategy.close`", "W9-X2", "T7"),
    ("calc-on-every-tick", "`calc_on_every_tick = true`", "Q-S1o", "T6"),
    ("process-orders-on-close", "`process_orders_on_close = true`", "W9-P1, W9-P1b", "T6"),
    ("calc-on-order-fills", "`calc_on_order_fills = true`", "W9-P2", "T6"),
    ("close-entries-margin-fill", "`close_entries_rule`, `margin_*`, `backtest_fill_limits_assumption`", "W9-D1, W9-J1", "T4, T6"),
    ("close-all-immediately", "`close_all(immediately = true)`", "W9-X4", "T7"),
    ("pyramiding-default", "pyramiding default (no `pyramiding =` declared)", "Q-S1b", "T1"),
]
READBACKS = ("strategy.position_size", "strategy.position_avg_price", "strategy.opentrades")


def gather(committed_dir, cache):
    pops = {f: "committed" for f in sorted(glob.glob(os.path.join(committed_dir, "*.pine")))}
    if cache:
        for sub in ("builtin", "reference"):
            for f in sorted(glob.glob(os.path.join(cache, sub, "*.pine"))):
                pops[f] = sub
    return pops


def measure(pops, orders=None):
    rows = []
    for f, pop in sorted(pops.items(), key=lambda kv: (kv[1], os.path.basename(kv[0]))):
        src = open(f, encoding="utf-8", errors="replace").read()
        code, _ = CM.strip_code(src)
        if not STRATEGY_DECL_RX.search(code):
            continue
        version = CM.version_of(src)
        w = walls_of_script(code, version)
        called = CM.order_calls_in(code, orders)
        rows.append({
            "key": "%s:%s" % (pop, os.path.splitext(os.path.basename(f))[0]), "population": pop, "version": version,
            "sha256": hashlib.sha256(src.encode("utf-8")).hexdigest()[:16],
            "placesOrders": bool(called), "orders": sorted(called),
            "walls": sorted(k for k, v in w.items() if v),
            "readbacks": sorted(n for n in READBACKS if re.search(r"(?<![\w.])" + r"\s*\.\s*".join(n.split(".")) + r"\b", code)),
        })
    return rows


def summarise(rows, cmap=None):
    """The counts the design's section 1 prints, from the rows (and optionally a coverage-map.json)."""
    n = len(rows)
    touches = collections.Counter(w for r in rows for w in r["walls"])
    out = {
        "strategies": n,
        "byPopulation": dict(collections.Counter(r["population"] for r in rows)),
        "byVersion": {str(k): v for k, v in sorted(collections.Counter(r["version"] for r in rows).items())},
        "placingOrders": sum(1 for r in rows if r["placesOrders"]),
        "walls": [{"id": k, "label": lab, "pinnedBy": pin, "task": task, "touches": touches[k]} for k, lab, pin, task in WALL_ROWS],
        "readbackScripts": {nm: sum(1 for r in rows if nm in r["readbacks"]) for nm in READBACKS},
    }
    if cmap:
        by_sha = {s["sha256"]: s for s in cmap["scripts"]}
        inv = {i["name"]: i["scriptsUsing"] for i in cmap["inventory"]["items"]}
        out["censusAgainstSource"] = {nm: {"map": inv.get(nm, 0), "source": out["readbackScripts"][nm]} for nm in READBACKS}
        mapped = [by_sha.get(r["sha256"]) for r in rows]
        out["mappedToCensus"] = sum(1 for m in mapped if m)
        out["onlyW9"] = sum(1 for m in mapped if m and set(m["walls"]) <= {"[strategy]"})
        other = collections.Counter(w for m in mapped if m for w in m["walls"] if w != "[strategy]")
        out["otherWaveWalls"] = dict(other.most_common())
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--committed", default=os.path.join(CM.ROOT, "corpus", "committed"))
    ap.add_argument("--cache", default=None, help="the licence-held sample cache (has builtin/ and reference/)")
    ap.add_argument("--map", default=None, help="coverage-map.json: adds the census-against-source table")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    rows = measure(gather(a.committed, a.cache))
    cmap = json.load(open(a.map, encoding="utf-8")) if a.map else None
    res = {"summary": summarise(rows, cmap), "scripts": rows}
    text = json.dumps(res, indent=1, sort_keys=True)
    if a.out:
        tmp = a.out + ".tmp"
        open(tmp, "w", encoding="utf-8").write(text)
        os.replace(tmp, a.out)
    s = res["summary"]
    print("strategies %d (placing orders %d) %s %s" % (s["strategies"], s["placingOrders"], s["byPopulation"], s["byVersion"]))
    for w in s["walls"]:
        print("%-28s %3d  %s %s" % (w["id"], w["touches"], w["pinnedBy"], w["task"]))
    print("readbacks", s["readbackScripts"])
    if cmap:
        print("census vs source", s["censusAgainstSource"], "onlyW9", s["onlyW9"])


if __name__ == "__main__":
    main()
