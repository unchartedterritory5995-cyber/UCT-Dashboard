# Breadth → Data Charts: curated presets + unit-family axes

**Date:** 2026-08-04
**Branch:** `feat/breadth-chart-presets`
**Status:** implemented, awaiting ship approval

## Problem

The Data Charts tab exposes 44 metrics behind a six-group checkbox picker. Building a
useful chart means knowing which metrics belong together *and* which of them share a
scale — the tab gave no help with either.

The scale part was an actual defect, not just a UX gap. Only `sp500_close` and
`qqq_close` were routed to the right y-axis (a hardcoded `PRICE_KEYS` set); everything
else shared the left. So a perfectly reasonable selection — daily 4% movers (24–956)
alongside the 5-day ratio (0.45–4.83) — rendered the ratio as a flat line on the floor.

## Scope decision

Presets are built **only from metrics already in the picker** (owner call). The API
returns ~10 further well-populated metrics that aren't exposed — `adv_decline_cum`,
`rsp_spy_ratio`, `iwm_qqq_ratio`, `hi_ratio`/`lo_ratio`, `up_vol_ratio`, `vxn`,
`avg_10d_cpc`, `near_52w_high`, `spy_close`, `rsp_close` — all at 99–100% fill. Adding
them was offered and declined; noted here as the obvious next increment (it would
unlock a cumulative A/D line and an equal-weight-vs-cap-weight divergence chart).

## Design

### Unit families

Every metric is tagged with one of six families in `app/src/pages/breadth/chartMetrics.js`:

| Family | Members | Typical range |
|---|---|---|
| `pct` | breadth_score, uct_exposure, all `pct_above_*`, cnn_fear_greed, aaii_*, naaim | 0–150 |
| `count` | all mover counts, universe/stage counts, highs/lows, hvc, atr_ext_7 | 0–3,000 |
| `ratio` | ratio_5day, ratio_10day, cboe_putcall | 0–5 |
| `index` | sp500_close, qqq_close | 500–8,000 |
| `vix` | vix | 15–31 |
| `osc` | mcclellan_osc | −100–100 |

`resolveAxes(selected)` then assigns axes: **left = the most-populated family, right =
everything else.** Ties go to the family of the first selected metric, which makes
preset layout a property of preset metric *order* — each preset lists its
intended-left metrics first.

This replaces `PRICE_KEYS` and fixes manual selections too, not just presets.

### Presets

Nine, each verified readable against the live 90-day ranges:

| Preset | Metrics | Left | Right |
|---|---|---|---|
| Market Health | breadth_score, uct_exposure, pct_above_50sma | pct | — |
| Breadth vs Price | pct_above_50sma, pct_above_200sma, sp500_close | pct | index |
| Participation | pct_above_10sma/20ema/50sma/200sma (+ MA extremes) | pct | — |
| Breadth Thrust | up_4pct_today, down_4pct_today, ratio_5day, ratio_10day | count | ratio |
| New Highs vs Lows | new_52w_highs, new_52w_lows | count | — |
| Trend Regime | stage2_count, stage4_count | count | — |
| Froth & Extension | hvc_52w, up_50pct_month, atr_ext_7 | count | — |
| Volatility & Fear | vix, cboe_putcall | vix | ratio |
| Sentiment Extremes | cnn_fear_greed, aaii_spread | pct | — |

### What the browser changed (and the tests could not)

Two presets were composed differently after seeing them render against real data.
Both are the *same* failure the unit-family rule exists to prevent, recurring **inside**
a family — same family still means same axis, and a family can span an order of
magnitude.

- **Breadth vs Price** originally plotted S&P 500 *and* QQQ. Both are `index`, so they
  shared the right axis — and at ~7,700 against ~723, QQQ rendered as a dead flat line
  along the bottom of an 0–8,000 scale. A divergence chart needs one price reference;
  QQQ was dropped. A test now caps any preset at one `index` series.
- **Froth & Extension** originally led with `up_25pct_month` (66–385), which dominated
  the counts axis and pinned ATR extension (2–34) and HVC (0–163) to the floor. Dropping
  it took the axis from 0–350 to 0–180 and revealed a mid-July HVC spike to ~85 that had
  been invisible.

Clicking a preset replaces the metric selection and the reference-line toggles. It
deliberately **does not touch the date range** — when a window has been framed around
a specific correction, having a preset reset it is hostile, and the date inputs are one
click away.

Extremes are *replaced*, not merged, so Participation's 70/80/90 washout levels can't
linger over a VIX axis. They also only draw when a `pct` metric is actually plotted,
and they follow the `pct` family to whichever axis it landed on rather than being
pinned to axis 0.

### Persistence

Selection + extremes persist to `usePreferences` under `breadth_charts_state`
(600 ms debounce). The stored value is **derived**, not copied into state by an effect —
SWR resolves after mount, so an effect would mean a cascading render and a
default-then-swap flash. A `selectedOverride`/`extremesOverride` pair takes precedence
once the user touches anything, which also guarantees a plain page load never writes its
own restored state back to the server. Unknown metric keys are filtered on read so a
future rename can't blank the chart.

The active chip is derived by comparing the selection to each preset's metric set
(`matchPreset`), so it lights up on match and dims the moment an extra box is ticked —
no divergence bookkeeping.

**No custom user presets.** A save/rename/delete surface was considered and cut; the
part of it that actually gets used is "reopen how I left it", which persistence gives
for one prefs key.

## Data finding — since FIXED (2026-08-05)

**`naaim` was dead.** It returned exactly `75.00` on 93 consecutive trading days
(2026-03-23 → 2026-08-04). Root cause was a seeded placeholder
(`{"exposure": 75.0, "date": ""}`) that a cache read trusted without checking its date
— which also suppressed the live sources beneath it.

Fixed in `breadth_collector.py` + `morning_wire_engine.py` (uct-intelligence `3c9200d`,
morning-wire `4daf1ef`), and the column was rebuilt from NAAIM's own published weekly
series. Validated at 56/56 against rows written while the scrape still worked.
**All 149 rows now carry real readings** (29 distinct values).

### The upstream story (corrected 2026-08-05)

A first pass concluded NAAIM's feed was dead. That was wrong, and searching beyond the
one source overturned it:

- NAAIM moved the live Exposure Index to a **paid subscription on 2026-08-01**.
- The free chart embed is **~3 months delayed**, not dead — it keeps advancing.
- Weekly numbers were public right up to the paywall, so 2026-05-06 → 2026-07-29 was
  recoverable. Those agreed with the official embed on **all 8 overlapping dates**.

So NAAIM stays out of presets for a third reason: its *forward* coverage is unreliable
(recent weeks routinely missing, backfilling ~13 weeks later). Fine to select
deliberately; a poor default. A test asserts no preset references it.

Two supporting tools ship in uct-intelligence:
`scripts/breadth_freeze_audit.py` (detects this defect class) and
`scripts/naaim_backfill.py` (heals history as the delayed feed catches up, and refuses
to either blank a value or regress it to an older reading).

## Known nits (pre-existing, not introduced here)

- The MA extremes **90 line is clipped**. The value axis anchors at 0 and tops out
  around 80 for typical participation data, so the highest overbought reference never
  draws. Identical on master; surfacing it via the Participation preset just makes it
  more visible.
- Both value axes anchor at 0 (`scale` left at its default). For the `index` family that
  wastes most of the plot — the S&P's 6,343 → 7,736 move reads as a gentle slope on an
  0–8,000 axis. `scale: true` on the right axis would fix it, but it also changes how
  ratio and count axes frame, so it's an owner call rather than a silent change.

## Testing

`chartMetrics.test.js` (31) — unit coverage gate, preset integrity, axis resolution,
per-preset layout verified *through the real rule* rather than restated as data.
`BreadthCharts.test.jsx` (13) — asserts against the ECharts option object the component
actually emits, not component state.

Both suites were mutation-checked with an unmutated control green on either side and an
apply-guard proving each mutation landed. Eight mutations, all killed: single-axis
revert, always-show-right-axis, extremes-merge-instead-of-replace, dropped unknown-key
filter, extremes pinned to axis 0, dropped `hasPct` guard, dropped write-back guard,
ignored stored selection.

One test initially passed **vacuously** — "clears extremes on preset switch" used
Volatility & Fear as the target, where the `hasPct` guard removes the lines regardless
of the toggle. Rewritten to switch to Market Health (all-pct), which the guard cannot
mask; the merge mutation then failed as it should.

## Files

- `app/src/pages/breadth/chartMetrics.js` — new. Catalog (moved out of BreadthCharts.jsx),
  unit families, presets, `resolveAxes`/`matchPreset`/`axisForUnit`.
- `app/src/pages/breadth/chartMetrics.test.js` — new.
- `app/src/pages/BreadthCharts.jsx` — preset row, derived-state persistence, axis wiring.
- `app/src/pages/BreadthCharts.test.jsx` — new.
- `app/src/pages/BreadthCharts.module.css` — preset chip styles + phone scroll row.

No backend changes — every metric is already in the `/api/breadth-monitor` payload.
