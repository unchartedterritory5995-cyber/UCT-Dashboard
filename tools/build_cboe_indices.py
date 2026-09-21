"""Ingest Cboe's public daily volatility-index history into the local store.

⛔ AN EXPLICIT TOOL, NOT A REQUEST-PATH FETCH. `api/services/market_indicators/
cboe_store.py` is read-only at serve time by design; this is the only thing that writes
it. Run it to build or refresh the store.

    python tools/build_cboe_indices.py                 # every registered symbol
    python tools/build_cboe_indices.py VIX9D VVIX      # just these
    python tools/build_cboe_indices.py --local         # reuse ./_cboetmp/*.csv

Source: https://cdn.cboe.com/api/global/us_indices/daily_prices/{SYM}_History.csv
Published on Cboe's public site for site visitors and subject to Cboe website terms.
EOD only — this tool has no intraday path and must not grow one without a licensing
conversation (the real-time Global Indices Feed is separately licensed and its
redistribution is prohibited).
"""
from __future__ import annotations

import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.market_indicators import cboe_store  # noqa: E402
from api.services.market_indicators import registry as reg  # noqa: E402

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
LOCAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "_cboetmp")


def fetch(symbol: str, use_local: bool = False) -> str:
    cache = os.path.join(LOCAL_DIR, f"{symbol}.csv")
    if use_local and os.path.exists(cache):
        with open(cache, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    url = cboe_store.CSV_URL.format(sym=symbol)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read().decode("utf-8", "replace")
    try:
        os.makedirs(LOCAL_DIR, exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            f.write(data)
    except Exception:
        pass
    return data


def main(argv) -> int:
    use_local = "--local" in argv
    wanted = [a.upper() for a in argv if not a.startswith("-")]
    if not wanted:
        # ⭐ EVERY REGISTERED VOLATILITY SYMBOL, DORMANT ONES INCLUDED. A dormant row
        # is one a product decision may publish tomorrow; having its history already
        # ingested is what makes that a flag flip rather than a data project.
        wanted = [s.symbol for s in reg._ROWS
                  if s.family == reg.FAM_VOLATILITY]
    ok = 0
    for sym in wanted:
        if sym not in cboe_store.KNOWN_SYMBOLS:
            print(f"  {sym:7} SKIP (not in cboe_store.KNOWN_SYMBOLS)")
            continue
        try:
            text = fetch(sym, use_local)
            bars, has_ohlc = cboe_store.parse_csv(text)
            n = cboe_store.upsert(sym, bars)
            span = f"{bars[0]['date']} .. {bars[-1]['date']}" if bars else "-"
            shape = "OHLC" if has_ohlc else "close-only"
            print(f"  {sym:7} {n:>6} rows  {span}  [{shape}]")
            reg_row = reg.get(f"CBOE:{sym}")
            if reg_row is not None and reg_row.has_ohlc != has_ohlc:
                print(f"           WARNING registry says has_ohlc={reg_row.has_ohlc} "
                      f"but the file is {shape} — fix registry.py")
            ok += 1
        except Exception as e:
            print(f"  {sym:7} FAILED: {e}")
    print(f"\n{ok}/{len(wanted)} symbols ingested into {cboe_store._db_path()}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
