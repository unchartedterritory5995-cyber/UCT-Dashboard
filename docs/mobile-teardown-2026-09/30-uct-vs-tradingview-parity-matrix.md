# UCT mobile charting × TradingView iOS — parity matrix v1

> # ⛔⛔ SUPERSEDED — DO NOT QUOTE THIS DOCUMENT'S VERDICTS
>
> **The authoritative parity distribution is now
> [`80-parity-distribution-and-root-causes.md`](80-parity-distribution-and-root-causes.md),
> computed from `ledger/PARITY_COMPARISONS_V2.jsonl`.** This file is kept as the record of
> what v1 concluded and of *how* it was wrong, because that is the study's headline result.
>
> **Its UCT column was measured in a 390px-wide FINE-POINTER frame.** The header below says
> *"Both sides measured, not inferred"* — that is true and was still not enough. A physical
> touchscreen later overturned three of this document's conclusions. Specifically:
>
> | v1 said | corrected to | evidence |
> |---|---|---|
> | *"Bar replay — TradingView: yes, with paper trading. UCT: **none**."* (§1) | **DESKTOP_ONLY**, not missing. Replay ships in `ChartToolbar.jsx`; what is absent is a phone door. | `CMP-079` |
> | *"long-press on the bare plot area produces nothing"* → the bare-chart bridge is the study's top item | ⛔ **WITHDRAWN.** On a real touchscreen the long-press opens a price-anchored sheet that is **broader** than TradingView's. | `UCT-CHART-0007`, `CMP-049` |
> | *"the crosshair reads price, date and three volume metrics — and no O/H/L/C"* | ⛔ **WITHDRAWN.** Full OHLC + change% + four live MA values render on hardware; **UCT is ahead here.** | `UCT-CHART-0008`, `CMP-020` |
> | *"UCT's equivalent sheet is eleven rows"* (§1) | Account-dependent: **five chart actions plus a per-account widget list.** | `UCT-NAV-0005` |
> | *"UCT has no object → alert"* (§3/§4, P2) | ⛔ **WITHDRAWN.** UCT's drawing→alert is three gestures and zero typing. The surviving gap is **binding vs seeding**. | `UCT-DRAW-0003`, `CMP-055` |
> | *"adopt TradingView's cursor-decoupled placement"* (§4, P1) | ⛔ **WITHDRAWN** as a gap — reclassified `PRODUCT_MODEL_DIFFERENCE`. | `CMP-036` |
>
> §0 below opens by warning that a code-derived claim died on contact with the running app.
> The correction it could not anticipate is that **a claim derived from the running app in a
> fine-pointer frame died on contact with a finger.** Both lessons are in
> `20-census-freeze-v1.md` and the addendum to `40-p1-p2-verdicts.md`.

**Both sides measured, not inferred.** TradingView was operated on a real iPhone 15 / iOS 17.5 running
app v2.139. UCT was operated live on `https://uctintelligence.com/charts` in a 390×844 frame, on the
production build, on 2026-09-07. Where a claim comes from reading source rather than operating the
product it is labelled as such — and §0 records the one place where that distinction already mattered.

Evidence: `ledger/TV_IOS_CENSUS_V1_FROZEN_2026-09-07.jsonl` (TradingView, 434 rows) and
`lanes/uct-mobile-measured.jsonl` (UCT, 22 rows measured this session).

---

## 0. The reason this document was required to be built by testing

`TV-IOS-ALERT-0008` recorded, from a careful reading of `MobileAlertSheet.jsx`, that UCT's mobile alert
seeds its price field from the live price, and called it **"GENUINE PARITY … worth recording as a UCT
strength."**

The running product does not do it. The field opens empty with the placeholder *Price* — confirmed
twice, from two view states, by reading `input.value` from the DOM while the chart's own price badge
displayed 363.13.

**One code-derived parity claim survived four research lanes and a full native TradingView session, and
died in the first thirty seconds of touching the running app.** Every verdict below is therefore
anchored to an observation of a running product, and anything that is not is marked.

---

## 1. The gap in one number

| | TradingView iOS | UCT mobile | ratio |
|---|---:|---:|---:|
| Interactive elements in the phone chart shell | — | **16** | |
| Destinations **one tap** from the chart via the overflow door | **18** | **11** | 1.6 : 1 |
| …of those, actions that operate on the **chart** | **13** | **5** | 2.6 : 1 |
| Chart types | **21** | **5** | 4.2 : 1 |
| Drawing tools on the phone | *not fully enumerated* | **20** | — |
| Bar replay | **yes, with paper trading** | **none** | — |
| Controls below the 44 px tap minimum | not measured | **9** | — |

**The single most useful framing is not the feature count — it is the door count.** TradingView spends
*one* door (`•••` → Analysis hub) to reach eighteen destinations. UCT spends *five* fixed doors to reach
five. TradingView's hub is banded by frequency — layout management, then broker, then TOOLS, then MORE —
so the phone gets the whole product without a deeper hierarchy. UCT's equivalent sheet is eleven rows,
**six of which are workspace assembly** (`+ Chart`, `+ Watchlist`, `+ Theme Tracker`, `+ Scanner`,
`+ Fundamentals`, plus the existing Watchlist widget) rather than charting.

That is the gap restated honestly: **UCT's phone hub is about composing a workspace; TradingView's is
about operating a chart.**

---

## 2. Measured task flows

Every number below was counted by performing the task. "Type" means a value had to be entered on a
phone keyboard.

| Task | TradingView | UCT | verdict |
|---|---|---|---|
| Search result → advanced chart | **3 taps** (search, result, ⛶ fullscreen) — every symbol entry point routes through the Symbol screen first | **2 taps** (symbol control, result) | ⭐ **UCT_AHEAD** |
| Create a price alert at the live price | **2 taps** (long-press price scale, `+`) — or **3 cold**, all fields pre-filled, never typed | **3 taps + type the price** | **PARTIAL → BROKEN** |
| Change interval | 1 tap in landscape / 2 via hub | **2 taps**, 8 intervals | **PARITY** |
| Change chart type | 2 taps via hub (21 types) | **2 taps** (5 types) | **PARTIAL** |
| Place a horizontal line | select tool, then a **draggable cursor with a live readout**, then commit | select tool, **one tap = committed at your fingertip** | **PARITY_BUT_WORSE_UX** |
| Undo that drawing | contested — one native tap did not visibly restore (`TV-IOS-UNDO-0011`) | **1 tap, verified at the storage layer** | ⭐ **UCT_AHEAD** |
| Reach bar replay | **2 taps**, full replay incl. Sell/Buy/Flatten | not present | **MISSING** |
| Read prices in the watchlist | last price + absolute **and** percent change on every row | **em-dashes** for Price, Vol and % Chg while the API returns them | **BROKEN** |
| Switch watchlist | **1 tap** — lists are horizontal tabs | 2 taps — `‹ Lists` then choose | **PARITY_BUT_WORSE_UX** |
| Change symbol without losing the chart | **everything survives**: indicators, interval, panes, pane heights | not yet measured on UCT | **TV_UNVERIFIED for UCT** |
| Choose an indicator you don't know | flat list of names, no descriptions | **name + plain-English line + caveat badge** | ⭐⭐ **UCT_AHEAD** |

---

## 3. Per-area verdicts

### Where UCT is genuinely ahead — protect these

1. **The indicator picker explains itself.** ⭐⭐ Every built-in carries a one-line plain-English
   description (*"On-Balance Volume — a running volume total that adds on up bars and subtracts on down
   bars"*) **and, where it matters, an honesty badge**: `Intraday only` on Anchored VWAP,
   `Preview-repaints — Chikou` on Ichimoku, `Premium` on the Relative Strength Line. TradingView's
   mobile picker is a searchable list of *names*. **Telling a trader that an indicator repaints, at the
   moment they are choosing it, is a thing no competitor does.** This is the strongest differentiation
   asset in the whole teardown and it costs nothing to keep.
2. **Selection states are two-channel.** UCT marks the active interval and chart type with a gold
   outline *and* gold text. TradingView encodes both by fill colour alone — an accessibility concern its
   own census flags three separate times. **Do not "fix" UCT's styling to match.**
3. **Chart-type tiles carry a glyph** showing what the type looks like. TradingView's are text-only.
4. **Hub rows are 48 px, full-width, with a trailing chevron** signalling which rows open a sub-surface.
   TradingView's 2-column tiles give no such signal.
5. **Undo works, and it lives in the drawing bar** where drawing happens — with Redo and a Snap-to-price
   magnet beside it. TradingView's undo sits a level away in the chart toolbar, and its behaviour was
   the one thing the native session could not pin down.
6. **Scan-to-chart is one tap shorter**, because UCT has no Chart Preview interstitial.
7. **The drawing roster is house-specific and strong** — Position, Cup, Advance %, Pitchfork, AVWAP —
   and every tool meets the 44 px minimum.

### Where UCT is behind, by root cause

**BROKEN_IMPLEMENTATION** — the capability exists and does not reach the user:
- Watchlist Price / Vol / % Chg render em-dashes while `/api/live-prices` returns 770.19 and
  34,054,199 for the same symbol in the same minute. **P0 for that surface** — most mobile watchlist use
  is after the close, which is exactly the state measured.
- The alert price field does not seed from the live price although the source says it should. **P1.**

**MOBILE_PRESENTATION** — right idea, wrong size on a phone:
- Three price-scale toggles at **17×11 px** — about 4 % of the area the project's own `--tap-min` token
  requires. TradingView faced the identical problem and hides the badges behind a three-state
  *Visible on tap* setting, so they cost zero permanent pixels and are full-size when revealed.
- Five watchlist sort headers at **18 px** tall.
- User formula rows print the entire expression as body text; roughly three formulas fill a phone screen.

**DESKTOP_COMPONENT_REUSE**:
- A five-line watermark drawn across the middle of a 390 px price pane, over the candles.
- A five-column sortable table on the watchlist, which **overflows horizontally** — the repo's own audit
  harness calls that the number-one objective mobile bug.

**DISCOVERABILITY**:
- The drawing bar holds 20 tools and shows about 5, scrolling horizontally with no affordance.
  TradingView has the same constraint and **ships a coach-mark for it** — *"Discover the scrollable
  toolbar"*, with its own dismissal — captured live this session. One component, one-off fix, pattern
  already proven by the competitor.

**RESPONSIVE_FAILURE**:
- The voice orb's right edge lands at x=432 in a 390 px viewport and collides with the notification bell.
  *(Reproduce on a real device before filing — the harness is an iframe.)*

**MISSING_CAPABILITY** — genuine absences:
- Bar replay (TradingView ships it *with* bar-by-bar paper trading on a phone).
- Compare / multi-symbol overlay.
- Any named-layout concept on mobile, and therefore any workspace that travels.
- Per-indicator Inputs and Style editing on the phone.
- Symbol-search disambiguation: `/api/ticker-search` returns `{ticker, name}` only, so two identically
  tickered instruments render as two identical rows. TradingView returns seven AAPLs and makes each one
  legible with a four-field two-line row. **This is a backend payload change, not CSS.**

**CHART_LIBRARY_LIMITATION** — shared with UCT's desktop, so not a mobile regression:
- 5 chart types vs 21. The cheap wins are Heikin Ashi and Baseline, both native to lightweight-charts.

---

## 4. The three system-level findings

The row counts are not the deliverable. These are.

### P1 — cursor-based placement vs tap-to-place
TradingView never asks a fingertip to be accurate. It gives you a **draggable cursor with a continuously
updating readout** and lets you correct by feel: dragging the bar-replay cursor moves the date badge,
the OHLC legend *and* every indicator's values, live, under the finger. UCT's placement grammar is
**your fingertip is the commit** — one tap and the line exists at whatever price you happened to hit. On
a 390 px chart that is a real cost, and the only correction is delete-and-retry.
*This is not a feature gap. It is a different answer to the same physics, and it is the highest-leverage
thing on this list.*

### P2 — universal object → alert
On TradingView the price series, every indicator and every drawing share **one action vocabulary**, and
alert is always first and always pre-filled with that object's live value. Measured distance to an
alert: 2–3 taps from *any* object, never typing. The same menu appears on desktop, so it is architecture
rather than mobile polish. UCT has one alert door, in a menu, that requires typing a number.

### P9 — the layout is the durable object; the symbol is a variable inside it
Changing symbol on TradingView preserved **everything** — the Pine script pane, the second indicator,
the interval, the pane geometry. The layout auto-commits (the Save tile carries a red dot when dirty and
greys out when clean), it is account-level, and a phone edit was visible in the desktop client's layout
list within seconds. **That is what "the workspace travels with the user" actually means**: auto-commit
on the phone, one account-level record, every client reading it. UCT's mobile shell has no named-layout
concept at all; the durable thing is a single symbol in `localStorage`.

---

## 5. What this matrix does not yet cover

- **UCT's coarse-pointer branch was not exercised.** A 390 px iframe in desktop Chrome satisfies
  `(max-width: 640px)` — so the layout and components are the real ones — but not `(pointer: coarse)`.
  `DrawingQuickBar`, the long-press `ContextPopover` and `Sheet`'s touch variants could not fire. No
  quick-bar appeared when a drawing was placed, and **that is correct behaviour in this harness, not a
  defect.** Closing this needs `uctintelligence.com` in mobile Safari on a real device — no app install
  and no Apple ID, only a UCT login.
- **39 high-value TradingView rows remain inferred** (freeze §3), concentrated in the gesture layer
  (fling, pinch axis coupling, time-scale drag, long-press) and the undo model. Any parity verdict that
  would depend on them is marked `TV_UNVERIFIED` rather than guessed.
- **No UCT landscape measurement**, and no side-by-side on the same symbol.
- **The watchlist defect needs one control**: does the *desktop* watchlist widget show prices in the same
  market-closed state? If yes it is mobile-specific; if no it is a product-wide after-hours gap. It is
  `BROKEN` either way, but the fix differs.
