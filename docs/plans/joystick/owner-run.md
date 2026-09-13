# The owner's run — ONE session, on your own phones

> **This is the only thing in the joystick programme still waiting on Patrick.** Everything else is
> PASS, N/A, or filed as a deferred item with an owner. Nothing else is blocked behind this.

⭐ **Why these rows and no others.** Each one is here because a *transport* could not answer it, not
because the product is suspect. The reasons are kept apart deliberately, because they are different
facts:

| reason | what it means | rows |
|---|---|---|
| **Mirror timing floor** | BrowserStack Live costs **260–427 ms per gesture** (measured, 16 gestures, two drag lengths). `FLICK_MS = 120`. A flick is physically unmeasurable through it — the cost is per pointer-event round trip, so a shorter drag does not help. | G1-1…G1-6, D4 |
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

⛔ **G2-3 / G2-4 (iOS VoiceOver) are NOT on this list and stay BLOCKED.** BrowserStack's iOS devices
answer *"Screen Reader is currently not supported for this device"* — a tooling fact, not something
a phone can answer differently. If you want them covered they need a real iPhone with VoiceOver,
which is the same device as section A; add them there if you choose to.

⛔ **A FAIL anywhere in section A is a stop-and-ring finding**, not a note for later: it would mean a
fast tap can fire a destructive action on real glass.
