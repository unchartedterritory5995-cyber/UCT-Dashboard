# Joystick hub — completion audit

> **The feature is built and shipped; the plan is closed except for one owner session and four
> owned follow-ups — and the instrument that was lying about ten shipped surfaces has been fixed.**
>
> **CLOSED 2026-09-13:** D-42 and D-43, merged `d153215d0`, live in `4beb06c00`. §1 moves from
> INCOMPLETE to COMPLETE-PENDING-OWNER-RUN. One new instrument defect (**D-44**) was found on
> glass in the same session — and closed the same day, `462d8f3d7`, merged `2b4fc75cc`. **All three glass
> defects this audit found are now shipped fixes.** Nothing in the programme waits on anyone
> but Patrick.

Audit SHA: **`ccbab9bcd`** (master tip at the start of the audit; `de519c969` by the end — master
moved 4 commits under it, none touching `app/src/hub`). Read-mostly. Every claim below cites a
`file:line`, a command output, or a run manifest. Anything not cited is marked **UNVERIFIED**.

## Remaining owner actions

| # | Action | Estimate |
|---|---|---|
| 1 | `owner-run.md` §A — the flick-safety block on a real iPhone, then `Copy trace` and run `tools/hub_trace_analyze.py`. **Closes G0-1 and D4, and unblocks Block G5's 96 rows.** | **20 min** |
| 2 | `owner-run.md` §B — nine G3 rows a 0.42-scale mirror could not aim at, **plus B10–B15**, the twelve steps D-42 had hidden | 25 min |
| 3 | `owner-run.md` §C — four Android/TalkBack rows on your own phone | 10 min |
| 3b | `owner-run.md` **§C-iOS** — three VoiceOver rows (G2-3, G2-4, D1-iOS). ⭐ These were BLOCKED on a BrowserStack limitation, not a product one, and your own iPhone lifts it | 10 min |
| 4 | `owner-run.md` §D/§E — two eye rows, one weekend row, two fps ratios | 10 min + a Saturday |
| ~~5~~ | ~~Rule on **D-44**~~ — ✅ **CLOSED 2026-09-13**, `462d8f3d7`: the generator now reads the gesture model and each mode's controller instead of the binding name, so no row carries a correction note and nothing here needs a ruling. ~~ — the glass sheet’s expected results are derived from the binding KEY alone, so the scrub step omits its mandatory 500 ms hold and `home`’s four rows describe a mode that does not exist.~~ | — |

Nothing else in this programme waits on anybody.

---

## §1 — Feature completeness: registry vs spec vs glass

**Spec of record:** `docs/plans/joystick/00-master-spec-v1.6.md` (highest version present).
**Generator rail:** `app/src/hub/surfaceMatrixIsCurrent.test.js` — **5/5 PASS**, so
`surface-matrix.md` is byte-equal to a fresh `node tools/hub_surface_matrix.mjs`.

### Modes and rings

Ten modes ship (nine routed + `catalysts` in-place). Against spec §C3:

| mode | Primary | Reverse | Scrub | outer ring | inner ring | verdict |
|---|---|---|---|---|---|---|
| wire | ✅ `wireSection.js:207` | ✅ `:208` | ✅ `:238`/`:251` | Chart it · Flag · Note | Voice · Home | **SHIPPED** |
| breadth | ✅ | ✅ | ✅ | *(empty)* | Voice · Home | **SHIPPED**, outer DEFERRED |
| scan | ✅ | ✅ | ✅ | Chart it · Flag · Alert · Plan trade | Scans · Why? · Voice · Home | **SHIPPED** |
| chart | ✅ | ✅ | ✅ | Plan trade · Alert · Flag · Draw · Compare | Log trade · Note · Voice · Home | **SHIPPED** |
| journal | ✅ `journalSection.js:642` | ✅ `:643` | ✅ `:553`/`:568` | Chart it · Move stop · Breakeven · Close | Plan trade · Note · Voice · Home | **SHIPPED** |
| catalysts | ✅ | ✅ | ✅ | Chart it · Flag · Why? | Filter · Note · Voice · Home | **SHIPPED** |
| notebook | ✅ `notebookSection.js:496` | ✅ `:521` *(shipped 2026-09-13, D-43)* | ✅ `:546` | New note · Voice note · Set ticker · Templates | Daily plan · Postmortem · Voice · Home | **SHIPPED** |
| calendar | ✅ | ✅ | ✅ | Macro · My names | Voice · Home | **SHIPPED**; "Earnings" DEFERRED |
| home | ✅ `homeSection.js:200` | ✅ `:211` | ✅ `:153`/`:175` | Scan · Chart · Breadth · Wire · Flow | Journal · Notebook · Calendar · Voice | **SHIPPED** (no Home bubble — spec §C3 exempts it) |
| flow | — | — | — | *(none)* | Voice · Home | **SHIPPED as specified** (navigate-only) |

⛔ **MISSING with no D-number — filed as a defect:** `notebook` Reverse ("previous note", spec
§C3 notebook). `notebookSection.js` declares `onTap`, `onScrub` and `readout` but no `onDoubleTap`.
Every other cursor-bearing mode has one. **→ G-DEFECT-2 below.**

⭐ `breadth`'s empty outer ring is NOT missing: spec §C3 lists "Sizing rule · Snapshot", and
`deferred.md` closes both. `calendar`'s "Earnings" likewise ("Earnings is effectively always on").

### `PREVIEW_MODES` — two modes remain, both deliberate

`registry.js:702-704` → `new Set(['home', 'flow'])`. `fanFor()` (`registry.js:804-813`):

- **`home`** gets the curated `PREVIEW_HOME` fan (`registry.js:746-757`) — nine doors, Wire moved to
  the inner ring, Calendar restored under R-C. Owner ruling, not a gap.
- **`flow`** filters to `kind === 'run' || 'home'` → `[Voice, Home]`, which is exactly spec §C3's
  "navigate-only". Not a gap.

⚠️ `registry.js:707`'s comment still says "THE REMAINING SIX STAY". Two remain. Historical narrative,
not a live claim — noted, not filed.

### Invariants — the rails that assert them

`npx vitest run src/hub` → **81 files / 1074 tests, all passing** on master.

| invariant | rail |
|---|---|
| Voice on every inner ring; Home ends every inner ring | `registry.test.js`, and visible in every matrix row |
| every confirm has `confirmText`; `requires[]` disables | `registry.test.js`, `hubComponents.test.jsx` |
| `flickable:false` on the destructive action | matrix: `journal.close` is the only `⛔ no`; `useJoystick.js:396` gates on `flickable !== false` |
| escalateCue on confirm/destructive doors incl. Actions button | `escalateCue.test.js`, `commitSheetEscalationIsVisible.test.jsx`, `flagUndoAndButtonCue.test.jsx` |
| Flag Undo | `flagUndoAndButtonCue.test.jsx` |
| Plan-trade sheet end-to-end | `PlanTradeSheet.test.jsx` + `writePaths.test.js` |
| Journal scrub → confirm sheet → one PUT with stopPrice | `StopConfirmSheet.test.jsx`, `journalSheetStacking.test.jsx`, `writePathsTransitive.test.js` |
| chip readouts for every Scrub | `tapHintIsBacked.test.js` |
| session-only Hide · Settings toggle · edge tab | `hubHideRestore.test.jsx` |
| coach mark once | `chipCopyAndCoachMark.test.jsx` |
| kill switch `HUB_PREVIEW_ENABLED` | `hubKillSwitch.test.jsx`, `tests/test_hub_preview_flag.py` |
| touch-only mount conditions | `hubInertWhenIneligible.test.jsx`, `exposureGate.test.js` |
| hideOnRoute + `/charts` scrim | `hubAutoHideRoot.test.jsx`, `autoHideOnTextFocus.test.jsx` |
| handedness mirror | `mirrorsAsAUnit.test.jsx` |
| high-contrast token | `highContrastWriter.test.jsx` (+ confirmed armed on a real device, `data-hub-contrast="high"`) |
| chip/button clearance | `hubChipActionsClearance.test.jsx` + `tools/hub_chip_clearance.py` 27/27 on the deployed build |
| theme island | `app/src/styles/themeIslands.test.js` |
| PREVIEW_MODES membership | `rolloutStages.test.js` |

### ~~⛔ G-DEFECT-1~~ — the surface matrix was blind to 10 shipped surfaces, and published two FALSE glass steps

> ✅ **RESOLVED 2026-09-13 — filed as D-42, fixed in `6d2945d84`, merged `d153215d0`, live in
> `4beb06c00`.** `bindingsIn` reads an **acorn parse tree** instead of a regex, so shorthand, the
> comma-list form and quoted keys all resolve while a destructure, a member read, a computed key
> and a string literal never can. The self-check went 9 → **20 cases** (count derived, not typed)
> and is mutation-proved: restoring the colon-only regex turns eleven red by name and leaves nine
> green. The sheet went **95 → 107 steps** and `GS-wire-0` is gone. The account below is kept as
> the record of what the defect was.

`bindingsIn()` (`tools/hub_surface_matrix.mjs:81`) matches `` `(^|[^\w.])${key}\s*:` `` — **the colon
form only**. It cannot see ES6 **shorthand** properties. Consequences, measured:

| mode | how it passes its bindings | generator reports |
|---|---|---|
| wire | shorthand, `wireSection.js:282-285` | **"— none —"** |
| home | shorthand, `homeSection.js:240+` | **"— none —"** |
| journal | `onTap:`/`onDoubleTap:` colon (seen); `onScrub,`/`onScrubCommit,` shorthand at `:644-645` | Primary + Reverse only, **no Scrub** |

`glass-acceptance-steps.md` is GENERATED from this, so:

- **10 shipped surfaces have no glass step** — wire ×4, home ×4, journal Scrub + Scrub-commit.
- Worse, the sheet asserts the opposite. `GS-wire-0` reads *"This mode declares no gesture
  bindings"* with expected *"Tap, double-tap and scrub do **nothing** here."* Three rows carry that
  text; only `flow` genuinely has no bindings.
- ⛔ **An operator running it would file a FAIL against working code, or PASS a broken one.**

⭐ The generator's own `--self-check` case 2 uses `{ onScrub: (ctx, s) => s }` — the colon form — so
the control is real but incomplete, and never exercises shorthand. This is
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` inside the instrument built to prevent it.

**Not fixed here** — §4 permits only the token fix and docs corrections; a generator change is
neither. **Owner ruling needed:** fix `bindingsIn` to accept shorthand and regenerate both files
(≈30 min, then the 96-row sheet grows), or accept 10 unstepped surfaces.

### ~~⛔ G-DEFECT-2~~ — `notebook` had no Reverse

> ✅ **RESOLVED 2026-09-13 — filed as D-43, same commit.** `onDoubleTap` is wired symmetrically
> with `onTap` — same clamp, same computed target, `prev()` through the shared cursor. Its rail
> drives the REGISTERED config and reads the §C3 promise out of the spec of record. ⛔ Its glass
> row `GS-notebook-b2` is INCONCLUSIVE-TRANSPORT and sits on `owner-run.md` §B as **B12**: a
> double-tap needs two presses inside 280 ms and the mirror floor is 260–427 ms. **It has never
> been on glass.**

Spec §C3 notebook: *"Primary: next note. **Reverse: previous note.**"* `notebookSection.js` declares
no `onDoubleTap`. No D-number covers it. Filed here; needs a D-number or a spec amendment.

### Glass tally

23 rows carry an untouched `[ ] PASS [ ] FAIL`. **Every one is accounted for:**

| bucket | count | where |
|---|---|---|
| PASS | 4 | G3-1, G3-15, G3-17 (FINE), G3-16(b) BETTER |
| RETIRED / N-A | 2 | G3-3, G3-12 — both name the removed two-finger Peek |
| BLOCKED (platform) | 2 | G2-3, G2-4 — BrowserStack iOS has no screen reader |
| INCONCLUSIVE-TRANSPORT / on `owner-run.md` | 21 | G1-1…6 (§A), G2-1/2 (§C), nine G3 rows (§B), G3-2+G3-16a+G3-5 (§D), G4-1/2 (§E) |
| BLOCKED-BY-G0 | 96 | Block G5's derived sweep |
| ~~**NOT RUN and NOT on owner-run.md**~~ | **0 rows / 0 surfaces** | ✅ **Closed 2026-09-13.** The 10 surfaces G-DEFECT-1 hid are now steps, and every one of them is either run or on `owner-run.md` §B. See the addendum below. |

### Addendum — what the 14 new steps did on glass (2026-09-13)

Record: `15pro-new-rows-2026-09-13.md`. iPhone 15 Pro / iOS Safari 17.6, Web Inspector CLOSED.

| Steps | Outcome |
|---|---|
| `GS-wire-b1` | ✅ **PASS.** Two taps, each advancing **exactly one segment** and scrolling it into view. |
| `GS-home-b1` | ⚠️ **PASS on the spec.** The tap navigated to the last-used section (Morning Wire) — `homeSection.js:200`, spec §C3:905. The sheet expected cursor-stepping, which `home` does not do → **D-44**, ✅ since fixed (`462d8f3d7`): that row now reads *“The **ROUTE changes** — spec §C3 says **“last-used section”**”* and carries the inert-on-a-first-visit caveat. |
| 3 × Reverse (`*-b2`) | ⛔ **INCONCLUSIVE-TRANSPORT** → `owner-run.md` B10–B12. 280 ms window vs a 260–427 ms floor. |
| 9 × scrub / commit / readout (`*-b3/b4/b5`) | ⛔ **INCONCLUSIVE-TRANSPORT** → `owner-run.md` B13–B15. A scrub is a **500 ms hold** that turns into a drag (`useJoystick.js:408`); the mirror has no way to hold a press. |

⚰️ **One reading was recorded as a PASS and then retracted.** A drag from the pad on `/dashboard`
navigated to Screener and was briefly logged as a working scrub-commit. It was a **fan push**:
without the hold, a drag resolves by DIRECTION, and straight up is the `home.scan` bubble. What
exposed it was the same gesture on `/morning-wire` firing `wire.voice` and raising a microphone
permission prompt — an outcome no scrub could produce. ⭐ The lesson is not "be careful": it is
to ask **what else would produce this exact observation**, and the answer was sitting in the fan.

> ### §1 verdict: **COMPLETE-PENDING-OWNER-RUN**
>
> **G-DEFECT-1 (= D-42) and G-DEFECT-2 (= D-43) are both CLOSED IN PRODUCTION**, `d153215d0`,
> live in `4beb06c00`. Every mode now declares what spec §C3 promises, including `notebook`’s
> Reverse, and the acceptance sheet can see all of it: **95 → 107 steps**, the two false
> “does nothing here” rows gone, and the one that remains (`GS-flow-b0`) true.
>
> **PENDING-OWNER-RUN, not COMPLETE**, for one reason only: of the fourteen steps that appeared,
> **two were run on a 15 Pro** (`GS-wire-b1` PASS, `GS-home-b1` PASS on the spec) and **twelve are
> INCONCLUSIVE-TRANSPORT** on `owner-run.md` §B. Both reasons are measured, not argued: Reverse
> needs two presses inside 280 ms against a 260–427 ms floor, and a scrub needs a 500 ms HOLD
> before the drag which the mirror has no way to perform.
>
> ✅ **One new defect, and it was the sheet’s prose, not the product: D-44 — NOW CLOSED** (`462d8f3d7`,
> merged `2b4fc75cc`). Every behaviour
> measured on glass matched the SPEC; what did not match was the generated expected-result text.
> It is an instrument defect of exactly D-42’s class one layer up — D-42 was the sheet not knowing
> a binding EXISTS, D-44 was the sheet not knowing what it DOES. The generator now derives every
> expected result from `constants.js`, the mode’s own controller and spec §C3, and its self-check
> grew to 36 cases with fixtures for a navigate, a cursor and a cycle mode. **No row on the owner
> run carries a correction note any more** — the sheet says what the product does.

---

## §2 — Plan completeness

### Phases and gates

| phase / wave | closure | evidence |
|---|---|---|
| Phase 0 Discovery | ✅ | spec §3 "COMPLETE"; `10-wave0-discovery.md` |
| Phase 0.5 UX | ✅ | spec §3.5; `20-wave05-ux.md` |
| Phase 1 registry/context/cursor | ✅ | `30-phase1-plan.md` |
| Phase 2 gesture engine + glass | ✅ | `40-phase2-gate.md`; PR **#101** → `d3bf38f44` |
| Phase 2a `hub_planned_trades` | ✅ | spec §5a; `/api/hub/planned-trades` live (401 unauth) |
| Phase 2.5 hide-recovery | ✅ | `45-phase2.5-plan.md`, `47-hide-recovery.md` |
| Phase 3 section controllers | ✅ | `60-phase3-plan.md`; Increment 2 `0fcefb649` |
| Increments 4–7 | ✅ | `RESUME-inc4/5.md`, `70-increment-6-closure.md`; last `4a66f97e1` |
| Increment 8 (nav-freeze rails) | ✅ | `19a2b925c`; `postmortem-nav-freeze.md` |
| Deploy A / B | ✅ | `0c0af484a`, `b9d66e0c3` |
| Closure docs | ✅ | PR **#109** `9b51eaf1a`, **#113** `71b4b61d0` |
| Hotfix (iOS 17) | ✅ | PR **#111**, gate appended retroactively |
| Smoke-login + hardening | ✅ | PR **#110**, **#112** `1dbe230d0`, **#114** `69e2cdc6b` |

38 gate manifests in `docs/plans/joystick/gate-runs/` (+2 `INVALID-*`, correctly gitignored refusals).

### Additive exceptions (a)–(i) — all landed

`(a)` `Layout.jsx` mounts the hub · `(b)` 4 files register `useHubCursor` · `(c)` 50 `--hub-*` refs in
`tokens.css` · `(d)` `scrollToIndex` in 14 files · `(e)` `.goLivePill` in `StockChart.module.css` ·
`(f)` `moveStop` at `UIcon.jsx:458` (62 ICONS keys) · `(g)` both Layout test files present ·
`(h)` `hubActive` guard in `App.jsx` · `(i)` `AWAITING_A_DECISION` at
`components/screener/reachable.test.js:279`.

### Ledger — no orphans

- **D-numbers:** 41 total. **37 CLOSED**, **4 OPEN, all owned** — D-38 (toast duration, joystick,
  accepted as-is), D-39 (chip vs page furniture, joystick), D-40 (Notebook phone list has no per-note
  DOM id, **Notebook**), D-41 (two `iteratorGlobalFloor` corrections, **Notebook**).
- **R-numbers:** 20 present. **19 CLOSED**; R-28 is OPEN with its owner in its own heading
  (`requests.md:920`, "owner: The Desk") — a cross-workstream row, not a joystick item.
- **ORPHANS: none.**

⚠️ Two new defects above (G-DEFECT-1, G-DEFECT-2) have no D-number yet — that is this audit's own
output, not a pre-existing orphan.

### Closure gate — **2 of 6**

| box | state | what it needs, and who |
|---|---|---|
| 1 · G0 resolved | ⬜ OPEN | Owner runs `owner-run.md` §A and pastes the trace — 20 min. |
| 2 · Glass on ≥1 iOS + ≥1 Android | ⬜ OPEN | Box 1 first: Block G5's 96 rows are BLOCKED-BY-G0, and a blocked row is neither a PASS nor a stated INCONCLUSIVE. |
| 3 · Post-deploy client smoke | ✅ CLOSED | `closure.md:83` |
| 4 · Preference-key validation | ✅ CLOSED | `closure.md:121` |
| 5 · Rollout at stage 3 | ⬜ OPEN | Stage 2 first, which needs box 1. |
| 6 · closure.md rewritten as LAUNCHED | ⬜ OPEN | Boxes 1–5. |

### Rollout

`ROLLOUT_STAGE = 1` (`app/src/hub/rolloutStage.js:23`) at the live SHA. Stage 2 reads "Owner reports
G0 ≥ 8/10" + "glass rows pass on ≥1 notched iOS + ≥1 Android"; stage 3 adds the conclusive smoke.
⭐ The **second** stage-2 blocker is gone — G3-15 is PASS — so stage 2 is held behind **one number**,
which is `owner-run.md` §A.

> ### §2 verdict: **COMPLETE-PENDING-OWNER-RUN** — every phase closed with a manifest and a PR, all nine exceptions landed, no orphan ledger rows; gate 2/6 with boxes 1, 2, 5, 6 all reducible to one owner session.

---

## §3 — Production state

| item | value |
|---|---|
| live SHA | web / worker / bars-api **`ccbab9bcd`**; flow-worker `c4c77d385` (older by design — narrow watch list) |
| `HUB_PREVIEW_ENABLED` | `true` |
| `SMOKE_LOGIN_LINK_ENABLED` | `1` |
| `/api/health` | **200**, `status: ok` |
| `POST /api/hub/planned-trades` | **401** |
| `GET /api/hub/planned-trades` | **401** |
| `/smoke-login` (no token) | 200 — the SPA route; the invalid-link state renders client-side |
| smoke notes | **0** |
| smoke positions | **0** |
| smoke flagged items | **0** — no stray Flag |
| smoke `joystick_hub` prefs | `handedness: right`, `highContrast: false`, `traceGestures: false` — defaults |
| latest prod auth backup | `/data/backups/auth-2026-09-12T040750Z-pre-member-smoke.db`, 103.9 MB, **quick_check ok**, 27 users / 22 subs |
| dev-box backup | `C:\data-backup-2026-09-08` — 53 files, 3.88 GB, newest mtime **2026-09-08 22:24**, **unchanged since the incident** |

⚠️ Production restarted **three times** during this audit (other workstreams). Every probe above was
taken only after `/api/health` uptime climbed past 3 minutes.

> ### §3 verdict: **COMPLETE** — every probe as expected, smoke account clean, both backups verified.

---

## §4 — Fixes made in this audit

### Token case-insensitivity — **SHIPPED** (PR #114 → `69e2cdc6b`, deployed)

Smoke-login tokens are now **lowercase base32** — 52 chars over `a-z2-7`, still 32 random bytes, so
**no entropy was traded for typeability** — and redemption lowercases at
`redeem_smoke_login_token`'s own boundary. Password-reset tokens are **unchanged** (base64url, exact
comparison), with a scoping rail proving it over 40 samples. Four rails, all mutation-proved.
Gate: 1306 files / 19,318 tests, **0 NEW attributable**. Verified live: a minted token is 52 chars and
lowercase-only.

⚠️ **Recorded, not buried:** the first patch replaced the *first* `secrets.token_urlsafe(32)` in the
file — **email verification**, where `purpose` is not in scope — a `NameError` on every signup
verification. Caught and corrected before any test ran green; the 220-test auth sweep passes.

### ⛔ The Pixel 8 still cannot be signed in — the fix was necessary but NOT sufficient

Two attempts on a fresh Pixel 8 / Android 14 / Chrome session, per the two-attempt rule:

| attempt | typed | landed on the device |
|---|---|---|
| 1 (whole URL) | `https://uctintelligence.com/smoke-login#token=ecrt…` | `uctintelligence.com/smc` |
| 2 (chunked: scheme+path first) | `https://uctintelligence.com/smoke-login` | `htps;//uctintelligence.com/smoke-login` |

⭐ Attempt 2 is the informative one: the **path is now correct**, but the scheme is corrupted — a
dropped `t` and `:` mis-mapped to `;`. So the Android mirror's text entry loses **characters and
punctuation**, not only case. The case fix removed one of two blockers; the transport remains lossy.
`url=` preload was already shown to be overwritten by BrowserStack's own session state.

**D1, G2-1, G2-2, D4 and the untimed Android rows therefore stay on `owner-run.md` §C.** TalkBack
itself is confirmed working on that device (the screen-reader toggle enables and disables cleanly) —
what cannot be done is authenticating a *mirrored* device.

> ### §4 verdict: **COMPLETE for the fix, INCOMPLETE for the device proof** — the token is caseless and live, and the Pixel 8 remains undrivable for a reason that is measured, is not the token, and is not a product defect.
