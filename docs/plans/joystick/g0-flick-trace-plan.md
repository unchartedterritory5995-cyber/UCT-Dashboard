# G0-1 — the flick trace plan

**Written ahead of need, 2026-09-11.** If the owner's G0-1 run returns a score below 8/10, this is
the next engineering task. It is written now so that a low count does not start with a blank page
and a guess — which is what the Phase 2 run record explicitly warned against:

> "⚠️ **Unexplained. It needs its own trace**, the way the sticky-fan 5/10 did — guessing here is
> how the previous wrong diagnoses started."

⛔ **DO NOT "FIX" THIS BY RAISING `FLICK_MS`.** That is the tempting one-line change and it is a
guess dressed as a fix: it would also make every genuine deliberate press on a slow device read as
a flick, which is the *opposite* failure and a far more dangerous one — a flick fires an action, so
widening the window widens the set of gestures that fire without intent. Instrument first.

---

## 1. The decision, quoted, and the only three ways it can go wrong

`app/src/hub/useJoystick.js`, in the release handler:

```js
// Flick: a press under FLICK_MS that travelled far enough. Evaluated at release time from the
// release vector itself, independent of whatever ring the live push-tracking above landed on.
if (elapsed < FLICK_MS && travelled >= openThreshold) {
  const outer = forceOuterRing(dx, dy)
  const flickTarget = outer ? resolveTarget({ dx: outer.dx, dy: outer.dy, actions: fan, travelPx, mirrored }) : null
  if (flickTarget && flickTarget.action.flickable !== false) {
    fireTarget(flickTarget)          // ← fires
  } else if (flickTarget) {
    // flickable:false (Journal's Close, etc.) — open the fan instead of firing anything.
  }
}
```

Constants: `FLICK_MS = 120`, `TRAVEL_PX = 24`, `openThreshold = openAtPx(travelPx)`.

**Close is `flickable: false`.** So on a correct device a fast flick at Close takes the second
branch: the fan opens, nothing fires. A *fire* on the iPhone 15 Pro therefore means exactly one of
three things, and the trace's whole job is to say which:

| # | Cause | What it would mean |
|---|---|---|
| **A** | `elapsed >= FLICK_MS` | The flick was measured as SLOW, fell out of the flick branch entirely, and was handled by the ordinary release path — i.e. it fired as a **deliberate press**. ⭐ **Leading hypothesis.** |
| **B** | `travelled < openThreshold` | The flick did not travel far enough to count as one, so it resolved as a **tap** instead. |
| **C** | `flickTarget` resolved to a different action | The geometry put the release vector on a neighbouring bubble whose `flickable` is not false — a resolution problem, not a timing one. |

⭐ **A and B are distinguishable only by numbers, and they have opposite fixes.** That is the
entire reason this cannot be diagnosed by watching the screen.

## 2. Why A is the leading hypothesis

`elapsed` is wall-clock between the `pointerdown` and `pointerup` the page *receives*. The iPhone
15 Pro is a **120Hz ProMotion** device; the iPhone SE (3rd gen) is 60Hz. Safari coalesces and
batches pointer events, and the relationship between the physical touch and the timestamp the page
sees is not guaranteed to be the same across refresh rates, nor between a real finger and an
automation-driven pointer.

If delivery of `pointerdown` is deferred relative to the physical contact — or if `pointerup`
arrives on a later frame — a physically fast flick can be *measured* as >120ms. The gesture would
then be handled as a deliberate press and **fire**, which is precisely the observed symptom.

⚠️ **This is a hypothesis with a named kill condition, not a conclusion.** If the trace shows
`elapsed` clustering well under 120ms on the 15 Pro and the fires are still happening, A is dead
and the answer is B or C. Record that outcome as loudly as a confirmation.

## 3. What to instrument

⛔ **The instrumentation must not change behaviour.** It records and does nothing else: no early
returns, no threshold changes, no branch reordering. A trace that alters the thing it measures is
worse than no trace, and this is the most safety-critical file in the feature.

Add a **dev-only ring buffer** to `useJoystick.js`, gated so it is inert in a normal session:

- **Gate:** a `localStorage` flag (`uct.hub.flickTrace = '1'`), read ONCE at hook init into a
  `const`. Not a prop, not a preference key — it must be settable from Safari's console on a
  BrowserStack device without a deploy, and it must not reach the preferences payload.
- **Buffer:** a module-level array capped at ~200 entries, oldest dropped. Never sent anywhere.
- **Read-out:** expose it as `window.__uctFlickTrace` (a function returning a copy), so the
  operator can paste it out of the remote Web Inspector console. ⛔ The buffer must be capped —
  `lesson_a_saturated_instrument_reports_zero`: print the window bounds with the rows so a full
  buffer cannot read as "nothing else happened".

## 4. What to log, per pointer event

One row per `pointerdown` / `pointerup` pair, written at the release decision point so every field
is the value the branch actually saw:

| Field | Why it is in the list |
|---|---|
| `downTs`, `upTs`, `elapsed` | **Cause A.** The number the branch compares against `FLICK_MS`. |
| `event.timeStamp` for both, alongside `performance.now()` | ⭐ **The load-bearing pair.** If `timeStamp` deltas are small while `performance.now()` deltas are large, the events were delivered late and A is confirmed at its root. If both agree, the finger really was slow and A is about the member, not the device. |
| `dx`, `dy`, `dist`, `maxDistRef`, `travelled`, `openThreshold` | **Cause B.** Whether it cleared the travel bar at all. |
| `pointerType`, `isPrimary`, `pointerId` | Separates a real finger from an automation pointer, and catches a stray second pointer. |
| `coalescedCount` (`event.getCoalescedEvents?.().length`) | Direct evidence of batching, which is A's mechanism. |
| `branch` — one of `flick-fire`, `flick-open`, `tap`, `press`, `scrub-commit`, `cancel` | **The verdict the code reached.** Without this the numbers are uninterpretable. |
| `targetId`, `ring`, `flickable` | **Cause C.** Which bubble the vector resolved to and whether it was allowed to fire. |
| `devicePixelRatio`, `screen.width/height`, `navigator.userAgent` | So a pasted buffer identifies its own device without the operator annotating it. |

## 5. How to diff SE vs 15 Pro

1. Run the **same ten-flick script** (glass-acceptance G0-1) on both devices, same build, same
   account, same target bubble, in the same session window.
2. Export both buffers.
3. Compare in this order — **stop at the first row that differs**, because the later rows are
   downstream of it:
   - **`branch` histogram.** If the SE shows 10 × `flick-open` and the 15 Pro shows a mix
     including `press`, the divergence is the flick branch and you are in cause A or B.
   - **`elapsed` distribution.** Median and max. Cause A predicts the 15 Pro's median sits at or
     above 120 while the SE's sits well below.
   - **`event.timeStamp` delta vs `performance.now()` delta.** Cause A's *root*: if they disagree
     on the 15 Pro and agree on the SE, the events are arriving late and no threshold change is
     the right fix — the code should measure from `event.timeStamp`, which is the hardware-ish
     clock, rather than from `performance.now()` read in the handler.
   - **`travelled` vs `openThreshold`.** Cause B.
   - **`targetId` / `flickable`.** Cause C.
4. ⛔ **Non-vacuity before concluding anything:** confirm both buffers actually contain ten rows
   each with `pointerType: 'touch'`. An empty or short buffer is a failed invocation, not a clean
   device — the same rule the gate wrapper is built around.

## 6. What each outcome licenses

- **A confirmed at the root (late delivery):** change what `elapsed` is measured FROM, not what it
  is compared against. Rail it against recorded traces from both devices.
- **A confirmed but delivery is honest (the finger really was slower than 120ms):** this is not a
  bug. It is a threshold that does not match how people actually flick on a larger phone, and it
  is a product decision with a number attached — bring the distribution, not an opinion.
- **B:** the travel bar is the problem, and `openThreshold` derives from `TRAVEL_PX`, which is a
  member-facing setting. Check whether the two devices resolve `travelPx` differently at all.
- **C:** a geometry/resolution bug, and `fanGeometry` has its own rails to extend — this one is
  the cheapest to fix and the least likely.

⭐ **Whatever the answer, it lands as a rail with a recorded trace behind it**, the way the
sticky-fan 5/10 was settled. A fix to a gesture threshold with no device trace attached is exactly
the "previous wrong diagnoses" the run record is warning about.
