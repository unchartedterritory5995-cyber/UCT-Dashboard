# Program rebase — the surviving worklist, from implementation truth

Generated 2026-09-08 from **current code**, not from the original backlog's counts.
Every row was re-measured; nothing here is inherited on trust.

Sources reconciled: `85-implementation-backlog-and-waves.md` (23 items + a 13-row
tombstone) · `90-independent-validation.md` · `95-census-errata.md` ·
`96-implementation-adjudication.md` · `97` · `98`.

---

## SHIPPED

| item | evidence |
|---|---|
| **MOB-01** phone layout door | `7b0877781` — device-verified, iPhone 15 / iOS 17.5 |
| **MOB-07** coarse-pointer primitive | `bcff456a8` — 16 behavioural tests, 6 mutations red |
| **MOB-06′** percent-scale path + contextual `$ Vol`/`Avg ND` + the presentation contract | `0f1a5e2f5` — 29 tests, 10 mutations red, **real-device ALL PASS** |
| **Wave 1 integration** | `f1370b73b` — 21 cases on one chart, incl. the named Percent/Log rail |

## NOT_REPRODUCED — the gap did not survive measurement

| item | what was claimed | what is true now |
|---|---|---|
| **MOB-03** | P0: the crosshair legend is off for existing members | Did not reproduce on master; a rail was shipped instead (`e433e98f6`) |
| **MOB-02** | the phone watchlist drops Price/Vol/%Chg and overflows | Columns **render**; `scrollWidth === clientWidth` (388/388). Layout claims **disproven** |
| **MOB-12** | phones need an "on this chart" band with per-row hide/settings | ⛔ **The legend chip menu already does more** — `chipMenu.js` offers Settings… · Show/Hide · Move to (price/own/volume) · Duplicate · **Add alert on…** · About · Remove |
| **MEASURE-03** | "the study's largest coverage hole" — UCT's phone legend-row affordances were never opened | The affordance exists and is rich (above). The hole was in the *research*, not the product |

## VERIFICATION_ONLY

| item | status |
|---|---|
| **MEASURE-01** four blocked drawing checks | ✅ **DONE** — all four measured, research blocker disproven (`1f97ea2e1`) |
| **MEASURE-02** landscape | 🟡 **PARTIAL, done tonight.** Real iPhone 13 / iOS 17.5, portrait → landscape → portrait, live readout: the presentation contract holds in both orientations, and the reveal correctly rides the **landscape branch** of the media list (`max-width:640` false, `landscape branch` true). ⛔ App-level state preservation across rotation is **NOT** measured — see the blocker below |
| **MOB-02** residue | do the watchlist columns **populate** with a live vendor feed? Needs a sandbox with a vendor key |

## SURVIVING_BUILD_ITEM — in dependency order

| # | item | why it survives | size |
|---|---|---|---|
| 1 | **MOB-09** tracings sync highwatermark | ⛔ **REPRODUCES ON CURRENT CODE.** `useTracingsSync.js:43-46` writes the highwatermark **before** an unawaited `setPref`, and the adopt gate is a strict `server.updatedAt > hw`. A failed push pins the device forever: the server holds drawings it will never adopt. Silent data loss, and MOB-05's prerequisite | S |
| 2 | **MOB-04** all-tools reach | 18 tools in a `overflow-x:auto` row with `scrollbar-width:none` and no fade/affordance — measured in `MobileDrawBar.module.css:51-55`. Core to the sprint's stated DRAWINGS goal | S |
| 3 | **MOB-05** bind a drawing's alert to the drawing | The one cluster where TradingView is simply better. **Needs MOB-09 first** | M |
| 4 | **MOB-10** `Hide` in the drawing object menu | Confirmed absent: the menu has Lock/Unlock, Duplicate, Bring/Send, Set level…, Save as default, Delete — nothing non-destructive between Lock and Delete | S |
| 5 | **MOB-18** mid-draw cancel | Confirmed absent from `MobileDrawBar.jsx` (no cancel/Escape path) | S |
| 6 | **MOB-11** placement narration | "Point 1 of 2" + a live axis price echo | S |
| 7 | **MOB-08** `presentation[deviceClass]` | The "Layouts + chart state" interaction: view-lock and grid mode are device-shaped facts stored server-side | L |
| 8 | **Clear-all / Repeat** rows | MOB-06′ orphans — one Tools row each | S |
| 9 | **Drawing Boards** phone door | MOB-06′ orphan, medium severity, **owner call** — a phone door is a wave, not a row | M |

## TOMBSTONED — and one row that must be OVERTURNED

The 13-row tombstone stands, with one exception recorded here rather than quietly:

> ⚰️ *"Surface `$ Vol` / `Avg 50D` as a UCT advantage — died because `.volLegend` is
> `display:none` on the phone shell; UCT removed them **on purpose**."*

**Overturned by MOB-06′, on new evidence.** They were hidden by a rule whose stated
rationale (*"…to answer questions the settings sheet already answers"*) does not cover
them — the settings sheet answers neither — and **no phone surface carried either
number**. That is an orphaned task, not a product decision. The tombstone's own rule
("do not revive without NEW evidence") was satisfied before the revival, and the fix
shipped in `0f1a5e2f5` with real-device confirmation.

The adjacent row — *"Fix the 17×11px price-scale tap targets"* — **stays tombstoned and
is correct**: the chips genuinely do not render on a phone. MOB-06′ did not restore them.
What it restored was the **task** behind them.

## PRE_SHIP_GATE

- Full regression, pre-existing failures separated **with proof**. Current baseline:
  **4 failures / 7,674 passing** — `reachable.test.js` (17 `community/*` + `floor2` +
  `flowBootstrap` modules from another workstream) plus the three known chart ones
  (ImportBox thinkscript, manifestProse, pine.blindCorpus). Proof: this branch
  (`9c6078503..HEAD`) touches 18 files, all under `components/chart`,
  `pages/charts/mobile` or `docs` — **zero intersection** with any named module.
- Real-device QA of the authenticated app — **BLOCKED, see below.**

## DEFERRED_LOW_VALUE

MOB-13 (truncate formula rows — subsumed by the MOB-06 rule) · MOB-15 (object tree) ·
MOB-16 (watchlist sort tap targets) · MOB-17 (symbol-search result fields) ·
MOB-19 (named drawing/settings templates — "Save as default" covers the 80%) ·
MOB-20 (replay/compare phone doors — **the register entry now exists in `98` §3.3**,
which the backlog itself said "matters more than the doors").

---

## ⛔ THE ONE BLOCKER, MEASURED NOT GUESSED

Real-device QA **of the authenticated app** cannot proceed, for two independent reasons,
both established by direct measurement tonight rather than inference:

1. **The BrowserStack account is on a Free Trial capped at ONE MINUTE per device**, and
   the cap is enforced ("Your session was stopped since you have used up the available
   Free Trial minutes on this device"). Several devices are now spent.
2. **The device cannot authenticate.** The tunnel works end-to-end — a real iPhone 15
   reached this worktree's dev server — but it arrives as `bs-local.com`, a different
   host from the sandbox's `127.0.0.1`, so it carries no session and lands on the login
   form. Entering a password is a prohibited action for me.

**What that did NOT block:** the presentation questions, which need no login. A separate
no-auth vite entry rendering the real `StockChart` against fixture bars carried every
verdict on-page, and a real iPhone 13 returned **ALL PASS** in both orientations.

**What it still blocks:** on-device verification of Percent/Log/Arithmetic/Auto actually
rescaling, the price-context sheet, Layouts, and workspace persistence. Those are
verified instead at 390px in a real browser against this worktree's code, plus 50
behavioural tests.

**To unblock:** either a BrowserStack plan with usable session length, or the owner
signing the sandbox test account in during a session. Both are owner actions.
