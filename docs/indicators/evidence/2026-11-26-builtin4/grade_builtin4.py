"""Grade the builtin4 entries against TradingView's own ta.* (run builtin4-2026-11-26: a witness script on AMEX:SPY and
NYSE:RDDT 1D, captured by FRED RS's rig). Same method as builtin3: the library's tree at the witness's settings, through
the server's evaluator on the CAPTURED bars, compared with TradingView's plotted value on every bar both have one; equal
within one part in a billion. It also settles the Intraday Intensity Index: TradingView's captured ta.iii against the
divide form and the multiply form. Captures are vendor data: they stay on this machine; only verdict words leave it.
Usage: UCT_REPO=<repo root holding the entries> python grade_builtin4.py"""
import glob
import io
import json
import math
import os
import sys

sys.path.insert(0, os.environ.get("UCT_REPO", "."))
from api.services import ast_interpret, call_expansions  # noqa: E402
from api.services import named_indicators as ni  # noqa: E402

RUN = os.path.expandvars(r"%LOCALAPPDATA%\uct-vendor-batch\runs\builtin4-2026-11-26\captures")
ENTRIES = {e["id"]: e for e in ni.entries()}
#: the witness's plots, in its own order (plot_0 .. plot_7) -> (entry, output, settings); None = graded below by hand
PLOTS = [("tr", "true_range", "tr", {}), ("wvad", "williams_variable_accumulation_distribution", "wvad", {}),
         ("swma", "symmetrically_weighted_moving_average", "swma", {}),
         ("lsma 25", "least_squares_moving_average", "lsma", {"length": 25}),
         ("lsma 14", "least_squares_moving_average", "lsma", {"length": 14}),
         ("iii", None, None, None),
         ("cog 10", "center_of_gravity", "cog", {"length": 10}), ("cog 7", "center_of_gravity", "cog", {"length": 7})]


def ok(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and not math.isnan(v) and not math.isinf(v)


def load(tag):
    (path,) = glob.glob(os.path.join(RUN, f"builtin4-witness-{tag}-*.json"))
    d = json.load(io.open(path, encoding="utf-8"))
    f = d["bars"]["fields"]
    bars = [{"t": r[f.index("time")], "o": r[f.index("open")], "h": r[f.index("high")], "l": r[f.index("low")],
             "c": r[f.index("close")], "v": r[f.index("volume")]} for r in d["bars"]["rows"]]
    pf = d["plotValues"]["fields"]
    rows = {r[pf.index("time")]: r for r in d["plotValues"]["rows"]}
    if d.get("newestBarIsForming"):
        bars = bars[:-1]
    return bars, pf, rows


def compare(got, bars, pf, rows, col):
    idx = pf.index(col)
    both = equal = 0
    first = None
    for i, b in enumerate(bars):
        tv = rows.get(b["t"], [None] * len(pf))[idx]
        g = got[i]
        if not (ok(tv) and ok(g)):
            continue
        both += 1
        if math.isclose(float(g), float(tv), rel_tol=1e-9, abs_tol=1e-9):
            equal += 1
        elif first is None:
            first = i
    return both, equal, first


def grade(tag):
    bars, pf, rows = load(tag)
    out = []
    for k, (title, eid, key, settings) in enumerate(PLOTS):
        col = f"plot_{k}"
        if eid is None:          # ta.iii: which form does TradingView compute?
            div = [(2 * b["c"] - b["h"] - b["l"]) / ((b["h"] - b["l"]) * b["v"]) if b["h"] != b["l"] and b["v"] else None for b in bars]
            mul = [(2 * b["c"] - b["h"] - b["l"]) / (b["h"] - b["l"]) * b["v"] if b["h"] != b["l"] else None for b in bars]
            for form, vals in (("iii DIVIDES by volume", div), ("iii MULTIPLIES by volume", mul)):
                out.append((form, *compare(vals, bars, pf, rows, col)))
            continue
        o = next(x for x in ENTRIES[eid]["outputs"] if x["key"] == key)
        tree = ni.tree_at(o, {**ni.defaults(ENTRIES[eid]), **settings})
        got = ast_interpret.interpret(call_expansions.expand_calls(tree), bars)
        out.append((title, *compare(got, bars, pf, rows, col)))
    return len(bars), out


if __name__ == "__main__":
    for tag in ("spy", "rddt"):
        n, res = grade(tag)
        print(f"== {tag.upper()} 1D, {n:,} bars")
        for title, both, equal, first in res:
            verdict = "EQUAL" if both and equal == both else ("NO OVERLAP" if not both else "DIFFERS")
            print(f"  {title:26} {verdict:10} {equal:,} of {both:,}" + (f" | first difference at bar {first}" if first is not None else ""))
