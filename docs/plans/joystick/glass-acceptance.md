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

---

# ⛔⛔ PRECONDITION G0-1 — RUN THIS FIRST. NOTHING BELOW COUNTS UNTIL IT PASSES.

**The Phase 2 device runs recorded an iPhone 15 Pro scoring flick 0/10 while an iPhone SE scored
10/10, on the same calibrated pointer path.** The run record's own words: *"Unexplained. It needs
its own trace, the way the sticky-fan 5/10 did — guessing here is how the previous wrong diagnoses
started."* It has never been explained.

⛔ **Everything in Block G1 is the same measurement performed by hand.** If the flick threshold
behaves differently on a 15 Pro-class device, then a G1 row that "fails" is not telling you about
the product — it is telling you about whatever G0-1 is. Reading it as a product FAIL would send
the next engineering task in exactly the wrong direction, which is the mistake the run record
warned about by name.

## How to run it

**Device:** an iPhone 15 Pro-class device. (If you also have an SE to hand, run it there too — the
diff between the two is the whole point.)

1. Sign in, open the **Journal** with at least one open position, and open the hub's fan.
2. Target the **Close** bubble — the most dangerous one, deliberately.
3. Perform **ten flicks**: finger down and up on the bubble as fast as you can, each well under
   ~120ms. Do not pause on the bubble; a deliberate press is a different gesture.
4. **Count the fires.** A "fire" is the Close sheet opening, or anything at all happening beyond
   the fan closing.
5. **Then one deliberate press** (~500ms) on the same bubble. It MUST open the sheet.

| | |
|---|---|
| Flicks performed | ______ / 10 |
| **Fires (want 0)** | ______ |
| **Score = 10 − fires** | ______ / 10 |
| Deliberate control opened the sheet | [ ] YES  [ ] NO |
| Device / iOS / browser | ____________________ |

## What the score means

- **Score 8/10 or better** (0–2 fires) → G0-1 **PASSES**. Carry on into G1 and read its rows
  normally.
- **Score below 8/10** (3 or more fires) → ⛔ **G0-1 FAILS.** Record **every G1 row as
  `BLOCKED-BY-G0`** — *not* FAIL. A G1 row cannot be a verdict on the product while the
  instrument disagrees with itself between two devices. Then the next engineering task is the
  trace the run record asked for: **`docs/plans/joystick/g0-flick-trace-plan.md`**, which is
  written and ready.
- ⛔ **If the deliberate control did NOT open the sheet, the whole run is void** regardless of the
  flick score — a session where nothing fires and nothing can fire proves nothing.

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
| G2-3 | **iOS + VoiceOver.** Same as G2-1. | The Actions sheet opens. | `G2-voiceover-sheet.png` | [ ] PASS [ ] FAIL — ⛔ **BLOCKED (not a fail), 2026-09-12** |
| G2-4 | With VoiceOver, reach and operate the **confirm sheet's number field and its ± steppers** on Screener Alert, and commit. | The price is adjustable and commits at the adjusted value, with no drag. This is the "EQUAL path" the sheet exists for. | `G2-confirm-fields.png` | [ ] PASS [ ] FAIL — ⛔ **BLOCKED (not a fail), 2026-09-12** |

⛔ **G2-3 / G2-4 cannot be run on BrowserStack Live on this device, and that is a product
limit of the harness, not a result.** Live's own toolbar → **Screen Reader (Beta)** answers, on
the iPhone 15 Pro / iOS 17.6 session: *"Screen Reader is currently not supported for this
device."* There is no way to turn VoiceOver on through the mirror, and an accessibility row that
cannot be performed is **BLOCKED**, never PASS — absence is not a pass
(`lesson_an_over_refusal_is_invisible` has the general form). Open paths, in order of cost:
(a) try another iOS device in the Live picker, since the message is device-scoped; (b) run
**G2-1/G2-2 on an Android + TalkBack** Live session, which the same menu may support and which
covers the same door on the other platform; (c) the owner's own phone with VoiceOver, which is
the path G0-1 already needs.

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
| G3-15 | **⚠️ Chip vs Actions button — a PRE-EXISTING overlap in declared geometry** | Look at the hub at rest with a long mode label. | ⛔ **This is a known open question, not a regression, and it is on this sheet because only glass can settle it.** In declared values the two boxes overlap: the chip sits at right-offset 118 with `width:auto` and `white-space:nowrap`, y[96,124]; the Actions button occupies right-offsets [114,158], y[88,132]. Same z-index, button paints last. jsdom resolves no layout, so no local suite can say whether a real long label actually reaches the button. Report what you SEE. | [ ] PASS · **[x] FAIL — MEASURED ON GLASS 2026-09-12**, see the block below |
| G3-16 | **Wire vs Journal in Home's fan** (D-27) | On the Dashboard, open Home's fan. **Do not read the labels** — cover them if you can. Ask: can you tell the **Wire** bubble from the **Journal** bubble by sight alone? Then enable **high contrast** and open the same fan again. | Two answers, both recorded — this row is the only thing that can answer either: **(a)** at the shipped default, are Wire and Journal distinguishable, or do they read as the same green? **(b)** does high contrast make Wire *more* separable from Journal than the default does? ⛔ "They look fine to me" from a normally-sighted operator answers (a) only for that operator — note whether the tester is colour-blind, and which type. | (a) default: [ ] DISTINGUISHABLE [ ] CONFUSABLE — ⬜ **still the owner's eye** · (b) high contrast: **[x] BETTER** [ ] SAME [ ] WORSE — measured 2026-09-12, see below |

⭐ **G3-16 is a SWITCH, and it is the only row here that is.** D-27 shipped the teal-shifted
Wire accent behind `[data-hub-contrast="high"]` precisely because no session can answer this
question — the token is built, railed and inert unless a member turns high contrast on. What
each answer does:

---

### ⛔ G3-15 — SETTLED ON REAL GLASS, 2026-09-12. It overlaps, and the question was framed too narrowly.

**iPhone 15 Pro / iOS 17.6, Safari, production, 393 × 659.** Rects read from the device through
the Live session's Safari Web Inspector — real layout, not jsdom.

| route | chip label | chip × Actions-button overlap |
|---|---|---|
| `/screener` | "Screener · 1/100 tap: next result" (w 229) | **40 × 28 px** |
| `/morning-wire` | "wire tap: next segment" (w 166) | **40 × 28 px** |
| `/breadth` | "Breadth tap: next tab" (w 162) | **40 × 28 px** |
| `/dashboard` | "Home Preview — more coming" (w 204) | **40 × 28 px** |
| `/calendar` | "Calendar tap: next day" (w 174) | **40 × 28 px** |
| `/journal` | (w 32) | **32 px** |
| `/notebook` | no chip rendered | n/a |

⭐⭐ **THE ROW ASKED THE WRONG QUESTION, AND THE ANSWER IS WORSE THAN IT EXPECTED.** It asks
whether *a long label* reaches the button. **Label length is irrelevant: the chip is
right-anchored** (`right: 118px`, `width: auto`, growing leftward), so its right edge sits at a
fixed 118px from the viewport edge while the button occupies right-offsets [114, 158]. The
overlap is therefore **a constant 40 px on every mode at every label length** — 158 − 118 — and
the measurement returns exactly 40 on all six modes that render a chip. It is not an edge case.
The declared geometry in the row above already implied this; glass confirms it to the pixel.

**Who wins:** both are `z-index: 360` with `pointer-events: auto`, and the button is later in the
DOM, so it paints and hit-tests on top. `document.elementFromPoint` inside the overlap returns
the button's `<svg>`; 130px to the left it returns the chip's own `<b>`. The chip is
`overflow: visible; white-space: nowrap`, so the text is **covered, not clipped** — the tail of
the hint ("…next result") sits under the sliders icon.

**Severity: cosmetic, plus a 40px hit-shadow over a readout.** The chip is a readout, so the
swallowed taps land on the Actions button rather than on nothing, and nothing is lost but the
last few characters of a hint. ⛔ **No fix is applied here.** A geometry change to a shipped
control is the owner's call, and three one-line candidates exist — move the chip's anchor from
`right: 118px` to `right: 164px`; give the chip a `max-width: calc(100% - 180px)` with
`text-overflow: ellipsis`; or drop the chip below the button's band. Each changes what a member
sees, so each wants a ruling, not an autonomous edit.

### G3-16 (b) — MEASURED, 2026-09-12. (a) still needs a human eye.

Tokens read from the **running production build** on the device, not from the repo:
`--hub-mode-wire` `#9FE887` (default) / `#D4FEE4` (`[data-hub-contrast="high"]`);
`--hub-mode-journal` `#4FB833` in both.

Measured by `node tools/hub_accent_cvd.mjs` (`--self-check` PASSES, and its control fires: red vs
green reads 86.6 for normal vision and 35.3 under protanopia, so the simulation can actually see
a deficiency rather than being an identity function). ⛔ It imports `contrastMath`'s `de00` and
`contrast` rather than re-deriving them, so these numbers are the same ΔE00 that
`modeAccentSeparation.test.js` rails — one authority, not two.

| vision | default ΔE00 (wire vs journal) | high-contrast ΔE00 | default ratio | high ratio | verdict |
|---|---|---|---|---|---|
| normal | **14.5** | **28.0** | 1.74 | 2.32 | BETTER |
| protanopia (simulated) | 14.0 | 27.5 | 1.71 | 2.23 | BETTER |
| deuteranopia (simulated) | 15.2 | 29.5 | 1.79 | 2.46 | BETTER |
| tritanopia (simulated) | 14.1 | 21.5 | 1.75 | 2.32 | BETTER |

⇒ **(b) = BETTER**, and not marginally: high contrast roughly **doubles** ΔE00 for normal vision
and for all three simulated dichromacies, and raises the luminance ratio on every one. That half
of the switch is answered, and the new axis is the dichromacy simulation — the existing rail
models a hue-blind viewer as *luminance only*, which is the coarse version of the same idea.

⛔ **(a) is NOT answered and must not be inferred from this table.** ΔE₇₆ between two token
values is not what a member sees: the bubbles are drawn on `backdrop-filter` glass over live
page content, so the rendered colours are composited, and "can you tell these apart at a glance
in a fan" is a perceptual question about two greens, not a distance. The row's own rule stands —
a normally-sighted operator's "they look fine" answers (a) for that operator only. **The owner's
eye is still the input**, and per the switch table below it is (a) alone that decides whether
`#D4FEE4` gets promoted to `:root`.

---

| G3-16 (a) default | G3-16 (b) high contrast | What to do |
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

## Block G5 — the per-surface sweep, DERIVED → `glass-acceptance-steps.md`

⛔ **RUN AFTER G0-1 RESOLVES. DO NOT RUN EARLY** — the same gate Block G1 carries, for the same
reason: these are the same gestures measured by hand. Below 8/10 on the flick score every row
there is **BLOCKED-BY-G0**, never FAIL.

**96 rows, one per surface, generated from the registry** — every mode's Primary / Reverse /
Scrub binding and every fan action, with the expected result derived from the action's own
`kind`, `flickable`, `escalate` and `requires`, plus the two named doors (D4 and D1) restated
where an operator will actually meet them. Regenerate, never hand-edit:

```sh
node tools/hub_surface_matrix.mjs --self-check     # prove the deriver can fail
node tools/hub_surface_matrix.mjs --glass > docs/plans/joystick/glass-acceptance-steps.md
```

⭐ **Why a generated sheet beside the hand-written blocks above, rather than instead of them.**
Block G3 was typed by hand from a memory of what Increments 3–7 added — and the thing that
memory misses is not a new action, it is an OLD action that stopped being hidden. Four modes
(`chart`, `catalysts`, `notebook`, `calendar`) left `PREVIEW_MODES` after Increment 2 and took
**nineteen already-declared actions** onto members' glass with them, against **three** genuinely
new actions. A member cannot tell which is which, and neither can a list written from recall.
`surface-matrix.md` is the same derivation as a table with the Increment-2 diff in it.

⛔ **What the generated sheet must NOT be used for:** G3-15 (the chip vs Actions-button overlap)
and G3-16 (Wire vs Journal colour confusability) stay here, in the hand-written blocks, because
they ask a human a question a generator cannot phrase — and G3-16's answer depends on **who** is
looking. Deriving those would turn a judgement into a checkbox.

---

## Recording the result

Fill the rows in THIS file, in place, and commit it. The operator who ran the session is the
one who records it. If the session did not finish, set the header's Outcome to **INCOMPLETE**
and leave every unreached row unticked — do not carry a previous run's ticks forward.

**If anything here FAILS**, the rollback is not a revert: set `HUB_PREVIEW_ENABLED=false` in
Railway. It takes effect on each member's next authenticated request, with no redeploy.
