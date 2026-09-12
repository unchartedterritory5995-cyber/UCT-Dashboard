---
id: GATE-S4-CONTEXT-BUS
title: S4 — Context Bus — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ⛔ UNAPPROVED. No approval line exists. Nothing in this packet is authorized.
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

# ⛔ UNAPPROVED — S4 Context Bus pre-implementation gate

## ⛔ APPROVAL

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ## ⛔⛔ NOTHING IN THIS PACKET IS AUTHORIZED.
>
> The approval block above is empty and that is its correct state today. No file may be created,
> edited or deleted on the strength of this document. The checkpoints in §4 exist so that a future
> approval line can NAME one — an approval reading "build S4" would authorize a scope nobody has
> bounded, which is the defect the D2 packet's §2 note records. A line naming **CP1** authorizes
> CP1 and nothing after it.

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
