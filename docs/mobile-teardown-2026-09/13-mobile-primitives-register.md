# 13 — MOBILE PRIMITIVES REGISTER

> ## ⚠️ CORRECTED DOWNSTREAM — read these before acting on anything below
> - **P9 / workspace persistence:** statements in this file that UCT mobile has no named-layout
>   concept, or that the durable phone state is `localStorage['charts_mobile_sym']`, are
>   **FALSE**. The phone shell writes the symbol to the **server-backed**
>   `charts_workspace_groups` via `useWorkspace().setGroupSym`
>   (`MobileChartsApp.jsx:54,104,155`), named layouts already exist server-side
>   (`/api/charts/layouts`, carrying layout **and** symbols), and the only thing missing is a
>   **phone door**. Authoritative: **`60-p9-workspace-architecture.md`** and
>   `lanes/uct-p9-workspace.jsonl`.
> - **Crosshair / `$ Vol` / price-scale tap targets:** `.volLegend` and `.scaleToggle` are
>   `display:none` on the phone chart shell (`StockChart.module.css:778-797`). Any claim here
>   that UCT shows `$ Vol`/`Avg 50D` on a phone, or that three 17×11px scale controls are a
>   phone defect, is withdrawn. Authoritative: **`90-independent-validation.md`**.
> - **Object → alert, bare-chart price actions, drawing-tool counts:** superseded by the
>   addendum in `40-p1-p2-verdicts.md` and by `70-task-flow-comparisons.md`.


**Thesis:** dozens of apparent feature gaps between UCT and TradingView mobile trace back to a
small number of cross-cutting interaction primitives. Build the primitive once and many
downstream gaps close together. This register is the answer to master-prompt §35 and §4
("which missing primitives cause the largest number of downstream deficiencies?").

Status key: ✅ native-verified on device · 📄 doc-tier only · ❓ still open
UCT column is grounded in `origin/master` @ `eceb65844` source, not assumption.

---

## P1 — CURSOR-BASED PRECISION PLACEMENT ✅

**Problem it solves.** A fingertip is ~9mm wide and *opaque*. Any interaction that requires
placing a point precisely — a drawing anchor, an alert level, a replay start bar — is
fundamentally broken by direct touch, because the target is underneath the finger at the exact
moment precision is needed.

**What TradingView actually does.** Selecting a drawing tool does not arm direct touch
placement. It enters a distinct **Drawing mode** that:
- swaps the whole chrome (new top bar, new bottom toolbar)
- renders a **movable crosshair cursor** decoupled from the fingertip
- shows the cursor's **live price on the price scale and live date on the time scale**
- displays an explicit **step counter** (`1 of 4` → `3 of 4`) and **instruction copy**
  ("Move cursor to start point" → "Move cursor to next point")
- offers a persistent **trash** to cancel mid-placement
- keeps **magnet/snap** one tap away in the mode's own toolbar

**Why it matters.** The finger never has to be on the anchor. Precision is delivered by
*decoupling* the pointer from the touch, not by asking the user to be accurate.

**Surfaces that reuse it.** Drawing placement (all families — needs confirmation across
Fib/Gann/patterns); replay start-bar selection (❓ to confirm); value-tracking crosshair is the
read-only sibling of the same idea.

**Frequency.** High for any chartist who marks up.

**UCT equivalent.** `MobileDrawBar` (122 LOC) arms a tool via `setActiveTool` and then relies on
`ChartDrawingOverlay` direct-touch placement. There is **no cursor, no step counter, no
instruction copy, no per-anchor axis readout**. The 18-tool roster is good; the *placement model*
is the gap.

**Should UCT adopt the principle?** **Yes — highest priority of any single item in this study.**
Not as a copy: the principle is *decouple the pointer from the finger and narrate progress*.

**Architectural implications.** Needs (a) a chart-mode state machine distinct from normal
interaction, (b) a cursor overlay layer with axis-label projection, (c) a per-tool step schema
(how many points, what to say at each), (d) chrome swapping in `MobileChartsApp`. This is a
genuine new primitive, not a tweak to `MobileDrawBar`.

---

## P2 — UNIVERSAL OBJECT → ALERT ✅

**Problem it solves.** The distance between "I notice something" and "tell me when it happens."
If alerts live in a separate destination, that distance is a navigation problem and the alert
never gets made.

**What TradingView actually does.** **"Add alert on …" is the FIRST item in every object context
menu**, observed identically on:
- an indicator → `Add alert on Aroon (14) at 0.00%…` — **pre-filled with the live value**
- a drawing → `Add alert on trendline…`
- the price scale → a **⊕ button appears beside the crosshair price** during value-tracking

The alert is *bound to the object*, and the object supplies the condition. There is no
"choose what to alert on" step because the object you tapped already answered it.

**Interaction distance measured natively:**

| From | To alert dialog | Depth |
|---|---|---|
| Price level | long-press chart → ⊕ on price scale | **2** |
| Indicator | tap legend → ••• → *Add alert on…* | **3** |
| Drawing | tap object → ••• → *Add alert on…* | **3** |
| Alerts manager (cold) | ⏰ or hub → + → configure | 3–8 |

**Surfaces that reuse it.** Indicators, drawings, price scale, watchlist rows (📄), strategies (📄),
chart patterns (📄).

**UCT equivalent.** `MobileAlertSheet` (115 LOC) is genuinely good *in isolation* — seeded from
the live price, with "Alert above"/"Alert below" as the commit buttons so direction needs no
separate picker. But it is reached via **More sheet → "Set price alert…"**, it is **price-only**,
and **no UCT chart object offers an alert action**. `IndicatorAlertPopover` exists on desktop
(`components/chart/IndicatorAlertPopover.jsx`) but is not wired into the mobile shell.

**Parity classification.** `PARTIAL` — price alerts PARITY_BUT_WORSE_UX (3 taps vs 2, and behind a
generic "More"); indicator/drawing alerts `MISSING` on mobile despite backend capability.

**Root cause.** `BACKEND_CAPABILITY_NOT_SURFACED` + `NAVIGATION_DEPTH`.

**Should UCT adopt?** **Yes.** This is cheap relative to its value — UCT already has
`useWatchlistAlerts`, `useIndicatorAlerts` and a desktop `IndicatorAlertPopover`. The missing
piece is an *object-context abstraction*, not alerting capability.

---

## P3 — CONTEXT-SENSITIVE OBJECT MENUS ✅

**Problem it solves.** A phone cannot show every action for every object. Desktop solves it with
right-click; touch has no right-click.

**What TradingView actually does.** One consistent grammar across object classes:
`tap object → inline toolbar appears IN PLACE → ••• → full context sheet`.
For an indicator the **legend row itself becomes the toolbar** (eye/gear/trash/•••), costing zero
extra vertical space. For a drawing, a **floating panel with its own drag handle** appears so the
user can move it off whatever it covers.

Menu ordering is identical across object types: **alert → organisation → destructive → Settings**.

**UCT equivalent.** None on mobile. UCT has `ChartContextMenu.jsx` (desktop) and
`components/mobile/ContextPopover.jsx` (a primitive, used elsewhere) but the mobile chart has
**no object selection model at all** — drawings are placed and edited through `MobileDrawBar`
global state, not per-object context.

**Should UCT adopt?** **Yes** — and note UCT already owns the `ContextPopover` primitive, so this
is wiring plus an object-selection model, not new UI from scratch.

---

## P4 — ORIENTATION AS DEPTH-FLATTENING ✅ *(new — discovered this session)*

**Problem it solves.** Portrait lacks horizontal budget, so tools get buried in a modal hub. That
depth is a *width* problem, not a priority judgement.

**What TradingView actually does.** Rotating to landscape **promotes ~6 tools out of the Analysis
hub onto the persistent toolbar** — 7 controls become 14. Indicators, alerts, bar replay, layouts
and object tree all go from **2 taps to 1**. Visible history triples (~2 months → ~6). The header
regains interval and exchange, which portrait truncates away entirely.

**The honest counterweight:** landscape compresses the pane stack badly — with three panes an
oscillator becomes hard to read — and the app tab bar is *not* hidden, spending vertical space
where it is scarcest.

**UCT equivalent.** `ChartsWorkspace.jsx:639` gates phone-landscape behind
`(pointer: coarse) and (orientation: landscape) and (max-height: 500px)`. It is therefore
**unreachable from any desktop browser at any window size** — only a real touch device enters it.
It is consequently the **least-tested branch in the UCT chart shell**, and no UCT test can see it
(jsdom evaluates no media queries).

**Should UCT adopt the principle?** **Yes** — treat landscape as a *depth-flattening* mode, not a
resize. And pair it with a pane policy change, since TradingView demonstrably got that part wrong.

---

## P5 — LONG-PRESS VALUE-TRACKING MODE ✅

**Problem it solves.** No hover on touch, so per-bar OHLC and indicator values have nowhere to live.

**What TradingView actually does.** Default legend is deliberately information-starved (last price
+ change only). Press-and-hold enters a modal **value-tracking mode**: crosshair appears, legend
expands to full `O/H/L/C/Change` **plus every plot of every indicator**, both axes show pills, and
dragging scrubs bar-to-bar. Observed directly: the Pine script dumped all 20+ of its plot values.

**UCT equivalent.** `StockChart.jsx` has `crosshairMode` with a three-way resolver
(`always | hold | off` via `crosshairMode.js`) — so **UCT already has the hold primitive**. What is
unverified is whether `'hold'` is the mobile default and whether the legend expands equivalently.
Flagged in `06-uct-current-mobile-baseline.md` §8 as an open runtime question.

**Should UCT adopt?** Likely **already present** — needs runtime confirmation, not construction.

---

## P6 — FAVORITES AS THE ONLY ACCELERATION ✅

**Problem it solves.** Long catalogues (110+ drawing tools, 400+ indicators, 20+ intervals) are
unusable on a phone without a fast path.

**What TradingView actually does.** Favoriting exists for intervals, indicators and drawing tools.
**There is no Recents anywhere** — favorites is the *only* acceleration mechanism.

**⚠️ And the gesture grammar is inconsistent:** favoriting an *indicator* is a **visible star tap**;
favoriting an *interval* is a **hidden long-press** that the app has to teach with a coach-mark.
Same concept, same app, two gestures — and TradingView shipping a coach-mark is an admission the
long-press is undiscoverable.

**UCT equivalent.** `mobileRecents.js` gives UCT **Recents for symbols** — which TradingView
lacks. UCT has no favoriting for intervals/indicators/tools.

**Verdict.** Split: **UCT_AHEAD on symbol recents**; adopt favoriting, but pick **one** gesture and
use it everywhere. This is a case where copying TradingView faithfully would import a defect.

---

## P7 — SUMMONED vs PERSISTENT CHROME ✅

**What TradingView actually does.** Nothing that isn't needed right now occupies the canvas.
Drawing mode replaces the toolbar wholesale; the object toolbar replaces the legend's values in
place; the drawing properties panel floats *and can be dragged off* what it covers. The `Save`
control carries a **red dirty-dot** so state is legible without opening anything.

**UCT equivalent.** `MobileChartToolbar` is a fixed 5-door strip that never changes; sheets are
modal overlays via `components/mobile/Sheet`. UCT's chrome is *static*; TradingView's is *modal to
the task*. UCT has no dirty-state indicator anywhere in the mobile chart.

**Should UCT adopt?** Yes for the dirty badge (trivial, high value). Yes for mode-swapped chrome
*if* P1 is adopted, since the two travel together.

---

## P8 — CONTEXTUAL QUICK ACTIONS ON THE PRICE SCALE ✅

**What TradingView actually does.** During value-tracking, a **⊕ appears beside the crosshair price
on the scale** — the 2-tap alert path. `v2.139.0` additionally made **long-press on the price
scale** open chart settings. The price scale is treated as an *interactive control surface*, not a
passive axis.

**UCT equivalent.** UCT's price scale is passive. `uct.charts.viewLock.*` keys show scale *state*
is persisted, but no scale-anchored actions exist on mobile.

**Should UCT adopt?** Yes — the price scale is the highest-value unused real estate on a phone
chart, and it is where price-anchored intent (alerts, scale modes) naturally belongs.

---

## Register summary — adoption priority

| # | Primitive | UCT status | Adopt? | Downstream rows unlocked |
|---|---|---|---|---|
| P1 | Cursor-based placement | absent | **critical** | all drawing precision + replay start |
| P2 | Universal object → alert | partial | **critical** | indicator/drawing/pattern alerts |
| P3 | Context-sensitive object menus | absent (primitive exists) | **high** | every per-object action |
| P4 | Orientation depth-flattening | gated, untested | **high** | whole landscape surface |
| P8 | Price-scale quick actions | absent | **high** | alerts, scale modes |
| P7 | Summoned chrome + dirty state | partial | medium | canvas density, save clarity |
| P5 | Long-press value tracking | likely present | verify | per-bar inspection |
| P6 | Favorites acceleration | inverse (has recents) | selective | catalogue navigation |

**The headline:** five primitives (P1, P2, P3, P4, P8) account for the substantial majority of the
interaction-level gaps found so far. None of them is a *feature*. All of them are *interaction
architecture* — which is precisely why a feature-by-feature backlog would have missed them.


---
---

# ADDENDUM — V2 native session (iPhone 17 Pro / iOS 26.6, landscape)

Everything above was written from the V1 session (iPhone 15 / iOS 17.5, portrait). A second
native session on a different device and OS generation added one primitive and **corrected two
existing entries**. The corrections are kept visible rather than edited into the originals,
because in both cases the original was flattering to the argument and the correction is not.

---

## P9 — THE LAYOUT IS THE DURABLE OBJECT; THE SYMBOL IS A VARIABLE INSIDE IT ✅ *(new)*

**Problem it solves.** "Why does TradingView feel like my workspace travels with me, and UCT feel
like a chart I have to rebuild?" That feeling is usually attributed to sync. It is not sync.

**What TradingView actually does — three measured facts that only make sense together.**

1. **Chart state survives a symbol change completely.** Switching SPY → AAPL preserved a Pine
   script pane, a second indicator, the interval and the pane geometry. Only the series data and
   the price scale changed. *(SYMBOL-0059)*
2. **The layout auto-commits, and says so.** The hub's `Save` tile carries a red dot when the
   layout is dirty and greys out when clean; it went dirty → clean with no user action. The
   desktop menu shows why: an explicit **Autosave** toggle, on by default, which is why
   "Save layout" is disabled on both clients. *(LAYOUT-0023, LAYOUT-0026)*
3. **Every client reads one account-level record.** A phone edit appeared in the desktop client's
   layout list within seconds, while a stale desktop tab was still rendering the old symbol.
   *(LAYOUT-0026)*

**So the model is:** the *layout* is the durable, named, account-level object. The *symbol* is a
variable slotted into it. Changing the variable does not disturb the object.

**UCT equivalent.** Inverted. The durable thing on UCT mobile is a **single symbol** in
`localStorage['charts_mobile_sym']`; indicator and settings state hangs off the chart widget, and
the phone shell has **no named-layout concept at all** — no New, no Open, no Save, no list.
`charts_workspace_layout` exists for the desktop grid and is debounced-saved with no dirty
indicator.

**Should UCT adopt?** **Yes — and it is the largest architectural item in this study**, larger
than P1, because P1 improves one interaction and P9 changes what the product *is* on a phone. It
is also the prerequisite for a real answer to "I set my chart up on the desktop this morning,
now I'm on the train."

**Architectural implications.** A named layout record (server-side, account-scoped), an
auto-commit path with a dirty flag, a mobile layout list, and — the load-bearing part —
**separating "what is on the chart" from "which symbol the chart is showing"** in the state model.
That last one is the real work; the UI is comparatively cheap once it exists.

**Corroborating detail worth copying:** TradingView's layout list identifies each layout by its
**contents and recency** (`SPY, 1D (Sep 7, 2026 at 21:07)`), not by name alone — which is why a
list containing two layouts called "Patrick" and one called "Unnamed" is still navigable.
*(LAYOUT-0001)*

---

## ⛔ CORRECTION TO P1 — the cursor model is narrower than stated above

P1 above says *"Selecting a drawing tool does not arm direct touch placement."*
**That is true for multi-anchor tools and false for single-anchor ones.**

Measured in V2: selecting **Horizontal line** and tapping the chart placed the line immediately at
the tapped price — tap-to-place, exactly like UCT. *(DRAW-0020)*

The accurate statement of the primitive is therefore **not** "TradingView drags where UCT taps."
It is:

> **Both products place by tap. TradingView makes the result immediately adjustable; UCT does not.**

On placement TradingView auto-selects the new object and hands over a **handle** plus an
**eight-control floating style toolbar** (colour, width, line style, text, templates, trash,
overflow) in the same gesture — so the tap is a *draft*. The step-counter cursor with axis
readouts is real, and it is what multi-anchor tools (Fib, channels, patterns) and the **bar-replay
start selection** use, where a wrong first anchor is expensive.

⚠️ The UCT half of this comparison is **not final**: UCT gates `DrawingQuickBar` on
`pointer: coarse`, which the 390px desktop-frame harness could not satisfy, so UCT may already
show an equivalent bar on a real phone. *(UCT-METHOD-0001)* Test that before writing any backlog
item against it.

**What survives the correction, and it is the important half:** precision is delivered by
*decoupling accuracy from the fingertip*. TradingView does that two ways — the cursor for
multi-anchor placement, and, newly measured, by letting a **crosshair reading be promoted into an
object**: the price-level menu's fifth item is literally *"Draw horizontal line at 723.62"*.

---

## ⬆ EXTENSION TO P2 — an arbitrary price is also an object

P2 above was scoped to *"price series, indicators and drawings"*. V2 shows the abstraction is
wider. Long-press the chart → a crosshair with a **⊕** beside its price → tap it, and a five-item
menu opens, **every item pre-filled with the exact price the user pointed at**:

> Add alert on SPY at 723.62 · Buy 1 SPY @ 723.62 limit · Sell 1 SPY @ 723.62 stop ·
> Add order on SPY at 723.62… · Draw horizontal line at 723.62

So the object model covers **any price the user can point at**, not just persisted objects. Alert
/ trade / draw are one vocabulary reachable from a level that exists only because a finger was
held there for 900ms. *(ALERT-0003)*

**Measured cost, both sides, no estimates:**

| | gestures | typing |
|---|---:|---|
| TradingView — alert at a level chosen by eye | **3** | none |
| UCT — alert at a level chosen by eye | **3** | **the price, on a phone keyboard** |

The gesture counts are equal. The difference is that TradingView never asks for a number, because
the chart already knows which number was meant.

---

## ⛔ CORRECTION TO P8 — two claims in it were too generous

1. **"The 2-tap alert path" is 3 gestures.** The ⊕ does not create an alert; it opens the
   five-item menu above. Long-press → ⊕ → Add alert. *(ALERT-0004)*
2. **TradingView's scale-mode badges are not bigger than UCT's — they are hidden.** Revealed by
   tapping the price scale, `A` and `L` measure roughly **20pt square**, also well under the 44pt
   minimum. UCT's equivalents are 17×11px and permanently on screen. *(CHART-0023, UCT-A11Y-0001)*

   ⛔ So the recommendation is **not** "make the toggles bigger like TradingView". It is
   **"hide them until the price scale is tapped"**, which is the actual difference, and which also
   returns permanent pixels to the chart. Writing it the first way would ship a change that misses
   the point and makes the toolbar wider for nothing.

Also newly measured: `A` (auto-fit) and `L` (log) are **independent toggles**, not a radio group —
both can be lit at once.

---

## Revised adoption priority

| # | Primitive | UCT status | Adopt? | Why it ranks here |
|---|---|---|---|---|
| **P9** | **Layout is the durable object** | **absent on mobile** | **critical — highest** | changes what the product *is* on a phone; prerequisite for cross-device continuity |
| P2 | Universal object → alert *(now incl. any pointed-at price)* | partial | **critical** | one vocabulary unlocks alert/trade/draw everywhere |
| P1 | Adjustable-after-placement *(restated)* | unknown on real touch | **critical, but TEST FIRST** | UCT may already have half of it behind `pointer: coarse` |
| P3 | Context-sensitive object menus | absent (primitive exists) | high | every per-object action |
| P4 | Orientation depth-flattening | evidenced in V2 | high | see below |
| P8 | Price-scale quick actions *(corrected)* | absent | high | highest-value unused real estate on a phone chart |
| P7 | Summoned chrome + dirty state | partial | medium | the dirty dot alone is trivial and high-value |
| P5 | Long-press value tracking | ✅ **verified** — long-press *is* the crosshair | verify on UCT | per-bar inspection |
| P6 | Favorites acceleration | inverse (has recents) | selective | catalogue navigation |

**P4 gained hard evidence in V2 and deserves promotion on the strength of it.** Rotating to
landscape does not merely reflow the toolbar from 7 controls to 14 — **the Analysis hub sheds its
entire TOOLS band**, because all seven of those tools became toolbar buttons. The hub's contents
are a *function of what the toolbar can already reach*, so there is never a second door to the
same thing. *(NAV-0042, NAV-0043)* UCT's five-door toolbar and eleven-row Tools sheet are
identical in every orientation.

**The headline, restated after two sessions:** the gap is not a feature list. It is that
TradingView has an *object model* (P2, P3), a *state model* (P9), and *orientation-aware
information architecture* (P4) — and UCT has a toolbar.


---
---

# ADDENDUM 2 — local sandbox pass (`RESPONSIVE_TOUCH_VARIANT_VERIFIED`)

Everything above compared TradingView (operated on real iPhones) against UCT read mostly from
source. This addendum is the first pass where **UCT's own object menu was operated**, in a local
E2E sandbox with real market data. Full verdicts: `40-p1-p2-verdicts.md`.

It overturns two entries and closes one.

---

## ⛔ P1 — THE BACKLOG ITEM IS WITHDRAWN

P1 above says cursor-based placement is *"the highest priority of any single item in this study"*
and that UCT's *"placement model is the gap."*

**Measured, that is wrong.** UCT's drawing context menu carries **`Set level…`** — an inline
numeric field, **pre-filled with the current value**, `type="number"` with
**`inputmode="decimal"`** so a phone raises a keypad rather than a QWERTY, beside a `Set` commit.
Typing `755.25` moved the stored drawing to exactly `755.25`.

On the axis P1 is *about* — precision — **a typed number beats a dragged cursor**, because a
cursor can never be finer than the pixel beneath it.

**What survives:** TradingView is better at **narrating** placement — live price and date on both
axes while an anchor moves, a step counter, instruction copy, a persistent cancel. That is worth
copying. The *cursor* is not.

**Revised recommendation:** take the **live axis readout**, not the cursor model. Adding a
decoupled cursor would bolt a mode onto a product whose mobile idiom is direct manipulation plus
an object menu, and would promote the weaker of the two precision paths to primary.

⚠️ Four coarse-gated behaviours are still untested (`HIT_THRESHOLD`, `HANDLE_R` + halo,
auto-select-after-placement, `DrawingQuickBar`). They can only strengthen UCT's position here,
never weaken it — every one of them is a touch affordance UCT *has* and this harness could not
execute.

---

## ✅ P2 — CLOSED AT PARITY FOR DRAWINGS

`Set alert…` expands inline to `▲ Above` / `▼ Below`. **No text field, no keyboard.** The created
alert carried the drawing's price to full precision (`759.7385561455568`).

| | TradingView | UCT |
|---|---:|---:|
| Gestures to an alert on a drawing | 3 | **3** |
| Typing | none | **none** |
| Direction | defaults to *Crossing* | **explicit Above/Below** |

**Equal cost, and UCT is arguably clearer.** The one real difference is that UCT's alert is
**seeded, not bound**: deleting the drawing leaves the alert, and on a sloped trendline it
snapshots the later endpoint (`764.645`) rather than following the line.

⛔ **Delete from this register any statement that UCT lacks object → alert.** It ships it.

The surviving P2 gap is narrower and is the **highest-value, lowest-cost item in the study**:
**bare-chart price → contextual actions**. Long-press on the empty plot area produces nothing
(16 interactive elements before, during and after the hold), while UCT already owns every part
needed — a working crosshair with the exact price, a type-aware menu component, `Set alert…` and
`Set level…`. Only the wire is missing.

---

## ✅ P3 — PRESENT, NOT ABSENT

P3 is listed above as *"absent (primitive exists)"*. The drawing context menu **is** a
context-sensitive object menu, and it is **type-aware**: a horizontal line offers 7 items; a sloped
trendline offers the same plus **`Make horizontal`**, inserted only where it means something.
`Save as default` has no TradingView mobile equivalent found.

---

## ⛔ WITHDRAWN: the redo UCT_AHEAD

`TV-IOS-UNDO-0002` recorded UCT as ahead because it ships Undo **and** Redo where TradingView
ships only Undo. Measured: Undo correctly restored a `Set level…` edit; **Redo did nothing**, while
reporting `disabled = false` throughout.

An affordance that looks available and silently does nothing is worse than an honest absence, so
the UCT_AHEAD is withdrawn. ⚠️ Scope not established — whether Redo covers other operation types
was not tested before the browser session was lost, so the honest claim is *"Redo does not cover
property edits and gives no indication of that"*, not *"Redo is broken."*

---

## Revised adoption priority (supersedes Addendum 1's table)

| # | Primitive | UCT status | Adopt? |
|---|---|---|---|
| **P2b** | **Bare-chart price → contextual actions** | **the wire is missing; every part exists** | ⭐ **highest value, lowest cost** |
| P9 | Layout is the durable object | absent on mobile | critical — largest architectural item |
| P2 | Object → alert | ✅ **shipped, parity** | — closed |
| P3 | Context-sensitive object menus | ✅ **shipped, type-aware** | — closed |
| P1 | Precision placement | ✅ **solved differently and arguably better** | ⛔ cursor model withdrawn; take the **axis readout** only |
| P4 | Orientation depth-flattening | evidenced on TradingView; UCT identical in both orientations | high |
| P8 | Price-scale quick actions | absent | high |
| P7 | Summoned chrome + dirty state | partial | medium — the dirty dot is trivial and high-value |
| P5 | Long-press value tracking | ✅ crosshair works; **no O/H/L/C** | add the OHLC row — cheap, data already present |
| P6 | Favorites acceleration | inverse (has recents) | selective |

**The headline, restated after the sandbox pass:** the gap is smaller and more specific than two
sessions of TradingView-first research suggested. UCT already has the object model (P2, P3) and a
*better* precision mechanism than the one I was about to recommend copying. What it lacks is the
**state model** (P9) and a handful of **bridges** between capabilities it already ships.


---
---

# ADDENDUM 3 — real-coarse-pointer pass

Real iPhone 15 / iOS 17.5 → mobile Safari → BrowserStack Local → the local sandbox. Physical
touchscreen. Full detail in `40-p1-p2-verdicts.md`.

**Two entries are overturned, and both were fine-pointer artifacts of the 390px frame.**

## P2b — bare-chart price to contextual actions: SHIPPED, not missing

Addendum 2 ranked this the highest-value, lowest-cost item on the evidence that long-press on the
empty plot produced nothing. On a real touchscreen it opens a price-anchored sheet:

> AT $700.64 — Draw line at $700.64 / Copy $700.64 / Alert when below $700.64
> CHART — Logarithmic scale / Magnet crosshair / Swing price labels / Indicators / Add indicator...
> TIMEFRAME — 1m / 5m / ...

UCT is at parity and the sheet is broader than TradingView's five-item price menu. Remove the item.

## P5 — long-press value tracking: UCT IS AHEAD, not behind

The crosshair legend on the device shows the full OHLC row, volume, change, change percent AND four
inline moving averages (EMA 9, EMA 20, SMA 50, SMA 200). The "broader indicator readout" previously
credited to TradingView belongs to UCT. Remove "add an OHLC row" from the backlog.

## Unchanged, and now confirmed on real hardware

Drawing-bar discoverability: roughly five of twenty tools visible, no scroll affordance, no
coach-mark. TradingView's searchable category-tabbed picker remains the copyable answer. This is now
the top surviving UI item.

## Still unverified

HIT_THRESHOLD 15px, HANDLE_R 7px + halo, auto-select-after-placement, DrawingQuickBar — all four
need a drawing placed on the device, which the synthetic-pointer harness could not do (iOS text
selection claims short taps on plain-text sheet rows; taps on the canvas with a tool armed did not
place). A harness limit, not a product finding. App Automate / Appium against the same bs-local URL
closes it in one command.

## Where the register now stands

| # | Primitive | UCT status | Adopt? |
|---|---|---|---|
| P9 | Layout is the durable object | absent on mobile | **critical — the one large architectural item left** |
| P2 | Object to alert | shipped, parity | closed |
| P2b | Bare-chart price to actions | **shipped, broader than TradingView** | closed |
| P3 | Context-sensitive object menus | shipped, type-aware | closed |
| P5 | Long-press value tracking | **shipped, ahead of TradingView** | closed |
| P1 | Precision placement | solved differently (Set level), arguably better | cursor model withdrawn; take the axis readout only |
| P4 | Orientation depth-flattening | TradingView only | high |
| P8 | Price-scale quick actions | absent | high |
| P7 | Summoned chrome + dirty state | partial | medium |
| P6 | Favorites acceleration | inverse | selective |

Five of ten primitives are now closed as shipped or solved-differently. The gap shrank every time
UCT was measured on the correct branch instead of inferred from a degraded one.

---
---

# FINAL CLASSIFICATION — deliverable D

**This section closes the register.** Every candidate primitive named in the convergence
directive is classified `TRADINGVIEW_ADVANTAGE` / `UCT_ADVANTAGE` / `PARITY` /
`DIFFERENT_MODEL` / `NOT_WORTH_COPYING`, with the evidence row and what UCT should actually do.
Where an earlier addendum in this file already moved a primitive, the classification below is
the one that stands.

| # | primitive | classification | evidence | what UCT should actually do |
|---|---|---|---|---|
| 1 | **Cursor / axis placement narration** | `TRADINGVIEW_ADVANTAGE` *(narration only)* | `CMP-039`, `TV-IOS-DRAW-0083/0084` | **Adopt the narration, not the cursor.** A step counter ("point 1 of 2") and live axis echo while placing. The cursor *model* is withdrawn — see #14. Cheap, self-contained, no model change. |
| 2 | **Exact numeric editing** | ⭐ `UCT_ADVANTAGE` | `CMP-040`, `UCT-DRAW-0004` | **Protect and extend.** `Set level…` opens a pre-filled decimal keypad at menu depth 1; TV's equivalent is a Coordinates tab and that row is INFERRED. Extend to the *single anchor* of a sloped line, which is the one case it does not cover. |
| 3 | **Contextual price actions** (bare chart → actions) | `PARITY`, UCT broader | `CMP-049`, `UCT-CHART-0007` | **Nothing. Ships, and is broader than TradingView's** — three price-anchored actions plus chart settings, indicators and timeframe from one long-press. ⛔ The backlog item that once ranked #1 is withdrawn. |
| 4 | **Contextual object actions** | `PARITY`, different sets | `CMP-043`, `CMP-044` | **Add `Hide`** (`CMP-045`) — the one verb genuinely absent. UCT's menu is already *type-aware*, which TV's fixed list is not. |
| 5 | **Object → alert conversion** | `PARITY` on existence, `TRADINGVIEW_ADVANTAGE` on semantics | `CMP-054`, `CMP-055` | **Bind the alert to the object.** UCT's path is cheaper (three gestures, zero typing) and weaker (a snapshot, and a sloped line silently snapshots its later endpoint). This is the one place to copy TradingView wholesale. |
| 6 | **Favorites / recents acceleration** | `NOT_WORTH_COPYING` | `CMP-017`, `CMP-027`, `TV-IOS-IND-0010` | **Do nothing.** TV needs favourites because its catalogues are huge and its sheets scroll; UCT's eight intervals are all already visible. And TV ships **no recents at all** in its mobile indicator picker — an absence, not a pattern. |
| 7 | **Crosshair / value tracking** | `UCT_ADVANTAGE` on content, **`PARTIAL` on availability** | `CMP-020`, `CMP-086`, `UCT-CHART-0008` | **Protect the content; fix the availability.** OHLCV + change% **plus four live MA values** — TV's documented legend shows OHLC + change + volume. ⛔ **`$ Vol` / `Avg 50D` WITHDRAWN on review**: `.volLegend` is `display:none` on the phone shell (`StockChart.module.css:778-797`) — UCT removed them deliberately. ⛔ **And the legend is gated on the `legendMode` USER SETTING, not on any pointer branch**; its legacy fallback `header.showLegend` sits in every stored production blob, so a member's phone can show **no OHLC at all**. That is the real work item. |
| 8 | **Persistent undo / redo** | `UCT_ADVANTAGE`, qualified | `CMP-067`, `UCT-UNDO-0003` | **Fix the first-use path, then keep the claim.** UCT ships both arrows; TV's toolbar overflows the viewport in both orientations. But UCT's Redo does not arm on the first undo after a load, and no history survives a reload. Write it as *"works within a warm session"* — never as a clean win. |
| 9 | **Bottom-sheet interaction** | `PARITY` | `CMP-060`, `UCT-NAV-0005` | **Nothing.** Both products are sheet-first on the phone; UCT's `Sheet` primitive already carries focus-trap, drag-dismiss, scroll-lock and safe-area. |
| 10 | **One-handed chart controls** | ⭐ `UCT_ADVANTAGE` | `CMP-015`, `CMP-002`, `CMP-084` | **Protect the interval row.** Eight intervals in the thumb arc at depth zero beats TV's scrolling sheet. ⛔ **The "17×11px price-scale controls" caveat is WITHDRAWN on review** — `.scaleToggle` is `display:none` on the phone chart shell, so those controls do not render on a phone at all. The phone chart shell is essentially clean; the surviving sub-44px controls are the watchlist sort headers (#12). |
| 11 | **Workspace persistence** | `TRADINGVIEW_ADVANTAGE` on the **door**; `UCT_ADVANTAGE` on the **model** | `CMP-068`–`CMP-073`, `UCT-P9-0001`–`0003` | **Put the lifecycle on the phone.** UCT's model is arguably better (the symbol is a variable; admins can publish firm-wide prebuilts, which TV cannot) and its phone has no door to it. See `60-p9-workspace-architecture.md`. |
| 12 | **Rapid symbol review** | ⭐ `UCT_ADVANTAGE` | `CMP-010`, `CMP-011`, `CMP-012` | **Fix the row, then this is best-in-class.** UCT: one tap from a watchlist row to a chart. TV: two, on every symbol, forever. But UCT's phone row drops Price/Vol/%Chg *that the API returns* and overflows horizontally. |
| 13 | **Contextual intelligence** | `DIFFERENT_MODEL` | `CMP-076`, `CMP-077` | **Do not trade this for a TradingView-shaped news tab.** TV's chart-adjacent context is news, ideas, social and broker order entry; UCT's is Fundamentals, Theme Tracker, AI Search and the firm's research. ⭐ Keep the auto-return-on-symbol-change — TV has no equivalent. |
| 14 | **Drawing selection / edit controls** | ⛔ **UNRESOLVED** + `PRODUCT_MODEL_DIFFERENCE` on placement | `CMP-041`, `CMP-042`, `CMP-048`, `CMP-036` | **Measure before designing.** Grab radius, handle radius, auto-select-after-placement and the quick bar are all `ACCESS_BLOCKED`: no drawing could be placed through the harness, and **the cause was never isolated between harness synthesis and UCT's own pointer accounting** (see the corrected `UCT-COARSE-0005`). Placement itself (tap-per-anchor vs offset cursor) is a legitimate model difference and the adoption item is **withdrawn**. |

## The register in one line each

- **UCT already advantages:** exact numeric editing · crosshair *content* · one-handed interval
  access · rapid symbol review · the workspace *model* · contextual price actions (broader
  than TV's) · redo existing at all · **and a phone-canvas cleanup rule this study twice
  mistook for a defect** (`display:none` on the `$-Vol` strip and the A/L/% chips).
- **TradingView genuinely advantages:** the phone layout *door* · alert **binding** ·
  placement narration · non-destructive `Hide` · object tree · catalogue breadth.
- **Not worth copying:** favourites acceleration · transactional settings commit for three
  inline toggles · TV's absent indicator recents · cursor-decoupled placement as a *gap*.
- **Different model, keep UCT's:** contextual intelligence · per-symbol drawing ownership ·
  no chart-native order entry.
- **Unresolved and honest about it:** every coarse-pointer drawing-selection behaviour.

**Ten of fourteen primitives are now closed as shipped, solved-differently, or not worth
copying. Four carry real work, and only one of those four — the phone layout door — is large.**

> ⚠️ **REVISED 2026-09-08 after independent adversarial review.** Rows 7, 10 and 14 changed.
> The review also found that this file's *earlier* sections still assert P9 claims that
> `60-p9-workspace-architecture.md` overturned — see the banner at the top of this file.
> Adjudication: `90-independent-validation.md`.
