"""Manual probe: coverage of the EarningsModal transcript section
(api/services/transcripts.py::_fetch_latest_transcript, served via
GET /api/transcripts/{sym}) before/after the 2026-08-05 FMP migration.

Finnhub `/stock/transcripts/list` returns 403 on every call on this plan
(plan-forbidden, not throttled) -- the transcript section has therefore been
permanently hidden for every user. FMP `stable/earning-call-transcript(-dates)`
is now the primary leg.

10 large, reliably-reporting names stand in for "recent reporters" -- FMP's
transcript-dates index goes back many quarters (84 for AAPL, live-probed
2026-08-05), so any of these having ZERO transcript would itself be a
regression worth flagging, not just a sparsity artifact.

Usage:
  python tools/probe_transcripts.py                # AFTER (FMP-primary)
  python tools/probe_transcripts.py --legacy        # BEFORE (Finnhub-only)
"""
import argparse
import sys

sys.path.insert(0, ".")

from api.services import transcripts as tr  # noqa: E402

_TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "JNJ"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy", action="store_true",
                     help="BEFORE state: Finnhub-only leg (reproduces the pre-migration 403).")
    args = ap.parse_args()

    fn = tr._fetch_latest_transcript_finnhub if args.legacy else tr._fetch_latest_transcript
    label = "BEFORE (Finnhub-only)" if args.legacy else "AFTER (FMP-primary)"

    ok, fail = [], []
    for t in _TICKERS:
        result = fn(t)
        (ok if result else fail).append(t)
        if result:
            print(f"{t:<6} OK    Q{result.get('quarter')} {result.get('year')}  "
                  f"chars={len(result.get('text') or '')}")
        else:
            print(f"{t:<6} FAIL")

    total = len(_TICKERS)
    print(f"\n{label}: coverage {len(ok)}/{total} "
          f"({100 * len(ok) / max(1, total):.0f}%)  failures: {', '.join(fail) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
