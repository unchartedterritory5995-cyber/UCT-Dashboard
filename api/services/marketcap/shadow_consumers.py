"""Consumer shadow comparison (Gate I): what each consumer's PROVIDER says today vs the canonical authority.

Run where the provider keys live (read-only; external GETs only; writes nothing but its own output file):
    python -m api.services.marketcap.shadow_consumers --ours ours.json --out shadow.json

`ours.json`: {ticker: [date, company_market_cap, security_market_cap|null]} from the build.
Providers are called DIRECTLY (not through the app's service functions) so no shared application cache is written:
  C/G  yfinance Ticker.info["marketCap"]          (chart header / snapshots / research / catalyst)
  H    yfinance Ticker.fast_info.market_cap       (news gate)
  C/E  FMP /stable/quote marketCap                 (fallback of C; research QuoteStrip)
  D    FMP /stable/profile marketCap               (AboutPanel)
B (Massive) is compared locally from the reference pull; I (flow) and F (Finviz calendar) are classified from code
only -- options-flow storage is deliberately not touched.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request


def fmp(path: str, sym: str) -> float | None:
    key = os.environ.get("FMP_API_KEY")
    if not key:
        return None
    try:
        with urllib.request.urlopen(f"https://financialmodelingprep.com/stable/{path}?symbol={sym}&apikey={key}", timeout=20) as r:
            j = json.loads(r.read())
        row = j[0] if isinstance(j, list) and j else (j if isinstance(j, dict) else {})
        v = row.get("marketCap") or row.get("mktCap")
        return float(v) if v else None
    except Exception:
        return None


def yf_vals(sym: str) -> tuple[float | None, float | None]:
    try:
        import yfinance as yf
        t = yf.Ticker(sym.replace(".", "-"))
        info = t.info or {}
        a = info.get("marketCap")
        b = getattr(t.fast_info, "market_cap", None)
        return (float(a) if a else None), (float(b) if b else None)
    except Exception:
        return None, None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ours", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    ours = json.load(open(a.ours))
    rows = {}
    for sym, (d, comp, sec) in ours.items():
        yi, yfi = yf_vals(sym)
        rows[sym] = {"date": d, "ours_company": comp, "ours_security": sec, "C_G_yf_info": yi, "H_yf_fast_info": yfi,
                     "C_E_fmp_quote": fmp("quote", sym), "D_fmp_profile": fmp("profile", sym)}
        time.sleep(0.4)
    json.dump(rows, open(a.out, "w"), indent=1)
    print(json.dumps({"n": len(rows)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
