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

# ⭐ THE PHONE SCRIPT — ten minutes, on the iPhone 15 Pro, on production

**This half is for the owner, with the phone in hand. Everything below it is reference for whoever
reads the trace afterwards.** Run it on the 15 Pro first — that is the device that scored 0/10 —
and then, if there is time, on the SE, which is the comparison the diff is built around. Nothing
here touches anyone else's data; step 4 flags and unflags one ticker on your own account, and that
is the only write in the script.

> **Where:** `https://uctintelligence.com` on the phone, signed in as **your own admin account**.
> Your account is right for this one and not a shortcut: the toggle resolves as `isAdmin && stored`,
> so only an admin can record at all, and the trace **never leaves the device** — no endpoint, no
> upload, clipboard only. A local sandbox is not evidence; it must be production.
>
> **Roughly ten minutes.** Twenty-five deliberate gestures and two visits to Settings.

### 1. Turn the recorder on

**Settings → Charts → Joystick → "Record gesture trace"** — switch it on, then press **Clear**.

> **What you should see:** the toggle goes on and two buttons appear under it, **Copy trace** and
> **Clear**. Clear prints nothing dramatic — it empties the buffer so an earlier capture cannot
> bleed into this one. ⛔ The card is under **Charts**, not a section of its own; searching Settings
> for "joystick" also finds it.

### 2. Go to the Screener

Open **Screener** and let the results paint. Rest your thumb on the pad so the chip appears, and
read it.

> **What you should see:** the joystick pad at its resting position, and the chip naming the ticker
> under the cursor (e.g. `NVDA`). If it says `No results`, the scan is empty — pick another scan
> before continuing, because with no symbol the "Chart it" and "Flag" bubbles render **disabled**,
> and a flick at a disabled bubble measures the disabled state rather than the flick.

### 3. Ten flicks at **Chart it**

Flick toward the **Chart it** bubble — outer ring, up and to the left — **ten times, deliberately,
about one every two seconds.** Counting them out loud helps; the count is what makes the arithmetic
afterwards possible.

> **What you should see:** each flick either fires (you land on the chart) or opens the fan.
> ⚠️ **"Chart it" NAVIGATES**, so a flick that works takes you to `/charts` — **come back to
> Screener after each one.** The trip back is not part of the measurement and the recorder does not
> care about it. If ten round trips is too much, do these ten at **Flag** instead and say so when
> you send the trace: the analyser is told which bubble you aimed at, in order, and it will not
> guess.

### 4. Ten flicks at **Flag**

Same motion, same rhythm, aimed at **Flag** — ten times.

> **What you should see:** the row's flag state toggling on and off as each one fires, and the page
> staying where it is. ⛔ This is the only step that writes anything: ten toggles of one ticker's
> flag on your own account, which lands back where it started on an even count.

### 5. Five slow drags at **Chart it** — the control

Now do it **wrong on purpose**: press, drag slowly to **Chart it** over about half a second, and
release. **Five times.**

> **What you should see:** the fan opens as you drag, the bubble highlights, and releasing fires it.
> ⭐ **These five are the control, and they are SUPPOSED to look wrong in the analysis** — they
> should come back as *"flick window missed"*, because they were never flicks. If the control does
> not land there, the instrument is not measuring what we think it is, and the twenty real flicks
> above cannot be read either.

### 6. Copy the trace

Back to **Settings → Charts → Joystick → Copy trace**, and **read the message it prints.**

> **What you should see:** a confirmation naming **how many events were copied and their sequence
> range** — e.g. *"Copied 214 events (seq 1–214)"*. ⛔ If it says the buffer was empty, the recorder
> was off and the run has to be repeated. If it says events were **dropped**, the buffer overflowed
> and the beginning is gone. Either way the capture is void — that is the instrument being honest,
> not a bug. If the clipboard is blocked, the JSON appears in a **box below the buttons**: select it
> all and copy it by hand.

Paste the whole thing back — a message, a note, a file, whatever reaches the desk. **The whole JSON,
never an excerpt:** the analyser refuses anything that is not a complete payload, on purpose.

### 7. Turn the recorder off

**Settings → Charts → Joystick → "Record gesture trace"** — off.

> **What you should see:** the toggle off and the two buttons gone. With it off the pointer path is
> the uninstrumented one — not a trace branch that decides to do nothing, but the raw handlers, so
> nothing is recorded and nothing is paid for.

## The clipboard format — what lands in the paste, and what reads it

`tools/hub_trace_analyze.py` takes that JSON **unchanged**. Do not reformat it and do not pull out
"the interesting rows".

```json
{
  "trace": "uct-joystick-g0",
  "schema": 1,
  "capturedAt": "2026-09-12T02:14:07.221Z",
  "constants": { "FLICK_MS": 120, "TRAVEL_PX": 16, "OPEN_AT_RATIO": 2.5 },
  "device": { "userAgent": "…iPhone…", "maxTouchPoints": 5, "devicePixelRatio": 3,
              "screenWidth": 393, "screenHeight": 852, "innerWidth": 393, "innerHeight": 745 },
  "window": { "capacity": 500, "recorded": 214, "kept": 214, "dropped": 0,
              "firstSeq": 1, "lastSeq": 214 },
  "rows": [
    { "seq": 1, "type": "pointerdown", "pointerType": "touch", "clientX": 331, "clientY": 690,
      "eventTs": 18422.7, "perfNow": 18423.1, "sinceDownEventTs": 0, "sinceDownPerfNow": 0,
      "coalesced": 1, "flickMs": 120, "openThreshold": 40, "travelPx": 16,
      "phase": "down", "elapsed": null, "travelled": 0, "decision": null, "target": null },
    { "seq": 9, "type": "pointerup", "pointerType": "touch", "elapsed": 176, "travelled": 83,
      "sinceDownEventTs": 41, "sinceDownPerfNow": 176, "coalesced": 6,
      "decision": "press-fire",
      "target": { "id": "scan.chartIt", "ring": 0, "index": 0, "angle": 178, "flickable": true } }
  ]
}
```

⭐ **The three clocks on that last row are the whole question.** `elapsed` is what the engine
compared against `flickMs`; `sinceDownPerfNow` is the same interval by `performance.now()`; and
`sinceDownEventTs` is it by `event.timeStamp`, which is stamped nearer the hardware. `elapsed 176`
beside `sinceDownEventTs 41` says the finger was fast and the **events arrived late** — a different
defect, and a different fix, from a finger that was genuinely slow.

## Reading it — one command

```sh
python tools/hub_trace_analyze.py --self-check        # first: prove the classifier can fail

python tools/hub_trace_analyze.py trace-15pro.json \
    --expect scan.chartIt:10 --expect scan.flag:10 --expect scan.chartIt:5

python tools/hub_trace_analyze.py trace-15pro.json --compare trace-se.json \
    --expect scan.chartIt:10 --expect scan.flag:10 --expect scan.chartIt:5
```

One row per gesture, in one of these buckets, then one verdict line per hypothesis:

| Bucket | What it means | The number it reports |
|---|---|---|
| **(a)** fired the intended action | the flick did what the thumb asked | `elapsed`, `travelled`, `angle` |
| **(b)** flick window missed | the flick branch was not taken; handled as a deliberate press — **the five control drags belong here** | `elapsed` vs `FLICK_MS`, or `travelled` vs `openThreshold` |
| **(c)** no engine transition | the pointer never completed in the engine | the first event actually seen |
| **(d)** fired a different action | the vector resolved onto a neighbour | the measured `angle`, and which action it hit |
| **(guard)** `flickable:false` | on Journal's **Close** this is the CORRECT outcome, not a miss | `elapsed`, and the target's `flickable` |

⛔ **`--expect` is how intent enters the analysis, because intent is not in the trace.** Without it
every fired gesture is reported as *intent not declared* rather than assumed correct — the analyser
will not read the action that fired as the action you meant.

⛔ **Order matters.** Expectations are matched to gestures **in sequence**, so a block run out of
order, or a bubble swapped mid-run, mislabels everything after it. If step 3 was done at Flag
instead, pass `--expect scan.flag:20` and say so.

---

# Reference — for whoever reads the trace

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

## 5. Capturing it, and diffing two devices

**The phone half is the numbered script at the top of this file.** This section used to repeat it in
prose; a second copy of a procedure is a second authority over it, and the two would drift.

**The desk half is one command**, `tools/hub_trace_analyze.py` (see *Reading it* above). What it
does that a person reading raw JSON cannot:

1. **Segments the event stream into gestures** — `pointerdown` to release — and classifies each from
   the row the ENGINE wrote. It re-derives no verdict of its own: `decision` and `target` come from
   the branch in `useJoystick.js` that took the decision.
2. **Matches intent by ORDER, declared with `--expect`.** Intent is not in the trace, so the tool
   refuses to infer it; an undeclared gesture is reported as *intent not declared*, never as a
   success. ⛔ Pairing is over gestures that reached a RELEASE, so one dropped gesture cannot slide
   every later label by one.
3. **Runs the non-vacuity gate first.** A capture with `window.dropped > 0`, with no rows, or with
   no `pointerType: "touch"` is **UNREADABLE (exit 2)** and nothing is averaged over it. An
   overflowed buffer is a failed capture, not a clean device.
4. **Prints the three-clock comparison** — `elapsed` vs `sinceDownPerfNow` vs `sinceDownEventTs`,
   with the largest `coalesced` count beside them — which is what separates cause A's *root* (late
   delivery) from cause A with honest delivery (the finger really was slower than 120 ms).
5. **`--compare` prints the second device beside the first.** Compare in this order and **stop at
   the first thing that differs**; everything after it is downstream:
   - the `decision` histogram over releases;
   - `elapsed` against `flickMs` (cause **A**);
   - the three clocks (cause **A**'s root);
   - `travelled` against `openThreshold` (cause **B**);
   - `target.id` / `target.flickable` against the registry (cause **C**).

⛔ **Run `--self-check` before believing a run.** It proves each bucket is reached by the row that
means it, that an intent-withheld gesture stays UNDECIDED, and that an overflowed buffer is refused
while a healthy one is not — rule 14's non-vacuity control, applied to the analyser itself.

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
