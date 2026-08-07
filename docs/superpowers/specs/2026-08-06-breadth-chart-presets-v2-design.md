# Breadth → Data Charts presets, round 2 (2026-08-06)

Follow-on to `2026-08-04-breadth-data-charts-presets-design.md`, which shipped
nine presets and the unit-family axis rule as `441684b8`.

Owner ask: "I like what you did with the presets, but think we can add more and
some better ones as well."

Changes, in dependency order:

1. **Catalog** (§1–2) — expose 12 metrics the collector already writes but the
   picker never showed, and add three unit families so they cannot crush their
   neighbours.
2. **Axis framing** (§3) — auto-frame the families whose value is read as a
   *shape*; keep the zero anchor for the families read as a *magnitude*.
   Without this, three of the new presets render as flat lines.
3. **Presets** (§4–5) — seven new, two revised, and a `More` menu so sixteen
   presets still occupy one chrome band.
4. **Readability** (§6–7) — colour by metric polarity instead of series order,
   and per-preset reference lines. §6 fixes a shipped defect; §7 is what makes
   the new presets judgeable rather than decorative.
5. **Context** (§8–10) — follow-through-day markers, a widening-only minimum
   window for the A/D line, and a value + percentile readout replacing the
   legend.

§1–5 are one dependency chain and must land in order. §6–10 are independent of
each other and of nothing but §1–4, so they can be built and reviewed in
parallel once the catalog exists.

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

## 6. Series colour by polarity

`BreadthCharts.jsx:156` assigns colour positionally — `PALETTE[i % PALETTE.length]`,
where `PALETTE[0]` is blue and `PALETTE[1]` is green. Every shipped crossover
preset therefore draws its **deterioration line in green**: `new_52w_lows` in
New Highs vs Lows, `stage4_count` in Trend Regime, `down_4pct_today` in Breadth
Thrust. The proposed `highs-lows-pct` and `setup-supply` would inherit it.

Bind colour to a `METRIC_TONE` map instead: `bull` → green ramp, `bear` → red
ramp, `neutral` → the existing blue/amber/violet palette.

**Tone is assigned only to metrics that exist as an opposed pair** —
`up_4pct_today`/`down_4pct_today`, `new_52w_highs`/`new_52w_lows`,
`hi_ratio`/`lo_ratio`, `stage2_count`/`stage4_count`, the `magna` and
`up/down_Npct` families, `aaii_bulls`/`aaii_bears`. Everything else is
`neutral`, including `vix`/`vxn` and the MA stack.

That restriction is deliberate. A "rising VIX is bearish" rule would paint all
three series in `vol-complex` red and make them harder to tell apart, and
`setup-supply` would draw `near_52w_high` and `new_52w_highs` as two greens.
The semantic win belongs on crossover charts; everywhere else, distinguishability
wins. Checked against all sixteen presets: the largest single-tone group is
`participation` with four neutrals, against six available neutral hues.

Red/green carries a colourblindness cost. It is accepted here because the app
already uses this convention throughout and because every paired series is also
labelled in words ("Up 4%+" / "Dn 4%+") in the legend, tooltip, and the readout
in §10.

## 7. Reference lines

`extremes` today is one hardcoded group — MA Breadth's 70/80/90 and 20/15/10/5.
Nothing else has levels, so on the new presets "up/down volume is 1.3" cannot be
judged from the chart.

Add an optional per-preset `lines` array, resolved by unit family so it reuses
the existing `axisForUnit` helper to find the axis its family landed on:

```js
lines: [{ unit: UNIT.RATIO, at: 1.0, label: 'parity' }]
```

Levels are canonical constants, not tuned values:

| preset | lines |
|---|---|
| `thrust` | `RATIO` at 1.0 (parity), 2.0 (thrust) |
| `volume-thrust` | `RATIO` at 1.0 (parity), `NET` at 0 |
| `volatility` | `RATIO` at 1.0 |
| `sentiment` | `PCT` at 25 (fear), 75 (greed) |
| `ad-line` | `CUM` at 0 |
| `vol-complex` | `VIX` at 20 |

`extremes` is left in place rather than folded in: it carries the `EXTREMES_BAND`
axis-widening behaviour that `lines` deliberately does not, and rewriting it
would risk the MA band for no gain. The two coexist.

A line whose family is absent from the preset's metrics would draw on an axis
with no series. A test forbids it.

**A reference line must not be able to undo §3.** ECharts expands an axis to
contain a `markLine`, so `ad-line`'s zero line on a window starting at 5,781
would drag the auto-framed `CUM` axis back to 0–13,981 and restore exactly the
wasted plot that §3 exists to remove. The rule follows the family's framing:

- **Anchored families** (`PCT`, `COUNT`, `NET`, `RATIO`) — the line always
  draws and may extend the axis. This is what `EXTREMES_BAND` already does for
  MA Breadth, and it is wanted: `sentiment`'s greed line at 75 should stay
  visible while Fear/Greed sits at 8.7, because the distance to it is the
  information.
- **Auto-framed families** (`INDEX`, `VIX`, `OSC`, `CUM`, `SPREAD`) — the line
  draws only when its value falls inside the visible data range, and is
  suppressed otherwise. A suppressed line is silent, not an error: it means the
  level is simply not in view.

So `ad-line`'s zero line shows on the 365-day window §9 gives it and disappears
if the reader narrows past the April trough, and `vol-complex`'s VIX 20 line
drops out of a window where volatility never approached it.

## 8. Follow-through-day markers

`is_ftd` is boolean, 100 % filled, and charted nowhere. It is true on 8 of 151
sessions: seven between 2026-04-08 and 2026-04-24, dating the April bottom, and
one on **2026-08-04**.

Render as vertical `markLine`s on a silent series — the same construction as the
existing `LIVE` marker at `BreadthCharts.jsx:166`. A checkbox beside the extremes
controls toggles them, persisted in `breadth_charts_state`, **default off** so no
existing view changes shape without being asked.

Clustering is the one real hazard: seven markers inside three weeks would stack
their labels into mush. **Label only the first marker of a cluster**, where a
cluster ends after a gap of 5 or more sessions. All lines still draw; only the
labels thin out. On the measured data that yields two labels, not eight.

## 9. Preset minimum window

Round one decided presets never touch the date range, and that holds for fifteen
of sixteen. `ad-line` is the exception, and it is measured rather than asserted:
over the default 90-day window `adv_decline_cum` retains only **55 %** of its
full-history travel, climbing monotonically from 5,781 with the April trough at
−995 off-screen. The divergence the preset exists to show is not in the frame.

By contrast `iwm_qqq_ratio` keeps 97 % of its travel in the same window and
`rsp_spy_ratio` 86 %, so Narrow Leadership and Risk Appetite need nothing.

Add an optional `minWindowDays`. On apply, if the current window is narrower,
`fromDate` moves back to `toDate - minWindowDays`. **It only ever widens** — a
preset can never narrow what the user framed, and `toDate` is never touched.
Only `ad-line` declares it, at 365. The fetch is already `days=365`, so it
clamps naturally to available history.

## 10. Metric readout

Each selected metric gets its latest value and that value's percentile over the
**visible window**, so "60.0" becomes "60.0 · 58th". Percentile is the share of
non-null observations in the window at or below the latest value.

This replaces the ECharts legend rather than sitting beside it. Set
`legend: { show: false }` — keeping the component alive but hidden preserves its
selection state, so a readout row can stay clickable by dispatching
`legendToggleSelect`, and series toggling survives the change. A hidden series
renders its row dimmed. Reclaiming the legend strip lets `grid.top` drop from 56
to about 24.

Each row is a colour swatch, the label, the value, and the percentile with a
small 0–100 track. Edge cases: fewer than two non-null points shows `—` rather
than a fabricated percentile; when the latest point is the provisional live row
the percentile is computed from it but the row carries the same live treatment
the chart tip already uses, so an estimate is never presented as a close.

## 11. Testing

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
10. **Tone coverage** — every catalog metric has a tone; every paired metric and
    its opposite carry opposing tones, so a pair can never both read bullish.
11. **Colour collision** — for every preset, no two selected metrics resolve to
    the same colour. This is the gate on §6: it fails today for
    `highs-lows`, `trend-regime`, and `thrust`, where the bearish series is
    green, and it is written to fail against the current positional palette
    before the tone map exists.
12. **Reference lines** — every line's unit family appears in its preset's
    metrics, so no line can draw on an axis carrying no series; no preset
    declares both a `lines` entry and an `extremes` group for the same family;
    and the visibility rule holds both ways — a line on an anchored family
    always draws, a line on an auto-framed family is suppressed when it falls
    outside the visible range. The `ad-line` zero line on a 90-day window is the
    named case, since letting it through would silently undo §3.
13. **FTD clustering** — the label-thinning rule returns one label per run and
    reopens after a 5-session gap; on the measured 8-hit series it yields 2
    labels. Asserts the label list, not just a count of markers.
14. **Minimum window** — applying `ad-line` to a 90-day window widens it to 365;
    applying it to a 400-day window leaves it untouched; no other preset moves
    either date. The never-narrows property is asserted directly.
15. **Percentile** — a known series gives a known percentile; a single non-null
    point and an all-null selection both yield `—` rather than 0 or `NaN`; the
    window filter is respected, so a value extreme in full history but ordinary
    in the visible window reads as ordinary.

### Live-surface pass

Green tests did not catch either round-one defect; a browser did. Budget a
browser pass before shipping, using the recipe that worked last time: pull real
rows once from the public endpoint, serve them from a stub API on `:8000`
(vite already proxies `/api` there), mount via a temporary `preview-breadth`
entry to skip `AuthGuard`, and delete the temp entry before commit.

Five things to look at specifically:

- `setup-supply` for compression, and `risk-appetite` for two bands on one
  auto-framed axis — the two tightest layouts in §4.
- The colour change on `highs-lows`, `trend-regime`, and `thrust`, since the
  point is that the bearish line now reads as bearish.
- FTD labels in a window containing the April cluster, which is where the
  thinning rule earns its place. Pick a `from` date before 2026-04-08.
- The readout's live row during market hours, when the provisional tip exists.
  Outside the session `live.row` is null and that path never runs, which is
  exactly how a defect here would escape an evening check.

Read the actual port from the vite log — another vite instance commonly holds
`:5173`. Allow ~20 s for ECharts' line animation in a background tab before
judging a partially drawn line as a data bug.

## Out of scope

- The `new_ath` collector defect.
- Custom user-defined presets — still no, unchanged from round one.
- Presets touching the date range, beyond the one widening exception in §9.
- Colourblind-safe palettes. §6 keeps the app's existing red/green convention;
  changing it is a dashboard-wide decision, not a Breadth one.
- Divergence detection or any automatic callout on the readout. It reports
  where a metric sits; interpreting that stays with the reader.
- The `PCT`-family span hazard and the `COUNT`-family `universe_count` hazard
  for hand-picked selections.
