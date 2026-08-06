"""Manual probe: coverage of the analyst-recommendation-consensus fields
across get_earnings_intel's `consensus` leg (Task 5, site 1: FMP
`stable/grades-consensus`) and the shared `_fmp_grades_historical` helper
that also backs call_recap.get_rating_changes / earnings_enrichment.
get_estimate_revisions (Task 5, sites 2+3: FMP `stable/grades-historical`) --
before/after the 2026-08-05 FMP migration (data-dependability migration
plan, Phase 2 Task 5).

Finnhub `/stock/recommendation` WORKS on this plan (unlike the permanently-
forbidden endpoints in T1/T2/T6) but shares the process-wide 60/min budget
across every Finnhub caller in the app and throttles under load (429,
live-observed). FMP is paid Premium and carries its own separate, bounded
budget -- moving these three call sites off the shared Finnhub budget is the
point, not working around a 403.

Usage:
  python tools/probe_recommendation_consensus.py             # AFTER (FMP-primary)
  python tools/probe_recommendation_consensus.py --legacy     # BEFORE (Finnhub-only)
"""
import argparse
import sys

sys.path.insert(0, ".")

from api.services import earnings_estimates as ee  # noqa: E402

_TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "JNJ"]


def _legacy_consensus(t: str):
    """BEFORE: the Finnhub-only leg get_earnings_intel used to run."""
    rec_raw = ee._fh_get("/stock/recommendation", {"symbol": t})
    if isinstance(rec_raw, list) and rec_raw:
        latest = rec_raw[0]
        return {
            "buy": latest.get("buy", 0), "hold": latest.get("hold", 0),
            "sell": latest.get("sell", 0), "strongBuy": latest.get("strongBuy", 0),
            "strongSell": latest.get("strongSell", 0), "period": latest.get("period", ""),
        }
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy", action="store_true",
                     help="BEFORE state: Finnhub-only leg (reproduces pre-migration throttle risk).")
    args = ap.parse_args()
    label = "BEFORE (Finnhub-only)" if args.legacy else "AFTER (FMP-primary)"

    print(f"=== {label}: consensus snapshot (site 1: get_earnings_intel) ===")
    ok, fail = [], []
    for t in _TICKERS:
        result = _legacy_consensus(t) if args.legacy else ee._fmp_consensus_snapshot(t)
        (ok if result else fail).append(t)
        if result:
            print(f"{t:<6} OK    buy={result['buy']} hold={result['hold']} sell={result['sell']}")
        else:
            print(f"{t:<6} FAIL")
    total = len(_TICKERS)
    print(f"\n{label} consensus: coverage {len(ok)}/{total} "
          f"({100 * len(ok) / max(1, total):.0f}%)  failures: {', '.join(fail) or '-'}")

    print(f"\n=== {label}: rating history (sites 2+3: call_recap / earnings_enrichment) ===")
    ok2, fail2 = [], []
    for t in _TICKERS:
        if args.legacy:
            rows = ee._fh_get("/stock/recommendation", {"symbol": t})
            rows = rows if isinstance(rows, list) else []
        else:
            rows = ee._fmp_grades_historical(t, limit=4)
        (ok2 if rows else fail2).append(t)
        print(f"{t:<6} {'OK' if rows else 'FAIL':<5} rows={len(rows)}")
    print(f"\n{label} history: coverage {len(ok2)}/{total} "
          f"({100 * len(ok2) / max(1, total):.0f}%)  failures: {', '.join(fail2) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
