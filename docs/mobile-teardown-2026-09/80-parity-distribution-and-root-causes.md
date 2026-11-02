# Final parity distribution and root-cause clustering

> ## ⚠️ REVISED 2026-09-08 AFTER INDEPENDENT ADVERSARIAL REVIEW
> The reviewer returned **MATERIALLY FLAWED** and was right on every load-bearing claim I
> re-checked against source. Five corrections are folded in below and the numbers were
> **recomputed from the ledger, not patched**:
> - **`$ Vol` / `Avg 50D` withdrawn as a UCT crosshair advantage** — `.volLegend` is
>   `display:none` on the phone chart shell (`StockChart.module.css:778-797`). UCT *deliberately*
>   removes it; this study twice recorded the opposite.
> - **The 17×11px price-scale tap targets withdrawn** — `.scaleToggle` is `display:none` on the
>   same branch. They do not render on a phone. `CMP-084` went BROKEN/HIGH → PARITY/NORMAL.
> - **A better finding replaces them (`CMP-086`)** — the OHLC legend is gated on the `legendMode`
>   **user setting**, not on any pointer branch, and its legacy fallback `header.showLegend`
>   "sits in every stored blob in production". A real member's phone can show **no OHLC at all**.
> - **Drawing-bar counts corrected** — 18 tools plus a pinned eraser, and the device capture shows
>   **3** visible, not "~5 of 20". The gap is worse than first stated.
> - **TradingView's replay paper-trading and its object→alert rows downgraded to presence-only**
>   — observed in a menu, never activated.
>
> Full adjudication, including the findings I did **not** accept: `90-independent-validation.md`.

**Deliverables B and C.** Everything here is computed from
`ledger/PARITY_COMPARISONS_V2.jsonl` — **86 comparable interactions**, each citing its
TradingView census row(s) and its UCT observation row(s). No number in this document was
typed beside the list it describes; every count came out of the file.

> **What a "comparable interaction" is, and why the denominator is 86 and not 434.**
> The TradingView census holds 434 rows. That is the size of *TradingView's surface*, not the
> size of a comparison. A parity class is only meaningful where **both** products were
> observed doing the same thing, so the distribution is computed over the 86 interactions
> where a UCT observation exists to set against a TV one. Quoting a percentage over 434 would
> silently convert "we did not measure UCT here" into "UCT does not do this" — the exact error
> this study spent five corrections unlearning.

---

## B1. Distribution over all comparable interactions (n = 86)

| class | n | % |
|---|---:|---:|
| **PARITY** | 22 | 25.6% |
| TV_UNVERIFIED / NOT_MEASURED | 14 | 16.3% |
| **UCT_AHEAD** | 10 | 11.6% |
| PRODUCT_MODEL_DIFFERENCE | 8 | 9.3% |
| PARITY_BUT_WORSE_UX | 7 | 8.1% |
| PARTIAL | 6 | 7.0% |
| TRADINGVIEW_AHEAD | 5 | 5.8% |
| BROKEN | 5 | 5.8% |
| ACCESS_BLOCKED | 3 | 3.5% |
| DESKTOP_ONLY | 3 | 3.5% |
| MISSING | 2 | 2.3% |
| NOT_DISCOVERABLE | 1 | 1.2% |
| MOBILE_UNUSABLE | **0** | 0% |

**At parity or better: 32 of 86 = 37.2%.** **Genuine deficiency (BROKEN + PARTIAL + MISSING +
DESKTOP_ONLY + NOT_DISCOVERABLE + PARITY_BUT_WORSE_UX + TRADINGVIEW_AHEAD): 29 of 86 = 33.7%.**
The remaining 29.1% is a deliberate product difference, an unmeasured TV baseline, or a blocked
check.

⚠️ **`MOBILE_UNUSABLE` is zero, and that is a real finding, not an omission.** No comparable
interaction was found where UCT's phone surface makes a task impossible. The BROKEN rows degrade
a task; none prevents one.

## B2. The weighted distribution — high-frequency / high-value only (n = 40)

This is the number that matters. An "active charting user" performs these many times per
session, or is blocked by them.

| class | n | % |
|---|---:|---:|
| **PARITY** | 15 | 37.5% |
| **UCT_AHEAD** | 7 | 17.5% |
| TV_UNVERIFIED / NOT_MEASURED | 4 | 10.0% |
| ACCESS_BLOCKED | 3 | 7.5% |
| PARTIAL | 3 | 7.5% |
| PARITY_BUT_WORSE_UX | 2 | 5.0% |
| BROKEN | 2 | 5.0% |
| PRODUCT_MODEL_DIFFERENCE | 2 | 5.0% |
| NOT_DISCOVERABLE | 1 | 2.5% |
| DESKTOP_ONLY | 1 | 2.5% |
| **TRADINGVIEW_AHEAD** | **0** | **0%** |
| MISSING | 0 | 0% |

> **On the high-frequency set, UCT is at parity or ahead on 22 of 40 interactions — 55%.**

### ⚠️ Read the zero honestly

**`TRADINGVIEW_AHEAD = 0` in this subset does NOT mean TradingView has no high-value
advantages.** It means every high-value TV advantage was classified by the *nature* of the
gap, using the taxonomy specified for this study, rather than as a generic "TV wins":

- the phone layout door → **DESKTOP_ONLY** (`CMP-069`)
- drawing-tool findability → **NOT_DISCOVERABLE** (`CMP-034`)
- alert binding vs seeding → **PARTIAL** (`CMP-055`)
- autosave feedback → **PARTIAL** (`CMP-070`)
- the entry-point feature surface → **PARITY_BUT_WORSE_UX** (`CMP-083`)

Those five *are* TradingView's high-value advantages. Anyone quoting the 0% without this
paragraph is misusing the table.

### The 7 high-value interactions where UCT is ahead

| row | interaction | why |
|---|---|---|
| `CMP-010` | one tap from watchlist row to chart | TV needs two, on every symbol, forever |
| `CMP-015` | eight intervals at depth zero | TV: open a scrolling sheet |
| `CMP-020` | crosshair content **when enabled** | OHLCV + change% **+ 4 live MA values**. ⚠️ `CMP-086`: whether it is enabled at all is a user setting |
| `CMP-040` | `Set level…` exact numeric placement | pre-filled keypad at menu depth 1 |
| `CMP-051` | price → alert in 2 interactions, zero typing | TV: a form with an operator choice |
| `CMP-065` | leave and return with nothing lost | measured in the server record |
| `CMP-071` | phone→desktop workspace continuity | measured end to end |

### Evidence quality behind the comparison

| UCT tier | n | | TV tier | n |
|---|---:|---|---|---:|
| RESPONSIVE_TOUCH_VARIANT_VERIFIED | 34 | | NATIVE_VERIFIED | 71 |
| NATIVE_VERIFIED (app / server record) | 17 | | OFFICIAL_DOC_VERIFIED | 9 |
| NOT_MEASURED | 15 | | INFERRED_NOT_VERIFIED | 5 |
| REAL_COARSE_POINTER_VERIFIED | 13 | | NO_EQUIVALENT | 1 |
| SOURCE_ONLY | 4 | | | |
| ACCESS_BLOCKED | 3 | | | |

⚠️ **The honest weakness of this study is right here, and the adversarial review made it worse
before it made it better.** 34 of 86 UCT observations come from the fine-pointer 390px frame —
the tier that has now produced **five** false negatives, and the last two were found not by a
device but by *reading the CSS*. Those two are the most embarrassing kind: in both cases UCT had
**deliberately solved** the problem for phones (`display:none` on the `$-Vol` strip and the
A/L/% scale chips, with a comment explaining that they are "desktop furniture"), the harness
could not see the branch, and the study recorded a defect where a considered decision existed.

**Surviving negative claims that still rest on `RESPONSIVE_TOUCH_VARIANT` alone:** `CMP-011`,
`CMP-012`, `CMP-029` (rendering-geometry facts a pointer cannot change) and the UCT half of
`CMP-055` (corroborated by source, never reproduced on a device). Everything else negative about
UCT is device-verified or source-verified.

---

## C. Root-cause clustering — 8 causes, exhaustive over all 32 deficiency rows

Verified mechanically: 32 of 32 gap rows clustered, 12 of 12 high-value gap rows clustered,
no row in two clusters, no cluster containing a non-gap row.

| # | cause | rows | HIGH | share of gap |
|---|---|---:|---:|---:|
| **C1** | **DESKTOP_COMPONENT_REUSE AT PHONE WIDTH** | 8 | 3 | 25% |
| **C2** | **MOBILE_SURFACE_COVERAGE** — no phone door to shipped capability | 3 | 1 | 9% |
| **C3** | **STATE_SCOPE_MODEL** (P9) | 6 | 2 | 19% |
| **C4** | **OBJECT_LIFECYCLE_VOCABULARY** | 5 | 0 | 16% |
| **C5** | **INFORMATION AT THE POINT OF DECISION** | 4 | 2 | 12% |
| **C6** | **TOUCH_BRANCH_UNTESTABILITY** | 3 | 3 | 9% |
| **C7** | **ALERT_SEMANTICS** — seeded, not bound | 1 | 1 | 3% |
| **C8** | **DELIBERATE PRODUCT SCOPE** (not a defect) | 2 | 0 | 6% |

**Four causes — C1, C2, C5, C6 — generate 18 of 32 gap rows and 9 of 12 high-value gap rows.** That is the majority of the real competitive gap, and none of the four is "UCT is
missing a feature."

### C1 · Desktop component reused at phone width — *the largest cause*
`CMP-002` `CMP-003` `CMP-004` `CMP-011` `CMP-012` `CMP-013` `CMP-029` `CMP-085`
*(`CMP-084` left this cluster on review — the price-scale chips it named do not render on a phone.)*

A component built for a wide viewport is rendered narrow, and nothing decides what to *drop*.
The symptoms are always the same three: horizontal overflow, sub-44px controls, and content
that fills the screen because it was never truncated for it. The watchlist drops Price/Vol/%Chg
*while the API returns them*; formula bodies are printed in full; the voice orb is clipped.
⭐ **And UCT already knows the fix.** `StockChart.module.css:778-797` deletes the `$-Vol` strip
and the A/L/% chips from the phone canvas, with a comment saying they are "desktop furniture"
that "cover candles to answer questions the settings sheet already answers". That rule exists,
and it covers exactly two elements. **Generalising it is the remedy for this whole cluster.**
**The fix is a rule, not nine tickets:** a component that renders on a phone must declare a
phone presentation — which columns, which controls, what truncation — or it must not render.

### C2 · A working capability with no phone door
`CMP-069` (layout lifecycle) `CMP-079` (bar replay) `CMP-080` (symbol comparison)

Each of these **exists and works** in UCT and has no entry point in the phone shell. The
phone Tools sheet is five rows plus a widget list; `MobileChartsApp` is a deliberately
curated subset — but the curation has **no register**, so nobody can tell a deliberate
omission from an oversight. `CMP-069` is the largest single gap in the study, and the fix is
a sheet over an API that already returns `{global, mine}`.
**The fix is a register:** every desktop chart capability is either *on the phone*, *listed as
deliberately desktop-only*, or *a bug*. Today all three look identical.

### C3 · No scope model for durable state (P9)
`CMP-066` `CMP-070` `CMP-072` `CMP-073` `CMP-075` `CMP-086`

One conceptual object — "my chart" — is stored at four different lifetimes chosen
historically rather than deliberately: server record, localStorage, module registry, nothing.
Hence a view lock that does not travel with the layout that owns it, a grid mode that leaks to
a form factor that cannot enter it, an autosave with no indicator and no named target, an undo
history that dies with the tab, and a last-writer-wins sync that can pin a device past a copy
it never took. ⭐ **`CMP-086` is the newest member and the sharpest:** a legacy boolean
(`header.showLegend`) that "sits in every stored blob in production" silently decides whether a
member's phone shows an OHLC readout at all. A stored value from a retired schema outranking a
current default is the same disease as everything else here — state whose lifetime nobody chose.
Full analysis: `60-p9-workspace-architecture.md`.

### C4 · The object vocabulary stops at create/edit/delete
`CMP-037` `CMP-045` `CMP-046` `CMP-062` `CMP-081`

UCT can make an object, change it and destroy it. It cannot **hide** it, **reuse** it as a
template, or **enumerate** it. TradingView's object menu carries Hide beside Remove, named
Templates, and an Object tree reachable from inside every object. All five rows are NORMAL
weight — this is the cheapest cluster to close and the least urgent.

### C5 · Not enough information at the moment of decision
`CMP-006` `CMP-034` `CMP-039` `CMP-083`

The user must choose a tool, a symbol or an anchor, and the surface does not show enough to
choose well: ~5 of 20 drawing tools visible with no scroll affordance; a search result row
carrying ticker + name where TV carries exchange, type and country; silent placement where TV
narrates "point 1 of 2" and echoes the anchor onto both axes.
⭐ **TradingView has the same disease in its worst form** (`CMP-083`: its Analysis hub's
default detent hides 15 of its 18 entry points). Neither product has solved *"a phone cannot
show a desktop's feature surface."* **This is the one cluster where UCT should lead rather
than copy.**

### C6 · The touch branch cannot be tested by anything but a finger
`CMP-041` `CMP-042` `CMP-048` — **3 rows, all high-value, all unresolved**

`_COARSE_POINTER` is a **module-load constant** over a live media query
(`ChartDrawingOverlay.jsx:83-90`), and every touch affordance in the drawing layer hangs off
it: grab radius, handle radius, auto-select-after-placement, the coach chip, the quick bar,
sheet-vs-popover. A resized desktop frame therefore *can never* become a touch surface, and
BrowserStack's synthesised taps reach every DOM control but not the overlay's placement path.
**This is a testability defect that produced three unresolved high-value checks in this
study, and it will do the same to the next engineer.** Fix: use the `useHasCoarsePointer`
hook that already exists in `useBreakpoint.js`, which also makes the branch reachable to an
emulated pointer.

### C7 · Alerts are seeded, not bound
`CMP-055` — 1 row, high-value

UCT's drawing→alert is *cheaper* than TradingView's (three gestures, zero typing) and
*semantically weaker*: it snapshots a price at creation, so moving the line does not move the
alert, and a sloped line silently snapshots its later endpoint. TV binds the alert to the
object. **This is the only cluster where TradingView's behaviour is simply better and worth
adopting wholesale.**

### C8 · Deliberate product scope — recorded so it is never mistaken for a gap
`CMP-016` (8 intervals vs ticks→ranges + custom) `CMP-058` (5 chart types vs 21)

Plus the model differences that are *not* in the gap set at all: no chart-native order entry
(`CMP-078` — UCT has no execution and correctly does not want it), no Siri shortcuts or home
widgets (`CMP-082` — a web app cannot ship them), and interval favourites (`CMP-017` — a
solution to a problem UCT does not have).

---

## The answer to the final product question

> *What makes an exceptional mobile charting product; which of those systems does TradingView
> actually execute better; which has UCT already solved as well or better; and what is the
> smallest coherent set of changes?*

**An exceptional mobile charting product is five systems.**

1. **A fast loop** — arrive, change symbol, change timeframe, read a bar, get back to live.
   **UCT already wins this**, on measured interaction counts, at four of five steps.
2. **Precision without a mouse** — put a level exactly where you mean it.
   **UCT already wins this** (`Set level…`, pre-filled). TradingView answers the same problem
   with cursor-offset placement; both are legitimate.
3. **A durable object you can name and return to.**
   **TradingView wins this on the phone, decisively** — not because its model is better (UCT's
   is arguably better: the symbol is a variable, and admins can publish firm-wide prebuilts)
   but because UCT's phone has **no door to its own model**.
4. **A feature surface a thumb can find.** **Nobody wins this.** TV hides 15 of 18 hub entries;
   UCT shows 5 of 20 drawing tools. Open ground.
5. **Objects that mean something after you make them** — hide, template, enumerate, and an
   alert that follows the line it came from. **TradingView wins this**, cheaply and clearly.

**The smallest coherent change set is four moves, in this order:**

1. **Put the layout lifecycle on the phone** (C2) — a sheet over an existing API. Closes the
   largest single gap and unlocks the P9 architecture.
2. **Make "renders on a phone" mean "has a phone presentation"** (C1) — one rule that closes
   nine rows including three of the four high-value BROKEN ones.
3. **Give durable state a scope model** (C3) — four tiers, two things moved, three defects
   fixed (the third being `CMP-086`: a retired settings key deciding a visible behaviour).
4. **Bind alerts to their objects, and add Hide** (C7 + part of C4) — the two places
   TradingView's behaviour is simply better.

Everything else in the backlog is polish on a product that already wins the loop a trader
actually repeats. **UCT does not need to become TradingView. It needs a door to its own
workspace, a phone presentation rule, and an alert that follows its line.**
