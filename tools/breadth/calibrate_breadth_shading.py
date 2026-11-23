"""Calibrate the Breadth Monitor's shading cutoffs — run about once a year.

The Monitor shades a cell by how RARE its reading is across all the breadth history
we hold (owner round 5, 2026-11-19): Notable = top/bottom 10%, Strong = 3%, Extreme
= 0.5% (the percentages live in app/src/pages/breadth/shadeSpec.json). The cutoffs
are FROZEN: this script computes them once and writes
app/src/pages/breadth/shadeCutoffs.generated.json, which the UI imports — so a past
day never changes color as new days arrive. Re-run it deliberately, then commit.

What it stores: per column, the value at each tail percentile on a fixed GRID (both
ends) plus the median. Because the grid is wider than today's pcts, the owner can
loosen or tighten shadeSpec.json `pcts` to any grid point WITHOUT a re-run.

⛔ PRIVACY (owner rule): this prints NO market values. The report is value-free:
per column, the number of days at each level per year, and the dates (+ column
names) of Extreme days. Never print or `cat` the generated file.

Usage, from the repo root, with the project venv:
    python tools/breadth/calibrate_breadth_shading.py            # write + report
    python tools/breadth/calibrate_breadth_shading.py --report-only
    python tools/breadth/calibrate_breadth_shading.py --universe nasdaq   # us / nasdaq / nyse

PER UNIVERSE (the Monitor's universe switcher). The file is `{universe: cutoffs}`; each run
rewrites ONLY its universe's entry. `--universe us|nasdaq|nyse` calibrates over that universe's
full PRE-BUILT history (`api.services.breadth_universe_monitor`, the rows the Monitor serves)
and only its PER-UNIVERSE columns: the market-wide ones (VIX, sentiment, the index readings,
UCT Exp, ...) are the same reading everywhere and the UI shades them by UCT's cutoffs.
The data comes from the same service the Monitor reads
(`api.services.breadth_monitor.get_history_deep`), so the rows are derived exactly
as the UI sees them. Run it where the DEEP history lives (production holds it back
to the reconstructed past; a local dev box usually holds only recent collector rows,
which the generated file records as `sessions`/`from`/`to`).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from datetime import date as _date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPEC = os.path.join(ROOT, "app", "src", "pages", "breadth", "shadeSpec.json")
OUT = os.path.join(ROOT, "app", "src", "pages", "breadth", "shadeCutoffs.generated.json")

# Tail percentiles stored for every column (each end). shadeSpec `pcts` must be on it.
GRID = [0.5, 1, 2, 3, 4, 5, 7.5, 10, 12.5, 15, 20, 25, 30]

# ⭐ THE RULE LIVES IN ONE PYTHON PLACE (api/services/breadth_shade_rule.py), shared with the
# drill window's reading endpoint; re-exported here under the names this tool always had.
sys.path.insert(0, ROOT)
from api.services.breadth_shade_rule import (  # noqa: E402,F401
    LEVELS, MARKET_WIDE_COLS, NOT_PER_UNIVERSE, WINDOW_FLOOR, _paired, cut_key, is_backtested_cell,
    load_uct_deep_rows, numeric, quantile, read_export as _read_export, shade, shade_value,
)


def sig(x: float) -> float:
    """4 significant digits — the file stays small and the cut is unaffected in practice."""
    if x == 0 or not math.isfinite(x):
        return 0.0 if not math.isfinite(x) else x
    return float(f"{x:.4g}")


def load_rows(universe: str = "uct", uct_deep: str = "", uct_backtest: str = "", exposure_db: str = "") -> list:
    """The rows the Monitor SHOWS. ⛔ (2026-11-22) UCT is never calibrated on the V2 `uct_backtest`
    series any more: it is today's list run backward, and it is not what the cells display."""
    sys.path.insert(0, ROOT)
    if uct_backtest:
        raise SystemExit("--uct-backtest is retired: UCT is calibrated on the Monitor's own rows "
                         "(--uct-deep), its back-tested sessions excluded")
    if universe == "uct" and uct_deep:
        return load_uct_deep_rows(uct_deep, exposure_db)
    if universe != "uct":
        # the rows as served: the universe's own columns plus its Health (scored at serve time)
        from api.services import breadth_monitor as svc  # noqa: E402
        rows = svc.get_history_universe(universe, days=8000)
        return [r for r in reversed(rows) if not r.get("_provisional")]
    from api.services import breadth_monitor as svc  # noqa: E402
    rows = svc.get_history_deep(days=8000)
    return [r for r in rows if not r.get("_live")]


def apply_uct_pit(rows: list, series_path: str) -> int:
    """The Monitor's own overlay (`breadth_uct_pit.overlay`) and derive pass on the back-tested
    rows, so the ranking sees exactly what the cells show with BREADTH_UCT_PIT on. Only the rebuilt
    rows take the re-derived fields; every other row stays as exported."""
    sys.path.insert(0, ROOT)
    import copy
    from api.services import breadth_uct_pit as pit  # noqa: E402
    from api.services import breadth_monitor as svc  # noqa: E402
    os.environ["BREADTH_UCT_PIT"] = "1"
    pit.SERIES_PATH = series_path
    pit._view.clear()
    n = pit.overlay(rows)
    work = copy.deepcopy(rows)
    svc._derive_ascending(work, 0)
    for r, w in zip(rows, work):
        if r.get("_uct_pit"):
            for k, v in w.items():
                if k != "adv_decline_cum":
                    r[k] = v
        r.pop("_ad_back", None)
    return n


def apply_uct_exp_model(rows: list, series_path: str) -> int:
    """The Monitor's own fill (`breadth_uct_exposure_model.fill`): blank UCT Exp before the wire
    published the current formula takes the formula run on history, as the cells show it."""
    sys.path.insert(0, ROOT)
    from api.services import breadth_uct_exposure_model as uxm  # noqa: E402
    os.environ["BREADTH_UCT_EXP_MODEL"] = "1"
    uxm.SERIES_PATH = series_path
    uxm._view.clear()
    return uxm.fill(rows)


def spec_for(spec: dict, universe: str) -> dict:
    """UCT: the whole spec. Elsewhere: only the per-universe columns."""
    if universe == "uct":
        return spec
    cols = {k: c for k, c in spec["cols"].items() if k not in MARKET_WIDE_COLS and k not in NOT_PER_UNIVERSE}
    return {**spec, "cols": cols}


def read_all() -> dict:
    """The cutoffs file as `{universe: cutoffs}` (a pre-universe single-cutoffs file is UCT's)."""
    try:
        with open(OUT, encoding="utf-8") as f:
            doc = json.load(f)
    except FileNotFoundError:
        return {}
    if "cols" in doc:                       # the old single-universe shape
        doc = {"uct": {k: v for k, v in doc.items() if k != "_doc"}}
    return {k: v for k, v in doc.items() if k != "_doc"}


def write_all(by_universe: dict) -> None:
    doc = {"_doc": "GENERATED by tools/breadth/calibrate_breadth_shading.py -- frozen shading cutoffs per "
                   "universe. Do not edit by hand; do not print (market data)."}
    for u in ("uct", "us", "nasdaq", "nyse"):
        if u in by_universe:
            doc[u] = by_universe[u]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")


#: How far past its share a level may reach before a tie moves its cutoff (continuous columns
#: land on their share within a session or two; a tied value can hold a third of history).
TIE_SLACK = 1.2


def tie_strict(vals: list, cut: float, share: float, end: str) -> float:
    """⛔ (2026-11-23) A level never covers more history than its share. On a column with few
    distinct values (distribution days, UCT Exp, CNN Fear & Greed, the up/down ratios) the quantile
    lands ON a common value, and every session tied with it would be shaded: UCT Exp read Extreme
    on a third of its sessions. When the sessions at or past the cutoff exceed the share, the
    cutoff moves to the next distinct value further out (past the last one: nothing is that rare)."""
    import bisect
    n = len(vals)
    if not n:
        return cut
    if end == "hi":
        if (n - bisect.bisect_left(vals, cut)) / n <= share * TIE_SLACK + 1.0 / n:
            return cut
        i = bisect.bisect_right(vals, cut)
        return sig(vals[i]) if i < n else math.nextafter(vals[-1], math.inf)
    if bisect.bisect_right(vals, cut) / n <= share * TIE_SLACK + 1.0 / n:
        return cut
    i = bisect.bisect_left(vals, cut) - 1
    return sig(vals[i]) if i >= 0 else math.nextafter(vals[0], -math.inf)


def build_cutoffs(rows: list, spec: dict, universe: str = "uct") -> dict:
    cols = {}
    fields = {}
    for key, c in spec["cols"].items():
        if c.get("kind"):
            continue
        field = c.get("basis") or key
        fields[cut_key(c, field)] = (c, field, key)
    for ck in sorted(fields):
        c, field, key = fields[ck]
        # ⛔ a back-tested UCT session is never part of the ranking (breadth_shade_rule)
        vals = sorted(v for v in (shade_value(c, field, r) for r in rows
                                  if not is_backtested_cell(key, r, universe)) if v is not None)
        if len(vals) < 20:
            continue  # too thin to rank — the UI leaves the column unshaded
        cols[ck] = {
            "n": len(vals),
            "mid": sig(quantile(vals, 0.5)),
            "lo": [tie_strict(vals, sig(quantile(vals, p / 100)), p / 100, "lo") for p in GRID],
            "hi": [tie_strict(vals, sig(quantile(vals, 1 - p / 100)), p / 100, "hi") for p in GRID],
        }
    dates = sorted(r["date"] for r in rows if r.get("date"))
    # the first session a PER-UNIVERSE column is ranked over (UCT: its first real, not back-tested,
    # session; the market-wide columns keep the whole window from `from`)
    real = [r["date"] for r in rows if r.get("date") and not is_backtested_cell("", r, universe)]
    return {
        "generated": _date.today().isoformat(),
        "sessions": len(dates),
        "from": dates[0] if dates else None,
        "ranked_from": min(real) if real else None,
        "to": dates[-1] if dates else None,
        "grid": GRID,
        # every count column is ranked as a share of the row's universe (shadeSpec `per`)
        "per": sorted({c["per"] for c in spec["cols"].values() if c.get("per")}),
        "cols": cols,
    }


def report(rows: list, spec: dict, cut: dict, universe: str = "uct") -> None:
    """Value-free: counts per level per year, Extreme dates + column names."""
    years = sorted({r["date"][:4] for r in rows})
    print(f"history: {cut['sessions']} sessions, {cut['from']} -> {cut['to']}, {len(years)} calendar years")
    print(f"pcts: {spec['pcts']}")
    extreme = defaultdict(list)
    print("\nper column: average days/year at Notable / Strong / Extreme (both tones), then per year")
    for key in spec["cols"]:
        per_year = defaultdict(lambda: [0, 0, 0])
        for r in rows:
            s = shade(r, key, spec, cut, universe)
            if s:
                per_year[r["date"][:4]][s[1] - 1] += 1
                if s[1] == 3:
                    extreme[r["date"]].append(key)
        tot = [sum(per_year[y][i] for y in years) for i in range(3)]
        avg = " / ".join(f"{t / max(1, len(years)):.1f}" for t in tot)
        detail = "  ".join(f"{y}:{'/'.join(str(x) for x in per_year[y])}" for y in years if any(per_year[y]))
        print(f"  {key:20s} {avg:18s} {detail}")
    print(f"\nExtreme days: {len(extreme)}")
    for d in sorted(extreme):
        print(f"  {d}  {', '.join(extreme[d])}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--report-only", action="store_true", help="use the committed cutoffs; write nothing")
    ap.add_argument("--universe", default="uct", choices=("uct", "us", "nasdaq", "nyse"),
                    help="which universe to calibrate (default uct); rewrites only its entry")
    ap.add_argument("--uct-deep", default="", help="UCT: the Monitor's deep rows (read-only production export)")
    ap.add_argument("--uct-backtest", default="", help="UCT: the V2 uct_backtest series (read-only production export)")
    ap.add_argument("--exposure-db", default="", help="UCT: a local monitor copy whose uct_exposure wins")
    ap.add_argument("--uct-pit", default="", help="UCT: the point-in-time history series (breadth_uct_pit) "
                                                  "laid over the back-tested rows, as the Monitor serves it")
    ap.add_argument("--uct-exp-model", default="", help="the rebuilt UCT Exp series "
                                                        "(breadth_uct_exposure_model) filled in as served")
    args = ap.parse_args(argv)
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)
    for lv in LEVELS:
        if spec["pcts"][lv] not in GRID:
            print(f"shadeSpec pcts.{lv} must be one of {GRID}")
            return 2
    uspec = spec_for(spec, args.universe)
    rows = load_rows(args.universe, args.uct_deep, args.uct_backtest, args.exposure_db)
    if args.uct_pit:
        if args.universe != "uct":
            raise SystemExit("--uct-pit is UCT only")
        print(f"uct pit rows laid over: {apply_uct_pit(rows, args.uct_pit)}")
    if args.uct_exp_model:
        print(f"uct exp rows filled: {apply_uct_exp_model(rows, args.uct_exp_model)}")
    # ⭐ THE WINDOW (owner 2026-11-19): every universe over ALL of its point-in-time history —
    # UCT (uct_backtest), US and Nasdaq from 2008-01-02, NYSE from 2009-06-11. Nothing before
    # 2008-01-02 is used, whatever a source holds (extending earlier is an owner decision).
    rows = [r for r in rows if r.get("date") and r["date"] >= WINDOW_FLOOR]
    every = read_all()
    print(f"universe: {args.universe}")
    if args.report_only:
        cut = every.get(args.universe)
        if cut is None:
            print(f"no cutoffs for {args.universe} in {os.path.relpath(OUT, ROOT)}")
            return 2
    else:
        cut = build_cutoffs(rows, uspec, args.universe)
        every[args.universe] = cut
        write_all(every)
        print(f"wrote {os.path.relpath(OUT, ROOT)} [{args.universe}] ({len(cut['cols'])} columns)")
    report(rows, uspec, cut, args.universe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
