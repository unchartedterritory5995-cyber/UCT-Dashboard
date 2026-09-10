# B3 / B5 — MANUAL DEVICE EVIDENCE form

**Fill this in by hand while running `b3b5-operator-script.md`. Empty = NOT RUN.**

`MANUAL DEVICE EVIDENCE` is its own tier: a human on a real touch surface. It is **not** the
emulated smoke (which proves nothing about the product) and **not** an automated Automate run
(which cannot happen — the account is on the Free plan and every session errors
`Automate testing time expired`).

| | |
|---|---|
| Build under test | `_______________` (git rev-parse HEAD before the sandbox boot) |
| Date | `_______________` |
| Operator | `_______________` |
| Channel | ☐ own phone on LAN ☐ BrowserStack Live ☐ both |
| Sandbox snapshot-compare first line | ☐ CLEAN ☐ CHANGED → **stop and report** |
| Seed confirmed (AAPL / MSFT / TSLA present) | ☐ yes ☐ no |

**Merge gate needs at minimum: D1–D5 on one real iOS device AND one real Android device, plus D6 on
Android.** More devices are corroboration.

---

## Device 1 — `________________________` (model / OS / browser)

| Check | What it measures | Pass? | Screenshot | Notes |
|---|---|---|---|---|
| D1 | Move stop → exactly ONE sheet, button reads `Set stop <price>` | ☐ P ☐ F | `D1-movestop-____.png` | |
| D2 | Breakeven → exactly ONE sheet | ☐ P ☐ F | `D2-breakeven-____.png` | |
| D3 | Close → close form directly, no confirmation in front | ☐ P ☐ F | `D3-close-____.png` | |
| **D4** | **Flick at Close → fan opens, NOTHING fires (×5)** | ☐ P ☐ F | `D4-close-flick-____.png` | `___/5 fired (want 0)` |
| D5 | Flick at Move stop → **fires** (prediction) | ☐ P ☐ F | `D5-flick-fires-____.png` | `___/5 fired (want ≥4)` |
| D5 | Flick at Breakeven → **fires** (prediction) | ☐ P ☐ F | `D5-flick-fires-____.png` | `___/5 fired (want ≥4)` |
| D6 | Android only: triple pulse on the three write actions | ☐ P ☐ F ☐ N/A (iOS) | — | |
| **D7a** | **Member gets NO pad** (`hubmember@local.dev`) | ☐ P ☐ F | `D7a-member-no-pad-____.png` | |
| D7b | Member gets NO Settings → Joystick card | ☐ P ☐ F | `D7b-member-no-card-____.png` | |
| D7c | Admin DOES get the card, and it toggles | ☐ P ☐ F | `D7c-admin-card-____.png` | |
| **D7d-1** | **:8078 kill switch — NO pad** (admin, pref explicitly on) | ☐ P ☐ F | `D7d-killswitch-off-____.png` | |
| **D7d-2** | **:8077 CONTROL — pad IS present** (same account/phone) | ☐ P ☐ F | `D7d-control-on-____.png` | ⛔ both halves or neither |
| D7e | Member who opts in KEEPS their way off | ☐ P ☐ F | `D7e-member-card-____.png` | restore step run? ☐ |

---

## Device 2 — `________________________` (model / OS / browser)

| Check | What it measures | Pass? | Screenshot | Notes |
|---|---|---|---|---|
| D1 | Move stop → exactly ONE sheet, button reads `Set stop <price>` | ☐ P ☐ F | `D1-movestop-____.png` | |
| D2 | Breakeven → exactly ONE sheet | ☐ P ☐ F | `D2-breakeven-____.png` | |
| D3 | Close → close form directly, no confirmation in front | ☐ P ☐ F | `D3-close-____.png` | |
| **D4** | **Flick at Close → fan opens, NOTHING fires (×5)** | ☐ P ☐ F | `D4-close-flick-____.png` | `___/5 fired (want 0)` |
| D5 | Flick at Move stop → **fires** (prediction) | ☐ P ☐ F | `D5-flick-fires-____.png` | `___/5 fired (want ≥4)` |
| D5 | Flick at Breakeven → **fires** (prediction) | ☐ P ☐ F | `D5-flick-fires-____.png` | `___/5 fired (want ≥4)` |
| D6 | Android only: triple pulse on the three write actions | ☐ P ☐ F ☐ N/A (iOS) | — | |
| **D7a** | **Member gets NO pad** (`hubmember@local.dev`) | ☐ P ☐ F | `D7a-member-no-pad-____.png` | |
| D7b | Member gets NO Settings → Joystick card | ☐ P ☐ F | `D7b-member-no-card-____.png` | |
| D7c | Admin DOES get the card, and it toggles | ☐ P ☐ F | `D7c-admin-card-____.png` | |
| **D7d-1** | **:8078 kill switch — NO pad** (admin, pref explicitly on) | ☐ P ☐ F | `D7d-killswitch-off-____.png` | |
| **D7d-2** | **:8077 CONTROL — pad IS present** (same account/phone) | ☐ P ☐ F | `D7d-control-on-____.png` | ⛔ both halves or neither |
| D7e | Member who opts in KEEPS their way off | ☐ P ☐ F | `D7e-member-card-____.png` | restore step run? ☐ |

---

## Device 3 (optional) — `________________________`

| Check | Pass? | Screenshot | Notes |
|---|---|---|---|
| D1 | ☐ P ☐ F | | |
| D2 | ☐ P ☐ F | | |
| D3 | ☐ P ☐ F | | |
| **D4** | ☐ P ☐ F | | `___/5 fired (want 0)` |
| D5 moveStop | ☐ P ☐ F | | `___/5 (want ≥4)` |
| D5 breakeven | ☐ P ☐ F | | `___/5 (want ≥4)` |
| D6 | ☐ P ☐ F ☐ N/A | — | |

---

## Device 4 (optional) — `________________________`

| Check | Pass? | Screenshot | Notes |
|---|---|---|---|
| D1 | ☐ P ☐ F | | |
| D2 | ☐ P ☐ F | | |
| D3 | ☐ P ☐ F | | |
| **D4** | ☐ P ☐ F | | `___/5 fired (want 0)` |
| D5 moveStop | ☐ P ☐ F | | `___/5 (want ≥4)` |
| D5 breakeven | ☐ P ☐ F | | `___/5 (want ≥4)` |
| D6 | ☐ P ☐ F ☐ N/A | — | |

---

## Anything unexpected

> Write it here even if it is not one of the checks — especially anything that felt wrong but
> passed. A step's expected result not happening is recorded as **FAIL and you keep going**; the
> later checks are independent and a full picture is worth more than a clean stop.

```




```

## Operator sign-off

- [ ] Screenshots saved to `docs/plans/joystick/screens/b3b5-manual/`
- [ ] Sandbox stopped
- [ ] Firewall rule removed (if one was added for the LAN channel)
- [ ] **D4 result stated explicitly above** — this is the one the merge ruling turns on
