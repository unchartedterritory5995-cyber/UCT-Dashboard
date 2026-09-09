# The 20 critical mobile workflows, rerun against the finished implementation

> ⛔ **SUPERSEDED by `99e-post-certification-reconciliation.md` §6 (2026-09-08,
> tip `f5a495c51`).** The verdicts below are preserved exactly and are correct
> **as of the certification tip `f8d625c27`**. Two have since moved on new
> evidence: **F12 drawing properties** TRADINGVIEW_AHEAD → PARITY (Hide shipped
> *with* its recovery surface, `d216ba57b`) and **F14 alert from an object**
> TRADINGVIEW_AHEAD → PARITY (MOB-05 shipped, `2d3b2d555`). The distribution is
> now UCT_AHEAD 11 · PARITY 7 · TRADINGVIEW_AHEAD 0 · DIFFERENT_MODEL 1 ·
> PARTIAL 1. The TradingView baseline in `70` was **not** re-opened.

Baseline: `70-task-flow-comparisons.md` (the certified research verdicts).
Rerun: 2026-09-08, against this branch's tip.

**Evidence tiers used here, and they are not mixed.**
`REAL` = real iPhone (13 / iOS 15.5 and 17.5, tonight) · `BROWSER-390` = a real
browser at 390px against **this worktree's** code · `TEST` = behavioural tests
driving the shipped doors · `SOURCE` = read, not run · `UNMEASURED` = say so.

⛔ **The scoring is not massaged.** Five flows are unchanged, three still favour
TradingView, and one verdict moved *against* an item I shipped tonight (F12).

---

| flow | baseline | now | Δ |
|---|---|---|---|
| F01 launch → chart | PARITY | **PARITY** | — |
| F02 change ticker | PARITY | **PARITY** | — |
| F03 cycle watchlist | UCT_AHEAD (loop) | **UCT_AHEAD** | — |
| F04 change timeframe | UCT on cost | **UCT_AHEAD** | — |
| F05 inspect a candle | UCT on content, caveat | **UCT_AHEAD** ⬆ | `$ Vol`/`Avg 50D` restored, REAL-verified |
| F06 return to live | PARITY (TV unverified) | **PARITY** | — |
| F07 add an indicator | UCT on comprehension | **UCT_AHEAD** | — |
| F08 modify an indicator | *unresolved hole* | **UCT_AHEAD** ⬆ | hole closed — the chip menu is richer than TV's |
| F09 remove / hide an indicator | *unresolved* | **PARITY** ⬆ | hide ≠ remove ships on the chip menu |
| F10 add a drawing | **TRADINGVIEW_AHEAD** | **PARITY** ⬆ | MOB-04: pinned All door + search + recents |
| F11 position / edit a drawing | UCT on exactness, 2 blocked | **UCT_AHEAD** ⬆ | blocked checks measured; narration + cancel added |
| F12 drawing properties | PARITY, different sets | **TRADINGVIEW_AHEAD** ⬇ | Hide still absent — deferred *with* a reason |
| F13 alert from a price | UCT_AHEAD | **UCT_AHEAD** | — |
| F14 alert from an object | UCT cost / TV semantics | **TRADINGVIEW_AHEAD** | MOB-05 not shipped — see below |
| F15 change chart type | PARITY | **PARITY** | — |
| F16 chart settings | UCT on reach | **UCT_AHEAD** ⬆ | Percent scale reachable again |
| F17 portrait ↔ landscape | *unresolved* | **PARTIAL** ⬆ | presentation REAL-verified both ways; app state UNMEASURED |
| F18 leave and come back | UCT (TV unverified) | **UCT_AHEAD** ⬆ | MOB-09 closes a silent cross-device loss |
| F19 save / restore a workspace | **TRADINGVIEW_AHEAD** | **UCT_AHEAD** ⬆ | MOB-01 door + server-backed named layouts |
| F20 contextual intelligence | PARITY / model diff | **DIFFERENT_MODEL** | — |

**Tally now:** UCT_AHEAD 11 · PARITY 5 · TRADINGVIEW_AHEAD 2 · DIFFERENT_MODEL 1 ·
PARTIAL 1. Baseline was UCT_AHEAD 5 · PARITY 6 · TV_AHEAD 2 · unresolved 4 · other 3.

---

## The flows that moved, and what actually changed

### F05 · Inspect a candle precisely — UCT_AHEAD, now REAL-verified
One crosshair hold returns date · O · H · L · C · **V · $ Vol · Avg 50D** ·
change · change % · every MA and every indicator chip. Measured on a real
iPhone 13: `V 2.6M · $ Vol $302.1M · Avg 50D 2.1M · EMA 9 113.64 · EMA 20 112.08
· SMA 50 108.93 · SMA 200 109.14`, no horizontal overflow, legend right edge
308px inside 390.
*interactions* 1 · *depth* 0 · *keyboard* none · *context loss* none · *tier* REAL.

### F08 / F09 · Modify and remove an indicator — the hole was in the research
The baseline called F08 "the study's largest **coverage** hole" and was careful
to report it as a hole rather than a UCT gap. That caution was right: the
affordance exists and is richer than the thing it was compared against. Tapping a
study's legend chip opens **Settings… · Show/Hide · Move to (price / own pane /
volume) · Duplicate · Add alert on… · About · Remove**, with refusals shown as
sentences rather than greyed rows.
*interactions* 2 · *depth* 1 · *tier* SOURCE + TEST. **MEASURE-03 is closed and
MOB-12 is NOT_REPRODUCED** — the "on this chart band" it proposed would add less
than what ships.

### F10 · Add a drawing — the top surviving UI gap, closed
Baseline: 3 of 18 tools visible in a rail with no scrollbar, no fade, no
coach-mark; 15 tools reachable only by an undiscoverable swipe. Now: a pinned
`⊞ All` door — **outside** the scroll rail so it cannot scroll away — opening a
labelled, searchable 4-across grid with a Recent row, plus a trailing-edge mask
so the swipe announces itself.
*interactions* 2 to ANY tool (open, tap) · *depth* 1 · *keyboard* optional
(search) · *tier* TEST (13 cases, roster-derived counts).
⚠️ Not `UCT_AHEAD`: TradingView's picker is still native-fast and its categories
help at a larger catalogue. **PARITY is the honest verdict.**

### F11 · Position / edit a drawing — and the placement moment
The two `ACCESS_BLOCKED` sub-checks were closed by MEASURE-01. Tonight adds the
half-finished placement: the chip is no longer a one-time coach mark but a live
HUD while points are pending — **"Point 2 of 3"** plus **Cancel**, which reuses
Escape's own abort. UCT keeps `Set level…` (exact numeric entry), which
TradingView has no equivalent for.
*tier* SOURCE + TEST; pixels are the device pass's.

### F12 · Modify drawing properties — ⬇ AND I AM MARKING THIS AGAINST MYSELF
Baseline said PARITY with different sets, listing **Hide** as MISSING on UCT —
"small, real, cheap". It is not cheap in this codebase: drawings carry `locked`
but no `hidden`, so it is a model field plus the render loop plus both hit-test
loops **plus a recovery surface**. Hiding an object that vanishes with no list to
unhide it from creates exactly the ACCIDENTALLY_UNAVAILABLE state this sprint
forbids, and the object tree that would fix it is deferred. Shipping half of it
would be worse than none. **So TradingView is ahead here, and stays ahead.**

### F14 · Alert from a drawing or indicator — TradingView ahead, deliberately
UCT creates one in three gestures with zero typing; TradingView binds the alert
to the object so moving the line moves the alert. UCT's is **seeded** — a price
snapshot that then stands alone. MOB-05 would fix it and is **not shipped
tonight**: it needs an alert-row schema change and a change to server-side alert
evaluation, neither of which can be verified in this session (the device cannot
authenticate — see below). Shipping an unverifiable change to how a member's
alerts fire is not a trade worth making at 4am.

### F16 · Chart settings — Percent scale is reachable again
The A/L/% chips are `display:none` on the phone shell and were the **only writer
of `percentScale` in the app**. The price-axis long-press now offers Arithmetic /
Logarithmic / Percent with Auto beside them, all through one writer.
*interactions* 2 · *depth* 1 · *tier* BROWSER-390 (axis observed re-scaling to
`18.00% … 0.00% … -4.00%`) + TEST + REAL (chips confirmed absent).

### F17 · Portrait → landscape → portrait — PARTIAL, and the split is stated
**Measured on a real iPhone 13 / iOS 17.5**, live readout, both directions: the
presentation contract holds, and the reveal correctly rides the *landscape
branch* of the media list (`max-width:640` false, landscape branch true) rather
than the width branch. Rotating back restores portrait exactly.
⛔ **What is NOT measured: app-level state across rotation** — symbol, timeframe,
drawings, open sheets. That needs the authenticated app on a device, which is
blocked. Recorded as PARTIAL, not as a pass.
⚠️ An earlier landscape reading said ALL PASS and was **discarded**: it reported
`max-width: 640px: true` on an 844px landscape phone, which is impossible — the
readout had stopped polling 16s earlier and was showing frozen portrait values.
A stale instrument does not fail; it agrees with whatever you last measured.

### F18 · Leave and come back — MOB-09
Undo/redo and per-symbol state were already good. What was silently broken:
`useTracingsSync` advanced its highwatermark **before** an unawaited write, so
any failed push pinned the device forever behind a strict `>` adopt gate — the
server holding drawings the browser would never take. Fixed, plus a reconciliation
that heals devices already pinned.

### F19 · Save and restore a workspace — the largest surviving gap, closed
Baseline: "the phone is a first-class WRITER to a durable object it cannot name,
snapshot or restore." MOB-01 shipped the door: Tools → Layouts → apply / prebuilt
/ Save / Save As / delete-own, calling the desktop's own handlers against the
same server record. Device-verified on iPhone 15 / iOS 17.5 at the time.
**UCT is now ahead on the measured axis** — the door exists, and UCT's record is
named, server-backed and cross-device, with firm-published prebuilts.
⚠️ **Evidence-tier discipline:** the *comparative* claim is scoped to what the
research actually observed of TradingView (`CMP-068`…`CMP-073`). I have **not**
verified whether TradingView offers anything equivalent to firm-published
templates, so this does not claim it lacks them — a negative claim about a
competitor needs the same proof as a positive one, and I do not have it.

---

## The three flows where TradingView still wins, plainly

1. **F12 drawing properties** — per-object Hide. Deferred because shipping it
   without a recovery surface would create a worse defect than it fixes.
2. **F14 object → alert** — TradingView *binds*; UCT *seeds*. This is the one
   cluster the research called "simply better", and it remains true.
3. **F10 is PARITY, not a win** — the door is open now, but a native
   category picker on a large catalogue is still a better shape than a flat grid.

Plus two standing product decisions, unchanged and correct:
**bar replay** and **symbol comparison** are `INTENTIONALLY_DESKTOP_ONLY`, now
recorded as such in `98` §3.3 rather than looking like oversights.

---

## Addendum · one capability the 20 flows never covered

**Drawing Boards** ("tracings" — named overlay sheets of drawings spanning every
ticker) is not one of the 20 certified flows, because the research never built a
flow for it. It was found instead by the MOB-06′ presentation register, as an
**orphaned mobile task**: real, per-user, synced, rendered by the canvas, and
reachable only through a `ChartToolbar` the phone shell sets to `display:none`.

It shipped tonight (`f8d625c27`) — Tools → **Drawing boards**, beside Layouts:
switch · rename · show/hide · delete · new, with the active board named on the row.

⭐ **Worth recording as a method point:** the flow comparison found *zero* of this.
Twenty task flows chosen by comparing two products can only see capabilities that
sit on both sides of the comparison; a **register of the product's own controls**
found this in one pass. The two instruments answer different questions and this
study needed both.
⚠️ I am deliberately **not** claiming TradingView lacks an equivalent — I have not
verified that, and a negative claim about a competitor needs the same proof as a
positive one. What is verified is that UCT has boards, and that until tonight the
phone could not reach them.
