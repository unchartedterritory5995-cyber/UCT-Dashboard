# Phase 0 — Discovery: Breadth → Data Charts

*No code changes. Code read at master `f4fc5d1c1` (the worktree's base). Production read
2026-09-13 through the member-smoke account. Line numbers are from that SHA.*

Contents:
1. [Ground truth — verified, corrected, and extended](#1-ground-truth)
2. [Every member-clickable element](#2-clickable-map)
3. [The ECharts option builder, end to end](#3-option-builder)
4. [Measurements](#4-measurements) — rig output
5. [Screenshots](#5-screenshots)
6. [New findings beyond the brief](#6-new-findings)
7. [Post-C3 member pass at 768 and 390](#7-post-c3-member-pass-at-768-and-390-2026-09-13-master-a9290e7f4) — after the corrective merges

The instrument is `tools/breadth_charts_rig.py` (committed with this doc; `--self-check`
proves its verdicts can fail). Raw numbers: `docs/breadth/measurements/before.json`.

⛔ **This repository is public; breadth history is paid data.** The screenshots and the measurement
JSON this doc cites live on the operator's disk under `docs/breadth/screenshots/` and
`docs/breadth/measurements/`, which `docs/breadth/.gitignore` keeps out of git. This doc describes
what they show without reproducing the data (D-018).

---

## 1. Ground truth

Each line of the brief's "ground truth" checked against source and a fresh production
read. ✅ = confirmed as written · ⚠️ = true but incomplete/imprecise (correction given) ·
❌ = wrong.

### Stack

| Claim | Verdict | Evidence |
|---|---|---|
| React (Vite, CSS modules), SWR, ECharts via echarts-for-react | ✅ | `app/package.json`: react 19.2, echarts **6.0.0**, echarts-for-react **3.0.6** (resize via `size-sensor` on the container, `autoResize` default on), swr 2.4, vite 7.3, vitest 4.0 |
| Not Lightweight Charts | ✅ | `BreadthCharts.jsx:4` imports `echarts-for-react`; no `lightweight-charts` import in the tab |
| FastAPI + SQLite, single web process | ✅ | one uvicorn process on `web`; the history route is a sync `def` (runs on the anyio threadpool), but its response is JSON-encoded on the event loop — see §6 F-12 |

### Presets, metrics, groups

| Claim | Verdict | Evidence |
|---|---|---|
| 36 presets | ✅ | `chartMetrics.js:316-625` |
| 7 pills + 29 in More across 7 sections | ✅ | pills = presets with no `group` (`PresetRow.jsx:26`): Market Health, Breadth vs Price, Participation, Breadth Thrust, Volatility & Fear, A/D Line, Highs/Lows %. More sections (`PRESET_GROUP_ORDER`, `:311`): Structure 6 · MA Breadth 3 · Primary Breadth 3 · Momentum 6 · Leadership 4 · Highs / Lows 2 · Volatility & Sentiment 5 |
| ~56 metrics in six picker groups | ✅ exactly **56** | `CHART_GROUPS`, `:12-105`: Score 2 · Primary Breadth 18 · MA Breadth 7 · Regime 11 · Highs / Lows 10 · Sentiment 8 |
| Active only on an exact match | ✅ | `matchPreset` compares sorted key sets (`:630-634`) |

### Axes

| Claim | Verdict | Evidence |
|---|---|---|
| Nine unit families | ✅ | `UNIT`, `:114-124` |
| Max two y-axes; left = most series, tie → first metric | ✅ | `resolveAxes`, `:649-679` |
| Right = every other family combined | ✅ | `rightUnits` is every non-left family; its axis title joins them (`BreadthCharts.jsx:391`) |
| index/vix/osc/cum/spread frame to data; pct/count/ratio/net anchor at 0 | ✅ | `SCALED_UNITS`, `:223-225`, applied as ECharts `scale` |
| Right axis frames only when it holds one family | ✅ | `BreadthCharts.jsx:395` |
| *(not in brief)* | ➕ | When Notable Extremes is on and a pct series is plotted, that axis is forced to span at least 0–100 (`EXTREMES_BAND`, `:30-33`) so the 90 line draws |

### Reference lines

| Claim | Verdict | Evidence |
|---|---|---|
| Canonical constants declared per preset | ✅ | `lines:` on 7 presets (thrust, volatility, sentiment, ad-line, volume-thrust, vol-complex) |
| Draw ONLY while the selection exactly matches the preset | ✅ | `activePresetDef` comes from `matchPreset` (`BreadthCharts.jsx:119-123`, `:211`) |
| *(not in brief)* | ⚠️ | The MA-breadth extremes (5/10/15/20, 70/80/90) are a **different mechanism**: toggle-driven, persisted, and they survive hand edits — so the two kinds of reference line behave oppositely under the same member action |
| *(not in brief)* | ❌ **defect** | A preset whose lines sit on **two** families draws them all on the first line's axis — see §6 F-1 |
| *(not in brief)* | ⚠️ | On framed families a line outside the visible data is suppressed (`resolveLines`, `:701-714`). The A/D Line preset's `flat` line at 0 therefore **never draws**: the stored cumulative A/D line now sits hundreds of thousands above zero because its running total starts in 2008 |

### History and the fetch

| Claim | Verdict | Evidence |
|---|---|---|
| Stored history reaches 2008-01-02 | ✅ | production `min_date` = `2008-01-02` |
| 191 of the last 365 rows carry `_reconstructed` | ✅ | measured 2026-09-13 |
| Tab requests `days=365` once and filters client-side | ✅ | `BreadthCharts.jsx:53`, filter `:106-112` |
| Nothing before ~2025-03-31 reachable | ✅ | the 365-row window's oldest row is `2025-03-31` |
| API accepts `days` 1–8000 | ✅ — ⚠️ router docstring is stale | the signature says `le=8000` (`api/routers/breadth_monitor.py:464`); the module docstring still says `le=3650` |
| Supports `end=`/`anchor=` | ✅ | `:464-466`; `get_history_deep` resolves the anchor over the merged date list |
| 365 rows ≈ 130 ms | ✅ warm | 127 ms measured on a warm cache; `get_history_deep` caches 5 min per `(days, end, anchor)` |
| Long history must be bounded/cached | ✅ and sharper than stated | see §6 F-12: the per-row derivation runs on the threadpool, but FastAPI's `jsonable_encoder` over the returned rows runs **on the event loop** |

### Coverage gaps (production, 2026-09-13)

All ✅ as written, with these additions:

- **Follow-through days before 2026 are not merely unflagged — they cannot exist.** The
  FTD rule (`api/services/breadth_monitor.py:502-524`) needs `qqq_day_pct`, which is derived
  from `qqq_close`, which reconstructed rows do not carry. So `is_ftd` is structurally
  `False` on every pre-2026 row, including the April 2025 bottom. The brief's "verify" is
  resolved: this is a collector/backfill gap, not a bug in the flag.
- `naaim`'s last stored value is carried through 2026-09-11 (358 rows, 73 distinct) — weekly
  and carried. Its own `naaim_date` field exists in every row but is not surfaced.
- `up_from_open` / `down_from_open` exist in the row schema and are **empty in all 365 rows**.

### Live row

✅ Appended, dotted tip, `LIVE h:mm` marker, withdrawn when the collector writes the day
(`BreadthCharts.jsx:106-112`, `:262-294`; `useLiveBreadth.js`). Production on Sunday
2026-09-13: `/api/breadth-monitor/live` → `ok: true, superseded: true, market_open: false`,
so the live state is not capturable today (see §5).

### Collected but not offered

✅ Twelve as listed. Precisions: `iwm_close` is also present (since 2026-01-02, n=172);
`spy_dist_days`/`qqq_dist_days` since 2026-02-20 (n=69); `market_phase` text on 138 rows
(values seen: Rally Attempt · Uptrend · Recovery · Distribution); `up_on_volume` /
`down_on_volume` 2 rows (since 2026-08-31). Also present and unoffered:
`spy_above_{10,20,50,200}sma` / `qqq_above_*` (0/1 flags), `spy_day_pct` / `qqq_day_pct`.

### Known defects (a)–(k)

| # | Verdict | Precision |
|---|---|---|
| (a) Notable Extremes shown in 6 groups, works in MA Breadth only | ✅ | `BreadthCharts.jsx:452-459` renders it in every expanded group; only `notableExtremes['MA Breadth']` is read (`:300`). CLAUDE.md records the other five as "no-op placeholders pending readings" since 2026-03-21 |
| (b) Preset reference lines vanish on any add/remove | ✅ | see above |
| (c) X labels MM/DD, no year | ✅ | `:372` `v.slice(5).replace('-', '/')` |
| (d) inline fetcher **in Breadth.jsx** parses error bodies as data | ⚠️ **wrong file** | The tab's own fetcher is **`BreadthCharts.jsx:19`** — a separate copy of the same line in `Breadth.jsx:50` serves the Monitor/Views. Behaviour by failure kind (confirmed in §4): a JSON error body (401/402/500 from our API) resolves as `data = {detail}` → `rows = []` → "No data in selected range." A **non-JSON** body (e.g. Cloudflare's HTML 502) makes `r.json()` reject → SWR `error` → the ErrorState. A network failure → ErrorState |
| (e) ~6× guard runs only for presets | ⚠️ | It is not a runtime guard at all: it is a **test** over the preset definitions (`chartMetrics.test.js`). At runtime nothing checks magnitude, presets included |
| (f) Range resets to 90 days | ✅ | `useState(() => offsetDate(-90))`, `:58`, never persisted |
| (g) Tooltip: no units or percentile | ✅ | also no thousands separators: non-integers print `toFixed(2)`, so S&P reads `7657.23` |
| (h) 680 px on phones | ✅ | and on every other width (`:533`); the readout strip sits above it, so the panel is taller still |
| (i) Hard-coded hex, not the palette system | ✅ — ⚠️ **four** palettes | Views has `classic` · `colorblind` · `mono` · `ocean` (`breadth/views/breadthViewShared.js:129-150`), not three. The chart chrome is hard-coded too (`#706b5e`, `#2e3127`, tooltip `#22251e`) — an older olive palette that matches no current token, and it ignores the app's **light** theme entirely (`tokens.css` defines `[data-theme="light"]`) |
| (j) Percentile window-relative only | ✅ | it also includes the provisional live row, and on weekly-carried series (AAII, NAAIM) repeated values skew it |
| (k) No URL / share / export / drill / normalise / log / multi-panel / shading / custom presets | ✅ | and the tab itself has no URL: `?view=`/`?compare=` force the **Views** tab (`Breadth.jsx:562-566`) and there is no `?tab=` |

---

## 2. Clickable map

Every element a member can operate inside the tab, where its state lives, and whether it
survives. "Nav" = leaving `/breadth` in-app and returning (the tab unmounts, and `/breadth`
re-lands on Monitor or Daily). "Reload" = a document load.

| Element | Count | Does | State lives in | Survives nav | Survives reload | In URL |
|---|---|---|---|---|---|---|
| Breadth sub-tab **Data Charts** | 1 | `setActiveTab('charts')` | `Breadth.jsx` `useState` | ❌ | ❌ | ❌ |
| Preset pill | 7 | `applyPreset` — replace selection, replace extremes, widen `From` for A/D Line | selection + extremes → server pref `breadth_charts_state` (600 ms debounce); widening → local | selection ✅ · range ❌ | selection ✅ · range ❌ | ❌ |
| **More** | 1 | opens the grouped popover; Escape / outside click closes | local | ❌ | ❌ | ❌ |
| More option | 29 | `applyPreset` | as pills | as pills | as pills | ❌ |
| Group toggle (Score … Sentiment) | 6 | expand / collapse its checklist | local `expanded` | ❌ | ❌ | ❌ |
| ⚡ Notable Extremes | 1 per open group | toggles `extremes[group]` | pref | ✅ | ✅ | ❌ |
| Metric checkbox | 56 | `toggleMetric` | pref | ✅ | ✅ | ❌ |
| From / To date | 2 | filter rows client-side | local | ❌ | ❌ (→ 90 days) | ❌ |
| Follow-through days | 1 | toggles FTD markers | pref `ftd` | ✅ | ✅ | ❌ |
| Readout chip | 1 per series | hide / show that line (`legendToggleSelect`) | local `hidden` + ECharts legend | ❌ | ❌ | ❌ |
| Chart wheel / drag | — | zoom / pan (`dataZoom` inside) | ECharts internal | ❌ | ❌ | ❌ |
| Zoom slider | 1 | zoom / pan | ECharts internal | ❌ | ❌ | ❌ |
| Chart hover / tap | — | axis tooltip + crosshair | ECharts internal | — | — | — |
| ErrorState **Retry** | 0–1 | `mutate()` | — | — | — | — |

Keyboard: every button and checkbox is reachable by Tab. The **chart has no keyboard path**
(no zoom, pan or tooltip without a pointer). The More popover is `role="listbox"` holding
`role="option"` **buttons** — arrow keys do nothing, Tab walks every option — so the ARIA role
promises a behaviour the control does not have. Group toggles expose no `aria-expanded`;
Notable Extremes exposes no `aria-pressed`.

Persistence detail: every selection change POSTs the whole `breadth_charts_state` blob
(`{selected, extremes, ftd}`) after 600 ms. A plain load never writes
(`BreadthCharts.jsx:91-100`, pinned by `BreadthCharts.test.jsx` "does not write back on a
plain load").

---

## 3. Option builder

`BreadthCharts.jsx:176-417`, one `useMemo` keyed on
`[selected, rows, notableExtremes, liveIndex, live.clock, activePresetDef, showFtd]`, handed to
`<ReactECharts notMerge lazyUpdate style={{height: 680}}>`.

**X domain.** `xAxis.type: 'category'`, `boundaryGap: false`. The categories are the dates of
the filtered rows, so the domain is exactly the sessions present — weekends and holidays take
no space (the right choice for session data). The domain is the whole filtered range; the
`dataZoom` pair then windows it. Labels: `MM/DD` (year discarded). Interval: ECharts auto.

**Y domains.** Two value axes, always both declared; the right one `show: hasRight`. Left:
`scale: scaleForUnit(leftUnit)`, plus `EXTREMES_BAND` min/max functions when the MA extremes
land on it. Right: `scale` only when it holds a single family. No explicit padding — ECharts'
nice-number rounding decides the bounds. No log scale.

**Ticks and gridlines.** Left axis labels `#706b5e` 11 px, split lines `#22251e`; right axis
has no split lines. Axis names are the unit label (`%`, `stocks`, `ratio`…) at 10 px, a join
(`VIX / ratio`) when the right axis mixes families.

**Series.** One `type: 'line'` per selected metric: `smooth: 0.35`, width 2, no symbols except
a 7 px circle on the live index, `connectNulls: false`, colour from `resolveColors`. Data is
`[date, value ?? null]` per row.

**Markers.** Four synthetic empty series carry `markLine`s: `__ref_lines__` (preset lines,
one series, one axis — §6 F-1), `__ftd__` (dotted violet verticals, labelled once per cluster),
`__live_now__` (dashed gold vertical, `LIVE h:mm`), `__ma_extremes__` (seven dashed levels on
the pct axis). All `silent`, `animation: false`.

**Tooltip.** `trigger: 'axis'`, cross pointer, custom HTML formatter: date header (the raw
`YYYY-MM-DD`), then `name: value` per non-null series, integers raw, others `toFixed(2)`.
No units, no percentile, no staleness.

**Legend.** Present but `show: false`; the readout strip drives it through
`legendToggleSelect`.

**dataZoom.** `inside` (wheel zoom, drag pan) + a 22 px `slider` at the bottom; default
start/end (the whole range).

**Grid.** `left 64 · right 64 when a right axis exists, else 24 · top 24 · bottom 56`.

**Resize.** echarts-for-react's `size-sensor` observes the container and calls `resize()`; the
chart height itself never changes (inline 680).

**What re-renders on each interaction.** Because the option is rebuilt and handed over with
`notMerge`, **every** change to any dependency rebuilds the chart from scratch: the series
animation replays, the zoom window resets to the full range, and the ECharts legend selection
resets to all-visible. Selection changes clear `hidden` to match (`:129-153`); a change of
`rows` or `live.clock` does **not** — see §6 F-2. Commit counts per interaction are in §4.

---

## 4. Measurements

Member-smoke session (`role: member`), production `uctintelligence.com`, 2026-09-13 (Sunday, market
closed). Every run holds its own deploy-swap verdict; the raw files are in
`docs/breadth/measurements/`.

⛔ **The first full run straddled another session's deploy** (pod uptime went backwards, 297 s →
211 s) and its 768 segment showed a 17 s first paint — the deploy, not the product. That segment,
and the light-theme capture (a fixed-wait instrument bug, fixed), were re-run on their own with
no swap and spliced in. `before.json` is that composite and says so in its `composite` block;
`before-original-run.json` is kept untouched.

### Page load and tab switch

The tab has no URL, so a member pays two costs that must not be added together: loading `/breadth`
(which plays the ~9 s intro and lands on Monitor or Daily) and switching to Data Charts.

| Width | `/breadth` → tabs usable (ms, incl. intro) | `/api/*` during page load | Tab switch `/api/*` | Data call (status · decoded KB · server ms) | Canvas attached (ms) | First chart ink (ms) | React commits | CLS | Shift after input |
|---|---|---|---|---|---|---|---|---|---|
| 390 | 10,546 | 36 | 2 (`?days=365`, `/live`) | 200 · 460 · 179 | 419 | 421 | 3 | 0.0 | 0.021 |
| 768 | 18,406 | 66 | 2 (`?days=365`, `/live`) | 200 · 460 · 515 | 3,542 | 3,543 | 3 | 0.0 | 0.013 |
| 1280 | 11,893 | 38 | 3 (`?days=365`, `/live`, one app-wide pack chunk) | 200 · 460 · 151 | 319 | 321 | 4 | 0.0 | 0.000 |
| 1920 | 11,356 | 38 | 2 (`?days=365`, `/live`) | 200 · 460 · 127 | 361 | 363 | 4 | 0.0 | 0 |

Reading it:
- **The tab itself is cheap and does not storm.** Exactly two tab-originated requests on the
  switch (history + live), 3–4 commits, no layout shift. The request count is not the problem.
- **The history call is 460 KB decoded for 365 rows** (~96 keys per row, gzip on the wire) to plot
  two lines.
- **The 768 sample (3.5 s) is an outlier on a 306 s-old pod** — one sample is not a rate, so §4.4
  repeats the tab switch per width.

### Per interaction

Tab-originated requests only (app-wide background polls — `barspack`, `intradaypack`,
watchlists, alerts — are excluded; they fire on their own clocks on every page). Format:
**requests · React commits · layout shift after input · ECharts remounted**.

| Interaction | 390 | 768 | 1280 | 1920 |
|---|---|---|---|---|
| tick % Above 200SMA (while zoomed) | 2 · 4 · 0.146 · no | 2 · 4 · 0.077 · no | 2 · 4 · 0.048 · no | 2 · 4 · 0.034 · no |
| preset: Market Health | 1 · 2 · 0.007 · no | 1 · 2 · 0.001 · no | 1 · 2 · 0.001 · no | 1 · 2 · 0.000 · no |
| preset: Breadth vs Price | 1 · 2 · 0.165 · no | 1 · 2 · 0.007 · no | 1 · 2 · 0.004 · no | 1 · 2 · 0.001 · no |
| preset: Full MA Term Structure (More) | 1 · 5 · 0.077 · no | 1 · 2 · 0.106 · no | 1 · 2 · 0.014 · no | 1 · 2 · 0.005 · no |
| preset: Volume Thrust (More) | 1 · 6 · 0.078 · no | 1 · 4 · 0.029 · no | 1 · 6 · 0.000 · no | 1 · 4 · 0.000 · no |
| open group: Regime | 0 · 1 · 0.170 · no | 0 · 1 · 0.077 · no | 0 · 1 · 0.061 · no | 0 · 1 · 0.034 · no |
| tick VIX | 1 · 2 · 0.011 · no | 1 · 2 · 0.000 · no | 1 · 2 · 0.000 · no | 1 · 2 · 0.000 · no |
| tick Up/Down Volume | 1 · 3 · **0.223** · no | 1 · 3 · 0.103 · no | 1 · 3 · 0.062 · no | 1 · 3 · 0.046 · no |
| toggle Follow-through days | 1 · 3 · 0.000 · no | 1 · 2 · 0.000 · no | 1 · 2 · 0.000 · no | 1 · 2 · 0.000 · no |
| date: From → 2025-03-31 | 0 · 1 · 0.000 · no | 0 · 1 · 0.000 · no | 0 · 1 · 0.000 · no | 0 · 1 · 0.000 · no |
| preset: Breadth Thrust (full window) | 1 · 3 · 0.172 · no | 1 · 2 · 0.000 · no | 1 · 2 · 0.000 · no | 1 · 4 · 0.000 · no |
| date: range in the future | 0 · 2 · 0.000 · no | 0 · 2 · 0.000 · no | 0 · 2 · 0.000 · no | 0 · 2 · 0.000 · no |

Reading it:
- **No remounts, no storms, 1–6 commits per change.** Every selection change is exactly one request —
  the debounced preference POST (blocked by the rig). Date edits fetch nothing (client-side filter).
- **The jumps are real and invisible to CLS.** Opening a group or adding a series that wraps the
  readout strip pushes the plot down — **0.22 at 390** for one checkbox — and because it follows
  input, CLS scores it 0. This is the "no layout shift on preset switch" requirement failing where
  the standard metric cannot see it.

### Geometry (page coordinates)

| Width | State | Plot box (x, y, w, h) | Plot visible before scrolling (of 680 px) | Controls above plot (px) | Controls < 44 px |
|---|---|---|---|---|---|
| 390 | default | 21, 603, 348, 680 | **241** | 455 | 4 of 22 |
| 768 | default | 31, 346, 706, 680 | 678 | 211 | **14 of 22** |
| 1280 | default | 105, 270, 1130, 680 | 530 | 194 | (desktop) |
| 1920 | default | 105, 270, 1770, 680 | 680 | 194 | (desktop) |
| 390 | picker-expanded | 21, 1324, 348, 680 | **0** | 1,176 | 65 of 85 |
| 768 | picker-expanded | 31, 628, 706, 680 | 396 | 493 | **77 of 85** |
| 1280 | picker-expanded | 105, 504, 1130, 680 | 296 | 428 | (desktop) |

Reading it:
- **On a phone the member sees 241 px of plot** — the x-axis and the zoom slider are two screens
  away; with one group open the plot is entirely below the fold.
- **Tablet (768) gets desktop-sized controls.** The tab's CSS enlarges targets only at `≤640px`;
  the app's touch tier is `≤1024px` (CLAUDE.md, *Breakpoints*). Measured at 768: group buttons
  28 px, date inputs 30 px, the FTD checkbox 13 px, readout chips 19 px, Notable Extremes 24 px.
- **No page-level horizontal overflow at any width.** The four "overflowing" elements at 390 are
  preset pills inside the pill row's own horizontal scroller — by design — but nothing signals that
  the row scrolls, and the **More** button covers "Participation" (`default__390`).

### Conditions

| Condition (induced client-side) | What the member sees, all four widths |
|---|---|
| data call held open | "Loading data…" in a 120 px box — the real chart is 680 px, so the page jumps when it lands |
| JSON **500** | **"No data in selected range."** |
| JSON **401** | **"No data in selected range."** |
| JSON **402** | **"No data in selected range."** |
| request aborted (network) | "Couldn’t load breadth history right now." + **"Tap to retry"** (touch copy on desktop too) |
| light theme | dark chart chrome on a light page (F-11) |

### Tab-switch samples — NOT quotable as product speed

Five cold tab switches per width (`--tab-switch-samples 5`). The run landed in the middle of
Sunday's deploy churn from other sessions and on a contended machine, and the instrument says so:

| Width | Valid samples | First ink, median (best–worst), ms | Server time of the data call, median (best–worst), ms | Why samples were discarded |
|---|---|---|---|---|
| 390 | 5 / 5 | 539 (379–21,987) | 355 (167–21,833) | — |
| 768 | 2 / 5 | 5,735 (5,383–6,087) | 430 (410–451) | 3 timeouts (a click and two paints that never completed in 30 s) |
| 1280 | 1 / 5 | 666 | 437 | 2 deploy swaps, 2 timeouts |
| 1920 | 4 / 5 | 638 (536–883) | 340 (224–431) | 1 deploy swap |

Two different noises, both visible in the numbers: the **server** spread (167 ms → 21.8 s for the
same 365-row call, cold caches after each deploy) and the **client** spread at 768 (a 0.4 s server
answer inked at 5–6 s — the page, not the network, was stalled on a contended host). Neither says
how fast the tab is. What it does establish is a design constraint: the tab's first paint currently
waits on a **derived 365-row history call whose cold cost is seconds**, and nothing warms it after a
deploy.

⛔ Phase 4 therefore does not compare against these numbers. It measures before and after in the
**same window, alternating**, with the SPA served from local builds and `/api/*` forwarded to
production as the member-smoke session — so the only thing that differs between the two columns is
the front end.

## 5. Screenshots

`docs/breadth/screenshots/before/` — `<state>__<width>.jpg` is a **tall** capture (the viewport
grown to the tab's own height, because the app scrolls `.main`, not the window);
`<state>__<width>__viewport.jpg` is what a member sees before scrolling. Widths 390 · 768 ·
1280 · 1920. Member-smoke account, no saved chart state, first-visit coach mark dismissed.

| State | What it shows | Evidence for |
|---|---|---|
| `default` (+ `__viewport`) | first visit: Health Score + % Above 50SMA, last 90 calendar days | F-6, F-17, phone layout |
| `zoomed` → `zoom-after-toggle` | wheel-zoomed, then one metric ticked | F-4 |
| `preset-market-health` | a one-family preset | baseline |
| `preset-breadth-vs-price` | pct + index, dual axis | F-8 |
| `more-popover` (`__viewport`) | the 29-entry popover | preset model, phone overflow |
| `preset-full-ma-term-structure` | six neutral-toned bands | F-10 |
| `preset-volume-thrust` | ratio + net with two reference lines | **F-1** |
| `picker-expanded` | Regime + Primary Breadth open | picker density, tap targets |
| `mixed-family` | pct ×3 + VIX + Up/Down Volume, hand-picked | F-8 (`VIX / ratio` axis), F-10 (colour collisions) |
| `tooltip` (`__viewport`) | axis tooltip on the mixed chart | tooltip (g), F-11 |
| `no-metrics` | empty selection placeholder | empty state |
| `magnitude-flatten` | Universe Count + 52W Lows on one axis | (e) |
| `ftd-on` | Market Health with FTD markers | FTD rendering |
| `range-full-365` | From moved to the first served session | (c) year-less labels |
| `thrust-full-365` | Breadth Thrust over the full window | **F-5**, F-6, FTD cluster labels |
| `empty-range` | a range with no rows | empty state |
| `loading` | data call held open | loading state (no skeleton; placeholder text in a short box) |
| `error-500`, `error-401`, `error-402` | JSON error bodies from the data call | **(d): all three render "No data in selected range."** |
| `error-network` | request aborted | ErrorState "Couldn’t load breadth history right now." + "Tap to retry" (touch copy on desktop) |
| `theme-light` | the app's light theme | **F-11** (dark chart chrome on a light page) |

Not captured: **live row** (Sunday, `superseded: true` — D-005).

## 6. New findings

Beyond the brief. Each carries its evidence tier: **MEASURED** (rig, validator, or a
probe run today) · **CONFIRMED** (seen on the deployed page) · **CODE** (read from source;
not yet observed in a browser) · **REFUTED** (suspected, measured, false).

### Chart mechanics

**F-1 · A preset's reference lines on two families are drawn on ONE axis.** — CONFIRMED
`BreadthCharts.jsx:208-217` pushes a single `__ref_lines__` series with
`yAxisIndex: refLines[0].axis`; its comment asserts "every preset declares lines for a single
family". One does not: **Volume Thrust** declares `ratio 1.0 "parity"` and `net 0 "flat"`
(`chartMetrics.js:426-429`). On the deployed page the `flat` line sits at **ratio 0 — the
bottom of the plot** — while Net Advancers' zero is mid-chart (`preset-volume-thrust__1280`).
Census over all 36 presets: this is the only one (node census, `volume-thrust:ratio+net`).

**F-2 · During market hours the chart is rebuilt from scratch on every live poll.** — CODE
(mechanism CONFIRMED via F-4; the live trigger is not observable on a Sunday)
The option memo depends on `rows` and `live.clock`; `useLiveBreadth` polls every 60 s in RTH
and each answer carries a new clock. With `notMerge`, every rebuild resets the zoom window,
replays the line animation, and resets ECharts' legend selection to all-visible — **but the
readout's `hidden` set is only cleared on selection changes** (`:129-153`), so a member who
hid a series sees it redrawn every minute while its readout chip still shows it hidden: the
exact desync the component's own comment warns about, reached by a different path.

**F-3 · The tab never refreshes its history.** — CODE
`useSWR('/api/breadth-monitor?days=365', fetcher)` has no `refreshInterval`, and the app-wide
`SWR_CONFIG` turns off focus/reconnect revalidation (`App.jsx:262-265`). When the 4:15 PM
collector writes the day, `useLiveBreadth` withdraws the provisional point (superseded) and
nothing fetches the collected row, so a tab open across the close **ends at yesterday** until
it is remounted.

**F-4 · Zoom is thrown away by any change.** — CONFIRMED
Zoomed with the wheel, then ticked one metric: the plot returns to the full range
(`zoomed__1280` → `zoom-after-toggle__1280`). Same `notMerge` rebuild as F-2; presets, the FTD
toggle and date edits do the same.

**F-5 · The ~6× magnitude guard is a test over a stale, hand-typed range table.** — MEASURED
`chartMetrics.test.js:327-347` holds `MAX_ABS`, observed maxima typed in August. Against the 365
sessions production serves today the served maxima exceed the typed ones by `up_vol_ratio` **15×**,
`up_4pct_today` 2.3×, `new_52w_lows` 4.1×, `lo_ratio` 4.4× and `adv_decline_cum` ~59× (its running total
now starts in 2008). With the real maxima, **Breadth Thrust's ratio axis spans 23×**: over the full window
its axis runs 0–100 for one April 2025 spike and the 5D/10D ratios lie on the floor
(`thrust-full-365__1280`). The guard is a second authority over the data's ranges and it has
drifted — `lesson_a_measured_knob_is_inert` in test form.

**F-6 · "N days" counts sessions.** — CONFIRMED
The default 90-calendar-day window reads **"62 days"**; the full window reads **"365 days"**
for a span of 17½ months (`default__1280`, `thrust-full-365__1280`).

**F-7 · The default range is computed in the browser's UTC date and frozen at mount.** — CODE
`offsetDate` uses `toISOString().slice(0,10)` (`:46-50`), so the window's edges follow UTC, not
ET, and a tab left open overnight keeps yesterday's `To` (rows dated today are filtered out).

**F-8 · Ten of 36 presets are dual-axis charts.** — MEASURED (node census)
breadth-vs-price, thrust, volatility, ad-line, narrow-leadership, volume-thrust, mcclellan,
fear, score-vs-vix, breadth-vs-nasdaq. Two unrelated scales on one plot manufacture crossings:
Volume Thrust's `parity` (ratio 1.0) sits exactly on Net Advancers −500
(`preset-volume-thrust__1280`). No preset mixes two families on the right axis; hand-picked
selections can (`mixed-family__1280`: right axis `VIX / ratio`).

**F-9 · Smoothing overshoot — REFUTED.** Suspected that `smooth: 0.35` draws values the data
does not contain. Rendered the real ECharts 6 build server-side on a series with sharp V's
(12…97) and evaluated the drawn Béziers: **drawn extremes equal data extremes (0.0 overshoot)**
— ECharts clamps its control points. Not a finding; recorded so it is not re-raised.

### Colour, type, theme

**F-10 · The series palette fails the colour-vision checks.** — MEASURED
(`dataviz` validator, OKLab ΔE×100, Machado 2009)

| Set (as the tab assigns it) | Surface | Worst result |
|---|---|---|
| 6 neutrals (MA Term Structure) | dark `#17181b` / OLED `#0a0a0a` | **FAIL** CVD: sky `#38bdf8` ↔ violet `#a78bfa` ΔE 5.2 (deutan); all six outside the dark lightness band |
| bull ↔ bear `#34d399` ↔ `#f87171` | dark / OLED | **WARN** CVD 6.5 (deutan) — legal only with secondary encoding, which the chart does not have |
| two bulls `#34d399` ↔ `#4ade80` (e.g. Uptrends vs New Highs) | dark | **FAIL normal vision ΔE 5.2** — hard to tell apart *without* any colour deficiency |
| 6 neutrals | light `#f4f5f6` | CVD FAIL as above; **every series < 3:1** (1.96–2.49) |
| Market Health + VIX + Up/Down Volume, 5 lines, **all pairs** (lines cross, so any two can touch) | OLED | **FAIL normal vision ΔE 4.2**: amber `#f59e0b` ↔ orange `#fb923c` (UCT Exposure vs Up/Down Volume); violet ↔ blue **ΔE 0.3** under deuteranopia |
| the two blues `#60a5fa` ↔ `#38bdf8` (Health Score vs VIX) | OLED | **FAIL normal vision ΔE 6.7** |

The deployed page agrees with the numbers: `mixed-family__390` draws UCT Exposure and Up/Down
Volume in two oranges and Health Score and VIX in two blues that cannot be told apart at a glance.
The neutral ramp's hues are Tailwind-400 steps chosen one at a time; they were never validated as
a set.

**And colours follow selection rank, not the metric.** `resolveColors` walks the selection in order,
so removing a series repaints the ones after it: with VIX, VXN and VIX 10D plotted, removing VIX turns
VXN from amber to blue and VIX 10D from violet to amber (node check of `resolveColors`, 2026-09-13) —
the dataviz "recolour-on-filter" anti-pattern.

**F-11 · Chart chrome is below text contrast, and the light theme is not handled at all.** — MEASURED
Axis and reference-line labels `#706b5e`: **3.34:1** dark, 3.73:1 OLED (11 px text needs 4.5:1).
Tooltip date `#706b5e` on `#22251e`: **2.93:1**. On the light theme the chart keeps its dark
chrome: gridlines `#22251e` become **14.2:1** black rules, FTD and LIVE labels fall to 2.5:1 and
2.1:1. The chart's colours match no current token (`--border #2a2c31`, `--text-muted #cfcac0`).

**F-12 · Stage 2/4 lose their qualifier in the chart.** — CODE
The Monitor and widget label them "Stage 2 (MA Stack)" with a comment explaining why the
qualifier matters (the count is not Minervini's full template, `heatmapMetrics.js:207-211`);
the chart calls them "Stage 2 Count".

### Data honesty & freshness

**F-13 · A stale series reports its last value as current.** — CODE + MEASURED data
`latestValue` returns the last non-null value with no date (`breadth/percentile.js`), so CBOE P/C
(last stored 2026-08-07) shows its last value in the readout on 2026-09-13 with nothing marking it
five weeks old.

**F-14 · Follow-through days cannot exist before 2026.** — CODE
See §1: the rule needs `qqq_close`, absent from reconstructed rows. A collector/backfill ask.

### Performance & platform

**F-15 · A long-history response is JSON-encoded on the event loop.** — MEASURED
FastAPI 0.115.6 `serialize_response` calls `jsonable_encoder(response_content)` directly in the
coroutine when a route has no response model, and this one has none. Timed locally on payloads
shaped like the real rows (~96 scalar keys): **365 rows 38 ms · 1,250 rows 149 ms · 3,650 rows
438 ms · 4,700 rows 534 ms**, plus `json.dumps` 9 / 36 / 101 / 128 ms. Every request on the pod
waits behind that. The 365-row call itself is 471 KB decoded (gzip on the wire).

**F-16 · Every interaction writes the whole preference blob.** — MEASURED
13 interactions → 13 `POST /api/auth/preferences` (600 ms debounce, interactions 1.6 s apart).
Cheap and correct; it only matters if range and URL state join the blob.

### Layout & chrome

**F-17 · Above the fold, the plot has no dates.** — MEASURED
At 1280×800 the controls take 270 px; the 680 px plot shows **530 px** before scrolling, so the
x-axis labels and the zoom slider are below the fold on first view.

**F-18 · The voice orb's first-visit coach mark covers the plot.** — CONFIRMED (app chrome)
"Meet Compass" sits over the lower-right of the chart on a first visit; the orb FAB and its two
sibling buttons overlap the zoom slider's right handle thereafter. Out of this program's scope
(app chrome); recorded because it lands on this tab's most valuable pixels.

### Registry

**F-19 · Three metric registries, not two.** — MEASURED
`chartMetrics.js` 56 keys · `heatmapMetrics.js` (Views + `/charts` widget) 46 · `Breadth.jsx`
`COLS` (Monitor) 47. Chart ∩ heatmap = 37 keys, of which **15 carry different labels** (`Health
Score`/`Health`, `% Above 50SMA`/`>50 SMA`, `CNN Fear/Greed`/`CNN F/G`…). 19 keys exist only in
the chart catalog; 9 only in the heatmap (`advancing`, `declining`, `up_from_open`,
`down_from_open`, `up_on_volume`, `down_on_volume`, `is_ftd`, `spy_ma_stack`, `qqq_ma_stack` —
the last three are not plottable series). The heatmap entries carry behaviour (`getTier`,
`getFmt`, `drillKey`, polarity, pairing) the chart catalog lacks; the chart carries unit
families and tone the heatmap lacks. Unification is therefore a **merge of two schemas keyed by
metric**, not a relabel — the brief's "thin adapter" test is answered in the Phase 1 audit.

### Accessibility

**F-20 · Roles and states that do not match behaviour.** — CODE
More popover: `role="listbox"` of `role="option"` buttons with no arrow-key handling. Group
toggles: no `aria-expanded`. Notable Extremes: no `aria-pressed`. The chart: no accessible name
or description, and no keyboard path to zoom, pan or read values. Readout chips are correct
(`aria-pressed`, spelled-out `aria-label`).

---

## 7. Post-C3 member pass at 768 and 390 (2026-09-13, master `a9290e7f4`)

Captured with the same rig and the same member-smoke account as §4, against production **after** C1, C2 and C3 were
live. Frames and measurements are local (`screenshots/after-c3/<width>/`, `measurements/after-c3*.json`) — the repo is
public and breadth history is paid (D-018). This does NOT replace §4: the Phase 0 before-state at all four widths is
complete (23 states × 4 widths, 98 frames) and is the baseline Phase 4's A/B compares against. Writing a post-C3 capture
into `screenshots/before/` would have made that comparison C3-against-C3.

### A-19 landed: controls under 44 px at 390 px

Every captured state improved, none regressed — 17 of 17.

| state | before | after |
|---|---|---|
| default | 4 | 1 |
| picker-expanded | 65 | 30 |
| mixed-family | 7 | 1 |
| tooltip | 7 | 1 |
| thrust-full-365 | 7 | 1 |
| preset-full-ma-term-structure | 8 | 1 |
| (every other captured state) | 2–5 | 1 |

**What the residual is.** Every remaining entry is an 18 × 18 native `<input type="checkbox">` — the metric rows and the
follow-through toggle. Each sits inside a `<label>` (`.metricItem`, `.ftdToggle`) that C3 gives
`min-height: var(--tap-min)` on the touch tier, and a click anywhere in a label toggles its input, so the member's tap
target is the 44 px row. A 44 px checkbox GLYPH would be wrong; the row is the control. Recorded as a residual, not a
failure.

### ⚠️ Out of scope, and worth someone's attention: 66 API calls to reach this tab at 768

At 768 the Breadth page lands on **Monitor**, whose Time Navigator fires a walk of **32 sequential
`/api/breadth-monitor?days=150&end=…&anchor=le` requests** back to 2008-03-18 on page load — 66 API calls before a member
can click Data Charts. Measured identically in the before-state run (`before.json`, 768: 66 page-load calls, 32 deep),
so it is pre-existing and not caused by this program; Monitor is explicitly out of this program's scope.

It is not harmless. On 2026-09-13 it cost this pass a capture: with the pod also serving other sessions, the Data Charts
tab's own `days=365` call did not return inside the rig's 45 s wait and the 768 segment had to be re-run on its own.
A member on a tablet pays the same queue. Raised for the Monitor owner; not a collector ask (the storm is frontend).

At 390 the page lands on Daily, which costs 40 calls and no deep walk, and the tab switch painted in 480 ms.
