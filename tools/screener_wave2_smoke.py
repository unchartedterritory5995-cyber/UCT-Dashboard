"""Wave 2 smoke: build_row over 20 real tickers with whatever Wave-2 source
artifacts exist locally. READ-ONLY. Bar-derived + FMP-derivation columns
must populate when their inputs are present; job-fed columns report
source-presence honestly instead of pretending."""
import json
import sys

sys.path.insert(0, ".")
from api.services.screener import snapshot_builder as sb          # noqa: E402
from api.services.screener import (finviz_universe, earnings_dates,   # noqa: E402
                                   earnings_context, analyst_pass,
                                   insider_capture)

universe = [t for t in json.load(open("api/data/cap_universe.json"))
            if isinstance(t, str)][:20]
sources = {}
readers = {
    "finviz": finviz_universe.read_finviz_fields,
    "edates": earnings_dates.read_earnings_dates,
    "lastmove": earnings_context.read_last_report_move,
    "implied": earnings_context.read_implied_context,
    "analyst": analyst_pass.read_analyst_fields,
    "insider": insider_capture.read_insider_fields,
}
maps = {}
for name, fn in readers.items():
    try:
        maps[name] = fn(universe, failures=sources)
    except Exception as exc:                                   # noqa: BLE001
        maps[name] = {}
        sources.setdefault(name, {})[type(exc).__name__] = 1
print("source presence:", {k: bool(v) for k, v in maps.items()})
print("failure census:", sources)

spy = sb._read_spy_closes()
census, rows = {}, 0
for t in universe:
    bars = sb._read_daily_bars(t)
    if not bars:
        continue
    T = t.upper()
    market_row = {}
    for m in maps.values():
        market_row.update(m.get(T, {}))
    row = sb.build_row(t, bars, None, None, spy_closes=spy,
                       market_row=market_row)
    rows += 1
    for k, v in row.items():
        if v is not None:
            census[k] = census.get(k, 0) + 1
print(f"rows built: {rows}")
for c in ("ipo_age_days", "days_to_earnings", "pt_upside_pct",
          "short_float_pct", "next_earnings_date", "rating_eps",
          "sponsorship", "insider_cluster_days"):
    print(f"  {c}: {census.get(c, 0)}/{rows}")
