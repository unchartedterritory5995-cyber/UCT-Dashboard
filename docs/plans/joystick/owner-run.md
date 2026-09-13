# The owner's run — ONE session, on your own phones

> **This is the only thing in the joystick programme still waiting on Patrick.** Everything else is
> PASS, N/A, or filed as a deferred item with an owner. Nothing else is blocked behind this.

⭐ **Why these rows and no others.** Each one is here because a *transport* could not answer it, not
because the product is suspect. The reasons are kept apart deliberately, because they are different
facts:

| reason | what it means | rows |
|---|---|---|
| **Mirror timing floor** | BrowserStack Live costs **260–427 ms per gesture** (measured, 16 gestures, two drag lengths). `FLICK_MS = 120`. A flick is physically unmeasurable through it — the cost is per pointer-event round trip, so a shorter drag does not help. | G1-1…G1-6, D4 |
| **Mirror timing floor, again** | The same 260–427 ms floor is longer than the **280 ms** double-tap window (`DOUBLE_TAP_MS`), so Reverse cannot be driven through a mirror either. | B10, B11, B12 |
| **The mirror cannot HOLD a press** | A scrub is a 500 ms hold that turns into a drag (`HOLD_MS`, `useJoystick.js:408`). The mirror’s only drag primitive is one down-move-up, so a “scrub” through it is a **fan push** and fires an action instead. | B13, B14, B15 |
| **Mirror pointing precision** | With the Web Inspector attached the device renders at **~0.42 of CSS size**: a 44 px target is ~18 px on screen with ~20 px spacing. Aiming at one fan bubble hit its neighbour. | G3-4, G3-6…G3-11, G3-13, G3-14, G3-8 |
| **Cannot authenticate the device** | Android's mirror keyboard **drops capitalisation**; the login token is case-sensitive base64url. BrowserStack's `url=` preload is overwritten by its own session state. An agent may not type a password. | D1, G2-1, G2-2, Android rows |
| **Needs a human eye** | No instrument can answer "is this legible / distinguishable to a person". | G3-16(a), G3-2 legibility |
| **Needs a calendar condition** | The tile must genuinely be absent. | G3-5 |

⛔ **On your own phone none of this applies.** You are signed in already, your finger is a real
finger, and the screen is full size.

---

## A — iPhone: the flick block and the trace (the one that matters most)

⭐ **This is G0-1 and D4 together.** The question the whole programme could not answer: *does a real
finger's flick produce a `pointerdown → pointerup` pair under 120 ms, and if so does the hub do the
safe thing?* The engine-level flick path is proven working (6/6 at 76–79 ms via a device-console
probe) — what is unproven is the **touch pipeline on glass**.

⚰️ **THIS BLOCK WAS REWRITTEN 2026-09-13 BECAUSE IT ASKED FOR THE WRONG RESULT.** It previously
told you to expect *"0 of 8 fire"* at **five** targets. Only **one** action in the whole registry
carries `flickable: false` — `journal.close` — and the other four are `flickable: true`, where a
flick firing them **is the shipped design** (`00-master-spec-v1.6.md:396`: *"default true; false = deliberate selection
only"*). Four of six rows would have reported FAIL against correct behaviour, on the block that
unblocks 96 others. It also interleaved the controls, which `--control N` reads as *the last N
gestures*, so the real controls would have been counted as flicks and five flicks counted as
controls. ⛔ **Nothing here was dangerous** — every one of these five opens a **sheet**
(`openStopSheet`, `openPlanSheet`, or a confirm), so a flick can never write to a live position.
The defect was the expectation, not the product.

**Setup:** Settings → Joystick → turn **Record gesture trace** ON.

### A1–A5 — the flicks. Do all of these FIRST, in this order.

Four fast flicks at each target — as quick as you can, twenty in total.

| # | Target | Flick 4× at | What should happen | Result |
|---|---|---|---|---|
| A1 | `journal.close` | Journal fan → **Close** | ⛔ **NOTHING FIRES. 0 of 4.** This is the only `flickable: false` action in the registry, and this row IS D4. The fan opens instead. | ☐ PASS ☐ FAIL |
| A2 | `journal.moveStop` | Journal fan → **Move stop** | The **stop sheet opens** — this action is `flickable: true`, so firing is correct. ⛔ What must NOT happen is a stop being written with no sheet. | ☐ PASS ☐ FAIL |
| A3 | `journal.breakeven` | Journal fan → **Breakeven** | The **stop sheet opens**, seeded at entry. Same rule: a sheet, never a silent write. | ☐ PASS ☐ FAIL |
| A4 | `journal.planTrade` | Journal fan → **Plan trade** | **ONE** plan-trade sheet opens, never two. | ☐ PASS ☐ FAIL |
| A5 | `scan.alert` | Screener fan → **Alert** | The **confirm sheet opens**. A `kind: 'confirm'` never writes on the gesture itself. ⭐ Last on purpose: it is the only one that needs you to leave the Journal. | ☐ PASS ☐ FAIL |

### A6 — the control block. Do these LAST, all five together.

⛔ **ORDER IS LOAD-BEARING.** `--control 5` tells the analyser *the last five declared gestures are
the controls*. If you interleave them the tool labels five of your flicks as controls and your real
controls as flicks, and the control check — the thing that proves the instrument can tell a press
from a flick — becomes meaningless.

| # | Do this | What should happen | Result |
|---|---|---|---|
| A6 | One **deliberate press (~500 ms)** at each of the five above, in the same order: Close, Move stop, Breakeven, Plan trade, Alert. | Every one of them opens its sheet, **including Close**. ⛔ If Close does not open here, A1 proves nothing: a bubble that never fires because the fan never opened would also read 0 of 4. | ☐ PASS ☐ FAIL |

### Then the trace, which is the real payload

Settings → Joystick → **Copy trace**, paste it into a file, and run it with the targets declared in
the order you performed them:

    python tools/hub_trace_analyze.py trace-15pro.json --control 5 \
      --expect journal.close:4 --expect journal.moveStop:4 --expect journal.breakeven:4 \
      --expect journal.planTrade:4 --expect scan.alert:4 \
      --expect journal.close:1 --expect journal.moveStop:1 --expect journal.breakeven:1 \
      --expect journal.planTrade:1 --expect scan.alert:1

⛔ **The `--expect` list is positional and must match what you actually did.** It is how the tool
tells *"correctly suppressed"* from *"fired a different action"*; declared against the wrong targets
it will confidently mislabel every gesture. ⚰️ The command published here until 2026-09-13 read
`--expect scan.chartIt:10 scan.flag:10` — two targets that appear nowhere in this block, at counts
this block never asked for. It was left over from an older protocol.

⭐ **The number that settles G0-1** is how many of your flicks produced a down→up pair under 120 ms.
If they mostly do and Close never fired, the safety works. If they mostly do NOT, then a "flick" on
real glass is simply slower than 120 ms and the threshold is fine as shipped — that is a finding,
not a failure.

⚠️ **A question for you, not a defect.** Only `journal.close` is flick-guarded. `Move stop`,
`Breakeven` and `Plan trade` all commit against a live position once their sheet is confirmed. They
are sheet-mediated, so nothing is written by the gesture alone and the present design is defensible
— but whether a flick should be able to *open* those sheets at all is a product call nobody has
made. Recorded as **D-45**; it needs a ruling, not a fix.

---

## B — iPhone: rows a mirror could not aim at

Right-handed, normal settings. Each is one gesture and one observation.

| # | Row | Do this | What should happen | Result |
|---|---|---|---|---|
| B1 | G3-4 | Dashboard with the Catalysts tile present: tap, then scrub. | Cursor steps AND the row scrolls into view. The readout names the row ("NVDA — Earnings"), not a position. | ☐ PASS ☐ FAIL |
| B2 | G3-6 | Notebook: scrub the note list. | Cursor lands visibly on a card; the readout names the note. | ☐ PASS ☐ FAIL |
| B3 | G3-7 | Screener: scrub the results, **past the loaded window** of the virtualised list. | Cursor stays visible on the row, scrolls with it, does not vanish over unloaded rows. | ☐ PASS ☐ FAIL |
| B4 | G3-8 | Screener: activate **Scans**. | The saved-screen picker opens through the page's own door. | ☐ PASS ☐ FAIL |
| B5 | G3-9 | Dashboard: tap the pad, then double-tap it. | Tap goes to your **last-used section**; double-tap goes to **Morning Wire** — a FIXED destination, not a "back". ⛔ They must differ: `homeSection.js:213` navigates Reverse to Wire unconditionally, and spec §C3:915 rejected making Primary default to Wire precisely so the two gestures never coincide. If your last section WAS Wire, visit another one first or this row proves nothing. | ☐ PASS ☐ FAIL |
| B6 | G3-10 | Calendar: scrub the day cursor to each end. | Days step and **CLAMP** — they must not wrap. Readout matches the page's own label. | ☐ PASS ☐ FAIL |
| B7 | G3-11 | Chart: scrub the timeframe. | Steps in the same order the TF sheet shows. | ☐ PASS ☐ FAIL |
| B8 | G3-13 | Notebook: activate **Link ticker**. | The confirm sheet carries a symbol field — never a permanently dimmed bubble, never a label that lies. | ☐ PASS ☐ FAIL |
| B9 | G3-14 | Any confirm action with fields. | Steppers and numeric input operate on the same value the gesture produces, and the committed value is the adjusted one. | ☐ PASS ☐ FAIL |

### B10–B15 — the steps D-42 was hiding (added 2026-09-13)

⭐ **Why these exist now.** `tools/hub_surface_matrix.mjs` matched an object key only in its colon
form, so ES6 shorthand was invisible to it: `wire` and `home` wire all four gestures plus a readout
and the generator printed **“— none —”** for both, while `journal`'s scrub was missing from a table
that listed its tap. Fixing it (**D-42**, `d153215d0`) added fourteen steps to
`glass-acceptance-steps.md`. `notebook`'s Reverse is one of them and is genuinely new (**D-43**).

**Two were run on a 15 Pro** (`15pro-new-rows-2026-09-13.md`): `GS-wire-b1` **PASS**, `GS-home-b1`
**PASS on the spec**. The twelve below could not be, for two different measured reasons.

⛔ **Reverse — the double-tap window is shorter than the transport.** The second press must land
before a **280 ms** timer (`DOUBLE_TAP_MS`, `constants.js:91`). The measured BrowserStack Live cost
is **260–427 ms per gesture**, per pointer-event round trip, so a faster tap does not help.

⛔ **Scrub — it needs a 500 ms HOLD before the drag, and the mirror cannot hold a press.**
`useJoystick.js:408`: *“A hold that turns into a drag is Scrub — never a fan push, whatever the
distance (C1)”*, `HOLD_MS = 500`. The mirror's only drag primitive is one down-move-up. A drag
without the hold is a **fan push resolved by direction** — during the run it fired `home.scan` and
navigated to Screener, and on the Wire it fired `wire.voice` and raised a microphone prompt.

⭐ **On your own phone both are trivial**: double-tap normally, and for a scrub press and hold about
half a second until the knob dot enlarges, then drag without lifting.

✅ **And the sheet says so itself now.** Until 2026-09-13 `glass-acceptance-steps.md` read only
“Press and drag along y to scrub” — and a drag without the hold is a **fan push**, which is how a
run fired `wire.voice` and got a microphone prompt instead of a measurement. Fixed as **D-44**;
the hold is derived from `HOLD_MS`, never typed.

| # | Sheet row(s) | Do this | What should happen | Result |
|---|---|---|---|---|
| B10 | `GS-wire-b2` | Morning Wire: **double-tap** the pad. | The segment cursor steps **back** one and that segment scrolls into view. A single tap must not also fire. | ☐ PASS ☐ FAIL |
| B11 | `GS-home-b2` | Dashboard: **double-tap** the pad. | You land on **Morning Wire** — Reverse is a fixed destination and needs nothing stored (`homeSection.js:211`). ⛔ It must NOT be the same destination Primary just used, or the two gestures are indistinguishable. | ☐ PASS ☐ FAIL |
| B12 | `GS-notebook-b2` | Notebook: **double-tap** the pad. | The cursor steps back one note **and opens it** — the mirror of tap. At the first note it **CLAMPS**; it must not wrap onto the last. ⭐ **Shipped 2026-09-13 and never seen on glass.** | ☐ PASS ☐ FAIL |
| B13 | `GS-wire-b3/b4/b5` | Morning Wire: press the pad, **hold 500 ms until the knob dot enlarges**, then drag along y without lifting and release. | While dragging, the chip names **the segment under the cursor**, in the page's own words. On release that segment is **revealed** — scrolled into view, not merely selected. | ☐ PASS ☐ FAIL |
| B14 | `GS-journal-b3/b4/b5` | Journal, with at least one open position: same hold-then-drag. | The chip names **the position** under the cursor. On release that row is revealed. ⭐ This is the stop-adjust flagship's own scrub, and the matrix could not see it until today. | ☐ PASS ☐ FAIL |
| B15 | `GS-home-b3/b4/b5` | Dashboard: same hold-then-drag. | ⭐ **The sheet now agrees with this row.** (Historically it did not — see the note on the sheet's.** The chip says **“Go to <section>”** and **nothing on the page moves** — by design (`homeSection.js:175`). On release you **NAVIGATE** to the section the chip named. ✅ **D-44 is fixed** (2026-09-13): `glass-acceptance-steps.md` now derives every expectation from the mode’s own controller, so `home`’s rows describe navigation. | ☐ PASS ☐ FAIL |

⚠️ **`GS-home-b1` is PASSED and needs no row, but read this before judging `home` anywhere.**
A tap on the Dashboard navigates to your **last-used section** — measured, it went to Morning Wire —
and on a first-ever visit with nothing stored it is **deliberately inert** (spec §C3:915 rejected
defaulting it to Wire, because Primary and Reverse would then fire the same destination). The
generated sheet used to say “the cursor steps once and the target scrolls into view” for that
row. ✅ **Fixed 2026-09-13 (D-44)**: it now reads each expectation off the mode’s own controller, so
`home`’s four rows describe navigation and carry the inert-on-a-first-visit caveat spec §C3:915
requires. Nothing on this list needs that correction any more.

---

## C — Android phone + TalkBack

⭐ **TalkBack itself is confirmed working on a Pixel 8** — BrowserStack's screen reader toggled on
and off cleanly. What could not be done was signing the *mirrored* device in. On your own phone you
are already signed in.

**Setup:** Settings → Accessibility → TalkBack ON.

| # | Row | Do this | What should happen | Result |
|---|---|---|---|---|
| C1 | G2-1 | Swipe to focus the hub's **Actions** button, then double-tap. **No drag anywhere.** | The Actions sheet opens. | ☐ PASS ☐ FAIL |
| C2 | G2-2 | With TalkBack, activate **every** action on Home's sheet in turn. No drag at any point. | Each activates its own target. | ☐ PASS ☐ FAIL |
| C3 | D1 | The no-drag door generally: reach and operate the hub using TalkBack only. | Everything reachable; nothing requires a drag. | ☐ PASS ☐ FAIL |
| C4 | D4 (Android) | §A's flick block on Android: four fast flicks at each of the five targets, then the five deliberate control presses LAST. | Same expectations as A1–A5 and A6 — **0 of 4 on `journal.close` only**, a sheet on the other four, and every control opens its sheet. ⛔ Take a SECOND trace here and analyse it separately; `--compare` puts the two devices side by side. | ☐ PASS ☐ FAIL |

---

## C-iOS — iPhone + VoiceOver

⭐ **These were BLOCKED and they are not any more — the block was BrowserStack's, not the
product's.** Its iOS devices answer *“Screen Reader is currently not supported for this device”*,
which is a tooling fact, and a tooling fact is exactly the kind a real phone answers differently.
Your own iPhone has VoiceOver, so **G2-3 and G2-4 move from BLOCKED to this list.**

⛔ **This is not a duplicate of §C.** VoiceOver and TalkBack consume different gestures, and the
hub's no-drag door has only ever been exercised against one of them. “It works with TalkBack” is
not evidence about VoiceOver.

**Setup:** Settings → Accessibility → VoiceOver ON. ⚠️ Set the Accessibility Shortcut up FIRST
(Settings → Accessibility → Accessibility Shortcut → VoiceOver), because switching VoiceOver off
without it is considerably harder than switching it on.

| # | Row | Do this | What should happen | Result |
|---|---|---|---|---|
| Ci1 | G2-3 | Swipe to focus the hub's **Actions** button, then double-tap. **No drag anywhere.** | The Actions sheet opens. | ☐ PASS ☐ FAIL |
| Ci2 | G2-4 | With VoiceOver on, activate **every** action on Home's sheet in turn. No drag at any point. | Each one activates its own target — not its neighbour, and not nothing. | ☐ PASS ☐ FAIL |
| Ci3 | D1 (iOS) | A confirm action that carries fields: reach its numeric field and its ± steppers with VoiceOver, adjust the value, and commit. | The committed value is the **adjusted** one, and nothing along the way needed a drag. ⛔ This is the half §C's C3 cannot answer for iOS. | ☐ PASS ☐ FAIL |

---

## D — The two eye rows, and the calendar one

| # | Row | Do this | What to record | Result |
|---|---|---|---|---|
| D1 | G3-16(a) | Dashboard, open Home's fan. **Cover the labels.** Can you tell the **Wire** bubble from the **Journal** bubble by sight alone? | ⛔ Note whether you are colour-blind and which type — "looks fine to me" answers this for one pair of eyes only. (b) is already measured BETTER: ΔE00 14.5 → 28.0. | ☐ DISTINGUISHABLE ☐ CONFUSABLE |
| D2 | G3-2 | Settings → Joystick → **High contrast** ON. Use the hub on a busy page. | Every ring, chip and readout stays legible against the live page behind the glass. ⭐ The mechanism is confirmed armed on a real device (`data-hub-contrast="high"`); only legibility is yours to judge. | ☐ PASS ☐ FAIL |
| D3 | G3-5 | Load the Dashboard on a **Saturday or market holiday**. | The Catalysts tile is absent, the hub falls back to the route-derived mode, and you see the preview fan. Nothing pretends the section is there. | ☐ PASS ☐ FAIL |

---

## E — FPS, as a ratio (Block G4)

⛔ **Never measured, and a mirror cannot measure it** — frames through a screen mirror are the
mirror's frames, not the device's.

**The criterion is a RATIO, not an absolute:** PASS = fan-open fps **>= 0.9 x the same device's idle
baseline**. (A Galaxy S24 idles at 30.1 fps where a Pixel 8 idles at 60.3, so an absolute threshold
would measure the phone, not the hub.)

| # | Device | Idle baseline (hub idle, no fan) | Fan-open fps during a 5s drag | Ratio | Result |
|---|---|---|---|---|---|
| E1 | ____________ | ______ | ______ | ______ | ☐ PASS ☐ FAIL |
| E2 | ____________ | ______ | ______ | ______ | ☐ PASS ☐ FAIL |

---

## What happens with your answers

- **A1–A5, the A6 control block and the trace** close **G0-1** and **D4**, and unblock rollout
  stage 2's last glass gate. ⛔ A1 alone is D4; the trace alone is G0-1; neither is the other.
- **B1–B9** close the G3 rows a mirror could not aim at.
- **C1–C4** close **G2-1 / G2-2 / D1** (Android).
- **D1–D3** close the judgement rows.
- **B10–B15** close the twelve steps D-42 had hidden, including `notebook`’s brand-new Reverse.
- **Ci1–Ci3** close **G2-3 / G2-4** and the iOS half of **D1**.

☠️ ~~**G2-3 / G2-4 (iOS VoiceOver) are NOT on this list and stay BLOCKED.**~~ — **superseded
2026-09-13 by §C-iOS.** The sentence was right about the cause and wrong about the conclusion:
BrowserStack cannot run a screen reader on its iOS devices, but *your* iPhone can, and this is a
list of things done on your own phone. Struck rather than deleted, because a reader who remembers
only the old heading will leave two accessibility rows permanently unclosed.

⛔ **A FAIL anywhere in section A is a stop-and-ring finding**, not a note for later: it would mean a
fast tap can fire a destructive action on real glass.
