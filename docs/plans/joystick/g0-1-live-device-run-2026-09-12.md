# G0-1 on real glass — BrowserStack Live, iPhone 15 Pro / iOS 17.6, 2026-09-12

**Result: `INCONCLUSIVE-TRANSPORT`. Box 1 of `closure.md` is NOT ticked.**
The mirror cannot deliver a gesture inside the 120 ms window, so no flick was ever
attempted on this device by a real touch. What the run *did* establish is written out
below, because three of the four things it eliminated were live hypotheses this morning.

---

## 0. The control, first

⛔ **Read this before any table.** The protocol's own readability gate is the measured
on-device duration of a gesture the operator asked to be a flick. If that number is not
under `FLICK_MS`, nothing further in the run is a statement about the product.

| block | transport | n | `elapsed` (ms, device's own `Date.now()` delta) | readable as a flick? |
|---|---|---|---|---|
| **A** | Live mirror, 140 px drag | 5 | 323, 359, 260, 280, 279 | ❌ **no** — min 260, 2.2× the window |
| **B** | Live mirror, shortest drag it accepts (22 px) | 5 | 313, 377, 279, 329, 427 | ❌ **no** — min 279, and *worse* than A |

`FLICK_MS = 120`, read from the running build's own payload, not retyped
(`constants: {FLICK_MS: 120, TRAVEL_PX: 24, OPEN_AT_RATIO: 0.4166666666666667}`).

**B is the mandated single retry, and it failed in an informative way.** Shortening the
drag by 6× (139 px → 23 px of travel) did not shorten the gesture: the move count barely
moved (11–22 → 16–19) and the median duration went *up* (280 → 329 ms). ⭐ **The mirror's
cost is per pointer-event round trip, not per pixel.** There is no shorter drag; the floor
is the number of events the client insists on sending, and the operator does not control it.

⇒ `INCONCLUSIVE-TRANSPORT`. Per the standing instruction, box 1 stays open.

---

## 1. Provenance

| | |
|---|---|
| device | BrowserStack **Live** (no Automate; nothing purchased), iPhone 15 Pro, Safari |
| UA, from the trace's own `device` block | `Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, …)` |
| viewport | `innerWidth 393 × innerHeight 659`; `visualViewport 393 × 659`, `offsetTop 0` |
| account | the synthetic production smoke account — `role: "admin"`, `hub_preview_enabled: true` |
| target | `https://uctintelligence.com/screener`, production |
| pad, measured | `getBoundingClientRect()` → `x 285, y 507, w 84, h 84` ⇒ centre **(327, 549)**, which is exactly `hub_g0_protocol.pad_centre(393, 659)`. The harness's geometry is correct on real hardware. |
| capture | `capturedAt: 2026-09-12T14:30:31.073Z`, `window.recorded: 224`, `dropped: 0` |
| read path | `data-hub-trace` on `[data-testid="joystick-trace-section"]`, read through the **Safari Web Inspector** attached to the Live session — the exact path `JoystickSettingsCard.jsx` says the attribute exists for. No clipboard bridge was used. |

⭐ **The Web Inspector on a Live session preserves the page.** Attaching and detaching it
does not reload the device's tab: a marker set on `window` before the first attach was
still there after two detach/attach cycles. That matters more than it sounds — the trace
ring is module state with no sink, so a reload would destroy every capture. The console log
*is* cleared on each attach; `window` is not.

---

## 2. Setup finding — the hub was not rendering, and it was not a defect in the hub

`document.querySelector('[data-testid="hub-root"]')` returned **null** on `/screener`.
Before calling that a product defect, every gate was read on the device itself:

```
bf  (backdrop-filter)          false      ← unprefixed, as Phase 2 already recorded
wbf (-webkit-backdrop-filter)  true       ← the capability floor PASSES
mq  (max-width:1023 + coarse)  true
vv  (visualViewport)           "object"
orb (voice orb present)        true       ← the documented hub-inactive fallback
```

So eligibility passed and the hub was still absent ⇒ the member preference. Read back
from `/api/auth/preferences`:

```json
"joystick_hub": "{\"enabled\":false,\"handedness\":\"right\",\"haptics\":true,\"holdMs\":500,
  \"travelPx\":24,\"doubleTapMs\":280,\"stickyFan\":true,\"highContrast\":false,
  \"traceGestures\":true,\"overrides\":{},\"coachMarkSeen\":true}"
```

**`enabled: false`, stored explicitly**, on an account whose `role` is `admin` — for whom an
*unset* preference resolves to ON (`rolloutStage.unsetDefault`). Ticking "Joystick shortcuts
(preview)" in Settings → Charts brought the pad back immediately, at the predicted pixel.

⚠️ **Two candidates were considered. One is ruled out in code; the other is mine.**

(b) *"A preference write made while the auth payload has not resolved persists a flat
`false` over an admin's default-ON state"* — `updateHubSettings` writes
`enabled: resolveEnabled(currentStoredEnabled)`, and `resolveEnabled(undefined)` is
`unsetDefault({ isAdmin })`, so the shape is real. It was an attractive suspect because the
page *was* throwing 502s throughout (a master deploy was rebuilding `web`; see §6).
⛔ **It does not hold, and the reason is worth keeping.** Two independent guards close it:
`AuthContext.fetchUser`'s `transientFailure()` leaves `user` **untouched** on any ≥500 or
thrown fetch (R2, 2026-08-22) — so `isAdmin` never flips on a blip; and on the initial load,
while `user` is still null, `rolloutStage.cardVisible({ isAdmin: false, everChose: false })`
is false at stage 1, so the card is not rendered and there is no control to write through.
No reachable path writes this key with `isAdmin` false. `useHubSettings.test.jsx:121-138`
already rails the positive case.

(a) **A stray tap on the card's first checkbox** during the earlier blind hunt for the trace
toggle, on a 0.71-scale mirror. `onToggle` writes `enabled: checked` explicitly, which is
exactly the value found. Every other key in the blob sits at its default, which is what one
`withDefaults` write looks like. ⭐ **This is the instrument, not the product** — and it is
recorded here rather than quietly fixed because it cost twenty minutes of "the hub does not
render on a real 15 Pro", which is the opening line of a product-defect report.
**Lesson: on a scaled mirror, get the target's rect from the device and convert, instead of
tapping at an eyeballed pixel.** The conversion used for the rest of this run —
`mirror = (497 + 0.7125·cssX, 88 + 0.7125·cssY)` — landed every subsequent tap first time.

---

## 3. Blocks A and B — the twenty flicks were never run, and why that was the right call

Every gesture in A and B resolved, fired the intended action, and was classified by the
engine as **`press-fire`** — a deliberate press released onto a target — never `flick-fire`.

| # | block | decision | `elapsed` | travel | moves | coalesced | target |
|---|---|---|---|---|---|---|---|
| 0 | A | `press-fire` | 323 | 139 | 21 | 0 | `scan.flag` |
| 1 | A | `press-fire` | 359 | 139 | 22 | 0 | `scan.flag` |
| 2 | A | `press-fire` | 260 | 139 | 18 | 0 | `scan.flag` |
| 3 | A | `press-fire` | 280 | 139 | 11 | 0 | `scan.flag` |
| 4 | A | `press-fire` | 279 | 139 | 18 | 0 | `scan.flag` |
| 5 | B | `press-fire` | 313 | 23 | 17 | 0 | `scan.flag` |
| 6 | B | `press-fire` | 377 | 23 | 19 | 0 | `scan.flag` |
| 7 | B | `press-fire` | 279 | 23 | 16 | 0 | `scan.flag` |
| 8 | B | `press-fire` | 329 | 23 | 18 | 0 | `scan.flag` |
| 9 | B | `press-fire` | 427 | 23 | 19 | 0 | `scan.flag` |

⛔ **The twenty-flick tables are deliberately absent.** Twenty more rows of `press-fire` at
~300 ms would have been twenty more measurements of BrowserStack's websocket, published in
a table headed "flick". The readability gate exists precisely so that a run which cannot
see the thing it is named after says so instead of filling in.

⭐ **But A and B are not nothing.** They are a clean 10/10 on the *press* path, on a real
iPhone 15 Pro, against production: ten deliberate presses with travel, ten correct
resolutions of the intended outer-ring action. The Phase 2 finding that opened G0-1 —
*"iPhone 15 Pro scored sticky fan 0/10 and flick 0/10"* — is **not reproduced for the
press/sticky half** on iOS 17.6.

---

## 4. Block C — an ENGINE probe, and what it is allowed to prove

⛔⛔ **THIS IS NOT A G0-1 RESULT AND MUST NEVER BE CITED AS ONE.** Block C dispatches
`PointerEvent`s in the device's own page from the Web Inspector console. They carry
`pointerType: "touch"` and reach `useJoystick`'s handlers with real wall-clock spacing, but
**no finger touched glass**, so every question about iOS's touch→pointer pipeline — the
whole remaining hypothesis space — is untouched by it.

What it *can* do is test the branch itself, at a duration the mirror cannot reach.

| # | decision | `elapsed` | `sinceDownEventTs` | travel | moves | coalesced | target |
|---|---|---|---|---|---|---|---|
| 10 | **`flick-fire`** | 77 | 77 | 140 | 3 | 0 | `scan.flag` |
| 11 | **`flick-fire`** | 77 | 78 | 140 | 3 | 0 | `scan.flag` |
| 12 | **`flick-fire`** | 77 | 77 | 140 | 3 | 0 | `scan.flag` |
| 13 | **`flick-fire`** | 79 | 79 | 140 | 3 | 0 | `scan.flag` |
| 14 | **`flick-fire`** | 76 | 84 | 140 | 3 | 0 | `scan.flag` |
| 15 | **`flick-fire`** | 79 | 79 | 140 | 3 | 0 | `scan.flag` |

**6/6.** On iOS 17.6 Safari, given a pointer sequence that arrives inside the window,
`elapsed < FLICK_MS && travelled >= openThreshold` → `forceOuterRing` → `resolveTarget` →
`fireTarget` works, and resolves the correct action for the direction.

### What this eliminates

1. **The flick branch is not dead code on this Safari.** A build- or feature-level failure
   of the flick path on iOS 17.6 is ruled out.
2. **The clocks agree.** Across all 16 gestures, `elapsed` (the engine's `Date.now()` delta,
   the one number compared against `FLICK_MS`) and `sinceDownEventTs` (`event.timeStamp`)
   differ by **≤ 8 ms**, worst case. Cause A as originally written — *the three clocks
   disagree and the engine measures the wrong one* — **is not present on iOS 17.6.**
3. **Coalescing contributes nothing here.** `getCoalescedEvents()` added **0** rows on every
   gesture of every block, both transports. The sub-hypothesis that iOS hides the fast part
   of a gesture inside coalesced events gets no support from this device.
   ⚠️ A real finger may still coalesce where a dispatched event cannot; (3) is the weakest
   of the three and is an observation about this transport, not a closed question.

---

## 5. Transports tried, and one rejected with evidence

| transport | result |
|---|---|
| Live mirror, extension drag, 140 px | works; 260–359 ms. Too slow. |
| Live mirror, extension drag, 22 px (shortest accepted) | works; 279–427 ms. **Not faster** — the floor is per-event. |
| **Synthetic mouse/pointer events on the mirror canvas** (`#flashlight-overlay-native`, dispatched in the operator's browser at 39–60 ms) | ⛔ **rejected by BrowserStack.** 5 attempts; `window.recorded` stayed at exactly **100**, i.e. *zero* events reached the device. The client does not act on untrusted events. |
| Clipboard bridge | refused by ruling; never used. |
| Automate / App Automate | not purchased; out of scope by ruling. |

⭐ The synthetic-canvas attempt is recorded because it *looked* like it worked — it returned
plausible local durations (39–60 ms) and the screen did not visibly change. Only the
device's own counter said it had done nothing. **A transport that reports success locally
and delivers nothing is exactly the shape that manufactures a finding**, and the only thing
that caught it was reading a number the device owns.

---

## 6. One production observation, explained, not an incident

The device console showed a broad 502 storm (`/api/watchlists`, `/api/live-prices`,
`/api/voice/insights/*`, `/api/community/status`, `/api/alerts*`, `/api/ticker-tags/public`)
between roughly 14:07 and 14:25 UTC, and `/screener` itself rendered "Scan failed — scan 502".

Cause: a **deploy rebuild**, not a fault. `origin/master` took `294fc28fe` at 09:15:48 CDT
(14:15:48 UTC); `/api/health` at 14:35 UTC reported `uptime_seconds: 777`, i.e. the `web`
service came up at ≈14:22 UTC. Every master push rebuilds `web`. Nothing to chase.
(`rss_mb: 1804.5` at 13 minutes' uptime is noted in passing, not diagnosed here.)

---

## 7. Where G0-1 now stands — and the sentence that has to be said

Everything that could narrow G0-1 without a human finger has now been done:

- the hub renders and the pad is at the specified pixel on a real 15 Pro ✅
- the press path fires 10/10 on that device ✅
- the flick branch fires 6/6 when a gesture reaches it inside the window ✅
- the engine's clock and the event clock agree to within 8 ms ✅
- coalescing adds nothing on this transport ✅

The single remaining question is the one no funded product can reach:

> **Does a real finger flicking the pad on an iPhone 15 Pro produce a `pointerdown` →
> `pointerup` pair whose `Date.now()` delta is under 120 ms?**

The Live mirror's floor is ~260 ms, so it cannot ask that question, and it will not get
faster with a different drag. ⛔ **This is the moment the standing instruction anticipated:
"Patrick's own phone testing is deferred to the very end and only if nothing else can
proceed — say so explicitly if that moment comes." It has come, and this is that sentence.**

The owner's run is short, because the instrument is already built and already proven on
real hardware today: turn **Record gesture trace** on in Settings → Charts, go to
`/screener`, flick the pad twenty times toward the upper-left, return to Settings, press
**Copy trace**, paste. `tools/hub_trace_analyze.py` reads it, and its control block is what
tells us whether the twenty were flicks.

### On the iPhone SE leg

**Not run, deliberately.** The blocker measured above is a property of the *mirror*, not of
the device on the other end of it: an SE session would reproduce `press-fire` at ~300 ms and
add no information about the flick. Spending a sign-in on an unreadable run would put a
second device's name on a table that measures BrowserStack. Say the word and it takes ten
minutes — but as the control it was meant to be, it is only worth running once there is a
readable flick to control *for*.

---

## 8. State left behind on the smoke account

- `joystick_hub.enabled` — **true** (was `false`; turned on to make the hub render at all).
- `joystick_hub.traceGestures` — **false**, toggled back off at the end of the run, verified
  by the rendered checkbox.
- `scan.flag` fired **16** times across the three blocks, all on the same cursor row (no
  cursor-advancing action ever fired). Even count ⇒ net unflagged; a DOM read for flagged
  rows afterwards returned 0. Within the authorised write surface ("Flag toggles on its own
  account").
- Nothing else was written. No SQL. No stage change: `ROLLOUT_STAGE` is still **1**.
