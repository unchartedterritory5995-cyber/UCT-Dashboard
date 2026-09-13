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

## A — iPhone: the flick-safety block (the one that matters most)

⭐ **This is G0-1 and D4 together.** The question the whole programme could not answer: *does a real
finger's flick produce a `pointerdown → pointerup` pair under 120 ms, and if so does the hub do the
safe thing?* The engine-level flick path is proven working (6/6 at 76–79 ms via a device-console
probe) — what is unproven is the **touch pipeline on glass**.

**Setup:** Settings → Joystick → turn **Record gesture trace** ON.

| # | Do this | What should happen | Result |
|---|---|---|---|
| A1 | Open the Journal fan. Flick fast at **Close**, 8 times, each as quick as you can. | The fan opens; **nothing fires**. No sheet, no write. 0 of 8. | ☐ PASS ☐ FAIL |
| A2 | **CONTROL** — same target, one deliberate press (~500 ms). | The Close sheet DOES open. ⛔ If this fails, A1 proves nothing. | ☐ PASS ☐ FAIL |
| A3 | Repeat A1/A2 at **Move stop**. | 0 of 8 fire; control opens. | ☐ PASS ☐ FAIL |
| A4 | Repeat at **Breakeven**. | 0 of 8 fire; control opens. | ☐ PASS ☐ FAIL |
| A5 | Repeat at Screener **Alert** (a confirm). | 0 of 8 fire; control opens the confirm sheet. | ☐ PASS ☐ FAIL |
| A6 | Repeat at **Plan trade**. | 0 of 8 fire; control opens ONE sheet, not two. | ☐ PASS ☐ FAIL |

**Then the trace, which is the real payload.** Settings → Joystick → **Copy trace**, paste it into a
file, and run:

    python tools/hub_trace_analyze.py --control 5 --expect scan.chartIt:10 scan.flag:10

⭐ **The number that settles G0-1** is how many of your flicks produced a down→up pair under 120 ms.
If they mostly do and nothing fired, the safety works. If they mostly do NOT, then a "flick" on real
glass is simply slower than 120 ms and the threshold is fine as shipped.

---

## B — iPhone: rows a mirror could not aim at

Right-handed, normal settings. Each is one gesture and one observation.

| # | Row | Do this | What should happen | Result |
|---|---|---|---|---|
| B1 | G3-4 | Dashboard with the Catalysts tile present: tap, then scrub. | Cursor steps AND the row scrolls into view. The readout names the row ("NVDA — Earnings"), not a position. | ☐ PASS ☐ FAIL |
| B2 | G3-6 | Notebook: scrub the note list. | Cursor lands visibly on a card; the readout names the note. | ☐ PASS ☐ FAIL |
| B3 | G3-7 | Screener: scrub the results, **past the loaded window** of the virtualised list. | Cursor stays visible on the row, scrolls with it, does not vanish over unloaded rows. | ☐ PASS ☐ FAIL |
| B4 | G3-8 | Screener: activate **Scans**. | The saved-screen picker opens through the page's own door. | ☐ PASS ☐ FAIL |
| B5 | G3-9 | Tap Home; then the reverse gesture. | Tap goes to the last section; reverse returns. Neither navigates somewhere unasked. | ☐ PASS ☐ FAIL |
| B6 | G3-10 | Calendar: scrub the day cursor to each end. | Days step and **CLAMP** — they must not wrap. Readout matches the page's own label. | ☐ PASS ☐ FAIL |
| B7 | G3-11 | Chart: scrub the timeframe. | Steps in the same order the TF sheet shows. | ☐ PASS ☐ FAIL |
| B8 | G3-13 | Notebook: activate **Link ticker**. | The confirm sheet carries a symbol field — never a permanently dimmed bubble, never a label that lies. | ☐ PASS ☐ FAIL |
| B9 | G3-14 | Any confirm action with fields. | Steppers and numeric input operate on the same value the gesture produces, and the committed value is the adjusted one. | ☐ PASS ☐ FAIL |

### B10-B15 - the steps D-42 was hiding (added 2026-09-13)

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
| C4 | D4 (Android) | The flick-safety block above, on Android. | Same expectation as A1–A6. | ☐ PASS ☐ FAIL |

---

## C-iOS - iPhone + VoiceOver

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

- **A1–A6 + the trace** close **G0-1** and **D4**, and unblock rollout stage 2's last glass gate.
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
