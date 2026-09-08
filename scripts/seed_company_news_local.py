"""Seed a LOCAL company-news store from real, free sources.

⚠️ DEVELOPMENT ONLY — for rendering and QA on localhost.

Everything it ingests is REAL: SEC EDGAR filings (public domain, no key) and,
if a local tweets.db exists, the already-stored curated X posts. Nothing is
invented. The FMP lanes need a production key and are simply skipped here,
which is stated in the output rather than papered over.

    COMPANY_NEWS_DB_PATH=... python scripts/seed_company_news_local.py
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The §56 ticker matrix: mega, large, mid, small, biotech, sector, ADR, ETF.
TICKERS = [
    "MU", "NVDA", "AAPL", "TSLA", "JPM", "KO", "XOM", "HON", "ONTO", "RMBS",
    "RKLB", "IONQ", "VKTX", "CRSP", "TSM", "BABA", "SPY", "CAT", "ON", "GEVO",
]


def main() -> int:
    from api.services.news import ingest, store, subject
    from api.services.news.adapters import fmp_news

    print(f"store: {store.db_path()}")
    print(f"tickers: {len(TICKERS)}\n")

    # §4 verification, when a key exists.
    if (os.environ.get("FMP_API_KEY") or "").strip():
        try:
            res = fmp_news.probe_latest(fmp_news.RequestBudget(4, "verify"))
            print(f"FMP -latest support: {res}\n")
        except Exception as e:
            print(f"FMP probe failed: {e}\n")
    else:
        print("FMP_API_KEY not set — FMP press-release and journalism lanes "
              "are SKIPPED. SEC + X only.\n")

    have_key = bool((os.environ.get("FMP_API_KEY") or "").strip())
    # Bounded: ~2 requests per ticker, aborts rather than overspending.
    budget = fmp_news.RequestBudget(len(TICKERS) * 3 + 10, "seed")
    totals = {"sec": 0, "x": 0, "fmp": 0}
    for i, sym in enumerate(TICKERS, 1):
        # Seed the name so subject matching does not need a metadata lookup.
        try:
            from api.services.catalyst import ticker_metadata
            meta = ticker_metadata.get_metadata(sym) or {}
            nm = meta.get("name") or meta.get("company_name") or ""
            if nm:
                subject.set_company_name(sym, nm)
        except Exception:
            pass

        r = ingest.run_sec_cycle([sym], per_symbol=60)
        totals["sec"] += r["items"]
        x = ingest.run_x_cycle([sym], hours=24 * 365)
        totals["x"] += x["items"]

        # Per-symbol FMP. The scheduled poller uses the GLOBAL -latest feed and
        # fans out by symbol, which is right for production but useless for a
        # one-shot local seed: the global snapshot is whatever is newest
        # market-wide this minute, so a specific ticker like MU is usually
        # absent. This is the same per-symbol path the initial backfill uses.
        n_fmp = 0
        if have_key:
            for lane in ("press", "stock"):
                try:
                    rows = fmp_news.fetch_symbol(sym, lane, limit=200, budget=budget)
                except fmp_news.FmpUnavailable as e:
                    print(f"     fmp {lane} stopped: {e}")
                    break
                except Exception as e:
                    print(f"     fmp {lane} error: {type(e).__name__}: {e}")
                    continue
                for raw in rows:
                    ingest.process(raw)
                    n_fmp += 1
        totals["fmp"] += n_fmp

        counts = store.counts_for(sym)
        print(f"  {i:2d}/{len(TICKERS)} {sym:6s} sec={r['items']:3d} "
              f"fmp={n_fmp:4d} x={x['items']:3d}  feed={counts['total']:4d}",
              flush=True)
        time.sleep(0.15)          # EDGAR courtesy pacing

    print(f"\ningested: sec={totals['sec']} x={totals['x']}")
    snap = store.health_snapshot()
    print(f"store now holds {snap['total_items']} items / "
          f"{snap['total_links']} ticker links")
    print(f"publisher mix: {[(m['source_display'], m['n']) for m in snap['publisher_mix'][:8]]}")
    if (os.environ.get("FMP_API_KEY") or "").strip():
        try:
            res = ingest.run_fmp_cycle(budget=30)
            print(f"fmp cycle: mode={res.get('mode')} items={res.get('items')} "
                  f"requests={res.get('requests')}")
        except Exception as e:
            print(f"fmp cycle failed: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
