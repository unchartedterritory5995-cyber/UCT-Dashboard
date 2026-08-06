"""Manual probe: news headline coverage before (AV-primary) vs after
(FMP-primary), data-dependability migration plan Phase 3 Task 14.

Measures, for 10 large-cap tickers:
  BEFORE -- AV `NEWS_SENTIMENT` (`sort=LATEST`, 24h window), counting
            headlines whose `ticker_sentiment` names the ticker at
            relevance >= 0.5 (the SAME floor `engine._compute_news` applies).
  AFTER  -- FMP `stable/news/stock?symbols=<all 10 in one call>` over the
            same 24h-ish recency window (`limit=100`), counting headlines
            tagged to each ticker.

Also probes `stable/news/general-latest` separately (breadth leg -- no
per-ticker tag, reported as a standalone row count) since it is a genuinely
NEW content class AV's ticker-gated feed never contributed.

Usage:
  python tools/probe_news_fmp.py
"""
import os
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta

sys.path.insert(0, ".")

import requests  # noqa: E402

TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "AMD", "NFLX", "JPM"]


def _load_env(path: str) -> dict:
    env = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def main() -> int:
    env = _load_env(os.path.join("C:\\", "Users", "Patrick", "morning-wire", ".env"))
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY") or env.get("ALPHAVANTAGE_API_KEY", "")
    fmp_key = os.environ.get("FMP_API_KEY") or env.get("FMP_API_KEY", "")
    print(f"AV key present: {bool(av_key)}   FMP key present: {bool(fmp_key)}")

    time_from = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y%m%dT%H%M")

    # ── BEFORE: AlphaVantage ────────────────────────────────────────────
    av_counts: Counter = Counter()
    av_total_headlines = 0
    if av_key:
        try:
            r = requests.get(
                "https://www.alphavantage.co/query",
                params={"function": "NEWS_SENTIMENT", "sort": "LATEST",
                        "limit": "200", "time_from": time_from, "apikey": av_key},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=15,
            )
            data = r.json()
            feed = data.get("feed", []) if isinstance(data, dict) else []
            av_total_headlines = len(feed)
            for item in feed:
                for t in item.get("ticker_sentiment", []):
                    try:
                        rel = float(t.get("relevance_score", 0))
                    except (TypeError, ValueError):
                        rel = 0
                    sym = (t.get("ticker") or "").strip().upper()
                    if rel >= 0.5 and sym in TICKERS:
                        av_counts[sym] += 1
        except Exception as e:
            print("AV fetch failed:", e)
    else:
        print("AV key missing -- skipping BEFORE measurement (report N/A, not 0)")

    # ── AFTER: FMP stable/news/stock, ALL 10 tickers in ONE call ────────
    fmp_counts: Counter = Counter()
    fmp_total_headlines = 0
    if fmp_key:
        try:
            r = requests.get(
                "https://financialmodelingprep.com/stable/news/stock",
                params={"symbols": ",".join(TICKERS), "apikey": fmp_key, "limit": 100},
                timeout=15,
            )
            data = r.json()
            rows = data if isinstance(data, list) else []
            fmp_total_headlines = len(rows)
            for row in rows:
                sym = (row.get("symbol") or "").strip().upper()
                if sym in TICKERS:
                    fmp_counts[sym] += 1
        except Exception as e:
            print("FMP news/stock fetch failed:", e)

        # Breadth leg -- general-latest, no per-ticker tag.
        try:
            r2 = requests.get(
                "https://financialmodelingprep.com/stable/news/general-latest",
                params={"apikey": fmp_key, "limit": 100},
                timeout=15,
            )
            data2 = r2.json()
            general_rows = data2 if isinstance(data2, list) else []
        except Exception as e:
            print("FMP general-latest fetch failed:", e)
            general_rows = []
    else:
        general_rows = []
        print("FMP key missing -- skipping AFTER measurement")

    print(f"\n{'TICKER':<8} {'AV (before)':>12} {'FMP (after)':>12}")
    av_matched = 0
    fmp_matched = 0
    for t in TICKERS:
        a, f = av_counts.get(t, 0), fmp_counts.get(t, 0)
        if a > 0:
            av_matched += 1
        if f > 0:
            fmp_matched += 1
        print(f"{t:<8} {a:>12} {f:>12}")

    print(f"\nAV total headlines pulled (24h window):  {av_total_headlines}")
    print(f"FMP news/stock rows pulled (10-symbol batch, one call): {fmp_total_headlines}")
    print(f"FMP general-latest rows (breadth leg, no ticker tag):   {len(general_rows)}")
    print(f"\nPer-ticker match rate -- AV (before): {av_matched}/{len(TICKERS)}")
    print(f"Per-ticker match rate -- FMP (after):  {fmp_matched}/{len(TICKERS)}")
    print(f"\nRequirement -- FMP per-ticker match rate >= AV baseline: "
          f"{fmp_matched} >= {av_matched} -> {fmp_matched >= av_matched}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
