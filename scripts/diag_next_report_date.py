"""Why does the Earnings tab say 'Date TBD'?

Walks the exact chain the panel uses and prints where the next-report date is
lost. Read-only; needs FMP_API_KEY / FINNHUB_API_KEY in the environment.

    python scripts/diag_next_report_date.py MU NVDA AAPL
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SYMS = sys.argv[1:] or ["MU", "NVDA", "AAPL", "TSLA", "KO"]


def main() -> int:
    from api.services import earnings_estimates as ee
    from api.services import earnings_table as et
    from api.services import earnings_intel as ei

    print(f"keys: FMP={'set' if os.environ.get('FMP_API_KEY') else 'MISSING'} "
          f"FINNHUB={'set' if os.environ.get('FINNHUB_API_KEY') else 'MISSING'}\n")

    for sym in SYMS:
        print("=" * 66)
        print(sym)
        print("=" * 66)

        # 1. the raw provider answer
        try:
            raw = ee._fmp_get("/stable/earnings", {"symbol": sym, "limit": 8})
            if isinstance(raw, list):
                print(f"  1. FMP /stable/earnings limit=8 -> {len(raw)} rows")
                for r in raw[:8]:
                    d = str(r.get("date") or "")[:10]
                    fut = r.get("epsActual") is None and r.get("revenueActual") is None
                    print(f"       {d}  epsActual={r.get('epsActual')!r:>8}  "
                          f"{'FUTURE' if fut else 'reported'}")
            else:
                print(f"  1. FMP /stable/earnings -> {type(raw).__name__}: {str(raw)[:90]}")
        except Exception as e:
            print(f"  1. FMP /stable/earnings RAISED: {type(e).__name__}: {e}")

        # 2. the resolved scheduled date
        try:
            print(f"  2. _next_report_date() -> {et._next_report_date(sym)!r}")
        except Exception as e:
            print(f"  2. _next_report_date RAISED: {type(e).__name__}: {e}")

        # 3. forward quarters, and whether any carries a report_date
        try:
            fwd = et._forward_quarters(sym, 4) or []
            print(f"  3. _forward_quarters -> {len(fwd)} rows")
            for r in fwd:
                print(f"       label={r.get('label')!r} period_end={r.get('period_end')!r} "
                      f"report_date={r.get('report_date')!r} "
                      f"eps={r.get('eps_estimate')!r} rev={r.get('rev_estimate')!r}")
        except Exception as e:
            print(f"  3. _forward_quarters RAISED: {type(e).__name__}: {e}")

        # 4. what the panel actually receives
        try:
            payload = ei.get_earnings(sym) or {}
            est = payload.get("estimates") or []
            summ = payload.get("summary") or {}
            print(f"  4. get_earnings -> estimates={len(est)} "
                  f"summary.next_report_date={summ.get('next_report_date')!r}")
            for e_ in est:
                print(f"       {e_.get('label')!r} report_date={e_.get('report_date')!r}")
            verdict = ("OK — a date will render"
                       if summ.get("next_report_date")
                       else ("'Date TBD' — estimates exist but none carries a report_date"
                             if est else "no note at all — no estimates"))
            print(f"  => {verdict}")
        except Exception as e:
            print(f"  4. get_earnings RAISED: {type(e).__name__}: {e}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
