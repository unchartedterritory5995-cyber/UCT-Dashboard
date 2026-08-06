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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import earnings_estimates as ee          # noqa: E402
from api.services import implied_store as store            # noqa: E402
from api.services.implied_backfill import historical_expected_move  # noqa: E402


def past_reports(sym: str, limit: int) -> list[dict]:
    """Past ANNOUNCEMENT dates carrying real fiscal identity, newest first.

    Neither provider has both halves, so this joins them:

      * FMP `stable/earnings` has the ANNOUNCEMENT date — the day the market
        actually repriced, which is the date an implied snapshot is keyed on —
        but carries no fiscal year/quarter at all (verified 2026-08-06: the
        row is {symbol, date, epsActual, epsEstimated, revenue*, lastUpdated}).
      * Finnhub `/stock/earnings` has the real fiscal `quarter`/`year`, but
        its `period` is the period END, not the announcement.

    The join rule: the fiscal row whose `period` is NEAREST the announcement.

    "Most recent period ending before the announcement" is the intuitive rule
    and it is WRONG. Finnhub's `period` is the calendar quarter-end CONTAINING
    the fiscal period end, which can land on either side of the announcement:

        AAPL  fiscal Q4 FY2025 ended Sep 27 -> period 2025-09-30, announced
              Oct 30. The period precedes the announcement.
        NVDA  fiscal Q3 FY2026 ended Oct 26 -> period 2025-12-31, announced
              Nov 19. The period FOLLOWS the announcement.

    So "before" silently mislabels every NVDA quarter and "on or after"
    silently mislabels every AAPL quarter — each off by exactly one, in
    opposite directions, which is the worst kind of wrong: it pairs a snapshot
    against a real but incorrect quarter's realized move rather than failing.
    Nearest handles both. Verified 2026-08-06 against 9 known announcements
    across three fiscal shapes (NVDA Jan-end, AAPL Sep-end, MSFT Jun-end):
    9/9 correct, where each single-sided rule scored 3/9 or 6/9.

    Deliberately NOT derived from the announcement month either. A
    calendar-fiscal guess (Jan-Mar -> Q4, Apr-Jun -> Q1, ...) is wrong for
    every off-calendar filer. Unmatched announcements are dropped.
    """
    today = _dt.date.today().isoformat()
    # Newest-first, and includes not-yet-reported rows (filtered below).
    fmp = ee._fmp_get("/stable/earnings", {"symbol": sym.upper(), "limit": max(limit * 3, 24)})
    announcements = []
    for r in fmp or []:
        if not isinstance(r, dict):
            continue
        date = str(r.get("date") or "")[:10]
        if date and date < today:          # exclude future / today's unreported
            announcements.append(date)

    fh = ee._fh_get("/stock/earnings", {"symbol": sym.upper(),
                                        "limit": max(limit * 2, 16)})
    periods = []
    for q in fh or []:
        if not isinstance(q, dict):
            continue
        end = str(q.get("period") or "")[:10]
        fy, fq = ee._int_or_none(q.get("year")), ee._int_or_none(q.get("quarter"))
        if end and fy is not None and fq is not None and 1 <= fq <= 4:
            periods.append((end, fy, fq))
    out, used = [], set()
    for date in sorted(announcements, reverse=True):
        try:
            ad = _dt.date.fromisoformat(date)
        except ValueError:
            continue
        scored = []
        for (end, fy, fq) in periods:
            try:
                scored.append((abs((_dt.date.fromisoformat(end) - ad).days), fy, fq))
            except ValueError:
                continue
        if not scored:
            continue
        gap, fy, fq = min(scored)
        # A real announcement sits within one calendar quarter of its period
        # bucket; beyond that the "nearest" row is just the least-far wrong
        # one, which is exactly the silent mispairing this rule exists to
        # avoid. Refuse rather than guess.
        if gap > 100:
            continue
        if (fy, fq) in used:               # two announcements, one quarter
            continue
        used.add((fy, fq))
        out.append({"report_date": date, "fiscal_year": fy, "fiscal_quarter": fq})
        if len(out) >= limit:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--syms", help="comma-separated tickers")
    src.add_argument("--from-store", action="store_true",
                     help="every ticker that already has a snapshot")
    ap.add_argument("--quarters", type=int, default=8,
                    help="past quarters per ticker (default 8)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print what would be written; touch no database")
    args = ap.parse_args()

    if args.from_store:
        syms = sorted({r["sym"] for r in store.all_symbols()}) if hasattr(store, "all_symbols") else []
        if not syms:
            print("--from-store: no symbols found in the store", file=sys.stderr)
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
