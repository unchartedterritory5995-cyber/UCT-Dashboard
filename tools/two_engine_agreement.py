"""Do `base_catalog` and the pattern engine agree on the names they SHARE?

Five concepts are implemented by both engines, and both are live on different
member surfaces. This measures how often they actually say the same thing about
the same symbol on the same bars, and it is the harness behind
`tests/test_two_engines_do_not_agree.py` — that rail says "RE-MEASURE" when a
threshold moves, and this is what it means.

    python tools/two_engine_agreement.py --sample 1500

⭐⭐ THE OVERLAP IS DERIVED, NOT TYPED. The base side comes from
`base_catalog.ALL_STRUCTURES`; the engine side from the registry, after
importing exactly the detector modules `_ensure_pattern_detectors_loaded()`
imports — read off `api/routers/patterns.py`'s AST. A hand-listed pair set goes
stale the day a sixth name is added, which is precisely when this matters.

⛔ BOTH ARMS SEE THE SAME BAR ARRAY. That is the whole point: "they were shown
different history" is the innocent explanation, and it has to be excluded by
construction rather than argued away. The engine arm is ALSO re-run at its own
shipped 200-bar depth (`api/main.py::_scan_patterns_daily`) so the window can
be ruled out as the cause rather than assumed away.

⛔ AND IT CANNOT REPORT A CLEAN-LOOKING NOTHING. It runs under `tools.probe`,
so a pass that measures no tickers or errors on all of them is refused rather
than printed. Two further controls ride along:

  1. the catalog arm is run TWICE per symbol on identical bars — anything short
     of total self-agreement means the arms are not comparable and every
     cross-engine number below is measuring this harness, not the engines;
  2. an empty union prints `--`, never `0.0%`. "Neither engine named anybody"
     and "they never agree" are different facts.

⛔⛔ READ-ONLY, AND THE TRIPWIRE IS LEFT ARMED TO PROVE IT. `/data` is a real
directory on this box, so importing the repo-root `conftest` first (a) sandboxes
every `/data` env pin and (b) installs the shared-root guard. Only the two DBs
this needs are pointed back at the live files, and both are opened `mode=ro`:
the screener snapshot (which `load_universe` already opens read-only) and
`bars.db` — `bars_sqlite._conn()` opens that READ-WRITE to set `PRAGMA
journal_mode`, so the CONNECTION is swapped for a read-only one while
`get_bars` itself is left untouched, keeping the shipped query and row shape.
The run prints the tripwire's verdict at the end; anything but zero refusals
means this went somewhere it should not have.
"""
from __future__ import annotations

import argparse
import ast
import importlib
import json
import os
import pathlib
import sqlite3
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Sandboxes every /data pin and arms the shared-root tripwire. MUST come before
# any product import — the paths are captured at module import.
import conftest                                                     # noqa: E402

LIVE_SCREENER = os.environ.get("UCT_LIVE_SCREENER_DB", r"C:\data\screener.db")
LIVE_BARS = os.environ.get("UCT_LIVE_BARS_DB", r"C:\data\bars.db")
os.environ["SCREENER_DB_PATH"] = LIVE_SCREENER

from tools.probe import Probe                                       # noqa: E402
from api.services import bars_sqlite                                # noqa: E402

_RO_BARS = sqlite3.connect(
    "file:%s?mode=ro" % LIVE_BARS.replace("\\", "/"), uri=True,
    check_same_thread=False)
bars_sqlite._conn = lambda: _RO_BARS

from tools.run_lift_ledger import load_universe                     # noqa: E402
from api.services.screener import base_catalog as bc                # noqa: E402
from api.services.screener import bases                             # noqa: E402
from api.services.pattern_engine import detect_all                  # noqa: E402
from api.services.pattern_engine.primitives.context import build_context  # noqa: E402

#: One concept, two spellings, so normalised-key equality cannot see it. The
#: standing sweep in `tests/test_no_second_authority_across_axes.py` compares
#: keys and therefore misses this pair; a member reads the LABEL.
NEAR_NAME_PAIRS = [("cup-with-handle", "cup_handle")]

#: Below this many symbols in the union, a percentage is a shape and not a
#: measurement.
MIN_UNION_FOR_A_RATE = 20


def shipped_registry() -> list:
    """Every pattern id the shipped loader registers.

    The router itself is not imported: it pulls FastAPI, the auth middleware and
    `pattern_engine.memory` (which opens `/data/patterns.db`), none of which is
    needed to register a detector.
    """
    tree = ast.parse((ROOT / "api/routers/patterns.py").read_text(encoding="utf-8"))
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module and \
                n.module.startswith("api.services.pattern_engine.detectors"):
            for a in n.names:
                importlib.import_module(n.module + "." + a.name)
    from api.services.pattern_engine.detectors import registry
    return registry.list_pattern_ids()


def _norm(s) -> str:
    return str(s).replace("-", "_").replace(" ", "_").lower()


def _rate(row):
    u = row["both"] + row["base_only"] + row["engine_only"]
    return (100.0 * row["both"] / u) if u else None


def _table(title, tally, n):
    print()
    print("=== %s ===" % title)
    print("%-22s %5s %6s %7s %8s %6s %8s %10s"
          % ("concept", "both", "base", "engine", "neither", "union",
             "agree%", "disagree%"))
    for key, t in tally.items():
        u = t["both"] + t["base_only"] + t["engine_only"]
        r = _rate(t)
        thin = u < MIN_UNION_FOR_A_RATE
        cells = ("      --", "        --") if (r is None or thin) else \
                ("%8.1f" % r, "%10.1f" % (100 - r))
        print("%-22s %5d %6d %7d %8d %6d %s %s"
              % (key, t["both"], t["base_only"], t["engine_only"],
                 t["neither"], u, cells[0], cells[1]))
    print("n = %d   (`--` = union under %d symbols; an empty cell is not a 0%%)"
          % (n, MIN_UNION_FOR_A_RATE))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=1500,
                    help="tickers drawn from the newest screener snapshot")
    ap.add_argument("--expect-min", type=int, default=300,
                    help="probe floor: fewer usable tickers than this is refused")
    ap.add_argument("--window", type=int, default=400,
                    help="the bar array BOTH arms see")
    ap.add_argument("--shipped-window", type=int, default=200,
                    help="the engine's own scan depth, for the confound control")
    ap.add_argument("--out", default="", help="optional JSON dump, per symbol")
    args = ap.parse_args()

    engine_ids = shipped_registry()
    by_norm = {_norm(i): i for i in engine_ids}
    exact = [(st.key, by_norm[_norm(st.key)])
             for st in bc.ALL_STRUCTURES if _norm(st.key) in by_norm]
    near = [p for p in NEAR_NAME_PAIRS if p[1] in engine_ids]
    pairs = exact + near
    want = sorted(set(e for _, e in pairs))

    print("[derive] base structures=%d  engine detectors registered=%d"
          % (len(bc.ALL_STRUCTURES), len(engine_ids)))
    print("[derive] exact-key overlap : %s"
          % ", ".join("%s<->%s" % p for p in exact))
    print("[derive] near-name concept : %s"
          % ", ".join("%s<->%s" % p for p in near))
    if not pairs:
        print("[derive] NO overlap found — the derivation is broken or the "
              "engines no longer share a name. Either way, stop.")
        return 2

    t0 = time.time()
    universe = load_universe(args.sample, seed=7)
    print("[universe] %d tickers with >=400 usable daily bars "
          "(sample=%d, seed=7) in %ds"
          % (len(universe), args.sample, time.time() - t0))

    blank = lambda: dict(both=0, base_only=0, engine_only=0, neither=0)
    same = {k: blank() for k, _ in pairs}
    deep = {k: blank() for k, _ in pairs}
    self_agree = 0
    rows = []

    with Probe("cross-engine agreement", expect_min=args.expect_min) as p:
        for sym, series in universe.items():
            with p.item(sym):
                w = series[-args.window:]

                cols = bases.classify(w, bars_full=series)
                matches = set((cols.get("base_matches") or "").strip(",").split(","))
                matches.discard("")
                # CONTROL: the same arm, the same bars, a second time.
                again = bases.classify(w, bars_full=series)
                if (again.get("base_matches") or "") == (cols.get("base_matches") or ""):
                    self_agree += 1

                fired = set(d.get("pattern_id")
                            for d in detect_all(w, build_context(w, sym=sym),
                                                pattern_ids=want))
                w2 = series[-args.shipped_window:]
                fired2 = set(d.get("pattern_id")
                             for d in detect_all(w2, build_context(w2, sym=sym),
                                                 pattern_ids=want))

                row = {"sym": sym, "bars": len(series)}
                for bk, ek in pairs:
                    a = bk in matches
                    for tally, b in ((same, ek in fired), (deep, ek in fired2)):
                        cell = ("both" if a and b else
                                "base_only" if a else
                                "engine_only" if b else "neither")
                        tally[bk][cell] += 1
                    row[bk] = ("both" if a and ek in fired else
                               "base_only" if a else
                               "engine_only" if ek in fired else "neither")
                rows.append(row)
                p.ok()

        for bk, ek in pairs:
            t = same[bk]
            r = _rate(t)
            p.result("%s <-> %s" % (bk, ek),
                     "both=%d base_only=%d engine_only=%d neither=%d agreement=%s"
                     % (t["both"], t["base_only"], t["engine_only"], t["neither"],
                        "--" if r is None else "%.1f%%" % r))
        p.result("catalog self-agreement (control)",
                 "%d/%d" % (self_agree, p.counted))

    _table("SAME BARS (%d-bar window)" % args.window, same, len(rows))
    _table("ENGINE AT ITS SHIPPED %d-BAR DEPTH (window confound)"
           % args.shipped_window, deep, len(rows))

    # ⭐⭐ THE RAW AGREEMENT RATE IS CEILINGED BY THE BASE-RATE MISMATCH, so on
    # its own it cannot separate "these two disagree" from "one of them simply
    # fires far more often". `expected` is how many symbols BOTH would name if
    # the two verdicts were independent; kappa is the agreement that survives
    # after chance is taken out. A kappa near zero means knowing one engine
    # fired tells you NOTHING about the other.
    n = len(rows)
    print()
    print("%-22s %6s %8s %6s %7s %8s %8s %9s"
          % ("concept", "both", "expected", "lift", "kappa", "base%",
             "engine%", "contained"))
    for bk, ek in pairs:
        t = same[bk]
        bn, en = t["both"] + t["base_only"], t["both"] + t["engine_only"]
        pb, pe_ = bn / n, en / n
        expected = n * pb * pe_
        lift = (t["both"] / expected) if expected else None
        po = (t["both"] + t["neither"]) / n
        pe = pb * pe_ + (1 - pb) * (1 - pe_)
        # ⛔ A MARGINAL OF ZERO HAS NO KAPPA. The formula still returns a
        # number there, and it would print 0.000 — "independent" — beside a
        # name one engine never fired for at all. Those are different facts.
        kappa = None if (bn == 0 or en == 0 or pe >= 1) \
            else (po - pe) / (1 - pe)
        c = (100.0 * t["both"] / min(bn, en)) if min(bn, en) else None
        print("%-22s %6d %8.2f %6s %7s %7.2f%% %7.2f%% %9s"
              % (bk, t["both"], expected,
                 "--" if lift is None else "%.2f" % lift,
                 "--" if kappa is None else "%.3f" % kappa,
                 100 * pb, 100 * pe_,
                 "--" if c is None else "%.1f%%" % c))
    print("kappa: 1.0 = identical verdicts, 0.0 = independent, <0 = worse than "
          "chance. `contained` = share of the RARER engine's hits the other "
          "also named.")

    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(
            {"n": len(rows), "sample": args.sample, "seed": 7,
             "window": args.window, "shipped_window": args.shipped_window,
             "pairs": pairs, "same_bars": same, "shipped_depth": deep,
             "catalog_self_agreement": self_agree, "rows": rows},
            indent=1), encoding="utf-8")
        print("\nwrote %s" % args.out)

    refused = len(conftest.SHARED_ROOT_VIOLATIONS)
    print("\n[tripwire] writes refused into the shared root: %d  "
          "(read-only opens recorded: %d)"
          % (refused, len(conftest.SHARED_ROOT_READS)))
    if refused:
        for v in conftest.SHARED_ROOT_VIOLATIONS[:5]:
            print("   %r" % (v,))
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
