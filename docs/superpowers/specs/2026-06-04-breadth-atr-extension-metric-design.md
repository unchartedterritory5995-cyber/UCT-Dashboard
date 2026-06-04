# Breadth Metric — ">N×ATR Extended Above 50SMA" (Jeff Sun extension)

**Date:** 2026-06-04
**Status:** Approved, implementing
**Repos:** `uct-intelligence` (collector) + `uct-dashboard` (display)

## Goal

Add a new breadth reading to the Breadth page: how many universe stocks are
extended **more than 7×, 10×, and 12× ATR above their 50-day SMA** on the daily
timeframe. Popularized by Jeff Sun as a signal that a trending stock is near
time to consolidate / mean-revert. Helps traders (a) find strength / trending
names and (b) avoid buying them too extended.

## Key insight — the per-stock math already exists

`breadth_collector.py` already computes, for every universe stock:

- `_true_atr_pct_map()` → Wilder ATR(14) as % of close
- `_sma50_atr_map()` → `a50 = (close − 50SMA) / ATR` (signed; +above / −below)

`a50` is already attached to every drill-list item and shown in the DrillModal's
"50SMA" column. So this feature is **counting + listing over an existing signal** —
no new data fetch, no DB migration (breadth storage is a schema-free JSON blob).

## Decisions (locked with user)

- **Direction:** extended **above** only (strength / froth gauge).
- **Thresholds:** three nested bands — `>7×`, `>10×`, `>12×` ATR.
- **Surfaces:** Monitor table column + Heatmap tile + Data Charts line (all three),
  each Monitor/Heatmap entry click-through to the stock list.
- **Monitor group:** Highs / Lows (alongside ATH / 52W Hi / HVC).
- **Color:** graduated green (treated as a strength gauge like new highs). Count
  thresholds are first-pass guesses, explicitly tunable after one live collection.

## Metrics (collector keys)

| Key | Counts stocks where | List key |
|-----|---------------------|----------|
| `atr_ext_7`  | `a50 > 7`  | `atr_ext_7_list`  |
| `atr_ext_10` | `a50 > 10` | `atr_ext_10_list` |
| `atr_ext_12` | `a50 > 12` | `atr_ext_12_list` |

## Backend — `uct-intelligence/scripts/breadth_collector.py`

Two new pure functions (next to the ATR helpers):

- `count_atr_extended(sma50_atr_map, thresh) -> Optional[int]`
  - `None` if map empty/missing (renders "—"); else count of `v > thresh`.
- `list_atr_extended(closes, sma50_atr_map, thresh, volumes=None, atr_map=None) -> list`
  - Items `{t, pct, c, vr?, atr?, a50}`, same shape as every other drill list,
    **sorted by `a50` descending** (most extended first). `pct` = day change.

Wired into both metric-assembly paths over `for thr in (7, 10, 12)`:
- live `collect()` (after the Highs/Lows block, ~line 1582)
- historical `_compute_metrics_for_date()` (after the Highs/Lows block, ~line 2136)

`_enrich_lists_with_names()` already runs generically over `*_list` keys in both
paths → company names attach automatically.

## Frontend — `uct-dashboard`

- **`Breadth.jsx` `COLS`** — 3 entries in the `G.HIGHS` group, each with
  `colorFn` (graduated green) + `drillKey` → click opens DrillModal.
- **`Breadth.jsx` `HM_METRICS`** — 3 entries in `'Highs/Lows'` group with
  `getTier`/`getFmt`/`drillKey`. **`TREEMAP_DEF`** — 3 tiles.
- **`Breadth.jsx` `PCTILE_KEYS`** — add the 3 keys so the Views (Meters/Scoreboard/
  Radar) can build a percentile series and normalize them.
- **`BreadthCharts.jsx` `CHART_GROUPS`** — 3 keys under the `'Highs / Lows'` group.

First-pass color thresholds (g1 / g2 / g3):
`atr_ext_7`: 40 / 80 / 120 · `atr_ext_10`: 15 / 35 / 60 · `atr_ext_12`: 8 / 20 / 40.

## Tests

- Backend: `tests/test_breadth_atr_extension.py` — `count_atr_extended` (empty→None,
  zero-match→0, strict `>` boundary, multi-band) and `list_atr_extended`
  (a50-desc sort, threshold filter, item shape, pct/day-change).
- Frontend: assert the 3 new columns render in the Monitor table.

## Out of scope

- The bearish mirror (`>N×ATR below 50SMA`) — deferred (user chose above-only).
- Retuning color thresholds against live magnitudes — polish pass after first
  live collection.
