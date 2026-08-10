"""Runs ON THE PRODUCTION POD. Refetch deep D/W history for damaged tickers.

The provider returns split-adjusted data and put_bars is INSERT OR REPLACE, so a
deep refetch overwrites the rows the false-positive rescale corrupted.

⛔ Verification is deliberately NOT done here. It happens from outside, against the
public API and an independent vendor, AFTER this runs -- checking our own write with
our own fetch would just confirm we stored what we fetched.
"""
import sys

from api.services import bars_fetch, bars_sqlite

SYMS = [s for s in sys.argv[1].split(",") if s]

print("REPAIR START", flush=True)
for sym in SYMS:
    for tf, fetch in (("D", bars_fetch._fetch_daily), ("W", bars_fetch._fetch_weekly)):
        try:
            got = fetch(sym, 5000, deep=True)
        except Exception as e:                                  # noqa: BLE001
            print(f"  {sym}/{tf} FETCH-FAILED {type(e).__name__}: {e}"[:160], flush=True)
            continue
        if not got:
            print(f"  {sym}/{tf} EMPTY-FETCH -- not written", flush=True)
            continue
        try:
            n = bars_sqlite.put_bars(sym, tf, got, date_tf=True)
        except Exception as e:                                  # noqa: BLE001
            print(f"  {sym}/{tf} WRITE-FAILED {type(e).__name__}: {e}"[:160], flush=True)
            continue
        print(f"  {sym}/{tf} fetched={len(got)} written={n}", flush=True)
print("REPAIR DONE", flush=True)
