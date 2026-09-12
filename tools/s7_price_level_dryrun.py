#!/usr/bin/env python
"""GATE-S7-PRICE-LEVEL — PIPELINE DRY RUN against real bars, into a SCRATCH store.

    python tools/s7_price_level_dryrun.py --date 2026-09-11

⛔⛔ ITS OUTPUT IS NOT COMPARISON DATA AND MUST NEVER BE READ AS ANY.

This drives the projection, the price resolution, the span machinery and the
outcome recorder over the REAL admin cohort and REAL session bars, to answer one
question: **does the pipeline carry a row all the way through?** It answers
nothing about whether the two rules agree, because it is a REPLAY — it feeds a
past session's bars through the evaluator — and the owner's F-S7-3 ruling is
*no replay, ever* for the comparison itself.

⭐ The two are kept apart by CONSTRUCTION, not by discipline:

  * it writes to a **temp store it creates itself** and refuses any path inside
    the shared data root, so it cannot reach `alert_taxonomy.db`;
  * it never stamps the sweep heartbeat, so it cannot make a dead sweep look
    alive;
  * the store it writes is **deleted on the way out** unless `--keep`.

⛔ The ledger sentence this run may produce is exactly one shape:
*"pipeline verified against real bars: projected=N"*. Not agreed/new-only/
legacy-only counts. Those come only from the forward-only run.

⚠️ It reads `watchlist_alerts` read-only, as the projection does, and prints
**aggregates and tickers only** — no user id, no email, no alert id.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

# Anything under here is the live tree. The dry run refuses to write to it.
_FORBIDDEN_ROOTS = ("/data", "C:\\data", "C:/data")


def _assert_scratch(path: str) -> None:
    """⛔ THE GUARD THAT MAKES THIS TOOL SAFE TO RUN ON THE POD.

    `/data` is a real directory on the dev box too, so a path that *looks*
    sandboxed can resolve into the owner's live files. This compares the
    RESOLVED path, because a relative path or a symlink is exactly how the
    2026-09-08 sandbox incident reached `C:\\data\\auth.db` while reporting a
    clean start.
    """
    real = os.path.realpath(path)
    for root in _FORBIDDEN_ROOTS:
        r = os.path.realpath(root)
        if os.path.exists(r) and (real == r or real.startswith(r + os.sep)):
            raise SystemExit(
                "REFUSING TO WRITE INSIDE THE SHARED DATA ROOT: %s resolves to %s.\n"
                "The dry run writes to a scratch store only." % (path, real))


def _session_prices(symbols, date_key: int, tf: str = "D"):
    """(open, close) for each symbol on `date_key` (YYYYMMDD), from the LOCAL bars
    store, read-only.

    ⭐ Two prices per symbol, not one: a single price can never produce a
    crossing, so a one-price dry run would report "pipeline works, zero spans"
    for a pipeline that is in fact broken at the cross test. Open→close is the
    cheapest pair that can move through a level.
    """
    from api.services import bars_sqlite
    out, missing = {}, []
    for sym in symbols:
        try:
            rows = bars_sqlite.get_bars_before(sym, tf, 1, int(date_key))
        except Exception:
            rows = []
        if not rows:
            missing.append(sym)
            continue
        ts, o, h, l, c, v = rows[-1]
        if int(ts) != int(date_key):
            # ⛔ Do NOT silently substitute the nearest earlier session — a bar
            # from a different day answers a different question, and the caller
            # would never know.
            missing.append("%s(no %s bar; newest<=%s is %s)" % (sym, date_key, date_key, ts))
            continue
        if o is None or c is None:
            missing.append("%s(null o/c)" % sym)
            continue
        out[sym] = (float(o), float(c))
    return out, missing


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--date",
                    help="session to replay, YYYY-MM-DD (e.g. 2026-09-11). "
                         "Required unless --self-check.")
    ap.add_argument("--tf", default="D")
    ap.add_argument("--keep", action="store_true",
                    help="keep the scratch store (prints its path) instead of deleting it")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the scratch guard refuses the live data root")
    args = ap.parse_args()

    if args.self_check:
        return _self_check()
    if not args.date:
        ap.error("--date is required (or pass --self-check)")

    date_key = int(args.date.replace("-", ""))

    from api.services.alert_taxonomy import db as _db
    from api.services.alert_taxonomy import price_level as _pl
    from api.services.alert_taxonomy import price_level_projection as _proj

    projected = _proj.project_admin_alerts()
    symbols = sorted({p["symbol"] for p in projected if p.get("symbol")})

    print("S7 PRICE-LEVEL PIPELINE DRY RUN  (NOT comparison data)")
    print("  session replayed ...... %s (tf=%s)" % (args.date, args.tf))
    print("  projected ............. %d rows, %d distinct symbols"
          % (len(projected), len(symbols)))
    shapes = {}
    for p in projected:
        k = (p.get("level_kind") or "<none>",
             "anchored" if p.get("anchor_t1") is not None else "no-anchors")
        shapes[k] = shapes.get(k, 0) + 1
    for k in sorted(shapes):
        print("      %-28s %d" % ("%s / %s" % k, shapes[k]))

    if not projected:
        print("\n  PROJECTED 0 -- nothing to run. This is a COHORT fact, not a "
              "pipeline result:\n  no ACTIVE watchlist_alerts row belongs to an "
              "admin-role account.")
        return 2

    prices, missing = _session_prices(symbols, date_key, args.tf)
    print("  priced ................ %d" % len(prices))
    print("  no_price .............. %d %s" % (len(missing), missing))

    scratch = tempfile.mkdtemp(prefix="s7dryrun-")
    store = os.path.join(scratch, "scratch_alert_taxonomy.db")
    _assert_scratch(store)
    try:
        _db.init_db(db_path=store)
        _pl.register(db_path=store)

        # Tick 1 seeds the baseline; tick 2 is the only one that can cross.
        t1 = {s: v[0] for s, v in prices.items()}
        t2 = {s: v[1] for s, v in prices.items()}
        r1 = _proj.run_projected_comparison(t1, now=float(date_key), db_path=store)
        r2 = _proj.run_projected_comparison(t2, now=float(date_key) + 1, db_path=store)

        import sqlite3
        conn = sqlite3.connect(store)
        spans = conn.execute(
            "SELECT COUNT(*) FROM price_level_comparison_spans").fetchone()[0]
        beats = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
            "AND name='price_level_sweep_heartbeat'").fetchone()[0]
        conn.close()

        print("\n  spans opened .......... %d" % spans)
        print("  anchor moves observed . %d" % (r1["anchor_moves"] + r2["anchor_moves"]))
        print("  outcomes (tick 1) ..... %s" % (r1["outcomes"] or "{}"))
        print("  outcomes (tick 2) ..... %s" % (r2["outcomes"] or "{}"))
        print("  heartbeat stamped ..... %s  <- must be 0: a dry run must never "
              "make a dead sweep look alive" % beats)

        ok = spans > 0
        print("\n  PIPELINE: %s" % ("VERIFIED -- a real row reached a real span"
                                    if ok else
                                    "NOT VERIFIED -- rows projected and priced but NO span "
                                    "opened; the projection or the span machinery is broken"))
        if args.keep:
            print("  scratch store kept at: %s" % store)
        return 0 if ok else 1
    finally:
        if not args.keep:
            shutil.rmtree(scratch, ignore_errors=True)


def _self_check() -> int:
    """⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD."""
    ok = True
    probe = "/data/alert_taxonomy.db"
    if not os.path.exists(os.path.realpath("/data")):
        probe = None
        print("self-check: no /data on this box to test the refusal against; "
              "testing the generic path check instead")
    try:
        _assert_scratch(probe or os.path.join(tempfile.mkdtemp(), "x.db"))
        if probe:
            print("SELF-CHECK FAIL: the guard ALLOWED a path inside the live data root")
            ok = False
    except SystemExit:
        if not probe:
            print("SELF-CHECK FAIL: the guard refused a legitimate scratch path")
            ok = False

    # A scratch path must always be allowed, or the tool can never run.
    try:
        _assert_scratch(os.path.join(tempfile.mkdtemp(prefix="s7ok-"), "s.db"))
    except SystemExit:
        print("SELF-CHECK FAIL: the guard refused a temp path")
        ok = False

    print("self-check: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
