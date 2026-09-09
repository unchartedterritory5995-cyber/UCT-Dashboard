# Review feed — hardware UX / performance certification, 2026-09-08

## Verdicts

| | |
|---|---|
| `REVIEW_FEED_HARDWARE` | **PASS** |
| `FEED_SCROLL_INTENT` | **PASS** (structural, on-device; the finger half is named below) |
| `TOUCH_SLOP_HARDWARE` | **PASS** — iPhone 15 Pro / iOS 17.5, 12/12 |
| `REVIEW_PILL_POSITION` | **LEFT** — resolved on measurement, not preference |
| `PRE_EXISTING_REACHABILITY_FAILURE` | **OUT_OF_SCOPE** |

---

## 1 · The frame tail, explained before any device time

Four experiments, none of them an optimisation:

| run | long frames (>32 ms) | worst |
|---|---|---|
| idle control — same page, same duration, no scrolling | **2 / 789** | — |
| scrolling 40 cards | 38–55 / ~760 | 66.7 ms |
| snapshot capture **ablated** | **51** (vs 51) | 66.7 ms |
| harness round-trips removed (self-driven scroll) | 54–55 | **33–50 ms** |
| `performance.memory` read per card added back | 59 | 83 ms |

**Root cause.** Every long frame is an exact 2×/3×/4× multiple of 16.67 ms and the
browser's own `longtask` observer (>50 ms) fired 0–1 times per run — so these are
**dropped vsync ticks from 17–50 ms of work, not a blocked main thread**. The
dominant coincident event is **bars arriving** (21–22 of ~54), i.e. a newly
admitted chart receiving its data and painting. That is the expected cost of a
chart appearing, roughly one dropped tick per card transition. The idle control
rules out ambient scheduling: 0.25% of frames idle vs 5% scrolling.

**What was NOT the cause.** Snapshot capture costs a real 13–15 ms on a 314×622
canvas, and ablating it changed the tail by **nothing** (51 vs 51).

**What was the harness.** The 66.7 ms frames were partly two CDP round-trips per
card, inside the measured window; driving the scroll from inside the page removed
them. The **667 ms outlier never reproduced in nine subsequent runs** and only
ever occurred in the heap probe, which reads `performance.memory` once per card
under `--enable-precise-memory-info` — a read that measurably adds long frames
(worst 50 → 83 ms here). Best-supported explanation: the instrument. **Not
proven** — one unreproduced sample, and it stays on the debt list.

**No optimisation was required.** Worst product-side frame: 33–50 ms.

## 2 · Budget rails

Six movement cases were added on a driveable IntersectionObserver, because the
existing rails could only measure a feed at rest: charts never accumulate across
a whole list, a distant card returns to a placeholder, **admission cannot
masquerade as windowing** (many total mounts, never more than three live),
re-entering a card leaks nothing, and the ceiling does not move at **10 / 40 /
100** symbols — plus a control proving the driveable observer really moves the
window. Mutation check: hand `symbols` to the queue instead of the window and
**10 of 15 cases go red**.

## 3–4 · Real device

**iPhone Air · iOS 26.6 · Safari · 420×746 portrait — 9/9 PASS in 11.1 s.**

Covered on hardware: the handoff from a seeded scan review reaching the chart;
the feed opening with the whole 12-symbol set; **≤3 live charts across ten
cards**; a card not claiming the vertical gesture; tapping a card moving the
REVIEW to that index; next-then-return landing on the NEW current symbol; and the
same contract entered from **watchlist** and **screener**.

Also confirmed on **iPhone 17e (26.6)** and **iPhone 15 Pro Max (17.1)**: the
transport pill renders with `1 / 12` and opens the feed (`scan — 12 charts`).

### What the device could and could not tell us

- **Live charts: 3, budget held.** Measured by the suite on-device.
- **Card readiness: confounded.** Cards mounted charts but had not painted within
  the observable seconds. The sandbox serves all 12 symbols' bars in 0.1 s
  locally, so this is the **BrowserStack Local tunnel**, not the product — but it
  is not separable inside a 60-second session, so it is recorded as confounded
  rather than as a result.
- **No reload, no crash** in any session.
- **Frame timing on iOS: NOT MEASURED.** Desktop-Chromium frame numbers are not
  translated to iPhone numbers.
- **Time to first useful feed: not isolated.** The 11.1 s suite includes three
  full app boots; a single entry was not timed separately.

## 5 · Density — settled

Cards-per-screen is `100 / height-vh`, so it is **viewport-independent**.
Measured on hardware: the shipped 62 vh was showing **1.61 charts per screen**
while its own toggle said "One up" — the label was never true.

**Chosen: ~1.4 charts per viewport (card = 70 vh).** One-per-screen was rejected
on its own costs: at ~100 vh nothing of the next card is visible, so the surface
stops looking scrollable and the adjacent symbol stops giving context — two of
the things a reviewer uses the feed for. `scroll-snap-align: start` already
delivers the one-card-per-flick ergonomics that made one-up attractive, so the
choice costs nothing there. 70 vh gives the current chart ~13% more height than
before and keeps ~30 vh of the next card on screen. Mount churn is identical (the
live window is the centred card ±1 either way).

**The toggle is retired.** It was the instrument for this decision, not a
feature, and the brief says no density setting yet.

⚠️ The half I cannot judge for the owner: candle readability and visual fatigue
over a long session. Those are a trader's call, and 70 vh is the geometry that
makes both candidates cheap to compare again if it is wrong.

## 6 · Pill placement — RESOLVED: LEFT

Both variants place an **identical control** — 145×52 (LEFT) vs 152×52 (RIGHT).
The only thing that differs is WHICH bars it sits on. Measured at the iPhone 15
Pro's real viewport width (393 px, price axis 76 px, price action 0–317 px):

| | pill x-range | covers | thumb distance |
|---|---|---|---|
| **LEFT** portrait | 8 – 153 | the **oldest 48%**; the newest half stays clear | 326 px |
| **RIGHT** portrait | 169 – 321 | **the newest 47% of price action**, hard against the axis | 175 px |
| **LEFT** landscape | 68 – 213 | 24.9% of a 583 px plot, oldest end | 520 px |
| **RIGHT** landscape | 435 – 587 | **the newest 25.4%**, hard against the axis | 152 px |

Vertically both sit at y 540–592 in a 53–604 chart — the bottom ~60 px, which is
the volume pane and the lower wicks. So the obstruction is a band across those
bars, not the whole column; the question is only *which* bars wear it.

**A · Is RIGHT materially easier one-handed?** Yes — **151 px** closer in
portrait (175 vs 326) and **368 px** closer in landscape (152 vs 520). This is RIGHT's only advantage, and it is real.

**B · Does RIGHT obstruct the newest bars?** Yes, by construction. Its 64 px
inset exists to clear the price axis, which lands it directly on the most recent
candles. Vertically it is a 52 px band at the bottom of the plot, so it covers
the volume pane and the lower wicks of the newest bars rather than the whole
column — but that band is over the newest 47% of price action in portrait.

**C · Does LEFT's reach cost more than RIGHT's intrusion?** No. **The pill is
pressed BETWEEN looks, not during them** — one tap to advance a symbol, then
seconds of reading. Reach is paid once per symbol; obstruction is paid the whole
time the chart is on screen. In a review flow the looking dominates the tapping.

**D · Is either materially worse in landscape?** No, and the asymmetry favours
holding one position: landscape is where RIGHT's reach gap is largest (520 vs
152) *and* where LEFT's intrusion is smallest (24.9% of a much wider plot, at the
oldest end). Neither is bad enough to justify a per-orientation rule.

**E · Interference with crosshair / drawing / price actions?** This is the cost
that is easy to miss. The pill is `z-index: 5` with `touch-action: manipulation`,
so **every tap inside its box belongs to the pill, not the chart**. Under RIGHT
that dead zone sits exactly where a member taps to drop a drawing anchor at the
current price or open the price-context menu on the latest bar. Under LEFT the
dead zone is over the oldest bars.

**REVIEW_PILL_POSITION = LEFT.** No code change — LEFT is already the shipped
default; this converts a recommendation into a measured decision.

⚠️ **The split between device and local, stated plainly.** pillRight was rendered
and confirmed on the **iPhone 15 Pro / iOS 17.6** — it draws, it is reachable,
and it sits hard against the price axis with candles behind it. The exact
rectangles above come from a local run at the real 393×659 viewport with a coarse
pointer, re-taken after the harness bug in §8 was fixed.

## ⚰️ Superseded: the earlier STILL_UNRESOLVED

Two attempts at the right-hand variant were lost inside the 60-second cap: one to
the cinematic intro animation (now skipped in view mode) and one to a promotional
modal. The left variant was seen on two devices and does not obstruct current
price action — the newest bars and the price scale are at the right edge.

**Recommendation, not a verdict: keep LEFT.** `pillRight` is inset 64 px to clear
the price axis, which places it directly over the newest candles — the bars a
reviewer is reading — while the prior geometry's advantage for it is reach alone
(portrait right-thumb: left 320 px vs right 175 px). The brief says to judge the
whole interaction, not reach, and the obstruction half was not observed on
hardware.

**The one run that closes it:** `?view=charts&review=scan&navprobe=pillRight` on
one device, portrait, with the chart drawn — compare the pill against the newest
bars, then rotate. The intro skip now makes that fit in one session.

## 7 · Touch slop — PASS

**iPhone 15 Pro / iOS 17.5, Safari, 393×659 portrait — 12/12 PASS in 9.4 s**,
reproduced a second time at 1.3 s on the same device.

```
PASS 12 · FAIL 0 · BLOCKED 0 / 12
  the device reports a COARSE pointer — which slop is in force
  a drawing is PLACED BY TAPPING, so its pixel anchor is known
  SETTLED != READY — a tap SELECTS it before any gesture is judged
  A · tap to select                    -> geometry UNCHANGED
  B · 4px, below the coarse threshold  -> geometry UNCHANGED
  C · exactly 8px, STRICTLY GREATER    -> geometry UNCHANGED
  D · 30px, clearly a drag             -> geometry CHANGES
  E/F · select-only taps left NO history entry; the drag left one
  G · a SECOND finger cancels an in-progress drag
```

Every verdict is read from `drawingsStore`'s synchronously-persisted geometry —
the product's own truth — never inferred from the pointer events the harness
dispatched. All seven cases A–G the brief required are covered, including the
strictly-greater-than boundary and multi-touch cancellation.

## 8 · Feed scroll intent — PASS, with the finger half named

On-device the step passes: the card's chart computes `touch-action: auto`, the
scroller is scrollable, and no drawing overlay accepts pointers inside a card.
Nothing in a card claims the vertical gesture.

⛔ **This is the structural half.** Whether the chart's own touch handlers steal
a mostly-vertical drag cannot be decided from computed styles, and a synthetic
TouchEvent cannot scroll anything — the compositor scrolls from real input. A
real finger drag was attempted but the cards had not painted, so movement was not
visible. **Named, not assumed.**

⚰️ This step produced **four wrong conclusions in a row** before it was right,
all from reading the card and its chart in two statements while the window was
moving: a fabricated `touch-action: "none"` from an old fallback firing on a
placeholder card, an unearned `!important` CSS override shipped against a defect
that did not exist, a wrong disproof of that override, and a null dereference.
The override is reverted; the read is atomic and carries which card it read.

## 9 · Order integrity

The scan surface publishes the exact reading order including the live-only tail,
and the screener publishes the loaded display order after the live re-sort moved
into `ScannerShell`. The hard case is pinned: a **value sort AND a live-only
tail** together — sorted nightly block first, tail below in the route's order —
asserted against what the DOM is showing, not against the fixture. The feed
renders the session's order with no re-derivation inside `/charts`.

## 10 · Prefetch — still NOT MEASURED

This run produced no credible with/without next-symbol timing: on-device the
tunnel dominates, and the old sandbox 503 path was not used to manufacture a
comparison. The debt stays explicit.

## 11 · Pre-existing reachability failure — OUT_OF_SCOPE

`reachable.test.js` names 16 `community/` + `floor2/` modules with no route
reaching them, from `cc195e888`, which pointed `/community` at
`CommunityRedesign` and left the old page mounted by nothing. Untouched.

**Regression state, separated:**

```
FULL SCOPE             exit=1   1,251 passed / 1 failed (1,252)   <- the Floor
THIS PHASE (no Floor)  exit=0   1,240 passed (1,240)
```

## 8 · ⚰️ The harness was testing a 393×150 phone

Found while answering "why is the screen only showing this much?" — and it is the
most consequential harness defect of the programme.

`#app` is `position: fixed; inset: 0 0 46% 0` with **no CSS `height`**. An
`<iframe>` carries HTML's default replaced-element size of **300×150**, and when
`top`, `bottom` *and* `height` are all non-auto, CSS is over-constrained and
`bottom` is the declaration that gets dropped. Measured, not inferred: computed
`top: 0px`, `bottom: 0px`, **`height: 150px`** on a 659 px phone.

**So every device run before this rendered the app into a 393×150 window.**

⭐ What that does and does not invalidate, stated case by case:
- **Unaffected — logic verdicts.** The slop contract (geometry before/after a
  gesture), the feed handoff, the ≤3 ceiling, order and continuity are all
  reasoning about state, not layout. Re-run at the corrected 393×659: **slop
  12/12, feed 9/9**, and slop re-confirmed **on device, 12/12 in 2.7 s**.
- **Unaffected — the density number.** Cards-per-screen is `100 / height-vh`,
  a ratio; it is the same at any viewport height.
- **Corrected — the pill rectangles.** The first measurement put LEFT at x 68 and
  a 255 px thumb distance; at the true viewport it is x 8 and 326 px. The
  decision does not move — LEFT still covers the oldest bars and RIGHT the newest
  — but the numbers in §6 are the corrected ones.

Fix: give `#app` an explicit `height: 54%`, and set `height: 100%` alongside
`inset: 0` in view mode. Verified on hardware: the app now fills the phone, with
the chart, drawing toolbar and placed line all visible.
