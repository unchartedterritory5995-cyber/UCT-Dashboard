# Joystick hub — real-glass acceptance

**This is the ONE open row in the whole program.** Everything else is shipped, railed and
gated. What remains cannot be produced by any session: it needs a human with a physical
finger on physical glass, driving BrowserStack Live in a browser.

> ⛔ **Never claim a device result from jsdom or an emulator.** jsdom performs no layout — it
> never resolves `calc()`, never applies `env(safe-area-inset-*)`, and reports zero for every
> measured box. A script written for a device and a result gathered from a device are two
> different artifacts; only the second closes a gate. (`CLAUDE.md`, "Real-device testing".)

> ⛔ **Absence is not PASS.** This program has already recorded four blank templates coming
> back and refused to read them as passes. An unfilled row below is OPEN, not PASS, forever.

> ⛔ **Claim this file before the session starts.** Stamp the header with the device, the
> session id and the ET time BEFORE opening the session. A run that dies must leave an
> explicit INCOMPLETE, never a stale pass from a previous run. (Phase 2 run 2 lost a Pixel 8
> mid-session and the previous run's JSON read as current.)

## Preconditions

- Target: **production**, `https://uctintelligence.com`. A local sandbox shake-out is NOT
  certification evidence and must not overwrite any.
- `HUB_PREVIEW_ENABLED` unset or `true` (it is `true` in production, deliberately).
- Sign in as an account whose `joystick_hub.enabled` preference is unset or `true`.
- A coarse-pointer device. The hub does not mount on a fine pointer.

## Session header — fill BEFORE you start

| Field | Value |
|---|---|
| Operator | ____________________ |
| Date / ET time started | ____________________ |
| BrowserStack session id | ____________________ |
| Device / OS / browser | ____________________ |
| App build (footer or `/api/health`) | ____________________ |
| Outcome | [ ] COMPLETE  [ ] **INCOMPLETE (session did not finish)** |

---

## Block G0 — carried forward from Phase 2, UNRESOLVED. Read before anything else.

⛔⛔ **These are not new rows. They are open findings from the Phase 2 device runs that were
never explained, and they sit exactly on top of the thing G1 measures.** They are repeated here
because a closure report that said "feature complete" while these lived only in a run record
would be hiding the most important open question in the program.

| # | Finding | Source | Status |
|---|---|---|---|
| G0-1 | **iPhone 15 Pro scored sticky fan 0/10 and flick 0/10, while iPhone SE scored 10/10 on both** — on the same calibrated pointer path, so the Selenium wheel bug no longer explains it. The run record's own words: "⚠️ **Unexplained. It needs its own trace**, the way the sticky-fan 5/10 did — guessing here is how the previous wrong diagnoses started." | `40-phase2-device.md` §"Still open on iPhone 15 Pro" | ⬜ **UNEXPLAINED** |
| G0-2 | **iOS gesture rows blocked by a Selenium input-source bug.** `driver.actions()` emits a `wheel` input source alongside the pointer and iOS WebDriverAgent rejects the whole action: `Only actions of '(...)' types are supported ... 'wheel' is given instead`. Harness, not product — but it means **the iOS gesture rows have never actually run**. | `40-phase2-device.md` §"Still open — all harness, none product" | ⬜ **HARNESS BLOCKED** |
| G0-3 | Ring 0 miss #1 — first iteration stayed on `/dashboard`, the other nine passed. "Smells like harness warm-up rather than product, **recorded as a guess, not a finding**." | same | ⬜ open, low severity |

⭐ **G0-1 is the reason this whole file exists.** A flick score of 0/10 on one iPhone and 10/10
on another is either a harness artifact or the flick-safety threshold behaving differently on
real glass — and those two have opposite consequences. **Resolve G0-1 before reading any G1
result as a pass**, because G1 is the same measurement performed by hand.

---

## Block G1 — D4, the flick-safety check. THE ONE THAT MATTERS.

The whole no-accidental-write design rests on this. It has passed in emulation on three
engine/viewport combinations (`device-steps/emulated-d4-control.json`); whether a real finger
on real glass honours the same threshold is the open question.

**Every row needs its deliberate control.** A run where nothing fires proves nothing unless a
deliberate press in the same session DOES fire — otherwise "safe" and "broken" look identical.

| # | Action | Expected | Screenshot | Result |
|---|---|---|---|---|
| G1-1 | Open the Journal fan. Flick fast at **Close** — 8 times, each under ~120ms finger-down-to-up. | The fan opens; **nothing fires**; no sheet, no write. 0 of 8. | `G1-close-flick.png` | [ ] PASS [ ] FAIL |
| G1-2 | **CONTROL** — same target, one deliberate press (~500ms+). | The Close sheet DOES open. If this fails, G1-1 proves nothing. | `G1-control.png` | [ ] PASS [ ] FAIL |
| G1-3 | Repeat G1-1/G1-2 at **Move stop**. | 0 of 8 fire; control fires. | `G1-movestop.png` | [ ] PASS [ ] FAIL |
| G1-4 | Repeat at **Breakeven**. | 0 of 8 fire; control fires. | `G1-breakeven.png` | [ ] PASS [ ] FAIL |
| G1-5 | Repeat at Screener **Alert** (a `confirm`). | 0 of 8 fire; control opens the confirm sheet. | `G1-alert.png` | [ ] PASS [ ] FAIL |
| G1-6 | Repeat at **Plan trade** (a `run` that opens its own sheet — R-16). | 0 of 8 fire; control opens ONE sheet, not two. | `G1-plantrade.png` | [ ] PASS [ ] FAIL |

## Block G2 — D1, the no-drag door (TalkBack / VoiceOver)

The Actions button is the WCAG 2.5.1 compliant path. Two-finger Peek is NOT — screen readers
consume two-finger single-tap before the page sees it, and two pointers is not a
single-pointer alternative. So this block is the accessibility gate, and Peek is not.

| # | Action | Expected | Screenshot | Result |
|---|---|---|---|---|
| G2-1 | **Android + TalkBack.** Swipe to focus the hub's Actions button, double-tap. No drag anywhere. | The Actions sheet opens. | `G2-talkback-sheet.png` | [ ] PASS [ ] FAIL |
| G2-2 | With TalkBack, activate **every** action on Home's sheet in turn, no drag at any point. | Each activates its target. | — | [ ] PASS [ ] FAIL |
| G2-3 | **iOS + VoiceOver.** Same as G2-1. | The Actions sheet opens. | `G2-voiceover-sheet.png` | [ ] PASS [ ] FAIL |
| G2-4 | With VoiceOver, reach and operate the **confirm sheet's number field and its ± steppers** on Screener Alert, and commit. | The price is adjustable and commits at the adjusted value, with no drag. This is the "EQUAL path" the sheet exists for. | `G2-confirm-fields.png` | [ ] PASS [ ] FAIL |

## Block G3 — surfaces added in Increments 3-7

Every one of these is emulated-green and has never been touched by a finger.

| # | Surface | Action | Expected | Result |
|---|---|---|---|---|
| G3-1 | **Left-hand mirror** | Settings to left-handed. Use the hub. | The knob, the edge tab, the Actions button and the toast all sit on the LEFT. Critically: **nothing invisible remains at the bottom-right** — tap around that corner and confirm no dead zone swallows taps. | [ ] PASS [ ] FAIL |
| G3-2 | **High contrast** | Enable high contrast. | Every ring, chip and readout stays legible against the live page behind the glass. | [ ] PASS [ ] FAIL |
| G3-3 | **Peek (two fingers)** | Two fingers down, both up. | The Peek sheet opens exactly once. A single-finger tap still taps and does NOT peek. | [ ] PASS [ ] FAIL |
| G3-4 | **Catalysts tap / scrub** | On the Dashboard with the Catalysts tile present, tap and scrub. | The cursor steps AND the row scrolls into view. The readout names the row ("NVDA - Earnings"), not just a position. | [ ] PASS [ ] FAIL |
| G3-5 | **Catalysts on a weekend** | Load on a Saturday or market holiday. | The tile is absent, the hub falls back to the route-derived mode, and the member sees the preview fan. Nothing pretends the section is there. | [ ] PASS [ ] FAIL |
| G3-6 | **Notebook cursor** | Scrub the note list. | The cursor lands visibly on a card and the readout names the note. | [ ] PASS [ ] FAIL |
| G3-7 | **Screener cursor** | Scrub the results, including past the loaded window of the virtualized list. | The cursor is visible on the row, scrolls with it, and does not vanish over unloaded rows. | [ ] PASS [ ] FAIL |
| G3-8 | **Screener scan picker** | Activate **Scans**. | The saved-screen picker opens through the page's own door. | [ ] PASS [ ] FAIL |
| G3-9 | **Home Primary / Reverse** | Tap Home; then the reverse gesture. | Tap goes to the last section; reverse returns. Neither navigates somewhere unasked. | [ ] PASS [ ] FAIL |
| G3-10 | **Calendar scrub** | Scrub the day cursor. | Days step and CLAMP at the ends (they must not wrap). The readout is the same label the page renders. | [ ] PASS [ ] FAIL |
| G3-11 | **Chart scrub** | Scrub the timeframe. | The timeframe ladder steps in the same order the TF sheet shows. | [ ] PASS [ ] FAIL |
| G3-12 | **The range input (no-drag scrub)** | Open Peek, use the range control instead of dragging. | It moves the same value the drag moves, and reads out the section's own readout. A member who cannot drag can still scrub. | [ ] PASS [ ] FAIL |
| G3-13 | **linkTicker's symbol field** | On the Notebook, activate Link ticker. | The confirm sheet carries a symbol field; it is never a permanently dimmed bubble and never a label that lies. | [ ] PASS [ ] FAIL |
| G3-14 | **Confirm-sheet fields** | Any `confirm` action supplying fields. | The steppers and numeric input operate on the same value the gesture produces, and the committed value is the adjusted one. | [ ] PASS [ ] FAIL |
| G3-15 | **Wire vs Journal in Home's fan** (D-27) | On the Dashboard, open Home's fan. **Do not read the labels** — cover them if you can. Ask: can you tell the **Wire** bubble from the **Journal** bubble by sight alone? Then enable **high contrast** and open the same fan again. | Two answers, both recorded — this row is the only thing that can answer either: **(a)** at the shipped default, are Wire and Journal distinguishable, or do they read as the same green? **(b)** does high contrast make Wire *more* separable from Journal than the default does? ⛔ "They look fine to me" from a normally-sighted operator answers (a) only for that operator — note whether the tester is colour-blind, and which type. | (a) default: [ ] DISTINGUISHABLE [ ] CONFUSABLE · (b) high contrast: [ ] BETTER [ ] SAME [ ] WORSE |

⭐ **G3-15 is a SWITCH, and it is the only row here that is.** D-27 shipped the teal-shifted
Wire accent behind `[data-hub-contrast="high"]` precisely because no session can answer this
question — the token is built, railed and inert unless a member turns high contrast on. What
each answer does:

| G3-15 (a) default | G3-15 (b) high contrast | What to do |
|---|---|---|
| DISTINGUISHABLE | anything | Nothing. D-27 is closed for good; the high-contrast token stays as the accessibility affordance it already is. |
| CONFUSABLE | BETTER | **Promote it**: move `--hub-mode-wire: #D4FEE4` out of the `[data-hub-contrast="high"]` block and into `:root`, replacing `#9FE887`. `hub/modeAccentSeparation.test.js` will go red on the "strictly improves" rails — that is correct, and the rail is rewritten in the same commit to compare against the NEW default. Re-run the 3:1 floor cases unchanged. |
| CONFUSABLE | SAME or WORSE | ⛔ **Do NOT promote it, and do not try another hue.** Two attempts will have failed on real glass, which says the accent is not the channel that separates these two — reopen D-27 against **icon, ring radius and bubble size**, which the row already records as load-bearing. |

---

## Block G4 — FPS, as a RATIO not an absolute

> Gate criterion is hub cost relative to the device's **idle baseline**, not an absolute fps.
> **PASS = fan-open fps >= 0.9 x idle baseline on the same device.** An absolute threshold
> measures the device; a ratio measures the feature. (A Galaxy S24 idles at 30.1 fps where a
> Pixel 8 idles at 60.3.)

| # | Device | Idle baseline (hub idle, no fan) | Fan-open fps during a 5s drag | Ratio | Result |
|---|---|---|---|---|---|
| G4-1 | ____________ | ______ | ______ | ______ | [ ] PASS [ ] FAIL |
| G4-2 | ____________ | ______ | ______ | ______ | [ ] PASS [ ] FAIL |

---

## Recording the result

Fill the rows in THIS file, in place, and commit it. The operator who ran the session is the
one who records it. If the session did not finish, set the header's Outcome to **INCOMPLETE**
and leave every unreached row unticked — do not carry a previous run's ticks forward.

**If anything here FAILS**, the rollback is not a revert: set `HUB_PREVIEW_ENABLED=false` in
Railway. It takes effect on each member's next authenticated request, with no redeploy.
