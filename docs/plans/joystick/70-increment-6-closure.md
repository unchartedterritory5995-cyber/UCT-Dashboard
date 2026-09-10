# Increment 6 — the closure measurement

**Written 2026-09-10.** The standing order defines done as: the measurement against
`00-master-spec-v1.6.md`, `60-phase3-plan.md`, `deferred.md` and `requests.md` returns an empty
core list, every remaining item is polish *by the spec's own words*, every shipped line has a rail,
and this report is committed.

## ⛔ The verdict, first

**The core list is NOT empty. Two items remain, and one of them cannot be closed by any amount of
engineering time.** Everything else in the program is done and shipped. This report names what is
left, what it would cost, and — for the one that is not mine to close — who has to close it.

That is the whole point of the measurement. A closure report that declares done and leaves the
owner to discover otherwise is the defect this program has spent a week building rails against.

---

## 1. The modes — the spine of the product

Ten modes are declared. `PREVIEW_MODES` is the set still showing `[Voice, Home]` instead of a real
fan; emptying it was what Phase 3 existed for.

| Mode | Controller | Live | Landed |
|---|---|---|---|
| `wire` | `wireSection.js` | ✅ | Increment 2 |
| `breadth` | `breadthSection.js` | ✅ | Increment 2 |
| `scan` | `screenerSection.js` | ✅ | Increment 2 |
| `journal` | `journalSection.js` | ✅ | Increment 2 |
| `notebook` | `notebookSection.js` | ✅ | Increment 4 (B10) |
| `calendar` | `calendarSection.js` | ✅ | **Increment 5** |
| `chart` | `chartSection.js` | ✅ | **Increment 5** (§3.5) |
| `catalysts` | `catalystsSection.js` | ✅ | **Increment 5** (§3.6) |
| `home` | `homeSection.js` | ⬜ dark | **owner decision — see below** |
| `flow` | — | ⬜ dark | **complete by design — see below** |

**NINE of the ten have controllers — only `flow` has none, and it needs none. Neither of the two
still-dark modes is an unfinished build**, and this is the single most important sentence in this
report:

⚰️ *(This paragraph said "eight of ten" in its first draft, and verifying it against
`ls app/src/hub/sections/*Section.js` before committing is what caught it — nine files, not eight.
A hand-typed count beside the list it describes is the defect this repo has now paid for in the
nav table, the writer index, the COT router and the setup catalog. Count it, do not remember it.)*

- **`home`** ships `onTap`, `onDoubleTap` and a scrub, and its fan is **eight `navigate` actions
  plus Voice — zero `run` actions**, so nothing about it is unhandled. It stays dark because
  `fanFor` gives Home a *curated* preview fan (`PREVIEW_HOME`, owner ruling 2026-09-09, Calendar
  restored under R-C) of seven bubbles. Flipping it shows the full eight. **That is a decision about
  how many doors Home offers, not a missing wire** — one sentence from the owner, not an increment.
- **`flow`** is navigate-only by ruling 3.9 ("and stays so"; `OptionsFlow.jsx` is partner-owned and
  a hard no). Its real fan IS `[Voice, Home]`, and `fanFor`'s preview projection returns exactly
  `[Voice, Home]` for it — **byte-identical**. The flag changes no bubble; it changes only the chip,
  which currently reads "Preview — more coming" for a mode where nothing is coming. Its real hint,
  `navigate only`, is true. Flipping it is a one-line honesty improvement, and it is deliberately
  NOT bundled here because it is a copy change the owner may want to word differently.

### The three borrowed-time lists are empty
`tapHintIsBacked`, `runActionsHaveHandlers` and the shipped-modes control each carried a list of
modes that were safe only because the projection hid them. All three now read `[]`. Every departure
happened the only way those rails accept — **a handler arriving, never an edit to the list**.

⛔ Empty is not dead. Each keeps its non-vacuity assertions, so `[]` can only mean "all handled",
never "the detector broke".

---

## 2. §-by-§ coverage

| § | Subject | State |
|---|---|---|
| 2 / 2a | Ground rules, theme, brand | ✅ `hubComponents.test.jsx` forbids a literal hex in any hub source |
| 2c | The corner — hub replaces the FAB stack | ✅ Feedback lives in Peek |
| 2d | One shared cursor | ✅ `useHubCursor`, railed |
| 2f | Two new `UIcon` glyphs | ✅ |
| 4 | Registry, context, cursor | ✅ `registry.test.js` pins set membership |
| 5 | Gesture engine and glass UI | ✅ |
| 5a / C1.4 | `hub_planned_trades` | ✅ reachable from Screener and now Chart |
| 6 | Section controllers | ✅ **9 of 10 have one; `flow` needs none. Both still-dark modes are decisions, not builds** |
| 7 | Modes | ✅ all ten declared and accounted for |
| 8 | Settings and polish | ✅ B13 made the schema reachable; `highContrast` got its writer |
| 9 | Things not to do | ✅ observed — no `api/` file touched by this program, ever |
| C1 | Gesture vocabulary | ⬜ **two-finger Peek outstanding** (see §3) |
| C1.3 | Preview kill switch | ✅ read per request, railed both ways |
| C2 | Accessibility commitments | ✅ **closed this increment** |
| C3 | Per-section map | ✅ follows §6 |
| C4 | Cross-section conventions | ✅ `contractArity.test.js` derives from the call site |

### §C2 is closed, and the last gap was the one that mattered
Every ACTION already had a no-drag door: the Actions button opens Peek with a single tap, and §C2
says in as many words that the button — **not** the two-finger gesture — is what satisfies WCAG
2.5.1, because both screen readers consume two-finger single-tap before the page sees it.

SCRUB had none. It is a continuous value, not a list entry, so the only way to move it was a
measured drag on the pad — the one interaction in the hub with no alternative, for exactly the
tremor and limited-reach members the motor paragraph exists for. `HubScrubRange` closes it with the
native `<input type="range">` the spec names, driving the section's own `onScrub`/`onScrubCommit`
and announcing the section's own readout.

---

## 3. The open core list — two items

**1. The two-finger Peek gesture (§C1).** Declared in the gesture table. **It is not an
accessibility gap** — §C2 is explicit that it cannot be Peek's only door and that the compliant door
already ships; this is an additional affordance for sighted members. Contained work: `useJoystick`
plus lifting the Actions sheet's open state so a gesture can open it.

**2. ⛔ Real-glass D4/D1 on production — NOT MINE TO CLOSE.** It needs a human driving BrowserStack
Live. jsdom performs no layout, resolves no `calc()`, applies no `env(safe-area-inset-*)` and
reports zero for every measured box, so **no local suite can produce this claim, tonight or ever**.
The row stays **OPEN, not PASS**. This program has already recorded four blank templates being
mistaken for a pass; absence is not evidence.

---

## 4. Deferred and idle-capacity items

| Item | State |
|---|---|
| transitive-dataflow write rail | ✅ `writePathsTransitive.test.js` (acorn call-graph walk) |
| `scripts/mutate.py` + rail | ✅ shipped and used repeatedly |
| D-33 `prefillStop` importable | ✅ struck — verified shipped by measurement |
| D-34 forward-R at a candidate stop | ✅ struck — `rAtStop` exported and called |
| plan §3.8 Home tap/scrub line | ✅ struck — three of its four claims measurably false |
| iOS visual escalation | ⬜ open — iOS Safari exposes no `navigator.vibrate` |
| CI device-job design doc | ⬜ open |
| preference-key validation | ⬜ open — `POST /api/auth/preferences` accepts any `{key, value}`, so B6 is an exposure default, not a security boundary |
| D-30 single `data_root()` helper | ⬜ open — explicitly NOT this program's to build (72 independent pins across `api/**`) |

---

## 5. Rails

**58 rail files** under `app/src/hub/**`. Every line shipped by this program carries one.

⭐ The rails written this increment caught **five** defects on their first runs, four of them mine
and one a real production defect:

1. `mirrorsAsAUnit` — `HubRoot`'s container was pinned right unconditionally while all seven
   children mirrored, with no `pointer-events: none`: an invisible 84×84 dead zone at the bottom
   RIGHT of every page for left-handed members. **Found by asserting the property rather than the
   three elements the spec names.**
2. `reducedMotion`'s own control caught its own detector — a scoped `.intro *` reset matched the
   "universal" regex exactly as well as a bare `*`.
3. `chartSection`'s compare control matched the IMPORT, not the mount.
4. `catalystsSection`'s global-query control matched the header COMMENT that exists to forbid it.
5. `hubComponents`' existing hex rail caught two literal colours in new CSS.

The pattern is worth naming: **four of the five were the rail failing on itself, and each was
caught because the control was written to be able to fail.**

---

## 6. What a member gets that they did not have this morning

Three whole sections stopped saying "Preview — more coming" and started working (Calendar, Chart,
Catalysts). Scrub gained a door that needs no drag. Three of Home's seven bubbles stopped
navigating to the wrong section. Left-handed members stopped losing taps to an invisible box. The
high-contrast toggle started doing something. And every bubble a member can reach now does
something — no fan anywhere answers a deliberate gesture with silence.
