"""Manual probe: coverage of `finnhub_recent_action` (per-candidate analyst
enrichment used by the catalyst engine, api/services/catalyst/engine.py:829)
before/after the 2026-08-05 FMP migration.

Finnhub `/stock/upgrade-downgrade` returns 403 on every call on this plan
(plan-forbidden, not throttled) -- `finnhub_recent_action` therefore returned
None 100% of the time. FMP `stable/grades` is now the primary leg.

Selects tickers with genuinely RECENT rating activity by scanning a liquid
large/mid-cap universe's OWN `stable/grades` (the exact endpoint
`_fmp_recent_action` calls) and taking the freshest N by date -- NOT FMP's
separate `stable/grades-latest-news` market-wide feed (that one covers a much
broader long-tail of tickers than `stable/grades` per-symbol actually has
history for -- live-verified 2026-08-05: several `grades-latest-news` names
resolved ZERO rows on `stable/grades?symbol=`, which would make the sample
measure a coverage GAP BETWEEN two different FMP endpoints, not this
migration). A fixed random large-cap list would mostly show "no action in
the 36h window" and measure sparsity, not coverage -- ranking a broader pool
by actual freshness is what "10 large caps with recent activity" means.

Runs BOTH the BEFORE (Finnhub-only) and AFTER (FMP-primary) legs against the
SAME selected ticker list and the SAME frozen `now`, in one process -- two
separate invocations minutes apart can straddle a UTC calendar-day boundary
and silently shift which borderline tickers fall inside the day-granularity
window (observed live 2026-08-05/06 while building this probe: a ticker
dated 2 days back read as in-window at one moment and out-of-window three
minutes later, purely from the day rolling over -- nothing to do with the
migration).

Usage:
  python tools/probe_analyst_actions.py [--limit 10]
"""
import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, ".")

from api.services.catalyst import analyst_actions as aa  # noqa: E402

# A liquid large/mid-cap universe to rank by freshest `stable/grades` date --
# NOT a claim that all of these will be "recent"; only the top N (by date)
# are used. Broad enough (159 names, live-verified 2026-08-05) that at least
# ~10 are almost always freshly graded even on a quiet day.
_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AMD", "JPM", "XOM",
    "V", "MA", "UNH", "HD", "PG", "KO", "PEP", "MRK", "ABBV", "CVX",
    "WMT", "BAC", "DIS", "CSCO", "NFLX", "CRM", "ADBE", "INTC", "QCOM", "TXN",
    "ORCL", "IBM", "GE", "CAT", "BA", "MMM", "NKE", "SBUX", "MCD", "LOW",
    "COST", "TMO", "ABT", "PFE", "LLY", "AVGO", "NOW", "PYPL", "UBER", "SHOP",
    "GS", "MS", "WFC", "C", "AXP", "BLK", "SPGI", "ICE", "CME", "SCHW",
    "PANW", "SNOW", "CRWD", "DDOG", "NET", "ZS", "MDB", "TEAM", "WDAY", "OKTA",
    "GILD", "AMGN", "BMY", "CVS", "CI", "ELV", "HUM", "ISRG", "SYK", "BSX",
    "F", "GM", "DAL", "UAL", "AAL", "LUV", "FDX", "UPS", "UNP", "NSC",
    "DE", "HON", "LMT", "RTX", "NOC", "GD", "EMR", "ETN", "ITW", "PH",
    "DOW", "DD", "LIN", "APD", "FCX", "NEM", "NUE", "X", "CLF", "AA",
    "T", "VZ", "TMUS", "CMCSA", "CHTR", "PARA", "WBD", "FOXA", "NWSA", "SIRI",
    "JNJ", "CL", "KMB", "CHD", "CLX", "EL", "KHC", "MDLZ", "MNST",
    "MU", "ON", "SWKS", "MCHP", "ADI", "NXPI", "KLAC", "LRCX", "AMAT",
    "MRVL", "ARM", "SMCI", "DELL", "HPQ", "HPE", "ZM", "DOCU", "TWLO", "PLTR",
    "COIN", "SQ", "AFRM", "SOFI", "HOOD", "ROKU", "PINS", "SNAP", "SPOT", "ABNB",
]


def _one(t: str):
    rows = aa._fmp_get("/stable/grades", {"symbol": t, "limit": 3})
    if isinstance(rows, list) and rows and rows[0].get("date"):
        return (str(rows[0]["date"])[:10], t)
    return None


def _recent_tickers(limit: int) -> list[str]:
    """Rank `_UNIVERSE` by each ticker's own freshest `stable/grades` date
    (calling the SAME endpoint `_fmp_recent_action` uses) and return the
    freshest `limit`. Bounded thread pool -- this is a manual probe tool run
    off the request path, not a request-path fan-out."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        print("FMP_API_KEY not set -- cannot select a recent-activity sample")
        return []
    dated: list[tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        for fut in as_completed({ex.submit(_one, t): t for t in _UNIVERSE}):
            r = fut.result()
            if r:
                dated.append(r)
    dated.sort(reverse=True)
    return [t for _, t in dated[:limit]]


def _run(label: str, fn, tickers: list[str], now: float) -> tuple[int, int]:
    ok, fail = [], []
    for t in tickers:
        meta = fn(t, within_hours=36, now=now)
        (ok if meta else fail).append(t)
        print(f"{t:<6} {'OK   ' + str(meta.get('action')) if meta else 'FAIL'}")
    total = len(tickers)
    print(f"{label}: coverage {len(ok)}/{total} "
          f"({100 * len(ok) / max(1, total):.0f}%)  failures: {', '.join(fail) or '-'}\n")
    return len(ok), total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    tickers = _recent_tickers(args.limit)
    if not tickers:
        print("no recent-activity tickers found (check FMP_API_KEY)")
        return 1
    now = time.time()  # frozen for BOTH legs below -- see module docstring

    print(f"--- BEFORE (Finnhub-only) --- tickers={tickers}")
    _run("BEFORE (Finnhub-only)", aa._finnhub_recent_action, tickers, now)

    print(f"--- AFTER (FMP-primary) --- tickers={tickers}")
    _run("AFTER (FMP-primary)", aa.finnhub_recent_action, tickers, now)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
