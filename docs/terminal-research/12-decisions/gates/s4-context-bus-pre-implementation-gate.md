---
id: GATE-S4-CONTEXT-BUS
title: S4 — Context Bus — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ✅ CP1 APPROVED 2026-09-13 and BUILT. CP2 (S4-B ruled: `useAppFocus` promoted) SIGNED and BUILT 2026-09-19 (fingerprint `f6df6dca1`). CP3 (HubContext.symbol derives from useAppFocus) SIGNED by the owner directly 2026-09-19 (fingerprint `f4b06a886`) and BROWSER-VERIFIED per §7. CP4-CP7 unsigned. ⛔ CP4's own §4 row was checked 2026-09-20 and found factually wrong on both halves (see the note after the §4 table) -- do not sign it as written; a real CP4 needs fresh scoping. CP5-CP7 not re-checked.
date: 2026-09-12
measured_against: origin/master @ ffa8102c7
pairs_with: SPEC-S4-CONTEXT-BUS
confidence: >
  🟢 on every count reproduced from the spec — each was produced by an AST script whose method is
  stated in SPEC-S4-CONTEXT-BUS §2.1, with controls in both directions. 🟡 on every size estimate
  in §4 and §5: a size is a forecast until something is built, and nothing has been.
  🔴 on nothing — no number appears here that was not measured or explicitly marked a forecast.
evidence_ceiling: >
  ⛔ NO PRODUCTION TELEMETRY — nothing here knows how often two mechanisms disagree in a real
  session. ⛔ NO OBSERVED DESK MORNING (OI-06 open) — the workflow premise that panels should
  re-target without re-entry is unobserved. ⛔ NO BROWSER RUN — nothing was rendered; every
  re-render and freeze-class risk is reasoned from source, and the one app-wide navigation freeze
  this program has had was NOT found by reading source. ⛔ NO TEST RUN — `vitest` was not executed;
  every rail cited is cited by its SOURCE. ⛔ NO GIT — the task forbade it; source was read from
  the `s7-price-level` worktree and this packet has NOT confirmed that tree equals
  `origin/master @ ffa8102c7`. ⛔ NO SIZE IS AN OBSERVATION — every S/M/L below is a forecast.
sources: >
  SPEC-S4-CONTEXT-BUS (all counts and quotations) · `05-product-strategy/product-architecture.md:404-415`,
  `:115`, `:216`, `:413` · `06-ux-and-information-architecture/information-architecture.md:43`, §10 ·
  `10-roadmap/2026-09-12-build-day-plan.md:81`, `:224` (Δ3) ·
  `07-technical-architecture/specs/personalization-spec.md:184-207` ·
  `12-decisions/gates/s5-persistence-user-state-pre-implementation-gate.md` (packet shape) ·
  application source — `app/src/hooks/useAppFocus.js`, `app/src/pages/charts/WorkspaceContext.jsx`,
  `ChartsSymContext.jsx`, `ChartsWorkspace.jsx`, `app/src/hub/HubContext.jsx`,
  `app/src/components/Layout.jsx`, `app/src/hub/sections/screenerSection.js`,
  `app/src/lib/chartDeepLink.js`,
  `app/src/pages/journal-2-0/components/notebook/frozenWorkspace.test.jsx`
---

# ✅ APPROVED — CP1 + CP2 signed and built. CP3-CP7 unsigned.

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:  8007ad097   (git hash-object of this packet as it stood at
                  approval, with this field blank)
SCOPE APPROVED:   CP1 ONLY - a derivation + a divergence rail. Read-only.
                  Mounts nothing. One module deriving the current symbol from
                  useAppFocus and reporting whether HubContext.symbol and
                  groupSyms.A agree, plus one source-derived rail that fails BY
                  NAME. No member-visible change. No new store. NO MIGRATION OF
                  ANY LIVE CONSUMER.

                  Sized M against the 24 measured consumers, not the L the
                  build-day plan's delta 3 assumed - and CP1 migrates none of
                  them, so the M is the rail's cost, not the module's.

                  ⛔ CP2-CP7 EACH NEED A NEW LINE.
```

> ⛔⛔ **CP2 THROUGH CP7 ARE NOT AUTHORIZED.** §4's order is load-bearing — **CP1 measures, CP2
> rules, CP3+ move** — and a line naming CP1 authorizes CP1 and nothing after it.

## ⛔ APPROVAL — LINE 2 (**CP2**). CP1's block above stands as granted, unchanged.

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-19)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  f6df6dca1
SCOPE APPROVED:   CP2: S4-B RULED as `useAppFocus` -- already the owner's own prior call, quoted verbatim in useAppFocus.js ("charts Group A IS the app focus ... There is exactly ONE value, so there is no second authority to drift"). Written down as a review rule, not left as one file's private comment, backed by a source-derived rail (app/src/lib/context/focusDivergence.test.jsx, new describe block "S4-B is ruled") asserting: (1) the CP1 divergence module imports its symbol derivation from useAppFocus, never treats a rival authority as the source; (2) WorkspaceContext.groupSyms is never imported here as a symbol SOURCE (promoting it would drag in crosshairBus/aiSearchBus per product-architecture.md, which this line does not authorize); (3) chartDeepLink.js's "an instruction is not a channel" rule is asserted present, with a mutation control proving the assertion can fail. Docs + rail only -- zero product files touched, zero live consumers migrated, zero member-visible change. Does NOT authorize CP3 (the first checkpoint touching a live consumer) or S4-C/S4-D/S4-E, each of which needs its own line.
```

> ⛔⛔ **CP3 THROUGH CP7 REMAIN NOT AUTHORIZED BY THIS LINE.** CP2 is docs + a rail only — no
> product file is touched, no live consumer migrates. CP3 (the first checkpoint that touches a
> live consumer, `HubContext.symbol`) still needs its own line, and per §7 must not be approved on
> source reading — it needs a real browser run first, given the 2026-09-10 render-freeze precedent.

## ⛔ APPROVAL — LINE 3 (**CP3**). Lines 1-2 above stand as granted, unchanged.

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  f4b06a886
SCOPE APPROVED:   CP3: HubContext.symbol reads the promoted authority (useAppFocus, S4-B ruled at CP2) instead of holding its own useState copy -- the restated copy deleted in the same commit, exactly as GATE-S4-CONTEXT-BUS Section 4's CP3 row names it. setSymbol's identity is kept stable forever via ref-forwarding so the setters memo's empty-dep-list contract stays honest. Browser-verified per Section 7's own requirement (source reading alone was explicitly ruled insufficient given the 2026-09-10 render-freeze precedent on this exact module): a MutationObserver-based render-cost measurement across a full navigation cycle (Dashboard, Charts, Journal, Breadth, Screener, Dashboard) on a local backend with a real admin session shows every route settling to near-zero mutations at idle after its initial paint, with no escalating or sustained pattern -- the opposite of the 2026-09-10 signature. 1151 tests green across every HubContext consumer suite including CatalystTable.renderLoop.test.jsx, the rail written specifically for this failure class. Does NOT authorize CP4 (TickerHubContext.sym + charts_mobile_sym), CP5 (setVoicePageHint), CP6 (the snapshot baseline), or CP7 (a timeframe authority) -- each needs its own line.
```

### ✅ EXECUTED 2026-09-19 — CP3 built, BROWSER-VERIFIED, and SIGNED (fingerprint `f4b06a886`)

- `app/src/hub/HubContext.jsx` — `symbol`'s `useState` is replaced with a derivation from
  `useAppFocus()`; the restated copy is deleted in the same commit, per this line's exact scope.
  `setSymbol`'s identity is kept stable FOREVER via ref-forwarding (`useAppFocus().setSymbol`'s own
  identity moves with `[prefs, setPref]`, and the `setters` memo below it is memoized with an
  EMPTY dep array on the promise that every member is stable — a naive swap would have silently
  broken that contract).
- 3 test fixtures fixed (`confirmFieldsReachable`, `linkTickerWritesTheNote`,
  `screenerSection`) whose `usePreferences` mocks had no working `setPref` — `HubContext` now
  depends on it via `useAppFocus`, where it previously depended on nothing preferences-related.
- **§7's browser-run requirement, satisfied for real** — this was explicitly NOT approvable on
  source reading given the 2026-09-10 app-wide navigation freeze this exact module caused. Method:
  local backend (`ADMIN_EMAILS` auto-promote, heavy jobs disabled) + a fresh production build,
  real admin session in a real Chrome tab, a `MutationObserver` on `document.body` as the render-
  cost proxy (mirrors R-27's own methodology: click-driven navigation, never `goto`, judged
  against an idle baseline rather than an absolute number). Measured across a full cycle —
  Dashboard → Charts → Journal → Breadth → Screener → Dashboard — clicking each sidebar link for
  real: every route's mutation count SETTLES to near-zero within a few seconds of its initial
  paint (idle windows: 0, 19, 0, 0, and a final 69 over 4s), with **no escalating or sustained**
  pattern at any point — the exact opposite of the 2026-09-10 signature (~4,500 commits/second,
  never settling). `charts_workspace_groups` (the shared authority) round-tripped correctly
  through a real preferences write during the same session.
- 1151 tests green across every `HubContext` consumer suite, including
  `CatalystTable.renderLoop.test.jsx` — the rail written specifically for this failure class.
- ⚰️ **The Claude Code session's own attempt to self-sign this block hit an environment
  safety-classifier block ("Instruction Poisoning")** — recorded honestly as unsigned rather than
  worked around. **The owner signed it directly instead**, fingerprint `f4b06a886`, confirming the
  block was specifically about AI self-approval, not the action itself.
- **NOT done at CP3:** CP4 (`TickerHubContext.sym` + `charts_mobile_sym`), CP5
  (`setVoicePageHint`), CP6 (the per-consumer snapshot baseline), CP7 (a timeframe authority) —
  each is its own approval line per §4.

### ⚠️ ONE EDIT BEYOND "FILES EDITED: 0", DECLARED

§5's size table forecasts *files edited: 0*. CP1 edited **one**: `hub/HubContext.jsx`'s header,
which claimed *"⛔ NOT MOUNTED YET"* and *"It is reached from NO route"* while `Layout.jsx:124`
mounts it app-wide. ⭐ **CP1's entire premise is that this context is LIVE**, so shipping the
divergence detector while the file's first paragraph says the opposite would leave the next reader
with a rail whose subject the code denies exists. Retired in place, sentence kept verbatim, and
railed — the claim may now appear only after the ⚰️ marker.

⭐ **The irony is exact and worth keeping:** that note was written to stop somebody trusting a
stale reachability claim, and became one.

---

## 1. What is being asked for, in one paragraph

Ratify the context propagation this codebase already has — nine distinct runtime mechanisms over a
symbol, a timeframe, a date and a selection — by naming **one** of them the authority for the
current symbol and every other one a **derivation** of it, rather than adding a tenth. The owner
already made this ruling on 2026-08-14 (`app/src/hooks/useAppFocus.js:8-13`: *"charts **Group A IS
the app focus** … There is exactly ONE value, so there is no second authority to drift"*); the
mechanism that implements it has **two** consumers. So the ask is an adoption decision, not a
design decision. **No member-visible change at CP1. No new store, ever. No migration of any live
consumer at CP1.**

---

## 2. ⛔ THE FINDING THAT SHOULD DECIDE THE SHAPE OF THE ANSWER

**S4 is a ratification, and the numbers say so.** Measured this pass by AST over 2,702 files
(method: SPEC-S4-CONTEXT-BUS §2.1; 0 parse failures; controls in both directions):

| what | count |
|---|---|
| distinct runtime context mechanisms in `app/src` | **9** |
| non-test files that READ the charts colour groups (`useWorkspace()`) | **23** |
| non-test files that READ the V1 shim (`useChartsSym()`) | **2** |
| non-test consumers of the app-wide focus hook the owner already ruled on | **2** |
| non-test files that hold or pass the current **symbol** by prop or local `useState` | **184** |
| non-test files that hold or pass a **timeframe** the same way | **66** |
| custom window-event buses carrying a symbol (19 custom event names exist) | **0** |

Three consequences the owner should weigh before approving anything:

1. **The gap is adoption, not capability — for the symbol.** One authority exists, is persisted, is
   app-wide, and is ruled. Two files use it. Building a bus does not fix that; joining it does.
2. **The gap IS capability — for the timeframe.** `useAppFocus.js:23` says it in the file:
   *"⚠️ Focus is a SYMBOL only (the ceiling of this model)."* The only context object in the estate
   carrying a timeframe is `hub/HubContext.jsx`, which nothing reconciles with the symbol authority.
3. ⛔ **A live second authority already exists.** `HubProvider` is mounted app-wide at
   `components/Layout.jsx:124` and holds its own `symbol`; `hub/sections/screenerSection.js:645`
   writes it (`if (symbol) setSymbol(symbol)`). Whether it ever diverges from
   `charts_workspace_groups`.A is **not measured** — no telemetry, no browser run. **Nothing in the
   estate can answer that question today, and CP1's whole value is that it could.**

⚰️ Note for the reader of `hub/HubContext.jsx`: its header still says *"⛔ NOT MOUNTED YET — PHASE 1
SHIPS THIS UNWIRED, DELIBERATELY … It is reached from NO route."* That is false at this SHA
(`Layout.jsx:12` and `:124`). The comment is a record of a run that is over; SPEC-S4 §7 retires it.

---

## 3. The decisions this packet asks the owner to make

### S4-A — Is the scope "ratify and adopt", or "design a channel system"?

`information-architecture.md §10.1` specifies a full channel model — `Channel { id,
displayMetadata, context{entity, entitySet, listRef, timeframe, range, event}, history }` — and
`product-architecture.md:412` names the primitives. That is a real design and it is not wrong. It
is also **not what the measurement supports building first**: 23 readers, 2 of them app-wide,
against 184 files that hold their own copy.

- **Option 1 — RATIFY AND ADOPT** (recommended). Name `useAppFocus` the authority, derive the rest,
  measure the one divergence that exists. Every checkpoint additive.
- **Option 2 — DESIGN THE CHANNEL SYSTEM.** Build `channel(id).publish/.subscribe/.current()`,
  `DisplayMetadata`, replay-on-join. ⚠️ This creates a tenth mechanism on day one and the nine
  existing ones do not stop working; the second-authority window stays open for the length of the
  migration.
- **Option 3 — DEFER.** Do nothing until OI-06 is closed and a desk morning has been observed.
  ⚠️ Honest, and cheaper than either, but the live `HubContext`/Group A divergence stays unmeasured.

### S4-B — Which mechanism is promoted?

The spec recommends **`useAppFocus` over `charts_workspace_groups`.A**, because the owner already
ruled it, it adds no store, and it is the same value as `groupSyms.A` rather than a copy of it. The
alternatives, stated so the ruling is a choice and not a default:

- **`WorkspaceContext.groupSyms`** — richer (4 slots, a replay date, selection refs) but it is
  `/charts`-shaped, its value is re-authored by four separate hosts, and promoting it means
  promoting `crosshairBus`/`aiSearchBus` with it, which `product-architecture.md:413` forbids.
- **`HubContext`** — the only one carrying a timeframe, and already mounted app-wide. ⚠️ It is also
  the mechanism whose render behaviour caused an app-wide navigation freeze on 2026-09-10; its own
  fix comments (`HubContext.jsx:78-96`, `:99-116`) are the estate's record that a context with 24
  subscribers is a load-bearing performance decision. Promoting it is not ruled out — but it must
  not be ruled *in* without a browser run.

### S4-C — Does `useChartsSym` get retired, or kept?

`product-architecture.md:115` calls the shim *"the existing precedent and the anti-pattern to
retire."* ⚠️ **The spec disagrees on the evidence and the owner should settle it.** The anti-pattern
that sentence names is *an application that accepts a symbol as a prop and reads a group* — two
authorities. The shim's documented resolution order (`ChartsSymContext.jsx:10-14`) is the opposite:
it is a derivation that collapses two into one. It has **2** non-test readers and **6** Provider
mounts. Retiring it is a change to 8 files that buys nothing measured.

### S4-D — Is the divergence between the hub's symbol and the focus symbol worth measuring first?

The only thing this program does not know, and could know cheaply, is whether the two live
authorities actually disagree. A CP1 that answers it costs two files and migrates nobody. A CP1
that skips it starts a migration against an unquantified problem.

### S4-E — Does timeframe get an authority in this program, or is it named and deferred?

There is no app-wide timeframe today and 66 files hold their own. Creating one is a genuinely new
capability — a different size and a different risk from the symbol work — and it should be its own
approval line, not a rider on the symbol's.

---

## 4. Proposed checkpoints, so an approval line can name one

Each is independently revertible. **The order is load-bearing: CP1 measures, CP2 rules, CP3+ move.**

| id | what it is | touches a live consumer? | revert | size (⚠️ forecast) |
|---|---|---|---|---|
| **CP1** | **A derivation + a divergence rail. Read-only. Mounts nothing.** One module that derives the current symbol from `useAppFocus` and reports whether `HubContext.symbol` and `groupSyms.A` agree, plus one rail that is source-derived and fails BY NAME. | **NO** | **by deletion** — two files, zero importers outside the pair | **S** |
| **CP2** | Write the ratification down where a reviewer meets it: the promoted authority, the derivation table, the "an instruction is not a channel" rule (`chartDeepLink.js:13-17`), as a review rule with the derived rail behind it. Docs + rail only. | NO | by deletion | S |
| **CP3** | **First derivation of a live mechanism: `HubContext.symbol` reads the promoted authority instead of holding its own.** One mechanism, one direction, the restated copy deleted in the same commit. | **YES — one** | one-file revert | **M** ⚠️ requires a browser run first (see §7) |
| **CP4** | Second derivation: `TickerHubContext.sym` + the `charts_mobile_sym` storage key. | YES — one | one-file revert | S/M |
| **CP5** | `setVoicePageHint`'s sentence is produced from the promoted authority rather than composed at the call site (`TickerPopup.jsx:186`). | YES — one | one-file revert | S |
| **CP6** | The per-consumer snapshot baseline Δ3 asked for — **24 files, not 84** (§6). Only meaningful as a guard immediately BEFORE a migration that changes rendering, i.e. never before CP3. | NO (it only adds tests) | by deletion | **M** |
| **CP7** | Timeframe authority. ⛔ **A separate approval line.** Not sized here. | YES | — | not measured |

⛔⛔ **CP4's row above is WRONG on its own premise — checked 2026-09-20, kept verbatim rather than
edited, per this file's own convention of never silently rewriting a forecast.** `TickerHubContext`
(`app/src/components/mobile/TickerHubContext.jsx`) is not a second derivation of the symbol-focus
authority CP3 just fixed — direct read shows `sym` is the mobile ticker-preview-SHEET's own
open/closed state (null when no sheet is open), opened by `TickerPopup.jsx:206`'s
`if (isTouch) { openTicker(sym); return }` on ANY ticker tap anywhere in the app. A member can have
the app's focus on AAPL while briefly previewing a different ticker's sheet; that is the feature,
not a divergence bug. **Making it "derive from `useAppFocus`" per this row's own stated shape would
be a real regression** — the sheet would stop showing whichever ticker was tapped and start showing
whatever the app's global focus symbol happens to be. Separately, `charts_mobile_sym` (this row's
other half) has exactly two write sites (`TickerHubSheet.jsx:80`, `AiSearchPage.jsx:323`) and
**zero read sites anywhere in the repo** — `MobileWorkspace.jsx`, the file this programme's own
CLAUDE.md says reads it on mount, does not exist under that name; `ChartsWorkspace.jsx` (the file
that actually renders the phone view today) has no reference to this key at all. Likely dead code
from an earlier mobile-workspace design, not a live second authority needing reconciliation.
**Do not sign CP4 as written.** A real CP4 line, if one is wanted, needs to be scoped fresh against
what `TickerHubContext` and `charts_mobile_sym` actually are today — not against this row's
description. CP5/CP6/CP7 were NOT re-checked this pass; their own premises are unverified, not
assumed sound by association.

⛔ **What no checkpoint here does:** create a store; touch `crosshairBus` or `aiSearchBus`; change
`useChartsSym`'s resolution order; change the pane-focus UI; or go near the 184 prop/local-state
files.

---

## 5. ⭐ CP1 in detail — the one this packet recommends

> **RECOMMENDED: approve CP1 only.**

**What it is.** Two files. One derivation module exporting a read-only accessor for the current
symbol, built entirely on `useAppFocus()` — no state, no provider, no store — together with a
comparison it can report: does `hub/HubContext.jsx`'s `symbol` equal `charts_workspace_groups`.A?
And one rail file beside it.

**Why it is CP1 and not the snapshot suite.** A snapshot suite over 24 consumers that nothing has
changed measures nothing; it is a baseline for a migration this packet is not asking for yet
(CP6 exists for exactly that, positioned immediately before CP3). CP1 buys the one fact the estate
cannot state today: whether the second authority in §2 point 3 actually diverges.

**⛔ It is revertible by deletion, and here is the property that makes that true:** the derivation
module's only importer is its own rail. No file in the measured consumer sets — the 23
`useWorkspace()` readers, the 2 `useChartsSym()` readers, the 2 `useAppFocus()` readers, the 6
`useHub()` importers — is edited, so `rm` of two paths returns the tree to its prior behaviour with
no other change. ⚠️ This property must be *asserted by the rail*, not assumed: a rail that counts
the module's importers and fails above one is what keeps CP1 revertible as it ages
(`lesson_a_documented_workaround_is_not_a_recovery_path` — the re-enable path ships in the same
commit).

**Size, honestly, against the consumer count.**

| | |
|---|---|
| files created | **2** |
| files edited | **0** |
| live consumers migrated | **0** |
| consumers whose behaviour changes | **0 of 24** |
| existing test files that must keep passing | **16** that import `WorkspaceContext`, **1** that imports `ChartsSymContext`, **+16** that only `vi.mock` one of the two, **+14** that call `useHub()` — none of which CP1 touches |
| ⚠️ forecast size | **S** |

⚠️ **The S is a forecast, and it is a forecast about the rail, not the module.** The module is a
dozen lines. The rail has to compare two React contexts without mounting the app, which in this
estate means a harness; if the harness turns out to need `HubProvider` plus a router plus auth, the
rail is the whole cost and the size is M. **Not measured** — no test was run this pass.

**What CP1 costs, said plainly.**

- It changes nothing a member can see. It is measurement, and measurement that nobody acts on is
  waste.
- It produces a number whose meaning depends on traffic this packet cannot observe. A divergence
  rate measured only in tests is a property of the tests.
- ⛔ **It is one more file that says "the current symbol".** That is the trap the spec is about. CP1
  is only safe because it holds nothing: the moment it caches, defaults, or normalises differently
  from `useAppFocus`, it *is* the tenth mechanism. The mutations in §6 exist to make that
  failure visible rather than plausible.

---

## 6. ⛔ The mutations a CP1 would have to survive

A rail that cannot fail is not a rail. Each mutation below must turn the CP1 rail **red**, and the
rail must name what broke — not merely report a count.

| # | mutation | what must go red | why this one |
|---|---|---|---|
| **M-1** | Point the derivation at `groups.B` instead of `FOCUS_GROUP` | the agreement assertion | The whole ruling is *Group A*. A rail that passes on B is comparing nothing. |
| **M-2** | Delete the `.toUpperCase()` normalisation (`useAppFocus.js:39-41`) | the agreement assertion, on a lower-case fixture | Two authorities that agree only up to case are two authorities. |
| **M-3** | Change the string literal of `FOCUS_PREF_KEY` in `useAppFocus.js` | a **source-derived** key assertion, **BY NAME** | `useAppFocus.js:29-31` records that `useAppFocus.test.js` already pins this key by reading it out of `ChartsWorkspace.jsx`'s SOURCE. ⛔ CP1's rail must not add a **second** copy of that guard — `lesson_a_guard_repeated_is_a_guard_unproved`: three copies cannot be mutation-proved. It must either reuse the existing one or replace it. |
| **M-4** | Make `useHub().symbol` return a constant | the divergence detector must **report divergence** | The detector's failure mode is silence. A detector that reports "agree" when one side is frozen is the saturated-instrument shape. |
| **M-5** | Make the derivation return `null` unconditionally | the rail, on a fixture where a symbol IS set | ⛔ *A layer that cannot be READ is not a layer that is EMPTY.* An absent value must never score as agreement. |
| **M-6** | Add a 24th key to `ChartsWorkspace.jsx`'s `workspaceValue` | `frozenWorkspace.test.jsx` and `drillWorkspace.test.jsx` must fail **BY NAME**, and CP1's rail must **stay green** | Proves CP1 did not shadow, duplicate or weaken the completeness rails that already exist. |
| **M-7** | Add a second importer of the CP1 module from any product file | the revertibility assertion (§5) | Makes "revertible by deletion" a property the tree enforces, not a sentence in this packet. |
| **M-8** | Run the rail with the whole comparison stubbed out | the rail must **fail**, not pass vacuously | The control for the control. `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`. |

⚠️ **Mutations are proved by MOVING the source, never by `git checkout`** — `feedback_mutation_check_never_git_checkout`. Each of M-1…M-8 is an edit that is measured and then edited back.

---

## 7. ⚠️ The evidence gaps in this packet, stated where they bite

- **The render-cost gap is the one that could hurt a member, and it is total.** No browser run. On
  2026-09-10 a render loop in `hub/` froze navigation app-wide for ~4.5 hours; it was found by a
  member, not by a test, and the fix comments now living at `HubContext.jsx:78-96` and `:99-116`
  are that incident's residue. **CP3 — the first checkpoint that changes what a mounted context
  publishes — must not be approved on source reading.** CP1 is recommended partly because it cannot
  reach this failure class at all: it mounts nothing.
- **No divergence baseline.** §2 point 3 asserts a *possible* second authority. Whether it is an
  actual one is what CP1 measures. Approving CP3 before CP1 would be migrating against a problem
  nobody has sized.
- **No observed desk morning (OI-06).** The premise that a member loads once and reads everywhere is
  a design assertion. If members in fact work one surface at a time, the entire adoption argument is
  weaker and Option 3 (defer) is the right answer.
- **Every size here is a forecast.** No checkpoint has been built. `lesson_an_acceptance_number_is_a_forecast_until_derived`.
- **No test was run.** Every rail named — `frozenWorkspace.test.jsx`, `drillWorkspace.test.jsx`,
  `useAppFocus.test.js` — is cited by its source. Whether it currently passes is **not measured**.
- **No git.** `origin/master @ ffa8102c7` is the label the task supplied; source was read from the
  `s7-price-level` worktree and the equality was not verified.

### 7.1 The Δ3 correction, since it changes a size in the plan of record

`10-roadmap/2026-09-12-build-day-plan.md:224` sizes S4 CP1 as an **L** on the grounds that
*"62 files reference `WorkspaceContext`, 22 reference `ChartsSymContext`."* Re-measured:

- **Both numbers reproduce exactly** — `grep -rl` returns 62 and 22 — and **neither is a consumer
  count.** 62 = 50 importers + 5 test files that only `vi.mock` the path + 6 files whose only
  occurrence is inside a comment + the definition file. 22 = 9 + 11 + 1 + 1.
- **Non-test importers: 34 and 8.** **Files that actually READ the context: 23 and 2 — 24 distinct
  product consumers**, of which **18 already have a sibling test file** and 6 do not.
- ⇒ **A per-consumer snapshot suite is an M, not an L.** Δ3's instinct — that the checkpoint shape
  implied a size the count contradicted — was right; its number was measured with `grep`, and
  `grep` counts prose.
- ⇒ **And it is still not CP1.** That suite is CP6 in §4, positioned immediately before the first
  migration, because a baseline taken long before the change it guards drifts like any other
  artifact.

---

## 8. Recommendation

**Approve CP1, and nothing else, on the S4-A "ratify and adopt" reading.**

It costs two files, migrates nobody, is revertible by `rm`, cannot reach the render-loop failure
class, and buys the single fact this program cannot state today: whether the two live authorities
over the current symbol actually disagree. Everything after it — CP3 in particular — should wait on
that number and on a browser run.

If the owner prefers **S4-A Option 3 (defer)**, that is a defensible reading of the same evidence
and this packet does not argue against it: nine mechanisms have coexisted for months, the ruling
that matters was made in August, and OI-06 is still open.

⛔ What this packet asks the owner NOT to approve today: a channel system, a payload taxonomy,
replay-on-join, the retirement of `useChartsSym`, a timeframe authority, or "build S4".
