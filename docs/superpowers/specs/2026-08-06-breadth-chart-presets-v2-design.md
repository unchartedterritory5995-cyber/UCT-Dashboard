# Breadth → Data Charts presets, round 2 (2026-08-06)

Follow-on to `2026-08-04-breadth-data-charts-presets-design.md`, which shipped
nine presets and the unit-family axis rule as `441684b8`.

Owner ask: "I like what you did with the presets, but think we can add more and
some better ones as well."

Three changes, in dependency order:

1. **Catalog** — expose 12 metrics the collector already writes but the picker
   never showed, and add three unit families so they cannot crush their
   neighbours.
2. **Axis framing** — auto-frame the families whose value is read as a *shape*;
   keep the zero anchor for the families read as a *magnitude*. Without this,
   three of the new presets render as flat lines.
3. **Presets** — seven new, two revised, and a `More` menu so sixteen presets
   still occupy one chrome band.

No backend changes. Every metric below is already in the
`/api/breadth-monitor` payload.

## Evidence

All ranges are measured, not estimated: 151 sessions pulled once from
`https://uctintelligence.com/api/breadth-monitor?days=400` (public, no auth) on
2026-08-06, covering 2026-01-02 → 2026-08-06.

The previous round's central lesson was that **a shared unit family is
necessary but not sufficient — a family can span an order of magnitude, and a
same-family pair can still flatten one series.** Every decision here is
justified against a measured range for exactly that reason.

## 1. Catalog additions

Twelve metrics, all 99–100 % filled and all current through 2026-08-06
(verified against the most recent 20 sessions, not just the full-history
average — a column can be well-filled overall and stale at the tail).

| key | label | group | unit | measured range |
|---|---|---|---|---|
| `adv_decline` | Net Advancers | Primary Breadth | `NET` | −2,004 → 2,142 |
| `adv_decline_cum` | A/D Line | Primary Breadth | `CUM` | −995 → 13,981 |
| `up_vol_ratio` | Up/Down Volume | Primary Breadth | `RATIO` | 0.22 → 5.73 |
| `hi_ratio` | % at 52W Highs | Highs / Lows | `PCT` | 1.87 → 18.61 |
| `lo_ratio` | % at 52W Lows | Highs / Lows | `PCT` | 0.15 → 8.57 |
| `near_52w_high` | Within 5% of High | Highs / Lows | `COUNT` | 235 → 1,177 |
| `rsp_spy_ratio` | RSP/SPY (Equal-Wt) | Regime | `SPREAD` | 0.2722 → 0.2996 |
| `iwm_qqq_ratio` | IWM/QQQ (Small-Cap) | Regime | `SPREAD` | 0.3865 → 0.4377 |
| `vxn` | VXN (Nasdaq) | Regime | `VIX` | 19.06 → 33.54 |
| `avg_10d_vix` | VIX 10D Avg | Regime | `VIX` | 14.28 → 26.87 |
| `avg_10d_vxn` | VXN 10D Avg | Regime | `VIX` | 18.51 → 29.31 |
| `avg_10d_cpc` | P/C 10D Avg | Sentiment | `RATIO` | 0.77 → 1.01 |

### Deliberately excluded

- **`spy_dist_days` / `qqq_dist_days`** — 43 % fill overall, and only 9 of the
  last 20 sessions, with the three most recent null. A distribution-day count
  that stops at the present is worse than absent.
- **`iwm_close`** — 36 % fill.
- **`spy_close` / `rsp_close`** — real data, but `INDEX` already carries two
  members that may not be paired, and `rsp_spy_ratio` expresses the
  equal-weight story better than a second price line. YAGNI.
- **`spy_day_pct` / `qqq_day_pct`** — a ±3 % daily change has no family it can
  share, and a one-day return is not a breadth measure.
- **`naaim`** — unchanged from round one. Its three most recent values are all
  79.70; the free feed still lags ~3 months since NAAIM paywalled the live
  index on 2026-08-01. Stays in the picker, stays out of presets.
- **`new_ath`** — see the defect below.

### Defect found, not fixed here

`new_ath` is not an all-time-high count. `breadth_collector.py:1827` computes
it as `count_nd_highs(closes, min(252, len(closes) - 1))` — a 252-day window,
which is the same 52-week high already reported as `new_52w_highs`. The two
series agree on **139 of 151 sessions** and differ by 1–2 when they don't; the
difference is the `len(closes) - 1` clamp, not a different measurement.

The picker labels it "ATH Count", so anyone charting it beside "52W Highs" is
drawing one line twice. Fixing it means changing what the collector writes,
which is out of scope for a front-end preset change. This spec keeps `new_ath`
out of every preset and the defect is logged for a separate pass.

## 2. Unit families

Three new families. Each exists because a measured range says the metric would
otherwise flatten something it shares an axis with.

| family | label | members | why it cannot join an existing family |
|---|---|---|---|
| `CUM` | `A/D line` | `adv_decline_cum` | 13,981 against `new_52w_lows`' 234 — a 60× spread inside `COUNT` |
| `NET` | `net` | `adv_decline` | signed ±2,000; on a `COUNT` axis it forces −2,004 → 2,142 and pins any small count to the middle |
| `SPREAD` | `spread` | `rsp_spy_ratio`, `iwm_qqq_ratio` | spans 0.028; beside `ratio_5day`'s 4.4 span it is a flat line **even with auto-framing** |

`hi_ratio` and `lo_ratio` join `PCT` rather than `RATIO` because
`breadth_monitor.py:169` computes them as `nh / uni * 100` — they are
percentages of the universe, and the axis label must read `%`.

The `PCT` family now spans 0.15 → 102. That is tolerable because no preset
pairs the high/low ratios with the MA stack, but it is a latent hazard for a
hand-picked selection, in the same way `universe_count` vs `new_52w_lows`
already is inside `COUNT`. Recorded, not designed around.

## 3. Axis framing

Today both axes are `type: 'value'` with no `scale`, so ECharts includes zero
in every range. That is correct for a magnitude and wrong for a level:

- `rsp_spy_ratio` (0.2722–0.2996) on a zero-anchored axis is a **flat line at
  93 % height** — the exact QQQ failure from round one, reintroduced.
- `sp500_close` (6,344–7,737) already wastes 82 % of the plot. This is the
  "wastes most of the plot for `index`" nit logged in round one as an owner
  call. It is now load-bearing.

**Rule — scale by unit family, not by axis position:**

| family | framing | reasoning |
|---|---|---|
| `PCT` | anchored at 0 | "40 % above the 50SMA" is read against 0 and 100; the MA extremes band needs 0–100 |
| `COUNT` | anchored at 0 | a count of stocks is read absolutely |
| `NET` | anchored at 0 | zero is the meaningful crossover |
| `RATIO` | anchored at 0 | 1.0 is the meaningful level and it must stay visible |
| `INDEX` | auto-framed | read as a shape |
| `VIX` | auto-framed | read as a shape against its own recent range |
| `OSC` | auto-framed | already spans zero naturally |
| `CUM` | auto-framed | read as a shape; the absolute level is an artifact of the series start |
| `SPREAD` | auto-framed | the whole signal is a 0.03-wide drift |

Implemented as a `SCALED_UNITS` set in `chartMetrics.js` and a
`scaleForUnit(unit)` helper, so the rule is unit-testable without mounting
ECharts — the same reason `resolveAxes` lives there.

Interaction with `EXTREMES_BAND`: the band forces `min ≤ 0` and `max ≥ 100` on
whichever axis carries the reference lines. Extremes are only offered for
`MA Breadth`, which is `PCT`, which is anchored — so the two rules never
contradict. A test pins this: **no scaled family may host an extremes group.**

## 4. Presets

### Seven new

| id | label | metrics | families | reading |
|---|---|---|---|---|
| `ad-line` | A/D Line | `adv_decline_cum`, `sp500_close` | CUM + INDEX | the classic divergence: price making highs the A/D line will not confirm |
| `narrow-leadership` | Narrow Leadership | `rsp_spy_ratio`, `sp500_close` | SPREAD + INDEX | index up while equal-weight/cap-weight falls = a mega-cap-only rally |
| `risk-appetite` | Risk Appetite | `iwm_qqq_ratio`, `rsp_spy_ratio` | SPREAD | small-cap and equal-weight participation together |
| `volume-thrust` | Volume Thrust | `up_vol_ratio`, `adv_decline` | RATIO + NET | conviction behind the advance, not just its width |
| `highs-lows-pct` | Highs/Lows % | `hi_ratio`, `lo_ratio` | PCT | the same crossover as New Highs vs Lows, normalized |
| `vol-complex` | Vol Complex | `vix`, `vxn`, `avg_10d_vix` | VIX | tech vs broad volatility, with the 10-day trend |
| `setup-supply` | Setup Supply | `near_52w_high`, `new_52w_highs` | COUNT | coiled within 5 % of a high vs actually breaking out |

**Why `highs-lows-pct` earns a slot beside the existing `highs-lows`:**
`universe_count` swings 2,637 → 3,736 across these 151 sessions, a **42 %**
change. A raw count of 52-week highs is therefore not comparable across the
window; the percentage is. Both are kept because the raw crossover is what a
reader recognises and the normalized one is what is actually true.

**Magnitude checks on same-family pairs**, since family alone is not enough:

- `setup-supply` — 235–1,177 against 52–555. On a zero-anchored 0–1,177 axis
  the highs line occupies 4–47 %: compressed but with real visible shape. This
  is the tightest same-family pair proposed and the one to look at first in the
  browser pass.
- `vol-complex` — 14.3–33.5 across all three, auto-framed. Comfortable.
- `highs-lows-pct` — 0.15–18.61, zero-anchored, no extremes group. Comfortable.
- `risk-appetite` — union 0.272–0.438 auto-framed; `rsp_spy_ratio` occupies the
  bottom ~17 %, `iwm_qqq_ratio` the top ~31 %. Each keeps its own shape in its
  own band. Acceptable, and the second thing to check in the browser.

### Two revised

- **`volatility`** — `vix`, `cboe_putcall` → `vix`, `cboe_putcall`,
  `avg_10d_cpc`. The daily put/call (0.64–1.12, 39 distinct values over 151
  sessions) is noise; the 10-day average (0.77–1.01) is the tradeable extreme.
  They share the `RATIO` axis at the same scale, so the smoothed line reads as
  the spine of the raw one. Still two families.
- **`thrust`** — add `up_vol_ratio`. The preset had counts and ratios but no
  volume, and volume is what separates a thrust from a bounce. `up_vol_ratio`
  (0.22–5.73) sits comfortably beside `ratio_5day` (0.44–4.83) on the shared
  `RATIO` axis. Five series, still two families.

`breadth-vs-price` improves with no metric change: `sp500_close` is `INDEX`, so
the axis rule alone moves it off the top 18 % of the plot.

### Unchanged

`health`, `participation`, `highs-lows`, `trend-regime`, `froth`, `sentiment`.

`froth` in particular keeps its documented exclusion of `up_25pct_month`, and
`near_52w_high` is deliberately *not* added to it — at 235–1,177 it would pin
`atr_ext_7` (2–34) and `hvc_52w` (0–163) to the floor, which is precisely the
defect that exclusion exists to prevent.

## 5. Preset row

Sixteen presets do not fit one line. `.presetRow` is `flex-wrap: wrap`, so
today they would silently become a second band — against the standing
no-stacked-chrome preference.

**Core pills plus a `More` menu.** The row keeps one-click pills for the
presets used daily and ends with a `More ▾` pill opening a grouped popover.

Core pills (7): Market Health · Breadth vs Price · Participation ·
Breadth Thrust · A/D Line · Highs/Lows % · Volatility & Fear

`More` popover (9), grouped, each row showing its `hint` as secondary text:

- **Structure** — Trend Regime · Setup Supply · New Highs vs Lows
- **Leadership** — Narrow Leadership · Risk Appetite
- **Momentum** — Volume Thrust · Froth & Extension
- **Volatility & Sentiment** — Vol Complex · Sentiment Extremes

7 core + 9 popover = 16, which test 7 below pins.

Behaviour:

- Selecting from the popover applies the preset and closes it.
- When the active preset lives in the popover, the `More` pill takes the active
  gold treatment and reads `More: <label>` — the band must never look like
  nothing is selected.
- Closes on outside click, on `Escape`, and on selection. Trigger is a real
  `<button>` with `aria-expanded` / `aria-haspopup`; the panel is a `listbox`
  with roving focus, matching how `CustomizePanel` already behaves.
- `.presetRow` drops `flex-wrap: wrap` so a regression that overflows the band
  fails visibly instead of quietly stacking.

`group` is a new optional field on a preset (`core` presets omit it). The row
renders pills for presets without a group and the popover renders the rest, so
promoting a preset between tiers is a one-line change.

## 6. Testing

Extends `chartMetrics.test.js` (45 tests today). The existing invariants all
still hold and must keep passing unchanged — in particular *"spans at most two
unit families"* and *"never pairs the two index metrics"*.

New coverage:

1. **Catalog** — every new metric has a unit, a label, and a group; the
   `unitOf` fallback is still unreachable.
2. **Family isolation** — `CUM`, `NET`, `SPREAD` each have at least one member;
   every family has an axis label.
3. **Scale rule** — `scaleForUnit` returns the documented value for all nine
   families; the set of scaled families is exactly the documented one, so
   adding a family without deciding its framing fails.
4. **Extremes vs scale** — no preset enables an extremes group whose family is
   auto-framed.
5. **Excluded metrics** — no preset references `naaim`, `new_ath`,
   `spy_dist_days`, `qqq_dist_days`, or `iwm_close`. `new_ath` gets its own
   named test citing the duplication, so a future author cannot add it back
   without reading why.
6. **Intra-family magnitude** — the round-one lesson turned into a gate. A
   table of measured maxima lives in the test file; for every preset, any two
   metrics sharing a family must have a ratio between their maxima of **≤ 6×**.

   The threshold is derived, not picked. Every current and proposed preset
   passes, with `froth` the closest at **4.8×** (`hvc_52w` 163 vs `atr_ext_7`
   34) — so the gate is tight enough to bite. Both round-one defects fail it:
   S&P 7,737 vs QQQ 746 is **10.4×**, and `up_25pct_month` 385 vs `atr_ext_7`
   34 is **11.3×**. A gate nothing can fail is not a gate, so this one is
   checked against the two known failures rather than only against green code.

   The table must be maintained: it encodes observed ranges, and a metric whose
   range shifts materially will make it stale. It is a tripwire for the known
   failure mode, not a proof of good layout.
7. **Row partition** — core pills and popover presets together are exactly
   `CHART_PRESETS`, with no overlap and no orphan.
8. **Popover component** — opens, applies, closes on select / outside click /
   `Escape`; the trigger shows the active label when the selection lives inside.
9. **Axis layout per preset** — the existing per-preset layout table extended to
   all sixteen, asserting the intended left/right split.

### Live-surface pass

Green tests did not catch either round-one defect; a browser did. Budget a
browser pass before shipping, using the recipe that worked last time: pull real
rows once from the public endpoint, serve them from a stub API on `:8000`
(vite already proxies `/api` there), mount via a temporary `preview-breadth`
entry to skip `AuthGuard`, and delete the temp entry before commit.

Two things to look at specifically, both flagged above: `setup-supply` for
compression and `risk-appetite` for two bands on one auto-framed axis.

Read the actual port from the vite log — another vite instance commonly holds
`:5173`. Allow ~20 s for ECharts' line animation in a background tab before
judging a partially drawn line as a data bug.

## Out of scope

- The `new_ath` collector defect.
- Custom user-defined presets — still no, unchanged from round one.
- Presets touching the date range — still no; a framed window is intentional.
- The `PCT`-family span hazard and the `COUNT`-family `universe_count` hazard
  for hand-picked selections.
