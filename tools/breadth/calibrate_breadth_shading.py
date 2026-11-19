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
LEVELS = ("notable", "strong", "extreme")


def quantile(sorted_vals: list, q: float) -> float:
    """Linear-interpolated quantile (q in 0..1) of an ascending list."""
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    pos = q * (n - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, n - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def sig(x: float) -> float:
    """4 significant digits — the file stays small and the cut is unaffected in practice."""
    if x == 0 or not math.isfinite(x):
        return 0.0 if not math.isfinite(x) else x
    return float(f"{x:.4g}")


def numeric(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def load_rows(universe: str = "uct") -> list:
    sys.path.insert(0, ROOT)
    if universe != "uct":
        from api.services import breadth_universe_monitor as bum  # noqa: E402
        ds = bum.dates(universe)
        by = bum.rows_for_dates(universe, ds)
        return [dict(by[d], date=d) for d in ds if d in by]
    from api.services import breadth_monitor as svc  # noqa: E402
    rows = svc.get_history_deep(days=8000)
    return [r for r in rows if not r.get("_live")]


#: Columns the UI shades by UCT's cutoffs on every universe (app/src/pages/breadth/monitorUniverses.js
#: MARKET_WIDE_COLS) -- never calibrated per universe.
MARKET_WIDE_COLS = frozenset({
    "uct_exposure", "is_ftd", "spy_ma_stack", "qqq_ma_stack", "sp500_close", "qqq_close", "vix",
    "spy_dist_days", "qqq_dist_days", "rsp_spy_ratio", "iwm_qqq_ratio", "vix_term_structure",
    "cnn_fear_greed", "aaii_bulls", "aaii_neutral", "aaii_bears", "aaii_spread", "naaim", "cboe_putcall",
})
#: Hidden / not yet available off UCT (monitorUniverses.js).
NOT_PER_UNIVERSE = frozenset({"breadth_score", "up_vol_ratio", "hvc_52w", "atr_ext_7", "new_ath"})


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


def build_cutoffs(rows: list, spec: dict) -> dict:
    cols = {}
    fields = set()
    for key, c in spec["cols"].items():
        if c.get("kind"):
            continue
        fields.add(c.get("basis") or key)
    for field in sorted(fields):
        vals = sorted(v for v in (numeric(r.get(field)) for r in rows) if v is not None)
        if len(vals) < 20:
            continue  # too thin to rank — the UI leaves the column unshaded
        cols[field] = {
            "n": len(vals),
            "mid": sig(quantile(vals, 0.5)),
            "lo": [sig(quantile(vals, p / 100)) for p in GRID],
            "hi": [sig(quantile(vals, 1 - p / 100)) for p in GRID],
        }
    dates = sorted(r["date"] for r in rows if r.get("date"))
    return {
        "generated": _date.today().isoformat(),
        "sessions": len(dates),
        "from": dates[0] if dates else None,
        "to": dates[-1] if dates else None,
        "grid": GRID,
        "cols": cols,
    }


# ── The level rule — mirrors app/src/pages/breadth/shading.js exactly ─────────────
def _paired(u, d, side):
    if u is None or d is None or u + d == 0:
        return None
    r = u / (u + d)
    if side == "up":
        return ("bull", 2) if r >= 0.70 else ("bull", 1) if r >= 0.60 else None
    return ("bear", 2) if r <= 0.30 else ("bear", 1) if r <= 0.40 else None


def shade(row: dict, key: str, spec: dict, cut: dict):
    """(tone 'bull'|'bear', level 1..3) or None."""
    c = spec["cols"].get(key)
    if not c:
        return None
    kind = c.get("kind")
    if kind == "flag":
        return ("bull", 2) if row.get(key) else None
    if kind == "pair":
        mine, other = numeric(row.get(key)), numeric(row.get(c["with"]))
        u, d = (mine, other) if c["side"] == "up" else (other, mine)
        return _paired(u, d, c["side"])
    field = c.get("basis") or key
    v = numeric(row.get(field))
    t = cut["cols"].get(field)
    if v is None or t is None:
        return None
    idx = {lv: cut["grid"].index(spec["pcts"][lv]) for lv in LEVELS}
    sides = c.get("sides", "both")
    floors = c.get("floors") or {}
    level, end = 0, None
    if sides in ("both", "high") and v > t["mid"]:
        for i, lv in enumerate(LEVELS, 1):
            if v >= t["hi"][idx[lv]]:
                level, end = i, "high"
        if "high" in floors and v >= floors["high"]:
            level, end = max(level, 2), "high"
    if not level and sides in ("both", "low") and v < t["mid"]:
        for i, lv in enumerate(LEVELS, 1):
            if v <= t["lo"][idx[lv]]:
                level, end = i, "low"
    if sides in ("both", "low") and "low" in floors and v <= floors["low"]:
        level, end = max(level, 2), "low"
    if not level:
        return None
    return ("bull" if end == c["bull"] else "bear", level)


def report(rows: list, spec: dict, cut: dict) -> None:
    """Value-free: counts per level per year, Extreme dates + column names."""
    years = sorted({r["date"][:4] for r in rows})
    print(f"history: {cut['sessions']} sessions, {cut['from']} -> {cut['to']}, {len(years)} calendar years")
    print(f"pcts: {spec['pcts']}")
    extreme = defaultdict(list)
    print("\nper column: average days/year at Notable / Strong / Extreme (both tones), then per year")
    for key in spec["cols"]:
        per_year = defaultdict(lambda: [0, 0, 0])
        for r in rows:
            s = shade(r, key, spec, cut)
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
    args = ap.parse_args(argv)
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)
    for lv in LEVELS:
        if spec["pcts"][lv] not in GRID:
            print(f"shadeSpec pcts.{lv} must be one of {GRID}")
            return 2
    uspec = spec_for(spec, args.universe)
    rows = load_rows(args.universe)
    every = read_all()
    print(f"universe: {args.universe}")
    if args.report_only:
        cut = every.get(args.universe)
        if cut is None:
            print(f"no cutoffs for {args.universe} in {os.path.relpath(OUT, ROOT)}")
            return 2
    else:
        cut = build_cutoffs(rows, uspec)
        every[args.universe] = cut
        write_all(every)
        print(f"wrote {os.path.relpath(OUT, ROOT)} [{args.universe}] ({len(cut['cols'])} columns)")
    report(rows, uspec, cut)
    return 0


if __name__ == "__main__":
    sys.exit(main())
