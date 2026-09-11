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

  let decision
  let decided = flickTarget
  if (flickTarget && flickTarget.action.flickable !== false) {
    fireTarget(flickTarget)          // ← fires
    decision = 'flick-fire'
  } else if (flickTarget) {
    // flickable:false (Journal's Close, etc.) — open the fan instead of firing anything.
    decision = 'flick-open'
  } else {
    const released = releaseOntoFan(dx, dy)
    decision = `flick-none-${released.outcome}`
    decided = released.resolved
  }
  resetGesture()
  return { decision, phase, elapsed, travelled, resolved: decided }
}
```

Constants: `FLICK_MS = 120`, `TRAVEL_PX = 24`, `openThreshold = openAtPx(travelPx)`.

⭐ **The `decision`/`return` lines are the shipped instrumentation, not pseudocode.** The handler
names its own outcome so the trace never has to guess one — see §3.

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

## 3. The instrument, as shipped

> ⚰️ **This section used to describe a hypothetical `localStorage` ring buffer read out of a Safari
> console with `window.__uctFlickTrace()`. It was never built that way.** The instrument is in the
> product, behind a toggle the owner can reach on the device with a thumb — because the operator
> performing G0-1 is on BrowserStack Live driving real glass in a browser, not attached to a remote
> Web Inspector. Everything below describes what is actually in the build.

⛔ **The instrumentation must not change behaviour.** It records and does nothing else: no early
returns, no threshold changes, no branch reordering. A trace that alters the thing it measures is
worse than no trace, and this is the most safety-critical file in the feature.

**Where it lives**

| Piece | File |
|---|---|
| The toggle — *Settings → Joystick → "Record gesture trace"* | `app/src/pages/settings/JoystickSettingsCard.jsx` |
| The flag, resolved | `app/src/hub/useHubSettings.js` (`settings.traceGestures`) |
| The recording | `app/src/hub/useJoystick.js` (`withTrace`) |
| The ring buffer + the JSON payload | `app/src/hub/gestureTrace.js` |

**The four properties it is built on, each with a rail behind it**

- **Off by default, and admin-only.** `HUB_SETTINGS_DEFAULTS.traceGestures` is `false`, and
  `useHubSettings` resolves the key as `isAdmin && stored === true`. The card hiding the control is
  an exposure default; the resolution is the actual gate, so a member who writes the key straight
  to the unvalidated `POST /api/auth/preferences` still records nothing. Rails:
  `app/src/hub/gestureTrace.test.js` (facts 5–6, in `exposureGate.test.js`'s idiom — that file is
  H11-frozen and was not edited) and `useHubSettings.test.jsx`.
- **With the toggle off, the pointer path is the uninstrumented one.** `useJoystick` returns the
  raw handler functions; `withTrace` is applied only under the flag, so there is no trace branch
  inside a pointer handler to mis-execute and no row object built per event. Rail:
  `gestureTraceEngineParity.test.jsx` runs every gesture in the vocabulary twice, off and on, and
  requires the two outcomes to be identical with the buffer empty in the first case.
- **⛔⛔ The trace never decides anything.** `onPointerUp` and `onPointerCancel` return a
  descriptor — `{decision, phase, elapsed, travelled, resolved}` — built *inside* the branch that
  ran, from the very locals that branch compared. The wrapper serialises it. It contains no
  decision vocabulary at all, so it cannot author a verdict: a trace that re-derived one would
  agree with the engine right up until the moment they disagreed, which is the only moment anyone
  reads it (`lesson_a_second_authority_over_one_value`).
- **⛔⛔ No sink.** Master spec §8's "no analytics" holds. There is no endpoint, no beacon, no
  upload; the buffer's only exit is the clipboard, and a source sweep over all three files
  (comment-stripped, with a control proving it can see a real call) asserts it stays that way.

**Capacity.** A module-level circular buffer of **500** rows, oldest dropped. The export always
carries `recorded` / `kept` / `dropped` / `firstSeq` / `lastSeq` beside the rows, and the Copy
button's own message names them — `lesson_a_saturated_instrument_reports_zero`: 500 rows and 5,000
events look identical unless the instrument says which it was.

## 4. What a row contains, and which cause each field settles

**Every pointer event on the pad gets a row** — `pointerdown`, `pointermove`, `pointerup`,
`pointercancel` — not only the decisive one, because cause A is about *delivery* and the moves are
where delivery is visible.

| Field | Cause | What it is |
|---|---|---|
| `elapsed` | **A** | ⭐ **The number the branch actually compared.** The engine measures with `Date.now()` — not `performance.now()`, not `event.timeStamp` — so this is the only field that decides anything. Present on `pointerup` rows. |
| `flickMs` | **A** | `FLICK_MS` as the running build holds it. A pasted trace whose threshold disagrees with the build that produced it is unreadable, so it ships with the rows. |
| `eventTs`, `perfNow` | **A** | This event's two clocks, both read at handler entry: `event.timeStamp` and `performance.now()`. |
| `sinceDownEventTs`, `sinceDownPerfNow` | **A** | ⭐ **The load-bearing pair**, the same two measured from this gesture's `pointerdown`. |
| `coalesced` | **A** | `event.getCoalescedEvents().length` — direct evidence of the batching that is A's proposed mechanism. `null` where the browser does not expose it. |
| `travelled`, `openThreshold`, `travelPx` | **B** | On a `pointerup`, `travelled` is exactly the value the flick branch compared. On a `pointermove` it is the engine's running maximum after that sample. |
| `clientX`, `clientY` | **B** | The raw geometry, so travel can be re-read independently of the engine's running maximum. |
| `target` — `{id, ring, index, angle, flickable}` | **C** | The bubble `resolveTarget` returned, flattened. `null` when it resolved nothing. |
| `decision` | **the verdict** | One of `flick-fire` · `flick-open` · `flick-none-fire`/`-sticky`/`-close` · `press-fire`/`-sticky`/`-close` · `home` · `scrub-commit` · `tap-pending` · `double-tap` · `cancel`. ⚠️ `tap-pending` and not `tap`: the single tap fires `doubleTapMs` later unless a second press cancels it, so at release time that outcome has not happened yet. |
| `phase` | context | The engine's own phase at the moment the row was decided — `idle` · `down` · `pushing` · `scrubbing`. |
| `pointerType`, `isPrimary`, `pointerId`, `pressure` | hygiene | Separates a real finger from an automation pointer, and catches a stray second pointer. |
| `type`, `seq` | hygiene | The DOM event type, and the row's position in the total stream. |

Plus, once per export: `device` (`userAgent`, `devicePixelRatio`, screen and viewport size,
`maxTouchPoints`), `constants` read from `constants.js`, and the `window` block above.

**The shape a pasted trace has:**

```jsonc
{
  "trace": "uct-joystick-g0",
  "schema": 1,
  "capturedAt": "2026-09-11T18:22:04.117Z",
  "constants": { "FLICK_MS": 120, "TRAVEL_PX": 24, "OPEN_AT_RATIO": 0.4166666666666667 },
  "device": { "userAgent": "…iPhone…", "devicePixelRatio": 3, "screenWidth": 393, … },
  "window": { "capacity": 500, "recorded": 34, "kept": 34, "dropped": 0,
              "firstSeq": 1, "lastSeq": 34 },
  "rows": [
    { "seq": 33, "type": "pointerdown", "pointerType": "touch", "pointerId": 1,
      "isPrimary": true, "pressure": 0.42, "clientX": 331, "clientY": 702,
      "eventTs": 918233.4, "perfNow": 918235.1,
      "sinceDownEventTs": 0, "sinceDownPerfNow": 0, "coalesced": 1,
      "flickMs": 120, "openThreshold": 10, "travelPx": 24,
      "phase": "down", "elapsed": null, "travelled": 0,
      "decision": null, "target": null },
    { "seq": 34, "type": "pointerup", "pointerType": "touch", "pointerId": 1,
      "isPrimary": true, "pressure": 0, "clientX": 297, "clientY": 668,
      "eventTs": 918274.9, "perfNow": 918277.0,
      "sinceDownEventTs": 41.5, "sinceDownPerfNow": 41.9, "coalesced": 0,
      "flickMs": 120, "openThreshold": 10, "travelPx": 24,
      "phase": "down", "elapsed": 42, "travelled": 48.1,
      "decision": "flick-fire",
      "target": { "id": "journal.close", "ring": 0, "index": 3,
                  "angle": 135, "flickable": true } }
  ]
}
```

⛔ **The row above is what a FAILING 15 Pro would look like on cause C**: `journal.close` is
declared `flickable: false` in the registry, so a row that says `flick-fire` on it with
`"flickable": true` means the vector resolved onto a *different* bubble than the thumb was aimed
at. That is the shape to look for — the fields disagreeing with the registry, not the trace
disagreeing with itself.

## 5. Capturing it

1. Sign in as an **admin** on the device, on **production** (`https://uctintelligence.com`). A local
   sandbox shake-out is not certification evidence.
2. **Settings → Joystick → "Record gesture trace"** on. Press **Clear** — the previous device's
   capture must not bleed into this one.
3. Go to the Journal with at least one open position, open the hub's fan, and run the G0-1 script
   from `glass-acceptance.md`: ten flicks at **Close**, then one deliberate ~500ms press.
4. Back in Settings, press **Copy trace**. Read the message it prints: it names how many events were
   copied and their sequence range, and says so plainly if the buffer was empty or overflowed. If
   the clipboard is unavailable the JSON appears in a box below for manual copy.
5. Paste it back. **Turn the toggle off.**
6. Repeat on the second device, clearing between runs.

## 5b. How to diff SE vs 15 Pro

1. Run the **same ten-flick script** on both devices, same build, same account, same target bubble,
   in the same session window.
2. Export both traces.
3. Compare in this order — **stop at the first thing that differs**, because everything after it is
   downstream:
   - **`decision` histogram over the `pointerup` rows.** If the SE shows 10 × `flick-open` and the
     15 Pro shows a mix including `press-fire`, the divergence is the flick branch and you are in
     cause A or B.
   - **`elapsed` distribution.** Median and max against `flickMs`. Cause A predicts the 15 Pro's
     median sits at or above 120 while the SE's sits well below.
   - **`elapsed` vs `sinceDownEventTs` vs `sinceDownPerfNow` — the three clocks.** Cause A's
     *root*: if `elapsed` (the engine's `Date.now()` delta) and `sinceDownPerfNow` are large while
     `sinceDownEventTs` is small, the events were DELIVERED late and no threshold change is the
     right fix — the code should measure from `event.timeStamp`, which is stamped nearer the
     hardware, rather than from a wall clock read in the handler. If all three agree, delivery is
     honest and the finger really was slower than 120ms, which is a product decision with a
     distribution attached rather than a bug. Cross-check with `coalesced`: batching on the 15 Pro
     and none on the SE is the mechanism in the open.
   - **`travelled` vs `openThreshold`.** Cause B.
   - **`target.id` / `target.flickable` against the registry.** Cause C.
4. ⛔ **Non-vacuity before concluding anything:** confirm both traces contain ten `pointerup` rows
   each with `pointerType: "touch"`, and that `window.dropped` is 0. An empty, short or truncated
   buffer is a failed invocation, not a clean device — the same rule the gate wrapper is built
   around, and the reason the Copy button refuses to say "Copied" over nothing.

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
