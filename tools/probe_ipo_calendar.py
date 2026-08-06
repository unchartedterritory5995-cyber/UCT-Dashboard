"""Manual probe: IPO calendar coverage before/after the FMP breadth merge
(data-dependability migration plan, Phase 2 Task 11).

Finnhub `/calendar/ipo` is NOT one of the permanently-forbidden endpoints
(unlike T1/T2/T6's targets) -- it works, but it is narrower than FMP's
`stable/ipos-calendar`. This probe measures row COUNT (breadth) and
populated-numeric-field rate for a live 30-day window, Finnhub-only vs the
merged result, to confirm FMP adds rows without regressing the detail
Finnhub already supplied.

Usage:
  python tools/probe_ipo_calendar.py                # AFTER (merged)
  python tools/probe_ipo_calendar.py --legacy        # BEFORE (Finnhub-only)
"""
import argparse
import sys
from datetime import date, timedelta

sys.path.insert(0, ".")

from api.services import ipo_calendar as ic  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy", action="store_true",
                     help="BEFORE state: Finnhub-only (no FMP breadth merge).")
    args = ap.parse_args()
    label = "BEFORE (Finnhub-only)" if args.legacy else "AFTER (FMP-merged)"

    today = date.today()
    from_date = today.isoformat()
    to_date = (today + timedelta(days=30)).isoformat()

    if args.legacy:
        raw = ic._fh_ipo_get(from_date, to_date)
        rows = []
        if raw:
            for row in raw:
                if not isinstance(row, dict):
                    continue
                entry = ic._normalize_row(row)
                if not entry.get("sym") and not entry.get("name"):
                    continue
                if not entry.get("date"):
                    continue
                rows.append(entry)
    else:
        # Direct call to get_ipos would use the cache -- bypass it for a
        # true live measurement matching the --legacy path above.
        fh_raw = ic._fh_ipo_get(from_date, to_date)
        fmp_raw = ic._fmp_ipo_get(from_date, to_date)

        def _norm(raw, fn):
            out = []
            if not raw:
                return out
            for row in raw:
                if not isinstance(row, dict):
                    continue
                entry = fn(row)
                if not entry.get("sym") and not entry.get("name"):
                    continue
                if not entry.get("date"):
                    continue
                out.append(entry)
            return out

        fh_entries = _norm(fh_raw, ic._normalize_row)
        fmp_entries = _norm(fmp_raw, ic._normalize_fmp_row)
        rows = ic._merge_ipo_rows(fh_entries, fmp_entries)

    n = len(rows)
    with_price = sum(1 for r in rows if r.get("price_range") is not None)
    with_shares = sum(1 for r in rows if r.get("shares") is not None)
    with_value = sum(1 for r in rows if r.get("value") is not None)

    print(f"{label}: {from_date} .. {to_date}")
    for r in rows:
        print(f"  {r['sym']:<8} {r['date']}  price={r['price_range']!r:<20} "
              f"shares={r['shares']}  status={r['status']}")
    print(f"\n{label}: rows={n}  price_range non-null={with_price}/{n}  "
          f"shares non-null={with_shares}/{n}  value non-null={with_value}/{n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
