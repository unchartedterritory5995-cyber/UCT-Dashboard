# Phase 1 — Audit: Breadth → Data Charts

*No code changes. Every finding cites evidence from [`00-discovery.md`](00-discovery.md) (F-n),
its measurements (§4, `measurements/before.json`) or a screenshot in `screenshots/before/`.*

**Severity.** **P0** member-blocking or actively misleading about the data · **P1** clearly degrades
the tab · **P2** polish or new capability.

**Lane** (how the fix ships — see [the backlog](#prioritised-backlog)).
**C** strictly corrective, flag-free on master, covered by tests ·
**R** registry unification, its own merge ·
**B** backend, dark behind its own flag ·
**V2** the new tab behind `VITE_BREADTH_CHARTS_V2_ENABLED` ·
**X** outside this program (collector asks or app chrome).

**Count:** 1 × P0 · 22 × P1 · 18 × P2.

---

## P0

### A-01 · A failed load reads as a quiet market — P0 · C
**Finding.** When the history call answers 401, 402 or 500 with a JSON body, the tab says **"No data in
selected range."** A member whose session expired, whose plan lapsed, or who hit a server error is told
the market produced nothing. Only an aborted request reaches the real error state — and that one says
"Tap to retry" on a desktop.
**Evidence.** `error-500__*`, `error-401__*`, `error-402__*` (all four widths), `error-network__1280`;
§4 Conditions; brief (d) corrected to `BreadthCharts.jsx:19`. House rule: *a failed load must never look
like a quiet market.*
**Fix.** Fetch through `utils/jsonFetcher.js` (it throws on non-OK and carries `status`), retire the
inline fetcher. Render three distinct states from `error.status`: 401 → "Your session has ended — sign in
to load breadth history"; 402 → "Data Charts is part of the UCT plan"; anything else → "Couldn't load
breadth history" with a **Retry** button (pointer-neutral copy). On a failed *re*fetch keep the last good
chart and show the error inline. Rail: a routed 401/402/500 each render their own sentence, and a genuine
empty range still renders "No data in selected range" (non-vacuity control).

---

## P1 — chart mechanics

### A-02 · Reference lines on two families are drawn on one axis — P1 · C
**Finding.** Volume Thrust's `flat` line (net 0) is drawn at ratio 0, the bottom of the plot, while Net
Advancers' zero is mid-chart. The single `__ref_lines__` series takes its axis from the first line.
**Evidence.** F-1; `preset-volume-thrust__1280`; census: the only preset with lines on two families.
**Fix.** Emit one marker series **per axis** (legacy) / per panel (V2). Rail over every preset: each drawn
line's axis equals the axis of the family it names.

### A-03 · Preset reference lines vanish on any hand edit — P1 · C
**Finding.** Parity/thrust, fear/greed and VIX 20 lines draw only while the selection exactly equals a
preset. Tick one more metric and the canonical lines disappear, although the metric they describe is still
on screen.
**Evidence.** Brief (b); `BreadthCharts.jsx:119-123, 211`.
**Fix.** Attach canonical lines to **metrics**, not presets: a registry field `refLines` on the metrics they
belong to (`ratio_5day`/`ratio_10day` parity 1.0 + thrust 2.0; `up_vol_ratio` parity 1.0; `cboe_putcall`/
`avg_10d_cpc` parity 1.0; `cnn_fear_greed` 25/75; `vix`/`vxn`/`avg_10d_*` 20; `adv_decline` 0). A line
draws whenever a metric that owns it is plotted. The constants are unchanged (decision of record: canonical
only). The preset `lines:` arrays are deleted — one authority.

### A-04 · A shared axis flattens small series silently; the guard is a stale test table — P1 · C → V2
**Finding.** Universe Count beside 52W Lows draws the lows as a line on the floor with no warning. The only
magnitude check is a *test* over presets using a hand-typed `MAX_ABS` table that has drifted: with today's
data **Breadth Thrust's ratio axis spans 23×** and over the full window runs 0–100 for one April 2025 spike.
**Evidence.** F-5; `magnitude-flatten__*`, `thrust-full-365__*`; `chartMetrics.test.js:327-347`.
**Fix.** Compute the spread at render from the **visible** data (max |v| per series in the window). Legacy
(C): when two series share an axis and differ by more than 6×, show a visible notice under the readout —
"52W Lows is 230× smaller than Universe Count on this axis" — and never flatten silently. V2: auto-split the
smaller series into its own panel (A-05). Replace the `MAX_ABS` test with a test of the runtime rule against
fixtures, so no hand-typed range table remains.

### A-05 · Dual-axis charts invent relationships — P1 · V2
**Finding.** 10 of 36 presets, and any hand-picked selection spanning two families, overlay two unrelated
scales: Volume Thrust's parity (ratio 1.0) sits exactly on Net Advancers −500 and the lines "cross" wherever
the axes happen to align. A third family is folded into the right axis (`VIX / ratio`).
**Evidence.** F-8; `preset-volume-thrust__1280`, `mixed-family__*`; dataviz anti-pattern #1.
**Fix.** See [Y axes — the recommendation](#y-axes--the-recommendation): stacked panels, one per unit
family, shared X, linked crosshair and zoom.

### A-06 · X-axis labels drop the year — P1 · C
**Finding.** Labels are `MM/DD`. Over the full window `03/31` appears twice, a year apart.
**Evidence.** Brief (c); `range-full-365__*`, `thrust-full-365__*`.
**Fix.** Tick format by visible span: ≤ 6 months `Jun 15`; 6 months–2 years `Jun '26`; > 2 years `2026`;
first tick of a new year always carries the year. Tooltip header `Fri Sep 11, 2026`. Pure function
`formatSessionTick(date, spanDays, isFirstOfYear)`, unit-tested per range.

### A-07 · Zoom is discarded by every change — P1 · C
**Finding.** Wheel-zoom, then tick a metric: the plot returns to the full range.
**Evidence.** F-4; `zoomed__1280` → `zoom-after-toggle__1280`.
**Fix.** Hold the zoom window in React state as **dates** (`zoomFrom`/`zoomTo`, captured from ECharts'
`datazoom` event) and write it back into the option's `dataZoom.startValue/endValue`. Reset only when the
range or the preset changes the date domain.

### A-08 · In market hours the chart rebuilds every minute — P1 · C
**Finding.** The live poll changes `rows` and `live.clock`, which rebuilds the option under `notMerge`: the
zoom resets, the line animation replays, and a series the member hid is redrawn while its readout chip still
says hidden.
**Evidence.** F-2 (CODE; the same rebuild path is CONFIRMED by A-07).
**Fix.** Drive legend selection from React state (`legend.selected` built from `hidden`) so a rebuild
re-applies it; zoom per A-07; `animationDurationUpdate: 0` for data-only changes. Rail: a re-rendered live row
with a hidden series keeps it hidden and keeps the zoom window.

### A-09 · The tab never refreshes its history — P1 · C
**Finding.** After the 4:15 PM collector writes the day, the provisional point disappears and nothing fetches
the collected row: a tab open across the close ends at yesterday.
**Evidence.** F-3.
**Fix.** Revalidate the history when `useLiveBreadth` transitions to superseded (the moment the collected row
exists), and on visibility return when the newest row is older than the last expected session. No polling
added (the live hook already polls). Rail: the transition triggers exactly one history request.

### A-10 · Stale, carried, reconstructed and not-yet-recorded data look identical to fresh data — P1 · C + V2
**Finding.** CBOE P/C last reported 2026-08-07 and the readout shows its last value today with no date. AAII/NAAIM are
weekly surveys drawn as if daily. Series that begin 2026-01-02 simply start mid-plot. 191 of 365 served rows
were reconstructed from bars and nothing says so.
**Evidence.** F-13; §1 coverage; measured coverage table.
**Fix (C).** Readout chip shows `as of Aug 7` when a series' latest value is older than the newest row by more
than its cadence allows (daily: 1 session; weekly: 7). **Fix (V2).** The coverage language in the design
phase: a start-of-data marker per series, a shaded "not recorded" region, a provenance strip for reconstructed
sessions, weekly series drawn as steps, and the same flags in the tooltip.

### A-11 · Seventeen years of history are stored and unreachable — P1 · B + V2
**Finding.** History reaches 2008-01-02; the tab asks for 365 rows (to 2025-03-31). Simply asking for more
through the existing route is unsafe: the route has no response model, so FastAPI encodes the response **on the
event loop** — measured locally at 38 ms for 365 rows, **438 ms for 3,650**, 534 ms for 4,700, before
`json.dumps`.
**Evidence.** F-15; §1 History.
**Fix.** See [Long history](#long-history--the-recommendation).

### A-12 · The percentile has no stated basis — P1 · C (+ P2 V2)
**Finding.** The readout says "8th" with nothing saying it is the 8th percentile of the 62 sessions on screen,
not of history.
**Evidence.** `default__*` readout; `MetricReadout.jsx`.
**Fix (C).** Accessible name and a visible hint: "8th pct of 62 sessions shown". **(V2)** A basis toggle:
*shown* (default) / *all history since 2008*, computed server-side (see below).

---

## P1 — visual & aesthetic

### A-13 · The series palette is not distinguishable, and colours follow rank — P1 · V2
**Finding.** Validated with the `dataviz` validator (OKLab ΔE×100, Machado 2009):
amber `#f59e0b` ↔ orange `#fb923c` **ΔE 4.2 under normal vision**; two blues `#60a5fa` ↔ `#38bdf8` **6.7**; two
bull greens **5.2**; sky ↔ violet 5.2 deutan; bull ↔ bear 6.5 deutan with no secondary encoding; every hue
outside the dark lightness band. Colours are assigned by selection order, so **removing VIX repaints VXN from
amber to blue** (verified). Slot 2 amber sits beside the brand gold accent.
**Evidence.** F-10; `mixed-family__390` (two oranges, two blues); node check of `resolveColors`.
**Fix.** A validated eight-slot categorical order per surface (OLED `#0a0a0a`, dark `#17181b`, light
`#f4f5f6`), exposed as tokens; bull/bear tones for opposed pairs taken from the Views palette the member picks
(classic · colorblind · mono · ocean) and validated as pairs; colours **sticky per metric** for the session
(a removed series frees its slot, survivors keep theirs); a legend always, direct end-labels for ≤ 4 series as
secondary encoding; gold never used as a series colour. Series cap: 8.

### A-14 · The chart ignores the design tokens — light theme broken, labels under contrast — P1 · V2
**Finding.** All chrome colours are hard-coded from an older olive palette. On the light theme gridlines become
14.2:1 black rules and FTD/LIVE labels 2.5/2.1:1. On dark/OLED, axis labels are **3.34/3.73:1** (11 px text needs
4.5:1) and the tooltip date is **2.93:1**.
**Evidence.** F-11; `theme-light__1280`; contrast table.
**Fix.** Read chrome colours from CSS tokens at render (`getComputedStyle` on the chart root, re-read on theme
change): gridline = one step off `--bg-surface`, axis text = `--text-muted`, tooltip = `--bg-elevated` +
`--text`. Canvas cannot resolve `var()`, so values are resolved once per theme and passed as literals.

### A-15 · Nothing states what is plotted, over what, or how fresh — P1 · C + V2
**Finding.** Within two seconds a member cannot tell the range in words, the axis each series is on, or whether
the last point is today's close, yesterday's, or provisional. The only range statement, **"62 days"**, counts
sessions; "365 days" labels 17½ months.
**Evidence.** F-6; `default__1280`, `thrust-full-365__1280`.
**Fix (C).** "62 sessions". **(V2)** A header line above the plot: *preset name or "Custom" · Jun 15 – Sep 11,
2026 · 62 sessions · as of Fri Sep 11 close* (or `LIVE 2:47 PM ET · provisional`), and a visible warning when
the collector has not written the last expected session.

### A-16 · A fixed 680 px chart that hides its own dates — P1 · V2
**Finding.** At 1280×800 the plot shows 530 px before scrolling and the dates and zoom slider are below the fold;
at 390 the member sees **241 px** of plot; with one group open at 390 the plot is entirely off-screen.
**Evidence.** F-17; §4 Geometry.
**Fix.** Chart height from the viewport: fill what the controls leave, min 320 px (phone) / 420 px (desktop),
panels share it (min 140 px each); the x-axis band is always inside the first screen at every tested width.

### A-17 · Layout jumps after every edit — P1 · V2
**Finding.** Opening a group or adding a series that wraps the readout pushes the plot down (**0.22** at 390 for
one checkbox). CLS reports 0 because the shift follows input. The loading box is 120 px and the chart 680 px, so
the first paint jumps too.
**Evidence.** §4 Per interaction, Conditions; `loading__*`.
**Fix.** Controls that open as popovers/sheets over the page, not inline; the readout strip keeps a reserved
height and scrolls horizontally rather than wrapping; the loading state is a frame at the chart's final size;
refetch holds the previous render at reduced opacity.

---

## P1 — navigation & controls

### A-18 · The phone layout spends the screen on controls — P1 · V2
**Finding.** 455 px of controls before the plot; three rows of group buttons; two date rows; the preset row scrolls
horizontally with no affordance and **More** covers "Participation"; the voice orb sits on the zoom slider.
**Evidence.** `default__390`, `more-popover__390__viewport`, `picker-expanded__390`; F-18.
**Fix.** One compact toolbar row — **Preset ▾ · Metrics ▾ · range pills (scroll, with edge fade) · ⋯** — whose
menus open as the app's `Sheet` bottom sheets on touch; the plot starts within the first 180 px at 390. (The orb is
app chrome — X, reported.)

### A-19 · Tablet gets desktop-sized touch targets — P1 · C
**Finding.** The tab enlarges controls only at `max-width: 640px`; the app's touch tier is `≤1024px`. At 768,
14 of 22 controls are under 44 px (group buttons 28, date inputs 30, FTD checkbox 13, readout chips 19).
**Evidence.** §4 Geometry; CLAUDE.md *Breakpoints* and *Tap targets* (`--tap-min`).
**Fix.** Move the rules to the canonical TOUCH query `@media (max-width: 1024px)` and use `var(--tap-min)`.
Rail: stylesheet test that the tab's tap-floor rules sit under the TOUCH query (jsdom applies no CSS, so the
rail reads the stylesheet, as `chartWrapLayout.test.js` does).

### A-20 · The range is a pair of date inputs that forget — P1 · V2
**Finding.** No quick ranges, native pickers only, reset to 90 days on every visit.
**Evidence.** Brief (f); §2 clickable map.
**Fix.** Range pills **90D · 6M · 1Y · 2Y · 5Y · Max** + **Custom** (the two date inputs, behind the pill);
persisted with the selection; A/D Line's widen-only rule kept (it widens to 1Y).

### A-21 · Nothing is shareable — P1 · V2
**Finding.** The tab is not addressable and its state is not in the URL, so a chart cannot be posted in Discord.
**Evidence.** Brief (k); `Breadth.jsx:562-566`.
**Fix.** `?tab=charts` (Breadth reads it once, like `?view=`) plus the chart's own params — see
[URL state](#url-state). A **Share** button copies the link; **Reset** returns to defaults. Writes are
`replace` (the decision the Views tab already made and argued).

### A-22 · Notable Extremes appears in six groups and works in one — P1 · C
**Finding.** A gold toggle sits in every expanded group; only MA Breadth's draws anything.
**Evidence.** Brief (a); `picker-expanded__*`.
**Fix (C).** Render it only in MA Breadth. **(V2)** One "MA breadth extremes" switch in the chart's toolbar,
visible only while an MA-breadth series is plotted.

---

## P1 — accessibility

### A-23 · The chart cannot be used without a pointer — P1 · V2
**Finding.** No accessible name or description, no keyboard path to zoom, pan or read a value, and no table view.
**Evidence.** F-20.
**Fix.** The plot region is focusable with a generated description ("Market Health: Health Score <value>, % Above
50SMA <value>, Jun 15 – Sep 11, 2026"); ←/→ step the crosshair one session (the tooltip shows the same content as
hover), Home/End jump, +/− zoom; a **Table** toggle renders the visible sessions as a table (virtualized).

---

## P2

| ID | Finding | Evidence | Fix | Lane |
|---|---|---|---|---|
| A-24 | ARIA that promises behaviour it lacks: More is `listbox` of `option` *buttons* with no arrow keys; group toggles lack `aria-expanded`; Notable Extremes lacks `aria-pressed` | F-20 | C: correct roles/attributes (a menu of buttons, `aria-expanded`, `aria-pressed`); V2: arrow navigation in pill groups, Escape closes | C, V2 |
| A-25 | Tooltip: raw ISO date, no units, no thousands separators (`7657.23`), no percentile, label before value | `tooltip__*` | Values lead; unit and thousands separators from the registry formatter; percentile; `Fri Sep 11, 2026` | V2 |
| A-26 | 36 presets, all-or-nothing active state, 29 in a list with no search, hints only in `title` (invisible on touch) | `more-popover__*` | Search in the preset sheet; nearest preset shown as "Market Health +1"; hints visible in the sheet; order stays editorial (no usage telemetry exists to rank by) | V2 |
| A-27 | 56 checkboxes behind six toggles; no search; coverage limits discovered only after plotting | `picker-expanded__*` | One Metrics sheet with search, grouped list, and inline badges (`since Jan 2026`, `weekly`, `last Aug 7`) | V2 |
| A-28 | Every metric is a smoothed line: signed daily net drawn as a line; weekly surveys drawn as daily; sparse spike counts (`hvc_52w`: 26 distinct values) as a line | coverage table | Registry `mark`: bars for `adv_decline` and `hvc_52w`, steps for AAII/NAAIM and distribution days, lines elsewhere | V2 |
| A-29 | No drill-through, though the Monitor already has names behind 22 of these metrics | `Breadth.jsx` drillKeys | Click a session → the existing `BreadthDrillModal` via `drillTarget`; unavailable (with reason) on reconstructed sessions, which store no lists | V2 |
| A-30 | No export | — | PNG (chart + title band with selection, range, as-of, UCT mark) and CSV of the visible series | V2 |
| A-31 | No log scale | — | Per panel for count/index/cum families; disabled with a reason when the window has a value ≤ 0 | V2 |
| A-32 | `market_phase` stored on 138 sessions and unused | §1 | Optional regime shading behind the plot | V2 |
| A-33 | Useful collected fields not offered | §1 | See [Unoffered fields](#unoffered-fields) | V2, X |
| A-34 | Three metric registries; 15 label mismatches between chart and heatmap; chart drops "(MA Stack)" from Stage 2/4 | F-12, F-19 | C: restore the qualifier; R: unify (below) | C, R |
| A-35 | Default range computed in UTC and frozen at mount | F-7 | ET session dates; recompute "today" when the tab regains visibility | C |
| A-36 | Every rebuild replays the 1 s line animation | A-08 | Animate on first paint only; updates are instant | V2 |
| A-37 | No tabular numerals in readout/tooltip values | CSS grep | `font-variant-numeric: tabular-nums` on value columns (not on standalone figures) | V2 |
| A-38 | "Tap to retry" copy on desktop; the error box is not the chart's size | `error-network__1280` | Folded into A-01 | C |
| A-39 | FTD markers cannot exist before 2026 (reconstructed rows lack `qqq_close`) and nothing says so | F-14 | Disclose on the FTD toggle when the range crosses 2026-01-02; collector ask | V2, X |
| A-40 | One preference write per interaction | F-16 | Coalesce selection + range + options into one debounced write | V2 |
| A-41 | First-visit "Meet Compass" coach mark and the orb FAB cover the plot | F-18 | Reported to app chrome; not changed here | X |

---

## Y axes — the recommendation

Three paths were evaluated:

1. **Hard cap of two families** with a message on the third. Removes a capability members use today
   (Breadth Thrust, Volatility & Fear) and keeps the dual-axis problem for the two that remain. Rejected.
2. **Stacked panels** — one panel per unit family, shared X, linked crosshair and zoom. Every series keeps its
   real unit, reference lines stay meaningful (VIX 20 is on a VIX axis, 5/10/15/20 on a percentage axis), and
   no two scales are ever aligned by accident. ECharts renders this natively (multiple `grid`s in one instance,
   `axisPointer.link` over the x-axes, one `dataZoom` driving all of them).
3. **Normalisation** (rebased = 100 at the window start / % change / z-score) collapsing to one axis. Genuinely
   useful for comparing shapes — but it discards the levels members actually trade on (70 % participation, a
   2.0 thrust, VIX 20), and reference lines stop meaning anything.

**Recommendation: (2) stacked panels as the primary path; (3) as an explicit follow-up** ("Scale: Actual ·
Rebased · Z-score"). Rules for (2):
- one panel per family present, **max 4 panels**; a fifth family is refused with a sentence naming the families;
- **magnitude split** inside a family: when two series on one panel differ by more than 6× on the visible data,
  the smaller moves to its own panel labelled with its family, and the header notes why ("split for scale");
  if that would exceed 4 panels, show the Rebased suggestion instead — never flatten silently;
- panel order follows the selection's first appearance of each family; heights share the chart height, primary
  panel 1.5× when there are 3+ panels;
- one legend/readout for the whole stack; direct end-labels per panel for ≤ 4 series.

## Long history — the recommendation

Measured constraints: the existing route JSON-encodes on the event loop (438 ms at 3,650 rows); a row is ~96 keys
(460 KB decoded for 365 rows) when a chart needs 2–8 of them; `get_history_deep` already caches per window.

Evaluated:
- **Bounded `days=` on the existing route + client decimation.** Fewest moving parts, but every long request
  blocks the loop for hundreds of milliseconds and ships ~7 MB for Max. Rejected.
- **Server-side resampling (daily → weekly/monthly).** Smaller payloads, but resampling counts and spikes needs a
  per-metric rule (last? max? mean?) and a thrust day disappears into a weekly mean — a quiet misstatement.
  Deferred; only if the projected payload proves too large.
- **A projected, pre-encoded series endpoint + client LTTB decimation. Chosen.**
  `GET /api/breadth-monitor/series?keys=a,b,c&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - ≤ 8 keys, validated against the registry; span bounded by stored history;
  - sync route (threadpool) returning a `Response` whose bytes are encoded **inside the handler**, so nothing
    heavy touches the event loop;
  - columnar: `dates[]`, `series{key: values[]}`, `reconstructed[]`, per-key coverage (`first`, `last`, `n`),
    per-key full-history percentile of the latest value, `collector_floor`, `min_date`, `max_date`;
  - cached by `(keys, from, to)` for 5 minutes under the prefix every collector write already invalidates;
  - Max = ~4,700 sessions × ≤ 8 keys ≈ 38k numbers (~250 KB raw);
  - client: ECharts `sampling: 'lttb'` so a 4,700-point line draws at pixel density without dropping extremes;
  - dark behind `BREADTH_SERIES_ENDPOINT_ENABLED` (backend) and consumed only by V2;
  - target: 5Y and Max first ink **< 1 s warm**, measured in Phase 4.
- **Era comparability.** When the window's `universe_count` changes by more than 20 % end to end, count panels
  show "Counts depend on the measured universe (1,521 → 2,648 names); % versions compare across years" with a
  one-tap swap to the ratio metric where one exists (`hi_ratio`, `lo_ratio`).

## Registry unification — is it a thin adapter?

**Yes, with one addition to the canonical schema.** `chartMetrics.js` becomes canonical and gains, per metric:
`short` (the heatmap/Views label, byte-identical to today's), `drillKey`, `refLines`, `mark`, `cadence`
(`daily`/`weekly`), and `chartable` (false for `is_ftd`, `spy_ma_stack`, `qqq_ma_stack`). The 9 heatmap-only keys
join the catalog (advancing/declining/up_on_volume/down_on_volume become chartable; `up_from_open`/`down_from_open`
are chartable but empty and stay unoffered). `heatmapMetrics.js` then builds `HM_METRICS` from the canonical
registry plus its own per-key `getTier`/`getFmt`, headers and order — behaviour layered on top, nothing
duplicated. The acceptance test is that `HM_METRICS` serialises **byte-identically** before and after (labels,
order, drill keys, polarity, pairs), so Views, the `/charts` widget and every existing test are untouched. Ships as
its own merge. The Monitor's `COLS` in `Breadth.jsx` is a third registry, outside this program's scope — recorded
as a follow-up.

## Unoffered fields

| Field | Decision | Why |
|---|---|---|
| `advancing`, `declining` | **Offer** (count; since 2026-03-16) | The raw sides behind Net Advancers; the Views tab already computes the Zweig thrust from them (`breadth/views/breadthEvents.js:29, 161`) |
| `vix_term_structure` | **Offer** (ratio; canonical 1.0 line) | Backwardation above 1.0 is a standard stress read |
| `spy_dist_days`, `qqq_dist_days` | **Offer** (count, step; since 2026-02-20) | A standard regime read (the voice regime classifier already weighs distribution days, `api/services/voice_regime_classifier.py:161-167`) and a natural companion to the FTD markers |
| `market_phase` | **Offer as shading**, not a series | Categorical text; belongs behind the plot |
| `up_on_volume`, `down_on_volume` | Defer | 2 sessions stored — a line of two points misleads; revisit at ≥ 20 |
| `spy_close`, `rsp_close`, `iwm_close` | Defer | Redundant with S&P/QQQ and the RSP/SPY, IWM/QQQ ratios already offered |
| `vxmt` | Defer | Carried by `vix_term_structure` |
| `up_from_open`, `down_from_open` | Do not offer | Empty in all 365 rows — collector ask |
| `naaim_date`, `aaii_survey_date` | Use, not offer | They date the weekly surveys' staleness badges |

## URL state

`/breadth?tab=charts&m=breadth_score,pct_above_50sma&r=6M` (`r` ∈ 90D·6M·1Y·2Y·5Y·MAX, or `from`/`to` for
custom) `&ftd=1&ext=1&pal=classic&pc=all` (percentile basis). Every param is untrusted and falls back to today's
behaviour exactly (the Views tab's `breadthUrlState.js` pattern); unknown metric keys are dropped, not fatal.
Writes are debounced `replace`s through the existing `mergeParams`; Breadth reads `?tab=` once on mount. Saved
preferences apply only when the link carries no chart params.

## Other evaluations

- **Percentile default:** *shown window*, because it describes the plot the member is looking at; *all history*
  is one tap away and labelled with its span ("of 4,700 sessions since 2008").
- **Custom presets:** **still not in this program** (the August decision holds, now argued): share links cover
  "send this chart to someone", the persisted last selection covers "come back to it", and named presets would add
  a management surface and a second preset authority for a need no member has asked for. Recorded as a follow-up.
- **Freshness:** "as of" always visible; if the newest row is older than the last completed session (after
  4:30 PM ET on a weekday), the header says the collector has not written that session yet.

---

## Prioritised backlog

Ordered by member impact, grouped into the merges that will carry them.

| # | Merge | Contents | Lane |
|---|---|---|---|
| 1 | **C1 — honest states** | A-01 (+A-38), A-09, A-10 (stale "as of"), A-12 (basis label), A-15 ("sessions"), A-35, A-34 (Stage 2 qualifier) | C |
| 2 | **C2 — chart mechanics** | A-02, A-03, A-06, A-07, A-08, A-22, A-04 (visible flatten notice), runtime magnitude rule replacing `MAX_ABS` | C |
| 3 | **C3 — touch & ARIA** | A-19, A-24 (attributes) | C |
| 4 | **R1 — one registry** | canonical `chartMetrics.js`, `heatmapMetrics.js` as adapter, byte-identical `HM_METRICS` | R |
| 5 | **B1 — series endpoint (dark)** | projected, pre-encoded, cached `/series` | B |
| 6 | **V2-1 — foundation** | flag, lazy V2 tab, `?tab=charts`, URL state, range pills, persistence, tokens + validated palette, responsive height, header/freshness | V2 |
| 7 | **V2-2 — stacked panels** | A-05, magnitude split, metric-attached lines per panel, log scale, sticky colours, end labels | V2 |
| 8 | **V2-3 — honest coverage + long history** | A-10 coverage language, A-11 via B1, LTTB, era note, A-28 marks, A-39 | V2 |
| 9 | **V2-4 — controls** | preset sheet with search and partial match, metrics sheet with badges, compact phone toolbar, A-17, A-18, A-20, A-26, A-27 | V2 |
| 10 | **V2-5 — reading & sharing** | tooltip (A-25), keyboard + table view (A-23), drill-through (A-29), export (A-30), shading (A-32), unoffered fields (A-33), percentile basis toggle | V2 |

## North star

A member follows a link from Discord and lands on the chart it describes — same metrics, same range, already
drawn. In the first two seconds the header tells them what they are looking at, over which dates, and whether the
last point is Friday's close or a provisional 2:47 PM read. Each measure sits in its own panel on its own real scale,
so nothing is flattened and nothing crosses by accident; the canonical lines — parity, thrust, VIX 20, the MA washout
ladder — appear wherever the metric they belong to is plotted. The colours can be told apart by anyone and stay put
when a series is removed. The range reaches back to 2008 in under a second, and where the record is thin the chart
says so in place: where a series begins, which sessions were reconstructed, which survey is a week old. Hovering, tapping
or pressing an arrow key reads every value with its unit and percentile; a click on a count opens the names behind it.
On a phone the plot fills the screen and the controls live in one row. And when something fails, the chart says
exactly what failed — never that the market was quiet.
