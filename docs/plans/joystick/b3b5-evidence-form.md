# B3 / B5 — EMULATED — NOT DEVICE EVIDENCE

⛔ **EMULATED — NOT DEVICE EVIDENCE.** CLAUDE.md forbids claiming a device result from an
emulator, and this is one: no real glass, no real digitiser, no haptic. It is a distinct and
weaker tier than a device run, and it is labelled that way everywhere it appears.

⭐ **Rule 8 honoured.** `has_touch`/`is_mobile` make the product's own gate
(`useHubActive.js:84`) GENUINELY true — the browser reports itself as a phone does. Nothing
was patched, and the harness refuses to run if that query does not resolve true by itself.

| | |
|---|---|
| Build under test | `9c42d03b4` |
| Date | 2026-09-09 |
| Operator | automated harness, driven by Claude |
| Engines / viewports | Chromium 393x852 · Chromium 360x800 · WebKit 393x852 |
| Sandboxes | `:8077` (flag on) · `:8078` (flag off, for D7d-1) |
| Accounts | `hubtest@local.dev` (admin) · `hubmember@local.dev` (member, paid) |
| Snapshot-compare | ☑ CLEAN — all checkpoints, both sandboxes |
| Seed confirmed | ☑ AAPL / MSFT / TSLA present in both |

**Gesture parameters** — recorded so a reader can reproduce or dispute them:

| | |
|---|---|
| Flick | press → 2 moves → release, no waits. Page-measured **7–104 ms** (`FLICK_MS` = 120) |
| Deliberate | press → 2 moves → hold 400 ms → release. Page-measured **430–588 ms** |
| Travel | the bubble's own rendered offset from the pad centre, read from the DOM |
| Pointer | `page.mouse` → trusted pointerdown/move/up, `pointerType: 'mouse'`. The engine does not branch on pointerType (`useJoystick.js`, `HubPad.jsx` — grepped, no matches) |
| Not reproduced | a real digitiser's jitter, palm rejection, and the OS gesture layer |


## chromium 393x852

| Check | What it measures | Result | Screenshot | Detail |
|---|---|---|---|---|
| D1 | Move stop → exactly ONE sheet, primary reads `Set stop <price>` | ☑ PASS | `D1-movestop-chromium-393x852.png` | gesture=578ms dialogs=1 hubConfirm=False primary='Set stop 395.25' |
| D2 | Breakeven → exactly ONE sheet | ☑ PASS | `D2-breakeven-chromium-393x852.png` | gesture=573ms dialogs=1 hubConfirm=False primary='Set stop 402.49' |
| D3 | Close → ClosePositionModal directly, no hub sheet in front | ☑ PASS | `D3-close-chromium-393x852.png` | gesture=563ms dialogs=1 hubConfirm=False labels=['shares', 'exit price', 'exit date'] |
| **D4** | **Flick at Close → fan opens, NOTHING fires** (+ deliberate control) | ☑ **PASS** | `D4-close-flick-chromium-393x852.png`, `D4-control-deliberate-chromium-393x852.png` | 8 flicks &lt;120ms [87, 64, 64, 69, 71, 64, 71, 75] → fired **0** (want 0); CONTROL deliberate @586ms → modal opened **True**; writes NONE |
| D5-moveStop | Flick at Move stop → **fires** (prediction) | ☑ PASS | `D5-flick-fires-chromium-393x852.png` | 5/5 flicks fired @[81, 87, 80, 77, 81]ms — prediction stated before the run: it FIRES |
| D5-breakeven | Flick at Breakeven → **fires** (prediction) | ☑ PASS | `D5-flick-fires-chromium-393x852.png` | 5/5 flicks fired @[97, 75, 86, 91, 88]ms — prediction stated before the run: it FIRES |
| D6 | Triple-pulse haptic on the three write actions | — N/A | — | N/A under emulation — a browser cannot feel a haptic. Covered by the B5 unit rail (useJoystick.test.js: warn=[22,60,22] vs impact=18 through the real fireTarget). |
| D7a | Member gets NO pad | ☑ PASS | `D7a-member-no-pad-chromium-393x852.png` | reached /journal/trades=True (precondition) pad=False |
| D7b | Member gets NO Settings → Joystick card | ☑ PASS | `D7b-member-no-card-chromium-393x852.png` | on charts section=True (precondition) joystickCard=False |
| D7c | Admin DOES get the card | ☑ PASS | `D7c-admin-card-chromium-393x852.png` | admin joystickCard=True |
| D7d-1 | :8078 kill switch → NO pad (admin, pref explicitly on) | ☑ PASS | `D7d-killswitch-off-chromium-393x852.png` | reached journal=True (precondition) :8078 flag OFF, admin, pref true -> pad=False |
| D7d-2 | :8077 CONTROL → pad IS present (same account) | ☑ PASS | `D7d-control-on-chromium-393x852.png` | :8077 CONTROL same account -> pad=True |
| D7e | Opted-in member keeps their way off (pad + card) | ☑ PASS | `D7e-member-card-chromium-393x852.png` | prefs POST=200 padAfterOptIn=True cardAfterOptIn=True — the strand case: an opted-in member keeps their way off |

## chromium 360x800

| Check | What it measures | Result | Screenshot | Detail |
|---|---|---|---|---|
| D1 | Move stop → exactly ONE sheet, primary reads `Set stop <price>` | ☑ PASS | `D1-movestop-chromium-360x800.png` | gesture=588ms dialogs=1 hubConfirm=False primary='Set stop 395.25' |
| D2 | Breakeven → exactly ONE sheet | ☑ PASS | `D2-breakeven-chromium-360x800.png` | gesture=562ms dialogs=1 hubConfirm=False primary='Set stop 402.49' |
| D3 | Close → ClosePositionModal directly, no hub sheet in front | ☑ PASS | `D3-close-chromium-360x800.png` | gesture=549ms dialogs=1 hubConfirm=False labels=['shares', 'exit price', 'exit date'] |
| **D4** | **Flick at Close → fan opens, NOTHING fires** (+ deliberate control) | ☑ **PASS** | `D4-close-flick-chromium-360x800.png`, `D4-control-deliberate-chromium-360x800.png` | 8 flicks &lt;120ms [74, 73, 61, 75, 72, 73, 72, 71] → fired **0** (want 0); CONTROL deliberate @572ms → modal opened **True**; writes NONE |
| D5-moveStop | Flick at Move stop → **fires** (prediction) | ☑ PASS | `D5-flick-fires-chromium-360x800.png` | 5/5 flicks fired @[66, 75, 76, 69, 67]ms — prediction stated before the run: it FIRES |
| D5-breakeven | Flick at Breakeven → **fires** (prediction) | ☑ PASS | `D5-flick-fires-chromium-360x800.png` | 5/5 flicks fired @[69, 77, 65, 70, 76]ms — prediction stated before the run: it FIRES |
| D6 | Triple-pulse haptic on the three write actions | — N/A | — | N/A under emulation — a browser cannot feel a haptic. Covered by the B5 unit rail (useJoystick.test.js: warn=[22,60,22] vs impact=18 through the real fireTarget). |
| D7a | Member gets NO pad | ☑ PASS | `D7a-member-no-pad-chromium-360x800.png` | reached /journal/trades=True (precondition) pad=False |
| D7b | Member gets NO Settings → Joystick card | ☑ PASS | `D7b-member-no-card-chromium-360x800.png` | on charts section=True (precondition) joystickCard=False |
| D7c | Admin DOES get the card | ☑ PASS | `D7c-admin-card-chromium-360x800.png` | admin joystickCard=True |
| D7d-1 | :8078 kill switch → NO pad (admin, pref explicitly on) | ☑ PASS | `D7d-killswitch-off-chromium-360x800.png` | reached journal=True (precondition) :8078 flag OFF, admin, pref true -> pad=False |
| D7d-2 | :8077 CONTROL → pad IS present (same account) | ☑ PASS | `D7d-control-on-chromium-360x800.png` | :8077 CONTROL same account -> pad=True |
| D7e | Opted-in member keeps their way off (pad + card) | ☑ PASS | `D7e-member-card-chromium-360x800.png` | prefs POST=200 padAfterOptIn=True cardAfterOptIn=True — the strand case: an opted-in member keeps their way off |

## webkit 393x852

| Check | What it measures | Result | Screenshot | Detail |
|---|---|---|---|---|
| D1 | Move stop → exactly ONE sheet, primary reads `Set stop <price>` | ☑ PASS | `D1-movestop-webkit-393x852.png` | gesture=430ms dialogs=1 hubConfirm=False primary='Set stop 395.25' |
| D2 | Breakeven → exactly ONE sheet | ☑ PASS | `D2-breakeven-webkit-393x852.png` | gesture=438ms dialogs=1 hubConfirm=False primary='Set stop 402.49' |
| D3 | Close → ClosePositionModal directly, no hub sheet in front | ☑ PASS | `D3-close-webkit-393x852.png` | gesture=444ms dialogs=1 hubConfirm=False labels=['shares', 'exit price', 'exit date'] |
| **D4** | **Flick at Close → fan opens, NOTHING fires** (+ deliberate control) | ☑ **PASS** | `D4-close-flick-webkit-393x852.png`, `D4-control-deliberate-webkit-393x852.png` | 8 flicks &lt;120ms [17, 15, 16, 13, 14, 15, 18, 15] → fired **0** (want 0); CONTROL deliberate @542ms → modal opened **True**; writes NONE |
| D5-moveStop | Flick at Move stop → **fires** (prediction) | ☑ PASS | `D5-flick-fires-webkit-393x852.png` | 5/5 flicks fired @[11, 17, 17, 18, 18]ms — prediction stated before the run: it FIRES |
| D5-breakeven | Flick at Breakeven → **fires** (prediction) | ☑ PASS | `D5-flick-fires-webkit-393x852.png` | 5/5 flicks fired @[11, 19, 9, 23, 24]ms — prediction stated before the run: it FIRES |
| D6 | Triple-pulse haptic on the three write actions | — N/A | — | N/A under emulation — a browser cannot feel a haptic. Covered by the B5 unit rail (useJoystick.test.js: warn=[22,60,22] vs impact=18 through the real fireTarget). |
| D7a | Member gets NO pad | ☑ PASS | `D7a-member-no-pad-webkit-393x852.png` | reached /journal/trades=True (precondition) pad=False |
| D7b | Member gets NO Settings → Joystick card | ☑ PASS | `D7b-member-no-card-webkit-393x852.png` | on charts section=True (precondition) joystickCard=False |
| D7c | Admin DOES get the card | ☑ PASS | `D7c-admin-card-webkit-393x852.png` | admin joystickCard=True |
| D7d-1 | :8078 kill switch → NO pad (admin, pref explicitly on) | ☑ PASS | `D7d-killswitch-off-webkit-393x852.png` | reached journal=True (precondition) :8078 flag OFF, admin, pref true -> pad=False |
| D7d-2 | :8077 CONTROL → pad IS present (same account) | ☑ PASS | `D7d-control-on-webkit-393x852.png` | :8077 CONTROL same account -> pad=True |
| D7e | Opted-in member keeps their way off (pad + card) | ☑ PASS | `D7e-member-card-webkit-393x852.png` | prefs POST=200 padAfterOptIn=True cardAfterOptIn=True — the strand case: an opted-in member keeps their way off |

---

## D6 — why it is N/A and not a gap

A browser cannot feel a vibration, so no emulator can take this measurement. It is covered
by the B5 unit rail, which asserts the two patterns are distinguishable at the argument
through the REAL `fireTarget` path — `warn() → navigator.vibrate([22,60,22])` vs
`impact() → navigator.vibrate(18)` (`haptics.js:13-16`), one test per Journal action,
mutation-proved per action. ⚠️ Separately: iOS exposes no `navigator.vibrate` at all
(`haptics.js:5-11`), so on iPhone no haptic fires for any action, before or after B5.

## What this evidence does NOT establish

**Real-glass D4.** Whether a physical finger on a real touch surface honours
`flickable: false` on `journal.close`. The emulated result is strong — 24 sub-threshold
flicks across three engines, zero fired, zero writes, each paired with a deliberate control
at the same offset that DID open the modal — but a real digitiser, palm rejection and the
OS gesture layer are not reproduced here. **That check moves to a post-deploy verification
on production, on the owner's own phone, as admin.**
