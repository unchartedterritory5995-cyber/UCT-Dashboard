# The UCT mobile charting target experience — Flows A–H

**Deliverable F.** A design specification, not production code. Nothing here has been built;
building any of it requires authorization.

**Every screen below starts from what UCT already ships.** Five strengths are load-bearing and
are protected by name in the flows that use them:

| protected strength | evidence | never trade it for a TradingView shape |
|---|---|---|
| **`Set level…`** — exact numeric placement on a pre-filled decimal keypad | `CMP-040` | TV's equivalent is a Coordinates tab, and that row is INFERRED |
| **The long-press price sheet** — price-anchored actions **plus** settings, indicators, timeframe | `CMP-049`, `UCT-CHART-0007` | it is *broader* than TradingView's ⊕ menu |
| **Crosshair density** — OHLCV + change% + four live MA values | `CMP-020` | TV's documented legend stops at OHLC + change + volume |
| **Type-aware drawing actions** — the object menu changes with the object | `CMP-043`, `UCT-DRAW-0005` | TV's is a fixed list |
| **Seeded-alert cheapness** — three gestures, zero typing | `CMP-051`, `CMP-054` | keep the *cost*; fix only the *binding* (`CMP-055`) |

**Three design rules the evidence produced, applied throughout:**

1. **Depth zero for the repeated, depth one for the occasional, a sheet for the rare.** UCT wins
   the repeated actions today (`CMP-010`, `CMP-015`, `CMP-051`) because they are already at depth
   zero or one. Nothing below moves an action *deeper*.
2. **A phone surface declares what it drops.** UCT already does this exactly twice — the `$-Vol`
   strip and the A/L/% chips are `display:none` on the phone canvas, with a comment explaining
   why. That rule is the remedy for the study's largest root cause (C1); every screen below states
   its own drop list.
3. **Nobody has solved the phone feature surface — so lead, don't copy.** TradingView's hub hides
   15 of its 18 entries at its default detent; UCT's drawing bar shows 3 of 18 tools (`CMP-083`,
   `CMP-034`). Flows B and C below take a different route: **progressive reveal by recency, with
   an always-present "all" affordance**, rather than tabs-plus-search.

Legend for the wireframes: `▓` chart canvas · `[ ]` control · `◂▸` horizontally scrollable ·
`⌃` sheet grabber · **bold** = new or changed.

---

## FLOW A · Chart → ticker → timeframe → candle inspection → live price

```
┌───────────────────────────────┐
│ ☰  AAPL  Apple Inc.   319.97 ▴│  ← symbol strip (tap = search sheet)
├───────────────────────────────┤
│ 2026-03-09  O 666.39 H 679.92 │  ← crosshair legend, on press-and-hold
│ L 662.39  C 678.27  V 102.7M  │     (UNCHANGED — this is already ahead)
│ +5.89 (0.88%)                 │
│ EMA9 681.5  EMA20 684.3       │
│ SMA50 687.9  SMA200 656.9     │
│                               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ⟳ LIVE  │  ← go-to-realtime, unchanged (CMP-022)
├───────────────────────────────┤
│ 1m  5m  15m  30m  1h  1D  1W  1M│ ← depth ZERO. Do not touch. (CMP-015)
├───────────────────────────────┤
│  ⌗ Draw   ⚙ Tools   ⬚ Layouts │  ← **Layouts is new** (Flow F / CMP-069)
└───────────────────────────────┘
```

**Keep:** the interval row at depth zero, the crosshair stack, go-to-realtime, the symbol strip
as the search door.
**Change — one thing:** ⚠️ **the crosshair legend must be ON.** `legendMode` defaults to `always`
for a new account but resolves `off` for any stored blob carrying the retired `header.showLegend`
boolean, so an existing member can press-and-hold and get nothing (`CMP-086`). **Migrate the
legacy key once, on read, and stop consulting it** — do not add a settings toggle to compensate
for a settings bug.
**Drop list for this screen:** `$-Vol` strip, A/L/% scale chips, the "● LIVE" badge (already
dropped, correctly — `StockChart.module.css:778-797`), the centre watermark (**new** — `CMP-003`).

---

## FLOW B · Indicators → search → add → edit → hide → delete

```
┌─ Indicators ───────────────⌃──┐
│ [ Search indicators…        ] │  ← **new**
│                               │
│ ON THIS CHART                 │  ← **new band: applied first**
│  EMA 9        👁  ⚙  ⋯        │  ← **hide · settings · overflow**
│  EMA 20       👁  ⚙  ⋯        │
│  SMA 50       👁  ⚙  ⋯        │
│                               │
│ RECENT                        │  ← **new: recency, not favourites**
│  RSI · MACD · ATR             │
│                               │
│ ALL INDICATORS                │
│  Aroon                        │
│   ▸ Trend strength from the   │  ← KEEP. UCT's picker explains itself
│     time since the last high  │     and TradingView's does not (CMP-025)
│  Average True Range           │
│   ▸ Typical daily travel …    │
└───────────────────────────────┘
```

**Keep:** the self-explaining rows — the single clearest UCT advantage in the indicator surface.
**Change:**
- **An `ON THIS CHART` band at the top**, with per-row `👁 hide` / `⚙ settings` / `⋯`. This is the
  answer to F08 and F09, which this study **never measured** (`CMP-030`…`CMP-033`) — ⚠️ so
  **measure UCT's current legend-row affordances before building this**; the band may already
  half-exist.
- **Recency, not favourites** (`CMP-027`, `CMP-028`): TradingView ships favourites and *no*
  recents. Recency needs no user maintenance and matches how a trader actually re-adds indicators.
- **Truncate formula rows to their name** with the body behind the row (`CMP-029`) — today three
  formulas fill a phone screen.
- **The picker stays open after an add** (`CMP-026`), with a toast-level confirmation.
**Drop list:** formula bodies, category tabs (the search field replaces them at this catalogue size).

---

## FLOW C · Drawings → add → select → edit → move → lock → delete/undo

```
┌───────────────────────────────┐
│ ◂ Trend  Horiz  H-Ray  Fib  ▸ │  ← today: 3 of 18 visible, no affordance
│                          [⊞]  │  ← **new: "all tools" opens the grid**
└───────────────────────────────┘
            ↓ [⊞]
┌─ Drawing tools ────────────⌃──┐
│ [ Search tools…             ] │
│ RECENT   Trend · Horiz · Fib  │
│ ┌────┬────┬────┬────┐         │  ← all 18, four across, labelled
│ │Trnd│Horz│HRay│Rect│         │
│ │Fib │FibX│Chan│Ptch│         │
│ │AVWP│Adv │Vert│Extd│         │
│ │Arrw│Circ│Text│Meas│         │
│ │Posn│Cup │    │    │         │
│ └────┴────┴────┴────┘         │
└───────────────────────────────┘

placing:            selected:
┌───────────────────┐ ┌───────────────────┐
│ **Point 1 of 2**  │ │  ▓▓▓▓●▓▓▓▓▓▓▓●▓▓▓ │
│ ▓▓▓▓▓▓┈┈┈┈┈┈┈▓▓▓ │ │                   │
│ ▓▓▓ 678.42 ◂ axis │ │ [◐][⧉][🔒][🗑]     │ ← quick bar (VERIFY IT RENDERS)
└───────────────────┘ └───────────────────┘
```

**Keep:** tap-per-anchor placement (`CMP-036` — the adoption of TradingView's offset cursor is
**withdrawn**), the type-aware object menu, and `Set level…`.
**Change:**
- **An `[⊞]` all-tools affordance** at the end of the scrollable bar, opening a labelled grid with
  search and recency. This closes the study's top surviving UI gap (`CMP-034`) **without** copying
  TradingView's tabs — and note TV's own hub has the same disease (`CMP-083`), so tabs are not a
  proven answer.
- **Placement narration** — "Point 1 of 2" plus a live price echo on the axis (`CMP-039`). The one
  part of TradingView's placement model worth taking.
- **`Hide` in the object menu**, beside `Delete` (`CMP-045`).
- **Arm Redo on the first undo after a load** (`UCT-UNDO-0003`) — today it does not.
⛔ **Blocked pending measurement:** the quick bar, auto-select-after-placement, grab radius and
handle size are all `ACCESS_BLOCKED` (`CMP-041`, `CMP-042`, `CMP-048`). **Do not design these
until a finger or an Appium `driver.tap` has seen them.** The wireframe shows the quick bar
because source says it exists — that is a hypothesis, not a spec.

---

## FLOW D · Chart → price alert

```
long-press the bare plot
┌─ AT $700.64 ───────────────⌃──┐
│  ✎  Draw line at $700.64      │  ← KEEP ALL THREE, verbatim
│  📋 Copy $700.64              │
│  🔔 Alert when below $700.64  │
│      **▸ above · below**      │  ← **new: direction switch, inline**
├───────────────────────────────┤
│ CHART                         │  ← KEEP — this band is why UCT's sheet
│  Logarithmic scale        ○   │     is BROADER than TradingView's ⊕
│  Magnet crosshair         ●   │
│  Swing price labels       ○   │
│  📊 Indicators                │
│  ＋ Add indicator…            │
├───────────────────────────────┤
│ TIMEFRAME  1m 5m 15m …        │
└───────────────────────────────┘
```

**Keep everything.** This sheet is already better than TradingView's equivalent (`CMP-049`) and
the flow is two interactions with zero typing (`CMP-051`).
**Change — one addition:** an inline **above/below** switch on the alert row. UCT pre-decides the
direction from where you pressed, which is usually right and occasionally wrong; a two-state
inline control costs nothing and removes the only reason to open a form.
⛔ **Do NOT adopt TradingView's create-alert dialog.** Scope/condition/operator/value/Create is
five decisions for an outcome UCT reaches in two.

---

## FLOW E · Watchlist → rapid multi-symbol review

```
┌─ Watchlist ────────────────⌃──┐
│ AAPL   319.97   +0.9%   102.7M│  ← **restore Price / %Chg / Vol**
│ NVDA   184.22   -1.4%    88.1M│     (present at the API, dropped by
│ MSFT   512.08   +0.2%    31.4M│      the phone today — CMP-011)
│ …                             │
└───────────────────────────────┘
   tap → the chart follows. ONE tap. (CMP-010)
```

**Keep:** the one-tap row→chart loop. **This is UCT's single biggest structural win** — TradingView
needs two taps per symbol, forever, because its watchlist row opens the symbol screen instead.
**Change:** three columns and no horizontal overflow at 390px (`CMP-011`, `CMP-012`), and 44px
rows (`CMP-013`).
**Drop list:** every column beyond Price / %Chg / Vol; the sort header row (move sorting into the
sheet's overflow — 18px headers are the a11y defect that survives review).
**Result:** with the row fixed, this flow is unambiguously best-in-class. It is the highest
value-per-unit-cost item in the study after the Layouts door.

---

## FLOW F · Chart type / settings → return with context intact

```
┌─ Layouts ──────────────────⌃──┐   ← **the whole sheet is new**
│  ⬚ Swing board          ✓now  │      (CMP-069 — the largest gap)
│  ⬚ Earnings week              │
│  ⬚ Intraday                   │
│  ── firm templates ──         │   ← admin-published prebuilts:
│  ⬚ UCT Standard               │      a capability TradingView
│  ⬚ Breadth day                │      does not have at all
├───────────────────────────────┤
│  Save            Save as…     │
│  Rename          Delete       │
│  **Saved ✓ just now**         │   ← dirty-state, not silence (CMP-070)
└───────────────────────────────┘
```

**This is a sheet over an API that already exists** — `GET /api/charts/layouts` already returns
`{global, mine}`, and a row already carries both the arrangement and the four colour-group
symbols. The phone simply never renders it: the template lists are computed two lines above the
`isMobile` return and used only on the desktop path.

**Keep:** chart type and chart settings where they are — Tools → Chart settings, plus the three
most-flipped toggles inline in the price sheet (`CMP-060`), which is better than TradingView's
hub → Settings → seven sections.
**Change:** add the Layouts door; add a dirty-state indicator; **do not** adopt TradingView's
transactional Ok/Cancel commit (`CMP-061`) — it is right for a 40-field sheet and wrong for three
inline toggles.

---

## FLOW G · Portrait → landscape → portrait, state preserved

⛔ **This flow is specified conditionally, because it was never measured** (`CMP-063`, `CMP-064`).
UCT has a landscape phone branch in CSS; no landscape observation was captured on hardware.

**What the architecture predicts** (a prediction, not a measurement): symbol, timeframe, chart
type and settings survive a rotation because they live in the server-backed record; the pan/zoom
view survives on the same device because the view lock is localStorage keyed by widget id.

**What the target experience should be, once measured:**
- Landscape hides the symbol strip's second line and the widget footer; the interval row stays.
- The crosshair legend collapses to two lines.
- ⚠️ **The `presentation[deviceClass]` model in `60-p9-workspace-architecture.md` treats landscape
  as the same device class as portrait.** If measurement shows a phone user wants a different
  *arrangement* in landscape, that is a fourth class — decide it with evidence, not now.

**Action before design: capture a landscape session on hardware.** It is one BrowserStack session.

---

## FLOW H · UCT intelligence from the chart, without destroying chart context

```
┌───────────────────────────────┐
│ ☰  AAPL  Apple Inc.   319.97 ▴│
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ⚙ Tools → Fundamentals        │
└───────────────────────────────┘
            ↓ full-screen peer surface
┌─ Fundamentals · AAPL ──────◂──┐
│ EPS 1.57/1.44  +9%            │
│ Rev $94.0B …                  │
│                               │
│ **[ ◂ back to chart ]**       │  ← explicit, plus the existing
└───────────────────────────────┘     auto-return on symbol change
```

**Keep — and protect:** the widget-page model, and especially the **auto-return when the chart's
symbol moves**, which TradingView has no equivalent for. UCT's chart-adjacent context is
Fundamentals, Theme Tracker, AI Search and the firm's own research — **that is the reason its
members are there** (`CMP-077`).
**Change:** an explicit back affordance alongside the implicit one, and the widget list ordered by
use rather than by account order.
⛔ **Do NOT** add a TradingView-shaped news/ideas/social tab. It would displace the product's own
differentiator to match a competitor whose model is advertising-and-community, not research.
⛔ **Do NOT** add chart-native order entry (`CMP-078`). UCT has no execution and correctly does not
want it.

---

## What this prototype deliberately does NOT do

| not doing | why | evidence |
|---|---|---|
| Adopt cursor-decoupled placement | withdrawn — a legitimate model difference, and UCT answers occlusion with exact numeric entry instead | `CMP-036` |
| Add an OHLC row to the crosshair | it exists, plus four MA values | `CMP-020` |
| Build a bare-chart price→action bridge | it exists, and is broader than TradingView's | `CMP-049` |
| Add object→alert | it exists, and is cheaper than TradingView's | `CMP-054` |
| Add favourites for intervals or chart types | solves a problem UCT does not have | `CMP-017` |
| Restore the `$-Vol` strip or the A/L/% chips to the phone | UCT removed them **on purpose**; the study mistook that for a defect twice | `90-independent-validation.md` §1.1–1.2 |
| Design the drawing quick bar | `ACCESS_BLOCKED` — never seen on a device | `CMP-048` |
| Design landscape in detail | never measured | `CMP-063` |

**The prototype is small on purpose.** Five of the eight flows are mostly *"keep what is there"*.
The real work is one new sheet (Layouts), one restored table (Watchlist), one new affordance
(all-tools grid), and two corrections (legend migration, alert binding).
