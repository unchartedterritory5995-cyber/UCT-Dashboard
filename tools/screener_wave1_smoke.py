"""Wave 1 smoke: build_row over 20 real tickers, print the non-null census.

READ-ONLY: reads bars.db via bars_sqlite (read path), calls build_row in
memory, writes NOTHING anywhere. Run before ship; the real gate on prod is
the build receipt after deploy (Task 13).
"""
import json
import sys

sys.path.insert(0, ".")
from api.services.screener import snapshot_builder as sb  # noqa: E402

universe = [t for t in json.load(open("api/data/cap_universe.json"))
            if isinstance(t, str)][:20]
spy = sb._read_spy_closes()
census = {}
rows = 0
for t in universe:
    bars = sb._read_daily_bars(t)
    if not bars:
        continue
    row = sb.build_row(t, bars, None, None, spy_closes=spy)
    rows += 1
    for k, v in row.items():
        if v is not None:
            census[k] = census.get(k, 0) + 1

new_cols = ["chg_pct_1y", "chg_pct_ytd", "chg_from_open_pct", "adr_pct_1w",
            "dist_20d_high_pct", "dist_ath_pct", "new_ath", "pole_pct",
            "close_cv_pct", "avg_body_pct_5", "candle_score", "vol_updown_ratio",
            "ema_touch_count", "ema20_rising", "ema_stack_intact",
            "atr_ext_sma50", "rs_line_trend", "prev_day_high", "dollar_vol_30d"]
print(f"rows built: {rows}")
for c in new_cols:
    print(f"  {c}: {census.get(c, 0)}/{rows}")
missing = [c for c in new_cols if census.get(c, 0) == 0]
print("ALL BAR-DERIVED COLUMNS POPULATED" if not missing
      else f"EMPTY (investigate before ship): {missing}")
