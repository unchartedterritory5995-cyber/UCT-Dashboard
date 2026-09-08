# Review feed — hardware UX / performance certification, 2026-09-08

## Verdicts

| | |
|---|---|
| `REVIEW_FEED_HARDWARE` | **PASS** |
| `FEED_SCROLL_INTENT` | **PASS** (structural, on-device; the finger half is named below) |
| `TOUCH_SLOP_HARDWARE` | **NOT RUN** |
| `REVIEW_PILL_POSITION` | **STILL_UNRESOLVED** — default stays LEFT |
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

## 6 · Pill placement — STILL_UNRESOLVED

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

## 7 · Touch slop — NOT RUN

No hardware step exists for it. The shipped contract (`SLOP_COARSE = 8`,
`SLOP_FINE = 2`) is covered by source-rail and unit tests only. Building the step
is tractable — the drawing overlay is driven by pointer events, which synthetic
events *can* exercise (unlike native scrolling) — but it was not built in this
pass, and reporting a PASS from the existing evidence would be claiming a device
result that does not exist.

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
