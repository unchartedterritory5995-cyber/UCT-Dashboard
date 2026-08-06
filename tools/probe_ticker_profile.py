"""Manual probe: name/industry resolution coverage before/after the
/stock/profile2 -> FMP stable/profile migration (data-dependability
migration plan, Task 8).

Isolates just the FALLBACK LEG that Task 8 changed (bypasses yfinance,
which already resolves the large majority of tickers and would mask the
migration's own effect). Measures, over a fixed deterministic sample of 200
cap_universe symbols (first 200 alphabetically from api/data/cap_universe.json):

  BEFORE  -- Finnhub /stock/profile2 ALONE (the pre-migration fallback leg)
  AFTER   -- FMP stable/profile FIRST, Finnhub profile2 as fallback
             (ticker_meta._from_fmp -> ticker_meta._from_finnhub, same merge
             order _base_meta uses)

Requires FMP_API_KEY (and ideally FINNHUB_API_KEY) in the environment --
load from C:\\Users\\Patrick\\morning-wire\\.env manually before running, e.g.
(PowerShell):
    Get-Content C:\\Users\\Patrick\\morning-wire\\.env | ForEach-Object {
      if ($_ -match '^(FMP_API_KEY|FINNHUB_API_KEY)=(.*)$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
      }
    }

Never prints key values -- only status/coverage numbers, per the plan's
Global Constraints.

Usage:
  python tools/probe_ticker_profile.py                 # both BEFORE and AFTER
  python tools/probe_ticker_profile.py --only-before
  python tools/probe_ticker_profile.py --only-after
  python tools/probe_ticker_profile.py -n 50            # smaller sample for a quick check
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, ".")

from api.services import ticker_meta as tm  # noqa: E402


def _cap_universe_sample(n: int) -> list[str]:
    here = os.path.join(os.path.dirname(__file__), "..", "api", "data", "cap_universe.json")
    with open(here, encoding="utf-8") as fh:
        uni = [str(t).upper() for t in json.load(fh) if t]
    return sorted(set(uni))[:n]


def _measure(symbols: list[str], label: str, use_fmp: bool,
             finnhub_sleep_s: float, fmp_sleep_s: float) -> dict:
    n = len(symbols)
    name_hits = 0
    industry_hits = 0
    finnhub_calls = 0
    fmp_calls = 0
    t0 = time.time()
    for i, sym in enumerate(symbols):
        data = {"name": None, "sector": None, "industry": None}
        if use_fmp:
            fmp_calls += 1
            fmp = tm._from_fmp(sym)
            data = {"name": fmp.get("name"), "sector": fmp.get("sector"), "industry": fmp.get("industry")}
            if fmp_sleep_s:
                time.sleep(fmp_sleep_s)
        if not data.get("name"):
            finnhub_calls += 1
            fh = tm._from_finnhub(sym)
            data = {
                "name": data.get("name") or fh.get("name"),
                "sector": data.get("sector") or fh.get("sector"),
                "industry": data.get("industry") or fh.get("industry"),
            }
            if finnhub_sleep_s:
                time.sleep(finnhub_sleep_s)
        if data.get("name"):
            name_hits += 1
        if data.get("industry"):
            industry_hits += 1
        if (i + 1) % 25 == 0:
            print(f"  [{label}] {i + 1}/{n} symbols processed "
                  f"({time.time() - t0:.0f}s elapsed)", file=sys.stderr)

    elapsed = time.time() - t0
    name_pct = 100.0 * name_hits / n if n else 0.0
    industry_pct = 100.0 * industry_hits / n if n else 0.0
    return {
        "label": label,
        "n": n,
        "name_hits": name_hits,
        "name_pct": name_pct,
        "industry_hits": industry_hits,
        "industry_pct": industry_pct,
        "finnhub_calls": finnhub_calls,
        "fmp_calls": fmp_calls,
        "elapsed_s": elapsed,
    }


def _print_result(r: dict) -> None:
    print(f"\n{r['label']}: n={r['n']}  "
          f"name={r['name_hits']}/{r['n']} ({r['name_pct']:.1f}%)  "
          f"industry={r['industry_hits']}/{r['n']} ({r['industry_pct']:.1f}%)  "
          f"finnhub_calls={r['finnhub_calls']}  fmp_calls={r['fmp_calls']}  "
          f"elapsed={r['elapsed_s']:.0f}s")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", "--num", type=int, default=200,
                     help="sample size (default 200, first N alphabetically from cap_universe.json)")
    ap.add_argument("--only-before", action="store_true")
    ap.add_argument("--only-after", action="store_true")
    ap.add_argument("--finnhub-sleep", type=float, default=1.05,
                     help="seconds between Finnhub calls -- respects the shared "
                          "process-wide 60/min account budget (default 1.05s)")
    ap.add_argument("--fmp-sleep", type=float, default=0.15,
                     help="seconds between FMP calls -- FMP Premium has no comparable "
                          "shared 60/min constraint (default 0.15s)")
    args = ap.parse_args()

    if not os.environ.get("FMP_API_KEY"):
        print("WARNING: FMP_API_KEY not set in this shell -- the AFTER pass will "
              "measure Finnhub-only behavior (FMP leg no-ops), NOT a true after-state.",
              file=sys.stderr)
    if not os.environ.get("FINNHUB_API_KEY"):
        print("WARNING: FINNHUB_API_KEY not set in this shell -- Finnhub calls will "
              "no-op (fh_get short-circuits), understating BOTH passes.",
              file=sys.stderr)

    symbols = _cap_universe_sample(args.num)
    print(f"Sample: {len(symbols)} symbols, first={symbols[0]!r} last={symbols[-1]!r}")

    results = []
    if not args.only_after:
        results.append(_measure(symbols, "BEFORE (Finnhub-only)", use_fmp=False,
                                 finnhub_sleep_s=args.finnhub_sleep, fmp_sleep_s=args.fmp_sleep))
    if not args.only_before:
        results.append(_measure(symbols, "AFTER (FMP-primary + Finnhub-fallback)", use_fmp=True,
                                 finnhub_sleep_s=args.finnhub_sleep, fmp_sleep_s=args.fmp_sleep))

    for r in results:
        _print_result(r)

    if len(results) == 2:
        before, after = results
        print(f"\nDelta: name {before['name_pct']:.1f}% -> {after['name_pct']:.1f}% "
              f"({after['name_pct'] - before['name_pct']:+.1f}pp)  "
              f"industry {before['industry_pct']:.1f}% -> {after['industry_pct']:.1f}% "
              f"({after['industry_pct'] - before['industry_pct']:+.1f}pp)")
        gate_name = after["name_pct"] >= 95.0
        gate_industry = after["industry_pct"] >= 90.0
        print(f"Gate: name>=95% {'PASS' if gate_name else 'FAIL'} "
              f"({after['name_pct']:.1f}%)  "
              f"industry>=90% {'PASS' if gate_industry else 'FAIL'} "
              f"({after['industry_pct']:.1f}%)")
        return 0 if (gate_name and gate_industry) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
