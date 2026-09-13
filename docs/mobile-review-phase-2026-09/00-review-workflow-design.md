# Mobile trader workflow & micro-interaction phase — design deliverable

2026-09-08, branch `fix/mobile-legend-legacy-state` @ `aceb212e3`. Design only.
**Nothing in this document has been implemented.**

The previous program asked *"can a phone do it?"* and answered yes with zero
surviving build items. This phase asks a different question: **"is it fast?"** —
for a trader moving through dozens or hundreds of charts in a session.

⛔ **Everything below is grounded in the current code, and where I guessed wrong
I say so.** One hypothesis I formed early — that the drawing/pan arbitration was
broken — turned out to be false on inspection. It is recorded in §6 rather than
quietly dropped, because a phantom defect in a design doc costs more than a
missing one.

---

## 1 · Current workflow map — measured, not assumed

### What exists

| capability | where | state |
|---|---|---|
| symbol selection from a list | `MobileChartsApp` → `setGroupSym(color, sym)` | ✅ one symbol, one write |
| list opens over the chart | widget → full-screen page | ✅ **the chart never unmounts — "returning is free"** |
| ordered traversal of a list | `Watchlists.jsx` — `visibleSymsFlat` + ArrowUp/Down/**Space**, `scrollIntoView({block:'nearest'})` | ⚠️ **desktop keyboard only** |
| bounded chart mounting | `useStaggeredMount(ids, {limit:3, slotTimeoutMs:5000})` | ✅ proven in the desktop grid |
| bar prefetch | `prefetchBar` · `prefetchBars` · `prefetchAllTimeframes` · `prefetchBarsToIDB` · `warmMemFromIDB`, all on the bounded `_idbQueue` (≤3 concurrent) | ✅ |
| coarse-pointer hit sizing | `coarsePointer.js` — `HIT 15/8`, `HANDLE 7/4` | ✅ MOB-07 |
| drawing feedback | "Point N of M", Cancel, magnet/snap | ✅ MOB-11/18 |
| tool reach | pinned `⊞ All` door + search + 35 aliases + recents | ✅ MOB-04 |

### The actual review loop today, counted

```
watchlist widget page open
 → tap symbol            (1)  → setGroupSym writes ONE symbol
 → tap back to chart     (2)  → chart was never unmounted, so this is cheap
 → inspect
 → tap to open list      (3)
 → find where I was      (?)  ← unbounded: scroll hunting
 → tap next symbol       (4)
```

**Four taps plus a scroll-hunt per symbol.** Over 50 symbols that is ~200 taps
and 50 acts of re-orientation.

## 2 · Pain-point map

| # | pain | root cause (measured) | severity |
|---|---|---|---|
| P1 | **No next/previous symbol, anywhere in the product** | there is no ordered set at the chart level — `setGroupSym` carries ONE symbol | 🔴 highest |
| P2 | **The chart cannot say where you are** — no "12 of 47" | no session model; the list exists only inside the widget's DOM | 🔴 |
| P3 | **Re-entering the list costs a scroll-hunt** | the page reopens; nothing restores the index | 🔴 |
| P4 | **Tap-to-select nudges the object** | ⛔ **no movement threshold before a drag applies** (§6) | 🟠 |
| P5 | Reviewing N charts means N full mounts | no feed surface; the grid's staggered mount is desktop-only | 🟠 |
| P6 | Sequential review is not prefetched | prefetch exists but nothing calls it for "the next symbol" | 🟠 |
| P7 | Drawing needs a tool armed from a rail each time | one-shot vs Repeat exists; no *mode* affordance on the phone | 🟡 |

⭐ **P1–P3 are one problem wearing three hats: there is no review session.** Fix
that and the top three pains close together; fix them separately and you build
three half-features that disagree about what "current symbol" means.

## 3 · Proposed **review session** model

A session is **client state, not server state** — it is scratch context, it must
survive a page-page navigation, and it must never outlive its list.

```js
// sessionStorage, one key, replaced not merged
{
  id: 'rs-<hash>',
  source: 'watchlist' | 'scan' | 'screener' | 'flagged' | 'group',
  label: 'Momentum Scan',       // what the chip says
  symbols: ['NVDA','AMD', …],   // ORDERED, deduped, visual order
  index: 11,                    // current position
  listScrollTop: 842,           // restores the list exactly (P3)
  reviewed: ['NVDA', …],        // optional, powers progress
}
```

⛔ **Derive `symbols` from the existing `visibleSymsFlat` logic, do not
re-derive it.** `Watchlists.jsx` already builds a deduped flat list in *visual*
order across Flagged, tag auto-lists and user lists, with a DOM-order fallback.
Re-implementing that ordering is how the phone and desktop start disagreeing
about what "next" means.

**Wrap-around: NO.** An explicit product decision. A trader reviewing a scan
needs to know they finished it; silently restarting at the top turns a finite
task into a loop with no edge. The control disables at both ends and the chip
reads `47 / 47`.

## 4 · Next/previous control — three prototypes to measure

All three sit in the **lower-left thumb zone**, which the landscape work already
established as the safe edge: the right edge carries the price scale and the
newest bars — the most valuable pixels — and the left edge is the oldest bars.

**A · Stacked pill (lower-left)**
```
┌──────┐
│  ‹   │   one tap = previous
│ 12/47│   tap = open the list AT this index
│  ›   │   one tap = next
└──────┘
```
Largest targets, unambiguous, ~52×132px. Costs the most chart area.

**B · Horizontal pill**
```
┌─────────────────┐
│  ‹   12/47   ›  │
└─────────────────┘
```
Half the height; the two arrows sit closer together, which raises mis-tap risk
exactly where a mis-tap is most annoying (wrong direction = lost place).

**C · Edge-swipe + minimal chip**
Chip shows `12/47` only; navigation is an **edge swipe** in review mode.
Smallest footprint, highest risk — see §9.

⛔ **Prototype before choosing, and measure on hardware.** The authenticated
harness can drive all three and report tap-target box, overlap with the price
axis, and thumb-zone distance. A desktop frame cannot answer this: it renders
fine-pointer CSS at any width.

**Non-negotiables for whichever wins:** auto-fade when idle (reuse
`useHideOnScroll`, already built) · never overlap the price axis · never overlap
the drawing quick-bar (`[data-uct-qbar]` has capture-phase exemptions already) ·
clear disabled state at both ends · portrait *and* landscape (in landscape it
must not collide with the new left rail — likely it becomes part of it).

## 5 · Multi-chart feed architecture

⛔ **Do not render N `StockChart` instances.** The budget, from the desktop grid's
own measurement: **16 cells ≈ 900 ms to frame and +63 MB heap.** A 50-symbol feed
built that way is a memory incident, not a feature.

The architecture that reuses what exists:

```
IntersectionObserver
  → useStaggeredMount(visibleIds, { limit: 3 })      ← already built
      → ≤3 charts MOUNTED at once (the on-screen card + 1 either side)
      → offscreen cards unmount to a LIGHT placeholder (sparkline or last frame)
  → prefetchBarsToIDB(nextN, tf)                     ← already built, bounded ≤3
```

**Performance budget, stated up front so it can fail:**
| metric | budget |
|---|---|
| mounted charts at any time | ≤ 3 |
| concurrent bar fetches | ≤ 3 (the existing `_idbQueue` cap) |
| heap growth over a 50-card scroll | < 150 MB, and **must return to baseline** after scrolling back |
| scroll | 60 fps on an iPhone 12-class device |

⭐ **Snapshot-on-unmount is the interesting option and it is cheap:**
lightweight-charts exposes `takeScreenshot()` (already used elsewhere). An
unmounted card can show its last painted canvas instead of a skeleton — the feed
then looks continuous while holding three live charts.

Card anatomy: symbol · scan metadata · pattern/signal badge · alert status ·
watchlist membership. **Tap → full chart at that index in the session** (so the
feed and the next/prev control share one model). Long-press → the existing
`TickerActions` sheet; do not build a second context menu.

## 6 · Drawing intent state machine — audited

### ⚰️ A hypothesis I formed and then disproved

I expected `canvasTouchAction = activeTool ? 'none' : 'auto'` to be a bug,
because `'cursor'` is truthy — cursor mode would then swallow native pan. **It is
not a bug.** `activeTool` initialises to `null`, and selecting the cursor tool
sets it back to `null` (`StockChart.jsx`: `if (tool === 'cursor') setActiveTool(null)`).
So the declared contract holds exactly:

| state | overlay `pointerEvents` | overlay `touchAction` | who owns the gesture |
|---|---|---|---|
| nothing armed | `none` | `auto` | **the chart** — native pan/pinch |
| tool armed | `auto` | `none` | **the overlay** — drawing |
| object hovered/selected | `auto` | `auto`→`none` | the overlay, within hit zones |

Multi-touch is already guarded: a second pointer cancels an in-progress drag
(`activePointersRef.size > 1`), so a pinch cannot smear a drawing. `dragRef` is
consulted rather than the `isDragging` closure, deliberately, because state needs
a render to reach the callback.

**Conclusion: the intent machine is sound. It does not need rebuilding.**

### 🔴 The one real defect: no touch slop

`handlePointerDown` writes `dragRef.current` immediately on hitting a drawing or
handle. The very next `pointermove` applies the delta — **there is no movement
threshold.** On a finger, a tap always jitters a pixel or two, so:

> **tap-to-select and drag-to-move are the same gesture.** Selecting a trendline
> to open its menu nudges it off its anchor.

The fix is small and the ingredients are present: `drag.startPixel` is already
recorded, and `coarsePointer.js` is the right home for the constant.

```js
// proposed, alongside HIT_COARSE / HANDLE_COARSE
export const SLOP_COARSE = 8   // finger
export const SLOP_FINE   = 2   // mouse
// drag applies only once hypot(pos - startPixel) > slop(); before that it is a tap
```

⛔ Use `isCoarsePointer()` — **do not add another device detector.** MOB-07
exists precisely so there is one answer to "is the pointer coarse", with two
doors (pure function + hook).

### Draw-mode lock — integrate, do not duplicate

UCT already has **one-shot** and **Repeat** semantics, and Repeat was moved off
the drawing rail (`47dd0bbcc`) because it cost two-thirds of the tools strip.
A third "locked draw mode" concept would be a fourth thing to explain. The
proposal is therefore **presentation, not a new mode**: when a tool is armed,
show a persistent mode banner (tool name · Point N of M · **Cancel**) — the
information already exists from MOB-11/18; it is the *persistence and prominence*
that is missing. Repeat ON already *is* locked draw mode; say so in the UI.

## 7 · Drawing shortcuts

The roster is reachable (MOB-04) but every drawing starts from the rail. The
missing layer is **frequency**, not reach.

- **Top-3 rail from recents** — `mobileRecents.js` already tracks recency. Recents
  beat favourites here for the reason MOB-04 already recorded: curation costs a
  decision before the first use; recency pays from the second session.
- **Long-press the draw button → the last tool**, armed directly. One gesture for
  "the thing I have been doing".
- ⛔ **No radial picker.** It is a novel gesture vocabulary for a roster that is
  already one tap away, and it collides with the long-press the chart uses for
  context menus.

## 8 · Performance plan for sequential review

Measure first — none of these numbers exist yet:

| metric | how |
|---|---|
| next-symbol latency (cache hit / miss) | harness step around the `setGroupSym` write |
| chart repaint after symbol change | existing paint instrumentation |
| IDB hit rate over a 20-symbol review | `barsIDB` counters |

**Prefetch policy: `current + next 2`, and previous 1.** Not the whole list —
the `_idbQueue` cap of 3 is the honest ceiling, and a 50-symbol warm would
saturate it for minutes and starve the chart the user is *looking at*. Deepen
only if measurement says the next-symbol step is still not instant.

## 9 · Swipe navigation — recommended **NO**, for now

Horizontal swipe is the chart's own pan. The brief already names the constraint,
and it is decisive: shipping a gesture conflict on the primary surface would undo
the fluency this phase exists to create. **Revisit only inside the feed**, where
the vertical scroll axis is the navigation axis and horizontal is unambiguous —
or as an explicit edge gesture. Not on the full chart.

## 10 · Prioritised backlog

| # | item | frequency | time saved | friction | complexity | regression risk |
|---|---|---|---|---|---|---|
| R1 | **Review session model** (`symbols`, `index`, `listScrollTop`) | every review | — (enabler) | 🔴 | M | low — new client state |
| R2 | **Next/prev control** on the chart | 100s/session | ~3 taps each | 🔴 | M | low |
| R3 | **Return-to-list at the same index** | every re-entry | a scroll-hunt | 🔴 | S | low |
| R4 | **Touch slop before drag** | every object tap | prevents *damage* | 🟠 | **XS** | low, and rail-able |
| R5 | **Prefetch current+2** | every next | perceived instant | 🟠 | S | low (bounded queue) |
| R6 | Feed surface (virtualised) | per scan | large | 🔴 | **L** | **medium — memory** |
| R7 | Armed-tool mode banner | per drawing | certainty | 🟡 | S | low |
| R8 | Top-3 recents rail + long-press last tool | per drawing | 1 tap | 🟡 | S | low |

## 11 · TOP 5 HIGHEST-LEVERAGE CHANGES

> The standard: *if this happens 100 times a session, is it excellent?*

1. **R1 · The review session model.** Nothing else is possible without it, and
   three of the top pains are one missing concept. Build it once, derive the
   order from `visibleSymsFlat`, keep it in `sessionStorage`.
2. **R2 · The next/prev control.** Turns a 4-tap-plus-scroll-hunt loop into **one
   tap**. This is the single largest time saving in the phase.
3. **R4 · Touch slop before a drag.** ⭐ **The cheapest item on the list and the
   only one that prevents *damage* rather than saving time.** Today, tapping a
   trendline to select it moves it — the user must then undo, on a surface where
   undo is not obvious. XS effort, high daily frequency.
4. **R3 · Return-to-list at the same index.** Removes the one unbounded cost in
   the loop: re-orientation. The chart already never unmounts, so this is
   restoring a scroll offset, not rebuilding a screen.
5. **R5 · Prefetch current + next 2.** Makes R2 *feel* instant instead of merely
   being fewer taps. Bounded by the existing queue, so it cannot starve the
   visible chart.

⚠️ **R6 (the feed) is deliberately NOT in the top five.** It is the most exciting
item and the most dangerous: it is `L`, it carries the only medium regression
risk in the list (mobile memory), and **R1 is its prerequisite anyway** — the feed
and the next/prev control must share one session model or they will disagree
about "current". Build 1–5, measure, then build the feed on top of a model that
already works.

## 12 · What I have NOT done

No code was changed. No interaction was prototyped on hardware yet — §4 and §5
both need the authenticated harness and one device session each, and the harness
is committed and ready. The performance numbers in §8 are **budgets, not
measurements**, and are labelled as such.
