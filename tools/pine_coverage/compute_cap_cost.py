# -*- coding: utf-8 -*-
"""compute_cap_cost.py - what each compute cap costs on the SERVER lane, measured.

The browser half is ``app/src/components/chart/engine/ast/computeCapCost.measure.test.js``;
it writes ``<out>.trees.json`` (every construct's canonical tree and every freed script's
host trees). This times the same trees through ``api.services.ast_interpret.interpret``,
the walker the alert arm and the scan sweep call, over two bar counts:

  window   ``indicator_alert_evaluator.bars_wanted(max_lookback(tree))``: the bars the
           alert arm fetches and the sweep's ``want`` (the same formula, railed equal by
           ``test_the_two_lanes_size_the_same_window``). This is what ONE SYMBOL costs.
  full     the newest 5,000 bars (``bars_window.HISTORY_WINDOW_BARS``), the most either
           server lane can be handed.

Usage (under the heavy lock; nothing is written but ``--out``):
  python tools/pine_coverage/compute_cap_cost.py --trees <out>.trees.json --out <file.json>
      [--only id1,id2] [--timeout 120] [--caps 384,2560,12] [--skip-full prefix1,prefix2]

``--caps nodes,lookback,series`` measures at CANDIDATE caps: each case's child process sets
``ast_budget.DEFAULT_BUDGET`` to them before it runs (a measurement-only override; the product
module is never edited). Each case runs in its own process with a wall-clock ``--timeout``: a
case that does not finish is recorded as ``">= <timeout> s (stopped)"``, a LOWER bound, never
as a measurement it was not.
"""
import argparse
import json
import multiprocessing as mp
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def load_bars(series_rel, n):
    cap = json.load(open(os.path.join(ROOT, series_rel), encoding="utf-8"))
    rows = cap["bars"]["rows"][-n:]
    if len(rows) != n:
        raise SystemExit("series has %d bars, need %d" % (len(rows), n))
    return [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in rows]


def _child(conn, trees, series_rel, nbars, opts, caps, want_peak, inputs=None):
    """One case, in its own process: seconds (and the tracemalloc peak) over the newest `nbars` bars.
    Every tree is run; a tree the walker refuses is counted by its guard and the rest still run,
    so a document's time is the time of what this lane computes for it."""
    try:
        if ROOT not in sys.path:
            sys.path.insert(0, ROOT)
        from api.services import ast_budget, ast_interpret
        if caps:
            ast_budget.DEFAULT_BUDGET = dict(caps)
        bars = load_bars(series_rel, nbars)
        if want_peak:
            import tracemalloc
            tracemalloc.start()
        t0 = time.perf_counter()
        refused = {}
        for tree in trees:
            try:
                ast_interpret.interpret(tree, [dict(b) for b in bars], inputs, None, None, opts)
            except ast_interpret.TableRefusal as exc:
                g = getattr(exc, "guard", None) or "?"
                refused[g] = refused.get(g, 0) + 1
        secs = time.perf_counter() - t0
        # a case whose EVERY tree refused measured nothing: that is its answer, not a time
        err = ({"guard": ",".join(sorted(refused)), "message": "every tree refused"}
               if refused and sum(refused.values()) == len(trees) else None)
        peak = None
        if want_peak:
            import tracemalloc
            peak = round(tracemalloc.get_traced_memory()[1] / 1048576, 2)
            tracemalloc.stop()
        conn.send({"seconds": round(secs, 3), "error": err, "peakMB": peak, "refusedTrees": refused or None})
    except Exception as exc:  # noqa: BLE001 -- reported as the case's result, never swallowed
        conn.send({"seconds": None, "error": {"guard": None, "message": "%s: %s" % (type(exc).__name__, exc)}})
    finally:
        conn.close()


def run_case(trees, series_rel, nbars, opts, caps, timeout, want_peak=False, inputs=None):
    parent, child = mp.Pipe(duplex=False)
    p = mp.Process(target=_child, args=(child, trees, series_rel, nbars, opts, caps, want_peak, inputs))
    p.start()
    child.close()
    if parent.poll(timeout):
        res = parent.recv()
        p.join(10)
        return res
    p.terminate()
    p.join(10)
    return {"seconds": None, "stoppedAfter": timeout, "error": None}


def measure(trees, series_rel, nbars, opts, caps, timeout, inputs=None):
    """Time (median of up to three when quick), then the peak in a run of its own."""
    first = run_case(trees, series_rel, nbars, opts, caps, timeout, inputs=inputs)
    if first.get("seconds") is None or first.get("error"):
        return first
    times = [first["seconds"]]
    if first["seconds"] < 5:
        for _ in range(2):
            r = run_case(trees, series_rel, nbars, opts, caps, timeout, inputs=inputs)
            if r.get("seconds") is not None:
                times.append(r["seconds"])
    times.sort()
    out = {"seconds": times[len(times) // 2], "runs": len(times), "error": None,
           "refusedTrees": first.get("refusedTrees")}
    if first["seconds"] < 60:
        out["peakMB"] = run_case(trees, series_rel, nbars, opts, caps, timeout * 3, want_peak=True,
                                 inputs=inputs).get("peakMB")
    return out


def fmt(r):
    if r.get("seconds") is None and r.get("stoppedAfter"):
        return ">= %ds (stopped)" % r["stoppedAfter"]
    if r.get("error"):
        return "REFUSED %s" % (r["error"].get("guard") or r["error"].get("message"))
    refused = r.get("refusedTrees")
    return "%.3fs%s" % (r["seconds"], (" (refused trees %s)" % refused) if refused else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trees", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default=None)
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--caps", default=None, help="nodes,lookback,series: measure at these candidate caps")
    ap.add_argument("--skip-full", default="", help="id prefixes measured on the alert window only")
    a = ap.parse_args()
    from api.services import ast_budget, ast_interpret
    from api.services.bars_window import HISTORY_WINDOW_BARS
    from api.services.indicator_alert_evaluator import bars_wanted
    caps = None
    if a.caps:
        n, lb, s = (int(x) for x in a.caps.split(","))
        caps = {"maxNodes": n, "maxLookback": lb, "maxSeriesRefs": s}
    data = json.load(open(a.trees, encoding="utf-8"))
    only = set(a.only.split(",")) if a.only else None
    skip_full = tuple(p for p in a.skip_full.split(",") if p)
    rows = []
    for item in data["trees"]:
        if only and item["id"] not in only:
            continue
        trees = list(item["trees"].values()) if "trees" in item else [item["tree"]]
        try:
            lookback = max(ast_interpret.max_lookback(t) for t in trees)
        except ast_interpret.TableRefusal as exc:
            rows.append({"id": item["id"], "refused": str(exc)[:300]})
            continue
        opts = {"tf": item.get("tf") or "D"}
        window = bars_wanted(lookback)
        row = {"id": item["id"], "family": item["family"], "n": item.get("n"), "trees": len(trees),
               "lookback": lookback, "windowBars": window}
        inputs = item.get("inputs") or None
        row["window"] = measure(trees, data["series"], window, opts, caps, a.timeout, inputs)
        if window == HISTORY_WINDOW_BARS:
            row["full"] = row["window"]
        elif item["id"].startswith(skip_full) if skip_full else False:
            row["full"] = None
        else:
            row["full"] = measure(trees, data["series"], HISTORY_WINDOW_BARS, opts, caps, a.timeout, inputs)
        rows.append(row)
        print("[cap-cost-py] %s: window %d bars %s | full %s" % (
            item["id"], window, fmt(row["window"]), fmt(row["full"]) if row["full"] else "-"), flush=True)
        tmp = a.out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"python": sys.version.split()[0], "bars": HISTORY_WINDOW_BARS, "series": data["series"],
                       "caps": caps or dict(ast_budget.DEFAULT_BUDGET), "timeout": a.timeout, "rows": rows}, f, indent=1)
        os.replace(tmp, a.out)


if __name__ == "__main__":
    main()
