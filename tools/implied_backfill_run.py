"""Backfill historical implied moves into /data/implied_moves.db.

The RICH/CHEAP verdict needs several PAIRED quarters (an implied move captured
before a report, next to what the stock actually did). Nightly capture alone
means waiting the better part of a year. This reconstructs those quarters from
Massive's historical option data — see api/services/implied_backfill.py for why
that reconstruction is faithful rather than approximate.

USAGE
    # dry run first — prints what it WOULD write, touches no database
    python tools/implied_backfill_run.py --syms NVDA,AAPL,TSLA --quarters 8 --dry-run

    # then commit it
    python tools/implied_backfill_run.py --syms NVDA,AAPL,TSLA --quarters 8

    # or drive it from the tickers that already have snapshots
    python tools/implied_backfill_run.py --from-store --quarters 8

SAFETY
    `record_implied` is INSERT OR IGNORE on (sym, report_date), so this can
    never overwrite a live nightly capture and is safe to re-run. Rows carry
    source="massive-backfill" so a live row and a reconstructed one are always
    distinguishable after the fact.

    Every reconstructed row is REFUSED unless it has a fiscal year+quarter:
    that pair is how a client joins a snapshot to its history row, and a row
    without it is unpairable — which is the only thing this whole exercise is
    for. (Same rule the nightly capture enforces.)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import earnings_estimates as ee          # noqa: E402
from api.services import implied_store as store            # noqa: E402
from api.services.implied_backfill import historical_expected_move  # noqa: E402

# past_reports + the Finnhub pacing knobs live in the SERVICE so the nightly
# scheduled sweep and this CLI run literally the same code. Re-exported here
# because the tool's tests and --fh-pace still address them by name.
from api.services.implied_backfill import (        # noqa: E402
    past_reports, _FH_PACE_SECONDS, _FH_COOLDOWN_WAIT, _FH_ATTEMPTS,
    _MAX_BACKFILLABLE_QUARTERS,
)

def main() -> int:
    # Declared here, before argparse reads it as a flag default — Python
    # requires `global` to precede every use of the name in this scope.
    global _FH_PACE_SECONDS

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--syms", help="comma-separated tickers")
    src.add_argument("--from-store", action="store_true",
                     help="every ticker that already has a snapshot")
    ap.add_argument("--quarters", type=int, default=_MAX_BACKFILLABLE_QUARTERS,
                    help=f"past quarters per ticker (default/max {_MAX_BACKFILLABLE_QUARTERS} "
                         "— Finnhub caps fiscal history at 4 on this plan)")
    ap.add_argument("--fh-pace", type=float, default=_FH_PACE_SECONDS,
                    help=f"seconds between Finnhub calls (default {_FH_PACE_SECONDS}); "
                         "the budget is SHARED with live member traffic")
    ap.add_argument("--dry-run", action="store_true",
                    help="print what would be written; touch no database")
    args = ap.parse_args()

    _FH_PACE_SECONDS = max(0.0, args.fh_pace)
    if args.quarters > _MAX_BACKFILLABLE_QUARTERS:
        print(f"note: --quarters {args.quarters} exceeds what Finnhub can label "
              f"({_MAX_BACKFILLABLE_QUARTERS}); the extra quarters cannot be paired "
              "and will be skipped, not guessed.", file=sys.stderr)

    if args.from_store:
        syms = store.all_symbols()
        if not syms:
            print("--from-store: the store has no snapshots yet — pass --syms",
                  file=sys.stderr)
            return 2
    else:
        syms = [s.strip().upper() for s in args.syms.split(",") if s.strip()]

    wrote = skipped_existing = skipped_no_move = skipped_no_fiscal = 0
    for sym in syms:
        try:
            reports = past_reports(sym, args.quarters)
        except Exception as exc:
            print(f"{sym}: report lookup failed: {exc}", file=sys.stderr)
            continue
        if not reports:
            print(f"{sym}: no past reports with a fiscal key")
            continue
        for rep in reports:
            rd = rep["report_date"]
            # Cheap pre-check so a re-run does not re-fetch option chains for
            # quarters already captured. record_implied would ignore the write
            # anyway; this just avoids the API cost.
            if not args.dry_run and store._has_snapshot(sym, rd):
                skipped_existing += 1
                continue
            move = historical_expected_move(sym, rd)
            if not move:
                skipped_no_move += 1
                print(f"  {sym} {rd}: no reconstructable straddle")
                continue
            if rep["fiscal_year"] is None or rep["fiscal_quarter"] is None:
                skipped_no_fiscal += 1
                continue
            line = (f"  {sym} {rd} FY{rep['fiscal_year']}Q{rep['fiscal_quarter']}: "
                    f"+/-{move['pct']:.2f}% (${move['dollar']:.2f}) "
                    f"strike={move['strike']} spot={move['spot']} exp={move['expiry']}")
            if args.dry_run:
                print(line + "   [dry-run]")
                continue
            store.record_implied(
                sym, rd, move,
                captured_at=f"{move['as_of']}T21:00:00Z",   # the instant priced, not now
                fiscal_year=rep["fiscal_year"], fiscal_quarter=rep["fiscal_quarter"],
            )
            wrote += 1
            print(line)

    print(f"\n{'would write' if args.dry_run else 'wrote'}: {wrote} · "
          f"already captured: {skipped_existing} · "
          f"no straddle: {skipped_no_move} · no fiscal key: {skipped_no_fiscal}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
