"""BANK V2, STEP 1b: fill the sector, industry and fund type the scan could not read, from Yahoo's company profile.

scan_history.py reads the sector from the dashboard's ticker_meta_cache, which knows about 1,800 names, so a third of
the institutional stocks in the deep scan came out with no sector, and choose.py's sector spread treated them as one
bucket. This reads each such stock's Yahoo profile once through yfinance (sector, industry, quoteType, so an ETF is
named as one), caches the answers in docs/study/bank_v2/yahoo_profiles.json (committed, so a re-run reads the file and
asks nobody), and writes a copy of the atlas with the gaps filled. A profile Yahoo cannot answer stays empty, never
guessed. Only the top --top stocks by dollar volume are looked up (the institutional cut choose.py uses).

  python -X utf8 scripts/study/bank_v2/enrich_meta.py --atlas <atlas.jsonl.gz> --out <atlas_enriched.jsonl.gz>
"""
from __future__ import annotations

import argparse
import gzip
import json
import pathlib
import time

REPO = pathlib.Path(__file__).resolve().parents[3]
CACHE = REPO / "docs" / "study" / "bank_v2" / "yahoo_profiles.json"


def profile(sym: str) -> dict:
    import yfinance as yf
    for attempt in range(3):
        try:
            info = yf.Ticker(sym).info or {}
            return {"sector": info.get("sector"), "industry": info.get("industry"),
                    "quote_type": info.get("quoteType"), "name": info.get("longName") or info.get("shortName")}
        except Exception as e:  # rate limit or a dead symbol: back off, then give up honestly
            last = str(e)[:120]
            time.sleep(2 + 3 * attempt)
    return {"sector": None, "industry": None, "quote_type": None, "name": None, "error": last}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--top", type=int, default=1000)
    ap.add_argument("--sleep", type=float, default=0.35)
    a = ap.parse_args(argv)
    rows = [json.loads(l) for l in gzip.open(a.atlas, "rt", encoding="utf-8")]
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    want = sorted({r["sym"] for r in rows if (r.get("liq_rank") or 10**9) <= a.top and not r.get("sector")} - set(cache))
    print(f"{len(want)} stocks to look up ({len(cache)} already cached)", flush=True)
    for i, s in enumerate(want, 1):
        cache[s] = profile(s)
        if i % 25 == 0 or i == len(want):
            CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"  {i}/{len(want)}", flush=True)
        time.sleep(a.sleep)
    filled = 0
    with gzip.open(a.out, "wt", encoding="utf-8") as f:
        for r in rows:
            p = cache.get(r["sym"]) or {}
            if not r.get("sector"):
                if p.get("sector"):
                    r["sector"], r["industry"] = p["sector"], p.get("industry"); filled += 1
                elif (p.get("quote_type") or "").upper() == "ETF":
                    r["sector"], r["industry"] = "ETF", None; filled += 1
            if p.get("quote_type"):
                r["quote_type"] = p["quote_type"]
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"filled the sector on {filled} instances; wrote {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
