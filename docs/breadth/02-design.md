# Phase 2 — Design: Breadth → Data Charts V2

*Implements the audit ([`01-audit.md`](01-audit.md)). Every judgment call is in [`DECISIONS.md`](DECISIONS.md).
The annotated mock is [`mock/index.html`](mock/index.html), rendered by `mock/render_mock.py` into
`mock/renders/` — it draws **synthetic** series shaped like production (this repository is public; D-018).*

---

## 1. Design plan, and its review against the brief

The brief fixes the visual language: the app's existing dark/gold system, Instrument Sans, no new design system.
So the plan is not a new identity — it is the discipline of spending the existing one well.

### Tokens (all existing — `app/src/styles/tokens.css`)

| Role | Token | OLED (default) | Dark | Light |
|---|---|---|---|---|
| Page | `--bg` | `#000000` | `#101012` | `#ffffff` |
| Chart surface | `--bg-surface` | `#0a0a0a` | `#17181b` | `#f4f5f6` |
| Menus, sheets, tooltip | `--bg-elevated` | `#111111` | `#1d1f23` | `#ffffff` |
| Primary ink / values | `--text-heading` | — | `#ffffff` | `#161a1e` |
| Body ink | `--text` | `#f0efea` | `#f0efea` | `#1f2328` |
| Secondary ink | `--text-muted` | `#cfcac0` | `#cfcac0` | `#57606a` |
| Accent (selection, live) | `--ut-gold` | `#dcbb5e` | `#dcbb5e` | `#7a5c16` |
| Warning (stale, late) | `--warn` | `#dcbb5e` | `#dcbb5e` | `#7a5c16` |
| Hairlines | `--border` | `#1e1e1e` | `#2a2c31` | `#e3e5e7` |

**Derived chart chrome** (computed at render from the tokens above, because canvas cannot read `var()`; D-020):

| Role | Rule | OLED | Dark | Light |
|---|---|---|---|---|
| Axis text | most recessive `mix(--text-muted, --bg-surface)` that clears **4.5:1** | `#7c7974` (4.57) | `#84817c` (4.58) | `#687079` (4.60) |
| Gridline | first `mix(--text-muted, --bg-surface)` reaching **1.25:1** | `#242322` (1.26) | `#2b2c2d` (1.27) | `#d9dcde` (1.26) |

### Type (Instrument Sans only; existing scale)

| Use | Face · size · weight |
|---|---|
| Reading line (what is plotted, over what, how fresh) | Instrument Sans · 17 px · 400, values 500 · `--text-heading` |
| Controls, legend names | Instrument Sans · 13 px · 500 |
| Legend values, tooltip values | Instrument Sans · 13 px · 600 · `.t-num` (tabular) |
| Axis ticks (canvas) | **Instrument Sans Tab** (the app's tnum-frozen face) · 11 px |
| Reference-line and coverage labels | Instrument Sans · 11 px · axis-text colour |

No all-caps labels (the legacy "PRESETS" eyebrow is dropped); no middle-dot meta strings — the reading line is a
sentence.

### Layout concept

One column that reads top to bottom as *choose → read → look*: a single control row, a sentence that states the chart,
then the stacked panels, the record strip and the shared date axis. Controls never push the plot down: they open as
popovers (desktop) or bottom sheets (touch).

### Principles

1. **The chart states itself.** A member can say what is plotted, over which dates, and how fresh it is without hovering.
2. **Real units, one scale per panel.** Nothing shares an axis it does not belong on; nothing is flattened silently.
3. **The record is visible.** Where data was reconstructed, not recorded, stale, or provisional, the chart shows it in place.
4. **One bold element.** The **record strip** — a thin band under the plot showing collected vs reconstructed sessions — is
   the tab's signature; everything else stays quiet (D-021).
5. **Failure is specific.** Errors say what failed and what to do; an empty result is never a failure.

### Review against the brief — what changed

| First draft | Why it read as a default | Revised to |
|---|---|---|
| Header as `Market Health · Jun 15–Sep 11 · 62 sessions · as of close` | middle-dot meta string (template chrome) | a plain sentence: *Market Health, from Jun 15 to Sep 11, 2026. 62 sessions, as of Friday's close.* |
| Each panel as its own rounded card with a shadow | the SaaS-card kit; implies panels are separate charts | panels share one surface, separated by a 14 px gap and their own legend row |
| Gold series colour for the "main" line | spends the accent on data; gold is reserved for selection and live | gold only for the active range pill, active preset, selection badges and the LIVE marker |
| An uppercase "METRICS" eyebrow over the picker | tracked-out caps label | the control itself is the label: "Metrics 3" |
| Coverage shown by a hatched texture everywhere | texture is an accessibility channel, opt-in only | a subtle surface-step area with a text label, and the record strip |

---

## 2. Layouts

### Desktop (≥ 1025 px) — `mock/renders/board-desktop.png`

```
Breadth   [Monitor] [Views] [Daily] [COT Data] [Data Charts]                     (existing page header)
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Breadth vs Price ▾] [Metrics 3 ▾]  (90D|6M|1Y|2Y|5Y|Max|Custom)        Share  Export  Table  ⋯ │  control row, 36 px
│                                                                                                   │
│ Breadth vs Price, from Sep 16, 2024 to Sep 11, 2026. 520 sessions, as of Friday's close.          │  reading line
│                                                                                                   │
│ Percent of stocks   ━ % Above 50SMA 41.3%  62nd of 520 shown   ━ % Above 200SMA 55.1%  48th …    │  panel legend
│ 100 ┼──────────────────────────────────────────────────────────────────────────  % Above 50SMA   │
│  50 ┼ …                                                                          % Above 200SMA  │  end labels
│   0 ┼──────────────────────────────────────────────────────────────────────────                  │
│                                                                                                   │
│ S&P 500             ━ S&P 500 7,657                                                               │
│ 7,700┼░░░ S&P 500 is recorded from Jan 2, 2026 ░░░░░│──────────────────────────  S&P 500         │  not-recorded area
│ 6,400┼░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│                                            │
│      ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ reconstructed ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁│█████████████ collected █████████████████    │  RECORD STRIP
│      2025                                            2026                                        │  shared date axis
│      [═══════════════════ zoom slider ═══════════════════════════════════════════════════]      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Chart height = viewport height − (page header + control row + reading line + 24 px), clamped to **420–900 px**. Panels
  share it; with 3+ panels the first gets 1.5×; each panel ≥ 140 px.
- The x-axis band and the zoom slider are inside the first screen at 1280×800 (A-16).
- End labels sit in a 120 px right gutter; the plot never draws under them.

### Tablet (641–1024 px)

Desktop structure; the right gutter narrows to 88 px and end labels truncate with the full name in the legend. Every
control is ≥ 44 px (the touch tier is ≤ 1024 px, A-19). Menus open as popovers when a fine pointer is present, sheets
otherwise (`Sheet variant="auto"`).

### Phone (≤ 640 px) — `mock/renders/board-phone.png`

```
☰ Breadth                                  🔍  ↗  🔔     (app top bar)
[Monitor][Views][Daily][COT Data][Data Charts]
[Breadth vs Price ▾] [Metrics 3 ▾]      [⋯]           44 px targets
(90D|6M|1Y|2Y|5Y|Max|Custom) ›                        scrolls, edge fade shows it scrolls
Breadth vs Price, from Sep 12, 2025 to Sep 11, 2026.
252 sessions, as of Friday's close.
Percent of stocks  ━ 50SMA 41.3%  ━ 200SMA 55.1% ›     legend chips scroll horizontally
┌──────────────────────────────────────┐
│ plot (panels share viewport height)  │
│ …                                    │
│ record strip                         │
│ dates                                │
└──────────────────────────────────────┘
```

- The plot starts within **~300 px** of the top of the page body at 390×844 (was 603 px).
- No zoom slider; no end labels (legend chips carry identity; opposed pairs keep short end labels as their secondary
  encoding).
- Share, Export, Table, and every option live in the **⋯** sheet.

---

## 3. Controls

| Control | Desktop | Touch | Behaviour |
|---|---|---|---|
| **Preset** button | popover, 420 px, grouped list with each preset's hint visible, search field on top | bottom sheet | Label is the active preset, **"Market Health + 1"** when one metric was added (nearest preset by overlap ≥ 50 %), or **"Custom"**. Applying replaces the selection; A/D Line widens the range to at least 1Y |
| **Metrics** button | popover, 460 px | bottom sheet | Search; groups as today (Score, Primary Breadth, MA Breadth, Regime, Highs / Lows, Sentiment) plus **Internals** (advancing, declining, distribution days, VIX term structure). Rows are checkboxes with inline badges: *from Jan 2026*, *weekly*, *last Aug 7*, *history reconstructed*. Max 8 selected; the ninth checkbox is disabled with the reason |
| **Range** | segmented `90D · 6M · 1Y · 2Y · 5Y · Max · Custom` | horizontal scroller with edge fade | Custom opens the two date inputs. Persisted. Changing range resets zoom |
| **⋯ Options** | menu | sheet | Follow-through days · MA breadth extremes (only while an MA-breadth series is plotted) · Market phase shading · Percentile basis (shown / all history) · Palette (Classic · Colorblind · Ocean · Mono) · Log scale (per eligible panel) · Reset to defaults |
| **Share** | copies the URL, confirms "Link copied" in place | in the ⋯ sheet | — |
| **Export** | menu: *Image (PNG)* · *Data (CSV)* | in the ⋯ sheet | PNG = chart + reading line + UCT mark; CSV = visible sessions × series + reconstructed column |
| **Table** | toggles a table view in place of the plot | in the ⋯ sheet | virtualized; same series, units, flags |
| **Legend chip** | click hides/shows the series | tap | `aria-pressed`; hidden state survives rebuilds (A-08) |

Keyboard: the control row is one tab stop per control; arrow keys move within the range segmented control
(roving `tabindex`) and within popover lists; Escape closes a popover and returns focus to its button.

---

## 4. Chart

### Panels (D-007)

- One panel per unit family present, in order of the family's first appearance in the selection; max **4 panels**.
- **Magnitude split:** inside a family, when the largest and smallest series' maxima on the *visible* window differ by more
  than **6×**, the smaller series moves to its own panel; its legend row says *"split for scale"*. If that would exceed
  4 panels, the series stays and the panel shows a visible note with a **Rebase** suggestion (follow-up mode).
- Panel legend row: family name in secondary ink, then a chip per series — line key, name, latest value (tabular), basis
  percentile ("62nd of 520 shown"), and a status badge when stale.

### X axis

- Category axis of the sessions present (weekends and holidays take no space); shared by all panels and the record strip;
  labels drawn once, under the record strip.
- Tick text by visible span: ≤ 6 months *Jun 15*; ≤ 2 years *Jun '26*; longer *2026*; `hideOverlap`.
- One `dataZoom` (inside + slider) drives every panel; the zoom window is state (dates) that survives rebuilds. The slider is
  neutral (gridline tones, no data wash) with gold handles — the accent marks the thing you grab, not a band of chrome.
- Crosshair: a vertical hairline snapping to sessions, linked across panels.

### Y axes (per panel)

| Family | Domain | Log available |
|---|---|---|
| pct (0–100 metrics) | 0 → 100 with ticks every 25, expands only for a genuine outlier (UCT Exposure to 150, AAII spread below 0) | no |
| pct (small shares: `hi_ratio`, `lo_ratio`) | 0 → nice max × 1.08 | no |
| count | 0 → nice max × 1.08 | yes |
| ratio | 0 → nice max × 1.08 | no |
| net | symmetric around 0 | no |
| index, vix, spread, osc, cum | framed to data, ±8 % padding | index, cum (positive windows only) |

Tick labels right-aligned in a 56 px left gutter, thousands-comma'd, the unit carried by the panel's family name and the
tooltip — never repeated on every tick.

### Reference lines (D-009)

Attached to metrics, drawn on that metric's panel whenever it is plotted: parity 1.0 and thrust 2.0 (5D/10D ratios),
parity 1.0 (up/down volume, CBOE P/C and its average), fear 25 / greed 75 (CNN Fear/Greed), VIX 20 (VIX, VXN and their
averages), 0 (net advancers), 1.0 (VIX term structure). 1 px dashed, axis-text colour at 55 %, label at the right end.
The MA-breadth ladder (5/10/15/20, 70/80/90) is its own option.

### Marks

| Metric kind | Mark |
|---|---|
| levels and daily counts | 2 px line, no markers, not smoothed (points are sessions) |
| `adv_decline` (signed daily net) | bars from 0, bull/bear tone by sign |
| `hvc_52w` (sparse spikes) | bars |
| AAII, NAAIM (weekly surveys), distribution days | step line |
| live provisional point | 8 px dot with a 2 px surface ring, dashed gold vertical, `LIVE 2:47 PM ET` |
| follow-through day | dotted vertical in axis-text colour, label on the first of a cluster |

Long windows are decimated with ECharts `sampling: 'lttb'`.

### Colour (D-010, D-019)

Colour identity is **scoped to a panel** (each panel has its own legend row). Values validated with the `dataviz`
validator (OKLab ΔE×100, Machado 2009) on OLED `#0a0a0a`, dark `#17181b` and light `#f4f5f6`.

**Neutral series, in assignment order**

| Palette | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 | Validation |
|---|---|---|---|---|---|---|
| Colorblind · Ocean · Mono-fallback | blue `#3987e5` / `#2a78d6` | orange `#d95926` / `#eb6834` | aqua `#199e70` / `#1baf7a` | violet `#9085e9` / `#4a3aa7` | magenta `#d55181` / `#e87ba4` | slots 1–3 pass **all pairs** on all three surfaces (worst CVD 9.2, normal 20.9); 1–5 pass adjacent |
| Classic | blue | orange | pink `#ec4899` / `#db2777` | violet | — | 1–3 all pairs (CVD 12.3, normal 15.8); 1–4 adjacent. Aqua is avoided because it is classic's bull tone |

`dark hex / light hex`. A panel's 4th and 5th colour series always show end labels (secondary encoding). **End labels are
dropped for a panel when two would land within 16 px of each other** — never nudged apart, which detaches a label from its
line — and the panel's legend row and the tooltip carry identity (the dataviz fallback for converging lines).

**Opposed pairs** (only when *both* sides of a pair are on the same panel; otherwise each side takes a neutral slot)

| Palette | Bull | Bear | Validation | Companion neutral on that panel |
|---|---|---|---|---|
| Classic | `#199e70` / `#0f7a55` | `#e66767` / `#c02626` | CVD **6.5 (warn band)** → end labels mandatory; normal 27.5 | indigo `#6366f1` / `#4f46e5` |
| Colorblind | `#256abf` / `#1d4ed8` | `#e0662e` / `#ea580c` | CVD 23.8 · normal 32.8 | aqua |
| Ocean | `#0aa5c2` / `#0891b2` | `#d9486e` / `#e11d48` | CVD 12.5 · normal 29.5 | indigo |
| Mono | emphasis form: the first series `--ut-gold`, every other series a gray step of the axis-text colour; end labels always | | grays fail the chroma floor **by design** (emphasis, not identity) | — |

Rules: colours are sticky per metric while it stays selected (removing a series never repaints another, A-13); a panel with
an opposed pair takes at most one colour neutral, further series draw in the emphasis gray with end labels; the gold accent
is never a series colour outside Mono.

### Tooltip (A-25)

Header *Fri, Sep 11, 2026* (ET). Rows grouped by panel: line key, **value first** (tabular, unit, thousands separators),
then the name and the basis percentile. Flags in words: *not reported since Aug 7*, *reconstructed from price history*,
*provisional, 2:47 PM ET*. Built with escaped text, never series names interpolated as HTML. Touch: tap-and-hold shows it;
a second tap elsewhere dismisses. Keyboard: identical content when the crosshair moves by arrow keys.

---

## 5. Coverage and staleness — the visual language

| Condition | On the chart | In the legend / tooltip |
|---|---|---|
| Series not recorded before its first session (e.g. S&P 500 before 2026-01-02) | a barely-off-surface area over the unrecorded span of **that panel**, a hairline where the record begins, and the label *"S&P 500 is recorded from Jan 2, 2026"* | tooltip row *not recorded yet* |
| Gap inside coverage (e.g. 22 missing Stage 2 sessions) | the line breaks | tooltip *not recorded* |
| Stale (latest value older than its cadence allows: daily 1 session, weekly 7) | the line simply ends | chip badge **last Aug 7** (warning ink, clock glyph); reading line adds *"CBOE P/C has not been reported since Aug 7."* |
| Weekly survey carried daily | step line | chip *weekly* |
| Reconstructed session (before the collector floor) | **record strip** segment in the light tone | tooltip *reconstructed from price history — counts are coverage-scaled estimates* |
| Collected session | record strip segment in the strong tone | — |
| Provisional live read (RTH) | dot + dashed gold vertical + `LIVE 2:47 PM ET` | reading line *"Live at 2:47 PM ET, provisional until the 4:15 PM close is recorded."* |
| Collector late (no row for the last completed session after 4:30 PM ET) | — | reading line *"Monday's session hasn't been written yet. The chart ends at Friday's close."* |
| Range crosses universe growth > 20 % on a count panel | panel note *"Counts depend on the measured universe (1.5k → 2.6k names). The % versions compare across years."* with a **Use %** action | — |
| FTD toggle with a range before 2026 | — | option subtitle *"Follow-through days are available from Jan 2026."* |
| Drill-through on a reconstructed session | — | tooltip *"Names are recorded from Jan 2, 2026."* instead of the *View names* action |

---

## 6. States — `mock/renders/board-states.png`

All states render inside the chart frame **at the chart's final height**, so nothing jumps when data lands.

| State | What the member sees |
|---|---|
| First load | axis hairlines and panel gutters at final size; *"Loading breadth history…"* centred in axis-text ink |
| Refetch (range change, revalidation) | the previous chart stays, at 45 % opacity, until the new data paints |
| Empty range | *"No sessions between Jan 1 and Feb 1, 2030."* + *"Pick a range that includes past sessions."* + the range control |
| Nothing selected | *"Nothing is plotted yet."* + **Presets** and **Metrics** buttons |
| 401 | *"Your session has ended."* + *"Sign in again to load breadth history."* + **Sign in** |
| 402 | *"Data Charts is part of the UCT plan."* + *"Choose a plan to chart breadth history."* + **See plans** |
| 5xx / malformed | *"Breadth history didn't load."* + *"The server returned an error."* + **Retry**; on a refetch the last chart stays with an inline notice |
| Network | *"Breadth history didn't load."* + *"Check your connection, then retry."* + **Retry** |
| Partial (a series not recorded in the window) | chart renders; §5 treatments |
| Stale, live, collector late | §5 treatments |

Copy rules: sentence case, active voice, no apology, one job per sentence; the button names the action and the
confirmation repeats it ("Copy link" → "Link copied").

---

## 7. Motion

| Event | Motion |
|---|---|
| First paint | lines draw once, 400 ms ease-out (ECharts `animationDuration`) |
| Any later change (selection, zoom, live tick, theme) | instant (`animationDurationUpdate: 0`) |
| Panel added / removed | chart height eases 180 ms; panels do not slide |
| Popover / sheet | 160 ms fade + 8 px rise (sheet: the app's `Sheet` motion) |
| Refetch | previous render fades to 45 % over 120 ms |
| `prefers-reduced-motion` | all of the above instant |

---

## 8. URL and persistence

`/breadth?tab=charts&m=pct_above_50sma,pct_above_200sma,sp500_close&r=2Y&opt=ftd,ext&pal=classic&pb=shown`
(`r` ∈ `90D 6M 1Y 2Y 5Y MAX`, or `from=YYYY-MM-DD&to=YYYY-MM-DD` for custom; `opt` = enabled options; `pb` = percentile basis).
Every parameter is untrusted with a stated fallback (the `breadthUrlState.js` pattern); unknown metrics are dropped.
`?tab=` is read once on mount by `Breadth.jsx`. Writes are debounced `replace`s through the existing `mergeParams`.
A link wins over saved preferences for that visit; otherwise the saved `breadth_charts_state` (now carrying range,
options, palette and percentile basis) applies. One debounced preference write per burst of changes (A-40).

---

## 9. Accessibility

- The plot region is a focusable `role="img"` group with an `aria-label` generated from the reading line and each series'
  latest value; `aria-describedby` points at a visually hidden summary updated when the data changes.
- ←/→ move the crosshair one session (tooltip content is announced via a polite live region), Home/End jump to the ends,
  +/− zoom, 0 resets zoom.
- **Table** view is the non-visual equivalent of every chart (A-23).
- Colour is never the only carrier: legend names, end labels, badges in words.
- Focus is always visible (the app's focus ring); every touch target ≥ 44 px on the touch tier.

---

## 10. Architecture and flag

- `VITE_BREADTH_CHARTS_V2_ENABLED` (build flag, default off; `docs/feature_flags.json` → `build_flags`, `Dockerfile.web`
  `ARG`). `Breadth.jsx` lazy-loads `breadth/charts2/BreadthChartsV2.jsx` when the flag is `'1'`; otherwise the legacy
  `BreadthCharts.jsx` renders unchanged.
- Pure modules shared by legacy and V2 where the corrective lane needs them: `breadth/chartMetrics.js` (canonical registry),
  `breadth/chartTicks.js` (session tick format), `breadth/chartMagnitude.js` (runtime spread rule),
  `breadth/chartRefLines.js` (metric-attached lines), `breadth/chartColors.js` (panel-scoped sticky assignment + palettes),
  `breadth/chartChrome.js` (token → chrome colours).
- V2-only: `charts2/` components (control row, sheets, reading line, panel chart, record strip, table view) and
  `charts2/useChartSeries.js` over `GET /api/breadth-monitor/series` (behind `BREADTH_SERIES_ENDPOINT_ENABLED`), falling back
  to the legacy history call when the endpoint answers 404.
- Rails: palette sets re-validated in a unit test (a vendored OKLab/Machado ΔE + WCAG contrast check), panel/axis/tick/
  magnitude/reference-line pure-function tests, URL round-trip, request dedup, jsonFetcher error states, and the member rig.

---

## 11. Mock

`docs/breadth/mock/index.html` — one page, five boards, each annotated with the audit findings it answers:

| Board | Shows |
|---|---|
| `board-desktop` | OLED, Breadth vs Price over 2Y: control row, reading line, two panels, not-recorded area, record strip, zoom |
| `board-phone` | OLED at 390 px: compact control row, scrolling range, legend chips, panels filling the screen |
| `board-light` | Light theme, Volatility & Fear over 6M: VIX 20 and parity lines, stale P/C badges, a pinned tooltip after the series went stale |
| `board-sheets` | the Metrics sheet (touch) with search and coverage badges, and the Preset popover (desktop) with "+ 1" |
| `board-states` | loading at final size, empty range, nothing selected, 401, 402, server error, collector late, live |

Rendered with `python docs/breadth/mock/render_mock.py` (Playwright serves the repository's files to the page through a
routed origin — no local server, no port). The page uses the app's real `tokens.css`, the self-hosted Instrument Sans faces
and the installed ECharts build, so what renders is the design system as it ships.
