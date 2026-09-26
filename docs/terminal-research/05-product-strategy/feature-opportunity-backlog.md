---
id: F-05-BACKLOG
title: Feature Opportunity Backlog — everything this product could build, each traced to the evidence that suggests it, sized, and stated so a human can pick from it
role: >
  Gate item 16 — MASTER_CHECKLIST item 16 ("Feature Opportunity Backlog",
  `05-product-strategy/feature-opportunity-backlog.md`, owners F-05 + A-03, status NOT STARTED
  before this file). ⚠️ The dispatch calls it "gate item 16"; `MASTER_CHECKLIST.md`'s own Gate
  column reads **13** for both item 16 and item 17. Both are recorded; neither is reconciled here.
  ⛔ This file enumerates and traces candidates. It does NOT rank, score, sequence or pick an MVP —
  item 17 (`05-product-strategy/feature-scoring.md`, NOT STARTED) owns all four and will be written
  from this output.
wave: 4
group: F
category: product-strategy
inputs: >
  `05-product-strategy/capability-matrix/best-of-breed.md` (F-05, item 10 — §1, §3.3, §3.4, §3.6,
  §4, §5, §6.1, §6.2, GAPS) · `05-product-strategy/anti-patterns.md` (F-01, item 11 — §0, §1, §2.4,
  §2.6, §2.7, §2.8, §3, §4, §5, §6, GAPS) · `01-existing-system/capability-ledger.md` (F-03a, the
  row-by-row "what exists today", incl. §R) · `05-product-strategy/capability-infrastructure-matrix.md`
  (WS-CAPINFRA — the row spine; every capability letter in this file is one of its rows) ·
  `05-product-strategy/product-architecture.md` (§4.2 the map, §5/§6 the system catalogue, and the
  four retroactive IMPLEMENTATION RECORDS for S1/S2, S7 Alerts, A8 and I1) ·
  `07-technical-architecture/realtime-performance-architecture.md` (ARCH-07, item 24) ·
  `10-roadmap/observability-plan.md` (ARCH-07-OBS, item 25) ·
  `10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md` (the measured browser run) ·
  `12-decisions/DECISION_CARDS_2026-09-26.md` (CARDS 9–21, incl. **CARD 17**) and
  `12-decisions/DECISION_CARDS_2026-09-25.md` (CARDS 1–8) ·
  `00-program-control/CRITICAL_PATH.md` · `00-program-control/OWNER_INPUTS_REQUESTED.md` ·
  `00-program-control/MASTER_CHECKLIST.md` (rows 15–17) · `00-program-control/RISK_REGISTER.md`
  (R-17, R-18, R-19) · `11-risks-and-open-questions/` (listed: `.gitkeep` only, 0 bytes).
scope: >
  Read-only. ⛔ No git command of any kind was run — SHA not pinned (no git by instruction).
  No network request, no WebFetch, no Railway command, no production call, no test, no script, no
  browser. One file was written: this one. `C:\Users\Patrick\uct-worktrees\_merge-master` was not
  read by this document at all — where a `_merge-master:CLAUDE.md` fact appears it is carried from
  F-01's citation of it, never from a fresh read. Two delegated read-only agents were used: one for
  ARCH-07 and ARCH-07-OBS; everything else was read directly.
confidence: >
  🟢 that every item below traces to the section cited beside it. 🟢 on the "what exists today"
  column wherever it restates a `capability-ledger.md` row id or a product-architecture
  IMPLEMENTATION RECORD. 🟡 wherever an item composes two artefacts into one statement, and on
  every size band without exception — a band is a judgement about shape, not a measurement.
  🟡 on the four items whose current state rests on a CLAUDE.md fact carried at one remove through
  F-01. 🔴 on anything about the running service: nothing was probed, so every "today" is a claim
  about a worktree at a date.
evidence_ceiling: >
  ⛔ THE CEILING THAT MATTERS: **this document opened no source file under `api/**` or `app/**`,
  and no `file:line` here was resolved by this document.** Every code address is carried from a
  programme artefact that measured it on a stated date. F-01's PROD-6 records seven of nine spec
  citations moving in two days, and ARCH-07-OBS §1 records two artefacts citing
  `api/main.py:3639-3644` for a comment that actually sits at `:4510`; this file inherits that decay
  at one further remove. ⭐ Treat every address here as *where the cited document found the thing*.
  SECOND CEILING: **no competitor product was used and no dossier was opened by this document.**
  Every competitor mechanism arrives through `best-of-breed.md`, whose own ceiling records that no
  product in the benchmark universe was observed running and that twelve of fifteen were never
  logged into; §2.8 of `anti-patterns.md` reaches its dossiers through a further delegated read.
  So a "mechanism worth copying" here is at three to four removes from the vendor.
  THIRD CEILING: **the capability ledger is as of 2026-09-02** and at least four of its cells are
  now superseded (see §2.4); where this file uses a ledger row it says so, and where a later
  artefact corrects one it carries the correction with a ⚰️.
  FOURTH CEILING: **no telemetry, no usage data and no member research.** OI-21's five queries were
  run once (2026-09-14) and their populations are existence-checks, not rates — `page_views` 4,949
  rows, `calendar_seen` 16, `calendar_alerts_fired` 956, `ai_search_log` 79, 17 stored layouts.
  Nothing below is evidenced by a member asking for it. The one exception is recorded per item.
status: draft
date: 2026-09-26
---

# Feature Opportunity Backlog

## 1. Headline — the three most consequential opportunities

⛔ **"Consequential" is not "highest-priority", and this distinction is the whole reason this
section is allowed to exist.** Consequential here means *"the most other items change depending on
whether this exists"*. Priority is a function of value, urgency, effort and owner intent, and
**item 17 (`feature-scoring.md`) owns it.** Nothing in this section is a recommendation to build,
and the ordering H1–H3 is not a ranking of anything.

**H1. The per-ticker history join (`FB-A13-01`) — the only capability in this programme's evidence
base where UCT can be first rather than behind, and it is blocked on a system nobody has started.**

`best-of-breed.md` §1 H3(b) names it as one of two rows with **no incumbent at all** across fifteen
products — *"what the wire said, what the setup did, what the book did, what flow did, what the
member said"* — and records that *"several concede they structurally cannot"* have it (SpotGamma
"never sees a fill"; Quartr has no price context). `capability-infrastructure-matrix.md` A13 calls
it **"the single most consequential normalization item in this entire matrix"**, and its D2 row
says A13's join is **"blocked entirely on this system existing"**. ⭐ The consequence that makes it
H1 rather than a wish: it is *buildable entirely on data UCT already owns* (best-of-breed §6.1
item 4) — so what stands between the product and its only uncontested differentiator is a
data-modelling deliverable (`FB-D2-01`), not a vendor, a licence or a discovery.

**H2. One shell-level freshness authority and one provenance renderer (`FB-S8-01`, `FB-S8-02`) —
because every panel item on this list inherits them, and both primitives already exist.**

ARCH-07 §3 Q3 leaves the freshness contract **OPEN** and its §4 D8 rules that *"one shell-level
freshness authority"* is required, because *"per-chart hysteresis is right for one chart and wrong
for twelve"*. F-01's PROD-C7 records that `provenance/FreshnessBadge.jsx`, `freshnessContract.js`
and `sessionStale.js` **exist** and that ⛔ *"nothing asserts that every panel uses them"*. S8 is
simultaneously one of the five rows where UCT is **closest** to best-in-class (best-of-breed §6.1
item 3 — the COT grounding gate *"fails closed"*, which Bloomberg's own dossier calls *"the stronger
version"*), which is what makes this the cheapest large distance on the board: the work is
**consolidation, not new capability**, and it is the difference between a terminal whose numbers can
be audited and one whose numbers become consensus (F-01 PROD-C5, PROD-C8).

**H3. The measurement floor (`FB-OBS-01` … `FB-OBS-04`) — without it, no item below can be said to
have worked.**

Four measured facts, each from a document hours old. (a) CARD 16 replaced an unusable warm-ratio
gate with **p95 ≤ 250 ms**, and ARCH-07's GAPS records ⛔ *"No p95 anywhere… The gate is therefore
specified and not yet measurable"*; ARCH-07-OBS G-2 confirms it with a control — *"Nothing in the
serving process computes a latency percentile for any surface."* (b) `bars_dropped_total`,
`fh_budget_denied_total` and `/api/admin/bars-stream-status` exist and **nothing reads them on a
schedule** (ARCH-07 §3 Q10; ARCH-07-OBS G-1 measures the read side as *"none in this repo"*).
(c) The web pod leaks **+7.9 MB/min, monotonic across quartiles, 76 `[mem]` samples over 104
minutes** (ARCH-07 §2.2) — and ARCH-07-OBS G-3 reframes that precisely: *"That is not a memory
finding; it is an observability requirement"*, because a five-minute window on a 26-minute pod read
flat-to-declining. (d) **No signal has a cadence contract**, so ARCH-07-OBS G-7 records that
*"no alert since Tuesday"* and *"the cron has not fired since Tuesday"* are currently the same
observation. ⭐ Every item in this backlog ends with a "how you would know it worked" field. Four of
those fields are currently unanswerable for measurement reasons alone, and this is why.

⚠️ **The single most *actionable* item is none of the three.** It is `FB-A10-03`:
`/api/schwab/market-narrative` returning **1 KB in 20,768 ms cold and 7,531 ms warm**, with a
`stall` of 2 ms both times, on a member-facing page's load path
(`evidence/2026-09-26-protocol-c-and-gridspike/results.md` §2.4, which calls it *"a standalone
defect… the single most actionable thing this run found"* and records that it *"does not need any
further research to act on"*). **Actionable, consequential and high-priority are three different
axes, and only the first two are this document's to speak to.**

---

## 2. Method — where the items came from, and the three filters each one passed

### 2.1 The four seams, and which produced what

| Seam | What it yields |
|---|---|
| best-of-breed §6.1 (five closest) + §6.2 (five largest gaps) | a *named mechanism* per row — buildable, not aspirational |
| best-of-breed §4 (nine contested rows) + §3.3/§3.4/§3.6 (mechanism notes, incl. the three declared extension rows X1–X3) | an opportunity wherever "best" is unsettled, and the runner-up mechanism where it is cheaper |
| capability-infrastructure-matrix (the 33-row spine) — BACKEND WORK, FRONTEND WORK, NORMALIZATION NEEDED, REMAINING GAP | the consolidation and normalization items nobody markets |
| ARCH-07 + ARCH-07-OBS + the 2026-09-26 browser run | concrete engineering work with a measurement attached |
| `capability-ledger.md` row limits · the four product-architecture IMPLEMENTATION RECORDS · the decision cards | the residual, and every ⚰️ in §2.4 |

⛔ **Deliberately no per-seam item count.** Most items draw on two or three seams at once — that is
the point of §2.1's ⭐ below — so any split would be a judgement typed beside a list, which is DOC-1
in the one document whose §2.2 makes DOC-1 a filter. The **total** is machine-counted (§2.5); the
attribution is not mechanically countable and is therefore not stated as a number. Every item names
its sources inline; an item with no source is in the appendix (§6), which states its own size.

⭐ **The richest seam was not the competitors.** It was the intersection: where best-of-breed names
a mechanism *and* the capability matrix already names a seam for it, the item writes itself and
carries both a shape and a place to put it. Fourteen items are of that shape and they are the ones
whose "how you would know it worked" field was easiest to fill — which is itself a signal about
which items are real.

### 2.2 ⛔ The negative filter — `anti-patterns.md` as a veto, applied per item

Every item carries an **Anti-pattern risked** field. It is never "none" by omission: it either names
an entry from F-01's library and says why the item is worth it anyway, or it states that F-01's
library records no entry this item walks into. **Items were removed by this filter, not merely
annotated**, and the removals are in **§4** with their reasons. Three of F-01's entries did the most
work here:

- **DOC-1** (a hand-typed count or roster beside the artifact that owns it) — F-01 ranks it the
  anti-pattern Terminal-Next is *most likely to commit*, because *"Terminal-Next is a panel registry
  plus a panel contract, which is to say it is a product made almost entirely of rosters"*, and
  records the programme committing it twice in `MASTER_CHECKLIST.md` itself. **Consequence for this
  file:** every item whose deliverable is a list (a keyboard registry, an endpoint whitelist, a
  holiday calendar, a per-surface capability matrix, a published address space) says in its
  observable that the list must be **generated or derived**, never typed. Six items say it.
- **PROD-4 / PROD-C1 / PROD-C5 / PROD-C7** (collapsing three outcomes into two; a hard cap with no
  meter; a published number with no derivation; mixed freshness disclosed in a FAQ) — these four
  turned five items from "add a surface" into "add a surface *plus* the receipt that makes it
  honest", which is a materially different size band.
- **STATE-1…6 and the half-ship** — F-01 §4 row 3 records that C5-03 §5 sequences the workspace
  store as *stamp a version now, build the store later*, and quotes §5.2: *"anyone who ships step 1
  and stops has left the board on a store whose own repo documents why it is wrong for this."*
  **`FB-S5-01` is therefore written as one item with two halves and an explicit refusal to be split**,
  because splitting it is the recorded failure mode.

### 2.3 ⛔ The one-paid-tier filter — CARD 17, and it removed more than it looks like it would

The owner's ruling, verbatim, 2026-09-26, `DECISION_CARDS_2026-09-26.md` CARD 17: **"there is one
paid tier only that is it."** The card spells out the foreclosure: *"No tier-comparison surface,
ever. With one paid tier there is nothing to compare: no pricing table, no upgrade affordance, no
locked-behind-a-higher-tier state, no per-tier entitlement rows. A design leaving room for a second
tier is carrying dead weight."*

**Applied as a hard test on every candidate: could this item's justification be written as "and
removing the limit is what the higher tier buys"? If yes, that half is dead and the item either
survives on its own merit for the one paid member or it is not here.** Four consequences, each
recorded where it bites:

1. ⚰️ **`FB-A10-01` lost half of its own source sentence.** best-of-breed §6.1 item 1 prescribes
   SpotGamma's assumption label for GEX and then says *"and make removing it the upgrade. That is a
   tooltip and a tier boundary, not a build."* **There is no tier to upgrade to.** The label
   survives — as an honesty mechanism under PROD-C5, which is a stronger justification than the
   upsell was — and the tier boundary is struck. This is the cleanest demonstration in the file that
   CARD 17 is a sharper filter than it sounds.
2. ⛔ **best-of-breed §5's whole third conclusion is out of scope as a proposal.** Its *"tier on the
   quality of the model, not the size of the dataset"* — drawn from SpotGamma's Essential-ships-the-
   assumption / Alpha-removes-it ladder — is a finding about other firms' price ladders. §5 already
   says so (*"⛔ None of this is a proposal: UCT's tiering is owner-bound"*), and CARD 17 closes it.
   **No item below proposes a metered capability.**
3. ⭐ **It makes `FB-I1-04` (member-visible AI meters) *more* necessary, not less.** F-01's PROD-C2
   is *"capping to zero at a tier without saying why"*; with one tier there is no "why" available at
   all, so a cap the member cannot read has no explanation anywhere in the product. The meter is
   the only honest lever left, and R-18 records the exposure it meters: per-user AI caps summing to
   about **$650 per member per month** against list ARPU, with Compass chat carrying **no
   population-level cap**.
4. ⚠️ **It partially answers a blocker another card still cites as open.** CARD 4 (2026-09-25) rules
   A14 Portfolio & Risk out of this programme because everything past the shipped `/portfolio-heat`
   door is *"gated on S9 Entitlements (not built, a business decision about tiers)"*, with the
   re-open trigger *"an entitlements decision (tiers exist and S9 gets a gate)"*. **CARD 17 settles
   the tier count.** ⛔ It does not fire the trigger — S9 still has no gate, D8 is unlifted, and
   CARD 17 itself says price, trial and seat model remain undecided — but the *tier-count* half of
   CARD 4's blocker is answered and should stop being cited as open. **Labelled: this is my
   inference across two cards, not a ruling in either.**

### 2.4 ⛔ How I avoided proposing something that already ships — and the four ⚰️ it produced

This is the error the dispatch named as most likely, and it very nearly happened four times. The
check was: **for every candidate, look for it in `capability-ledger.md` by row, then in
`product-architecture.md`'s four retroactive IMPLEMENTATION RECORDS, then in the decision cards' own
"done" amendments.** The ledger alone is insufficient — it is dated 2026-09-02 and three of these
four corrections postdate it.

⚰️ **1. The command palette is not absent.** `capability-ledger.md` §R lists it among *"the platform
primitives D-06 §8 names absent (command palette, form controls, formatter module, freshness
badge)"*. `product-architecture.md`'s S1/S2 IMPLEMENTATION RECORD records `CommandPalette.jsx`
(450 lines) **PROVISIONAL-SHIPPED 2026-09-03** in two commits, live in production, keeper by owner
ruling 2026-09-11, *"load-bearing for four other workstreams"*. **So no item below proposes building
a palette.** `FB-S2-01` proposes the registry the palette shipped without, which is what
best-of-breed §6.2 item 1 actually prescribes: *"the keyboard registry **before** more palette"*.

⚰️ **2. The freshness badge is not absent either.** Same ledger §R list; F-01 PROD-C7's detector
field records `provenance/FreshnessBadge.jsx` + `freshnessContract.js` + `sessionStale.js` as
existing. **So `FB-S8-01` is a rail-and-adoption item, not a build item** — and that is a different
size band. (Of §R's four "absent primitives", **two have shipped and two have not**: the formatter
module is still absent — 118 files define their own `fmt*` — and so is the form-control layer, where
ledger N12 records that *"`docs/ui-consistency-audit.md` claims one — FALSE"*. Those two are
`FB-S10-02` and `FB-S10-03`.)

⚰️ **3. Per-widget error boundaries exist, and the cap exists too.** Ledger C1 carries
*"🔴 **no per-widget error boundary** (TD-02)"* and the capability matrix's S1 row still prescribes
*"add a per-widget error boundary ('cheapest fix in the estate', TD-02)"*. F-01 §4 row 2 records
that C5-03 §6 **corrected this against shipped code on 2026-09-25**: `ErrorBoundary` wraps
`WidgetBody` at `WidgetHost.jsx:107-111`, the header renders **outside and before** it at `:227`/
`:254`, and `PANEL_MOUNT_CAP = 3` sits at `ChartsWorkspace.jsx:84`, all in `424bf3355`, an ancestor
of `origin/production`. **So `FB-S1-01` is the residual gap (the header is outside the boundary),
not the boundary**, and `FB-S1-02` is the bound that genuinely does not exist — ARCH-07 §3 Q1:
*"`PANEL_MOUNT_CAP` caps concurrent MOUNTS, not board size — there is no `MAX_WIDGETS`."*

⚰️ **4. The AI print explainer is mounted.** F-01's REACH-2 (written 2026-09-26) names
`FlowExplainButton.jsx` + `FlowExplainModal` as a *"complete, 9/9 tested"* UI *"deliberately not
imported (PACKET-AA CP1)"*. `DECISION_CARDS_2026-09-25.md` CARD 8's same-day amendment records A10
CP2 landed, was rolled back under H15, was **exonerated by a controlled comparison** (the reverted
build failed identically at the same pod age), and *"The owner pushed it at 17:27:25Z; LIVE as
`7878374fb` (SUCCESS 17:30:04Z)… **CARD 8 is done.**"* **"Mount the print explainer" is therefore
not a backlog item**, and an F-01 entry one day old already reads stale on this one. ⭐ That is the
strongest available argument for doing this check against the cards and not only against the ledger.

### 2.5 Counting discipline

⛔ No count in this file is typed beside the artefact that owns it. Every item count in §3, §5 and
§6 was produced by `grep -c` over **this file** after it was written, and the pattern is stated
where the count appears. Counts carried from other documents (178 ledger rows, 33 taxonomy rows, 65
anti-pattern entries, 91 status surfaces) are that document's own measurement, cited and never
re-derived here. Where an item's field quotes a number, the number is quoted from the artefact that
measured it, with the artefact named.

**The item count, and how it was produced.** Run over this file after writing:
`^#### (FB-[A-Z0-9]+-\d+)` matched on every item heading, grouped by the taxonomy row embedded in
the id, with a duplicate check on the id list. Result: **85 items, 0 duplicate ids**, distributed as
below. ⚠️ The per-section totals are that same run's grouping summed per section, not a second
count.

| § | Family | Items | Per row |
|---|---|---|---|
| 3.1 | Edge and chrome | **12** | S1 3 · S2 4 · S10 3 · S12 2 |
| 3.2 | Market, price, positioning | **11** | A1 1 · A2 **0** · A10 6 · A11 4 |
| 3.3 | Research and documents | **17** | A3 2 · A4 1 · A5 4 · A6 2 · A7 2 · A8 3 · A9 3 |
| 3.4 | The member's own record | **4** | A12 3 · A13 1 |
| 3.5 | Intelligence | **4** | I1 4 |
| 3.6 | Platform core | **16** | S3 1 · S4 2 · S5 2 · S6 1 · S7 3 · S8 2 · S9 4 · S11 1 |
| 3.7 | Data platform | **6** | D1 1 · D2 1 · D3 1 · D4 1 · D5 2 |
| 3.8 | Observability (all S12) | **9** | OBS 1–9 |
| 3.9 | Extension rows (proposed) | **6** | X1 2 · X2 2 · X3 2 |
| | **Total** | **85** | |

⚠️ **Three rows of the 33-row spine carry no item and one is not a row at all** — A2, A14 and E1 are
empty *for stated reasons* (§5), and the OBS items are S12's, not a tenth family. **Coverage of the
spine is therefore 30 of 33 rows, plus the three proposed X rows** — counted from the grouping above
against `capability-infrastructure-matrix.md` §0's own row list, not against a roster typed here.

### 2.6 Item shape, and the field that matters

Every item carries: a stable **ID** (`FB-<taxonomy row>-<n>`, so the row is in the address), a
one-line **statement**, the **capability row** from `capability-infrastructure-matrix.md`'s spine,
**provenance**, **today** (from the ledger or a record, or "nothing"), the **mechanism** where a
competitor's is worth copying, a **size band** with the reason for the band, **depends on**, the
**anti-pattern risked**, and **known it worked**.

⭐ **The last field is the one to get right, and where it cannot be filled the item says so rather
than inventing an observable.** Measured over this file by grepping each item's `Known it worked.`
field: **one** item says *"No observable stated"* outright (`FB-S10-03`, where nothing in the inputs
measures the defect), and **five more** name a fixture or measurement that does not exist yet —
`FB-A5-04`, `FB-S5-01`, `FB-S9-04`, `FB-OBS-01`, `FB-X3-02`. ⚠️ **That grep is a floor, not a
census:** an observable can be unreachable without the field admitting it, and every item depending
on `FB-OBS-01` inherits its unmeasurability without restating it. That is deliberate: F-01's GATE-6
is *"a rule stated in a document that no check enforces"* and PROD-6's rail header is the sentence
this file was written against — *"The fix was a paragraph in an architecture document. **A paragraph
cannot fail, so it is not a boundary.**"*

⚠️ **Size bands are S / M / L / XL and never a number of days.** The band is a claim about *shape*:
**S** = one surface or one constant, no new store, no new contract · **M** = a new module or a
migration of known call sites, one contract, existing data · **L** = a new system or a
cross-cutting migration with a store change · **XL** = a new system that other systems must be
rewritten against. No band is a measurement and none should be read as an estimate.

---

## 3. The backlog

Grouped by the taxonomy `capability-infrastructure-matrix.md` §0 owns — Edge/Chrome, Applications,
Intelligence, Platform Core, Data Platform — plus the **three extension rows X1–X3 that
`best-of-breed.md` §3.6 declares** (and explicitly declares as proposals to that file, not edits to
it). ⛔ No parallel taxonomy is invented here. An observability sub-section (§3.8) collects the
ARCH-07-OBS signals, which all belong to **S12** but read better together than scattered.

### 3.1 Edge and chrome — S1, S2, S10, S12

#### FB-S1-01 — Bring the panel header inside the per-widget error boundary
- **Statement.** The widget header renders outside and before the `ErrorBoundary` that wraps the widget body, so a header-side throw is still unbounded.
- **Row.** S1 Terminal Shell & Workspace.
- **Provenance.** `anti-patterns.md` §4 row 2, citing C5-03 §6's 2026-09-25 correction against shipped code: `ErrorBoundary` wraps `WidgetBody` at `WidgetHost.jsx:107-111`; the header renders *"outside and before it at `:227`/`:254`"*, in `424bf3355`.
- **Today.** The body boundary ships. ⚰️ `capability-ledger.md` C1 (*"🔴 no per-widget error boundary (TD-02)"*) and `capability-infrastructure-matrix.md` S1 (*"add a per-widget error boundary"*) are both superseded on this point; `MASTER_CHECKLIST.md` row 20 still asserts zero boundaries and F-01 §4 row 2 calls that ⛔ ACTIVE.
- **Mechanism.** None external. This is a structural placement, not a design to copy.
- **Size.** **S** — a JSX move plus one test; no store, no contract, no new data.
- **Depends on.** Nothing.
- **Anti-pattern risked.** None in F-01's library. It closes DOC-4 exposure (a record that was true when written standing in for a live obligation) by making the checklist row's claim resolvable.
- **Known it worked.** A fixture whose header throws renders the boundary's fallback rather than unmounting the board — and the fixture must be seen to fail without the fix (GATE-1).

#### FB-S1-02 — Publish a board-size bound, and then choose the number
- **Statement.** Nothing in the product bounds how many panels a board may hold; `PANEL_MOUNT_CAP = 3` bounds concurrent mounts only.
- **Row.** S1.
- **Provenance.** ARCH-07 §3 **Q1** — *"OPEN, and it is the binding one"*: *"`PANEL_MOUNT_CAP` caps concurrent MOUNTS, not board size — there is no `MAX_WIDGETS` — so nothing in the product currently bounds how much a board may hold."* ARCH-07 §6.1: *"It is a product decision and it blocks D4 and D10."*
- **Today.** `GRID_MAX_CELLS = 16`, `PANEL_MOUNT_CAP = 3`; ledger C1 records *"no widget-count cap or mount queue (geometry is the implicit bound)"*.
- **Mechanism.** Bloomberg's Launchpad publishes a Component Browser and a Group Manager rather than a hard ceiling (best-of-breed §3.4 S1); SpotGamma is the warning — *"per-component instance caps"* arriving after the tools.
- **Size.** **S** to enforce a bound; the *number* is not an engineering item at all. ARCH-07 §3 Q1: CARD 15 ruled an absolute production capacity number out of scope, *"The number still has to be chosen by a person."*
- **Depends on.** ⛔ A person choosing it. The obtainable inputs are the relative 1→N panel curve and the per-panel cost from CARD 15's sandbox (`FB-OBS-07` supplies the window).
- **Anti-pattern risked.** **PROD-C1** — a hard cap with no meter. ⭐ Worth it anyway *only* if the cap publishes itself at the point of use: the measured 16-cell board costs *"~218 MB transiently and ~45 MB durably"* (`results.md` §1), so the bound is real, and F-01's rule is that the gauge ships with it.
- **Known it worked.** Adding panel N+1 says why it was refused, in rendered text (PROD-2's copy contract), and the relative 1→N curve exists to justify N.

#### FB-S1-03 — Promotion: make the panel set a by-product of the surface set, not a hand-curated registry
- **Statement.** Any page-shaped surface can be promoted into a panel (and demoted back) through one `registerPanel(manifest)` contract, so the registry stops being the bound on what a board can hold.
- **Row.** S1.
- **Provenance.** best-of-breed §3.4 S1 mechanism: *"`LLP` promotes almost any function into a workspace component, **so the widget set is a by-product of the function set rather than a hand-curated registry.** That is the structural difference from UCT, whose `WIDGET_REGISTRY` is a hand-maintained 18 types (`ledger C2`)."* F-01 §4 row 1 quotes C5-03 §4 commitment 1: *"the number of registry entries must stop being the bound on what the board can hold."* `capability-infrastructure-matrix.md` S1 FRONTEND WORK: *"Build `registerPanel(manifest)` on the existing widget-registry shape (C2 — 'adopt as the panel manifest; add `menus.terminal`'); promote/demote between page and panel; pop-outs."*
- **Today.** Ledger C2 — a metadata-only, deep-frozen registry of 18 types with `paramsSchema`, durability regimes and per-shell `menus` flags, with the host binding map pinned by `registry.test.js`. Ledger C9 records the *other* way of doing this (`embedded` pages as widgets) as **avoid**: *"20-prop signatures; the pattern was abandoned after two uses"*.
- **Mechanism.** Bloomberg `LLP` + the Component Browser. ⚠️ best-of-breed records ◻ that whether a Bloomberg View spans displays is NOT DETERMINED, so the multi-monitor half of that row is not what is being copied here; UCT's pop-out portal (ledger C5, *"the multi-monitor story at zero backend cost"*) already holds it.
- **Size.** **L** — a new contract every application must honour, plus a migration path for 18 existing types and the abandoned `embedded` pattern.
- **Depends on.** `FB-S5-01` (a panel instance is a saved object, so the document shape binds it) and `FB-S4-02` (a panel declares a need, never owns a transport).
- **Anti-pattern risked.** **DOC-1** head-on — this is the item F-01 warns about by name. ⛔ Worth it only if the manifest set is **derived from the surfaces** and `registry.test.js`'s pinning is extended rather than replaced; a hand-maintained promotion list is the same defect with a new name.
- **Known it worked.** A surface not in today's 18 mounts as a panel with zero registry edits, and the existing binding-map test still pins host↔registry with a control proving it can fail.

#### FB-S2-01 — The keyboard registry, before any more palette
- **Statement.** One frozen, `code`-based keyboard declaration set with a duplicate-binding rail, replacing 87 raw `keydown` listeners.
- **Row.** S2 Command, Search & Navigation.
- **Provenance.** best-of-breed §6.2 item 1 — S2 is *"the best-evidenced row in this file"*, and its prescribed order is *"the keyboard registry **before** more palette (frozen `code`-based declarations with a duplicate rail), then one resolver, then a published address space"*, with ⛔ *"Closable by engineering alone — no vendor, no licence"*. `capability-infrastructure-matrix.md` S2 BACKEND WORK says the same: *"build the keyboard registry (frozen `code`-based declarations replacing 87 raw `keydown` listeners, TD-07) before the palette."*
- **Today.** No registry. The palette shipped without one (§2.4 ⚰️ 1), on an estate best-of-breed §6.2 measures as *"87 raw `keydown` listeners and four independent ticker resolvers"*.
- **Mechanism.** Bloomberg's enforced type system — *"`YA` on an index errors rather than rendering something plausible and wrong"* — and `Number <GO>` giving every list row a keyboard address (best-of-breed §3.4 S2).
- **Size.** **M** — one module plus a migration of a known, countable set of call sites, plus a rail. No new data, no vendor, no owner input.
- **Depends on.** Nothing. ⚠️ OI-06's answer is in (thinkorswim, TradingView, Finviz and Unusual Whales all opened by hand; TradingView alerts in the workflow) and the S1/S2 record says its findings get **diffed against what shipped** into a rework list — that can change the *palette*, not the need for a registry.
- **Anti-pattern risked.** **DOC-1** (the registry is a roster) and **GATE-2** (three copies of one guard). ⛔ Worth it anyway because the alternative is 87 uncoordinated authorities; the mitigation is that the duplicate rail must be **derived from the declarations** and must be seen to fail on an added duplicate.
- **Known it worked.** An AST-derived census of raw `keydown` listeners outside the registry, railed at a stated ceiling with a control; and a deliberately duplicated binding turns the rail red.

#### FB-S2-02 — One ticker resolver
- **Statement.** Four independent ticker resolvers collapse to one, with `_extract_tickers`' three-tier precedence as the surviving authority.
- **Row.** S2.
- **Provenance.** `capability-infrastructure-matrix.md` S2 NORMALIZATION NEEDED: *"One shared ticker resolver (`_extract_tickers`'s three-tier precedence, D-12 §3e) replacing four independent resolvers today (TD-20)."* best-of-breed §6.2 item 1 sequences it second.
- **Today.** Four resolvers (best-of-breed §6.2 item 1). Ledger K2 records `_extract_tickers` at `ai_search.py:731`.
- **Mechanism.** Quartr's published discipline — ticker as ambiguous user input, disambiguate by exchange (best-of-breed §6.2 item 2, quoted for S3 and applying here).
- **Size.** **M** — one module, four known call-site families, and a behavioural-parity test per family.
- **Depends on.** Nothing hard. `FB-S3-01` would make it resolve to an entity rather than a string, but the collapse is worth doing first.
- **Anti-pattern risked.** **DOC-2** (a second authority over one value) is exactly what it closes. ⭐ F-01's structural fix applies: derive one from the other and **prove it by moving the source**, not by a comment claiming agreement.
- **Known it worked.** An AST rail naming any second resolver, with a control; and a fixture ticker with a known-ambiguous resolution returns the same answer from all four former call sites.

#### FB-S2-03 — A published address space: saved things become names
- **Statement.** Every saved object — board, screen, watchlist, definition, note, chart — gets a stable name that is typeable in the palette and resolvable anywhere, and the address set is generated from the object registries.
- **Row.** S2 (with S5 as the store).
- **Provenance.** best-of-breed §1 H1 — the convergence *"five Bloomberg leaves reached independently without seeing each other's files: **saved things become names, and names are addresses** — a chart titled 'Graph 53' *is* the function `G53`; a saved news search *is* `NI BUFFBALL`; a saved screen *is* `=BEQS('name')`"*, with ⭐ *"That costs engineering, not licence fees."* §6.2 item 1 sequences it third.
- **Today.** Nothing general. Two partial seeds: ledger G3's `defId@version` addressing (*"the strongest persistence design in the repo"*) and CARD 3's shipped `/charts?openWatchlist=<watchKey>` plus `?openLayout=`/`?openShared=` doors — *"a real address in the same shape as the layout doors"*.
- **Mechanism.** Bloomberg's, above. ⭐ Plus Gödel's, which best-of-breed §3.4 S2 says Bloomberg does **not** hold: *"the command string is reused as an *interchange format*, `{AAPL EQ G}` resolving identically inside a chat message, a changelog pill and a bug-report launcher."*
- **Size.** **L** — it is a naming contract across every saved-object type plus a resolver plus deep-link generation, and it is the thing `FB-S2-04` is built on.
- **Depends on.** `FB-S5-01` (one versioned document per saved object), `FB-S3-01` for entity-shaped addresses, `FB-D2-01` for metric-shaped ones.
- **Anti-pattern risked.** **DOC-1** — an address list is a roster. ⛔ The item is only worth building if the address set is **enumerated from the object registries**, with a rail that fails when a saved-object type has no address.
- **Known it worked.** Typing a saved object's name in the palette opens it; and the rail enumerates saved-object types from the registries and fails by name on one without an address.

#### FB-S2-04 — The command string as an interchange format
- **Statement.** An address pasted into a member-visible text surface (a Floor post, a note, a support ticket) resolves as the same object it resolves to in the palette.
- **Row.** S2 (consumed by X1).
- **Provenance.** best-of-breed §3.4 S2, on why Gödel is runner-up and not an also-ran: *"it holds one mechanism Bloomberg does not… `{AAPL EQ G}` resolving identically inside a chat message, a changelog pill and a bug-report launcher. One grammar, addressable from anywhere that renders text."* Adjacent: §3.6 X1's Bloomberg IB mechanism — *"structured data links turn a mentioned ticker into a route back into a Terminal function, so the chat transports **objects** rather than text."*
- **Today.** Nothing. Ledger M1 (The Floor) renders text; ledger J2 (Notebook) stores widget embeds by verbatim `paramsSchema` params, which is the closest existing thing and is a *different* mechanism.
- **Mechanism.** Gödel's, above — and it is the cheap half of X1. ⛔ F-01/best-of-breed N4 binds on the expensive half: *"Building an IB-shaped widget only the desk is on reproduces the form of the moat and none of its substance."*
- **Size.** **S** once `FB-S2-03` exists — one renderer plus one parser over an address space that already resolves. **L** before it.
- **Depends on.** `FB-S2-03`, hard.
- **Anti-pattern risked.** ⚠️ Ledger J2's recorded hazard applies directly: *"embed params are stored verbatim in every note — renaming a widget type or param orphans member content."* An address embedded in a member's post is the same liability, so the address space must be versioned or alias-mapped from day one (`GOVERNING_PRINCIPLES` §13's no-renaming rule, cited via the capability matrix's A5 row).
- **Known it worked.** A pasted address renders as a resolvable object in The Floor and in a note; and a renamed object still resolves through its alias — proved by performing the rename in a test.

#### FB-S10-01 — Extract the DataGrid seed into S10 before a sixth grid exists
- **Statement.** `VirtualResults` + `columnDefs` + `ColumnDesc` + `liveSort` become a shared S10 `<DataGrid>` with the screener as its first consumer.
- **Row.** S10 Presentation Primitives.
- **Provenance.** `capability-infrastructure-matrix.md` A9 NORMALIZATION: *"Extract `VirtualResults`+`columnDefs`+`ColumnDesc`+`liveSort` (already '~80% of a DataGrid,' TD-06) into shared S10 before building a sixth grid implementation."* Ledger G1's reuse note names them *"the DataGrid seed"*. `product-architecture.md` A9: *"Extend; `VirtualResults`+`columnDefs` are extracted into S10 first or 'make a sixth' (TD-06)."*
- **Today.** Ledger G1 — a virtualized ARIA grid with 157 column definitions, a live overlay, CSV and a coverage receipt, inside `/screener`.
- **Mechanism.** TradingView's *"one engine everywhere"* is the runner-up in best-of-breed §3.4 S10; Bloomberg wins that row on *colour as a type system*, which is a separate item's business.
- **Size.** **M** — an extraction with one behavioural consumer, no store change, no new data.
- **Depends on.** Nothing. ⭐ It is cheapest *before* the first Terminal-Next panel that wants a grid, which is the whole argument in its source.
- **Anti-pattern risked.** **DOC-1** — 157 column definitions are a roster; they must move, not be retyped.
- **Known it worked.** The next result-shaped panel adds zero grid code; and a rail counts grid implementations in `app/src` and fails on a sixth.

#### FB-S10-02 — One `format` module
- **Statement.** One number/percent/date/time formatter replacing 118 local `fmt*` implementations.
- **Row.** S10.
- **Provenance.** `capability-infrastructure-matrix.md` S10: *"no shared format module exists (118 files define their own `fmt*`, TD-08)"*, and its NORMALIZATION cell says *"This system IS the normalization-of-presentation deliverable."* best-of-breed §3.4 S10 carries the same measurement.
- **Today.** Nothing shared. ⚰️ This is one of the two §R "absent primitives" that really is still absent (§2.4).
- **Mechanism.** None external needed. ⚠️ The live hazard is domain-specific and already recorded: ledger H9 — *"`live_map` values are percentages not prices (a −99 % bug class)"*, which is a formatting-contract failure that reached members.
- **Size.** **M** — the module is small; the migration is 118 files and each one is a chance to change a rendered number.
- **Depends on.** Nothing.
- **Anti-pattern risked.** **PROD-2** — every migrated site is a rendered string, so the assertions must be on rendered text, not on the formatter's return value.
- **Known it worked.** An AST census of local `fmt*` definitions, railed at a declining ceiling with a control; and a golden-file test over a fixture of the value classes that have bitten (a percent that is not a price, a negative, a null, a pre-1900 date — ledger A3 records the strftime crash class).

#### FB-S10-03 — A form-control layer
- **Statement.** One set of input, select, checkbox and field-error primitives, because the document claiming one exists is wrong.
- **Row.** S10.
- **Provenance.** Ledger N12: *"no density tokens; **no form-control layer** (`docs/ui-consistency-audit.md` claims one — FALSE)"*. `capability-ledger.md` §R lists form controls among the absent platform primitives.
- **Today.** Nothing. ⚠️ Ledger N12 also records *"no density tokens"*, and the capability matrix's S10 row names *"density tokens"* as part of this system's build — the two travel together.
- **Mechanism.** None named in the corpus. ⚠️ Adjacent warning worth carrying: best-of-breed §3.6 X3 records TradingView's largest Chart help folder as *"'I can't find a certain feature or setting' — 43 articles"*, i.e. *"capability without a findability budget converts into support volume"*.
- **Size.** **M** — a primitive set plus a migration whose call-site count is unmeasured by any artefact this file read.
- **Depends on.** Nothing.
- **Anti-pattern risked.** **DOC-4** is already fired here — a document asserting a layer that does not exist is *"a record that was true when written, standing in for a live obligation"*, or in this case never true. The item should delete that claim in the same change.
- **Known it worked.** ⚠️ **No observable stated.** Nothing in the inputs measures form-control inconsistency, so "it worked" cannot currently be distinguished from "it shipped". The honest first step is a census, which is itself the observable's precondition.

#### FB-S12-01 — The per-user cohort store, the master flag, and a runtime kill switch that is not maintenance mode
- **Statement.** `has_tag` + `require_beta` + one `_access_payload` field + `TERMINAL_NEXT_ENABLED` + `..._BETA_EMAILS`, plus a kill switch that survives a redeploy.
- **Row.** S12 Rollout, Cohort & Observability.
- **Provenance.** Ledger **P6** — the ledger's only **absent · absent** row: *"build once (`has_tag` + `require_beta` + one `_access_payload` field + `TERMINAL_NEXT_ENABLED` — D-10 §5.3)"*, with *"no server→client flag channel; no runtime kill switch short of maintenance mode (TD-11)"*. `capability-infrastructure-matrix.md` S12 BACKEND WORK: *"**New**: server-side per-user cohort targeting; a master `TERMINAL_NEXT_ENABLED` flag plus a beta allowlist the flag ledger can see; **a runtime kill switch that is not maintenance mode**; artifact-first status endpoints."* CP-08 (🟡): *"NO per-user cohort store, so Stage 3 needs one; `entitlements.py` is the natural seat."* Ledger O4 names the shape to inherit.
- **Today.** Ledger P6 absent; ledger O8 — maintenance mode is *"the only runtime kill switch in the product (TD-47)"* and it *"resets on every redeploy (several/day)"*. Ledger O1: *"**no feature-flag toggle exists anywhere in**"* the admin console. `user_tags` is written and read by no gate (best-of-breed §3.4 S12).
- **Mechanism.** best-of-breed puts **Gödel Terminal** best-in-class on this row, for member-facing feature status rather than for cohorting (see `FB-S12-02`). The rollout template is internal: ledger J1/`shellFlag.js`'s rollout-percentage pattern and `BARS_PUSH_ROLLOUT_PCT`.
- **Size.** **M** — one store, one dependency, one client field, one flag pair. ⭐ CARD 17 makes it *smaller* than item 23 assumed: the tier axis collapses to a binary, and *"Cohorts are not tiers. A named cohort inside the single paid tier is still how Terminal-Next ships dark."*
- **Depends on.** Nothing. It gates `FB-S9-*`'s rollout but is not gated by it.
- **Anti-pattern risked.** **GATE-5** (an invented kill-switch name) — the flag and its off-state must be the real names the ledger can see, and ledger O4 records the current ledger as *"stale on all 5 `dark` and 1 `pending` (armed in Railway)"*. Also **GATE-1**: a kill switch nobody has seen fire is not a kill switch. ⛔ And stopping a dark run must never be a delete against member data.
- **Known it worked.** Two accounts, one tagged and one not, see different products; the kill switch is **rehearsed** and the rehearsal is the evidence; and the flag's state is readable from the ledger rather than only from Railway.

#### FB-S12-02 — Member-facing feature status at the point of use
- **Statement.** BETA marks where the feature is, plus a two-column "here today / working on" strip, so a member can tell an unfinished capability from a broken one.
- **Row.** S12.
- **Provenance.** best-of-breed §1 **H2**: *"The best member-facing **feature-status** mechanism belongs to **Gödel Terminal** at $118/month, a self-declared public beta: BETA pills at the point of use on the docs index, plus a two-column 'In Gödel today / Working on' strip a prospect reads before paying (Gödel dossier §M idea 5)."* ⭐ H2's own conclusion is the reason this is cheap: *"Price is uncorrelated with mechanism quality across this set. The correlation is with whether the vendor had to explain itself to a self-serve buyer."*
- **Today.** Nothing member-facing. Ledger N13 records a `ComingSoon` gate on `/` and a `Pricing`/`Compare` set behind it; ledger L3 records creative titles, not feature status.
- **Mechanism.** Gödel's, above. ⚠️ Its own counter-warning travels with it: best-of-breed §3.6 X3's compressed list includes *"don't let 'beta' become a permanent permission-granting label"* (Gödel §N item 1).
- **Size.** **S** — two surfaces and a data source, and the data source should be `FB-S12-01`'s flag ledger rather than a second list.
- **Depends on.** `FB-S12-01` for the honest source of "what is on".
- **Anti-pattern risked.** **DOC-1** — a hand-maintained "working on" strip is a roster beside the flags that own the truth. ⛔ Worth it only if both columns are **derived from the flag ledger**. ⚠️ And CARD 17 constrains the second column: with one paid tier, a "working on" strip must not read as a tier preview.
- **Known it worked.** Flipping a flag changes the strip with no content edit; and a member-visible BETA mark disappears when the flag reaches full rollout, proved by flipping it in a test.
### 3.2 Applications — market, price and positioning: A1, A2, A10, A11

#### FB-A1-01 — An honest blank for futures, instead of an Unsuitable source
- **Statement.** The futures strip renders a named reason rather than a number sourced from an X-class provider.
- **Row.** A1 Markets.
- **Provenance.** best-of-breed §6.2, "Three gaps that cannot be closed at all, recorded so nobody plans against them", (a): *"⛔ **Licensed futures quotes** (A1): yfinance is X-class with 'no purchasable remedy', and the strip should render an honest blank rather than an Unsuitable source."* `capability-infrastructure-matrix.md` A1 records it as class-G and *"the only class-G gap where the CURRENT solution (yfinance) is not merely underused but actively the worst-licensed row in the entire register"*, while noting futures positioning **is** in scope per GOVERNING_PRINCIPLES §13.
- **Today.** Ledger A7 — `/api/snapshot` serves index/ETF/futures, with *"yfinance for NQ/ES/RTY/BTC"* because *"futures not in Massive equities API — yfinance fallback only"*.
- **Mechanism.** Unusual Whales' — best-of-breed PROD-C7 counter-pattern via F-01: **degrade by freshness, not by feature**, with the degraded state stated out loud. And Koyfin's rule, adopted verbatim by F-01 PROD-C7: *"If UCT ever renders a proxy, the proxy's name belongs beside the value."*
- **Size.** **S** for the honest blank — one render path and one sentence. ⛔ The licensed-feed half is **not an engineering item**: it is an owner purchase decision, named as F-09 §6 item 9 BUILD/INTEGRATE and listed as one of only three places the capability matrix §6 says a genuinely new vendor is worth evaluating.
- **Depends on.** `FB-S8-01` for the render primitive, if that lands first; nothing otherwise.
- **Anti-pattern risked.** **PROD-4** — the blank must say *"we do not hold a licensed source for this"*, never *"no data"*. F-01's own generalisation applies: *"rendering that as '0 matches' is a lie a member would act on."*
- **Known it worked.** The strip's rendered text names the reason, asserted as text and not as state (PROD-2); and no yfinance call remains on the futures path, by the AST census shape `test_yf_guard_census.py` already established.

#### FB-A10-01 — The GEX assumption label ⚰️ (and the half of its own source sentence that CARD 17 kills)
- **Statement.** The GEX surface states the assumption its number rests on, at the number.
- **Row.** A10 Options & Flow.
- **Provenance.** best-of-breed §6.1 item 1 — A10 is *"Already the named moat… ✖ Bloomberg ships no flow/sweep/GEX product, ✖ Gödel ships a chain and a pricer"* — and the prescribed mechanism is *"SpotGamma's assumption label. Put 'this number assumes dealers sold every option' in the GEX tooltip"*.
- **Today.** Ledger F6 — GEX walls / dealer positioning / OI change, active, sourced from Schwab chains. ⛔ `schwab_router.py` is **partner-owned** (GOVERNING_PRINCIPLES §5 via the capability matrix's A10 row: *"wrapped, never described or edited"*), so the label belongs on the rendering side.
- **Mechanism.** SpotGamma's. ⚠️ And best-of-breed §4 item 5 bounds what the label can claim: the two dealer-positioning models are *"permanently unrankable on public evidence"* because SpotGamma's Synthetic OI rests on *"multiple new data feeds and proprietary SpotGamma algorithms"*, deliberately undisclosed.
- **Size.** **S** — a tooltip and a copy decision.
- **Depends on.** Nothing. `FB-S8-01` would give it a home.
- **Anti-pattern risked.** **PROD-C5** — it is the *fix* for a published number with no derivation, and F-01 names UCT's exposure on this row as ⛔ ACTIVE and broad. ⚰️ **And the item's own source sentence continues** *"and make removing it the upgrade. That is a tooltip and a tier boundary, not a build."* **CARD 17 strikes that half: there is no second tier to upgrade to.** The label survives on the honesty argument alone, which is the stronger one.
- **Known it worked.** The tooltip's rendered text is asserted; and PROD-C5's own buildable detector — *"a rail asserting that every member-facing score carries a non-null method link, sample window and base rate"* — has GEX as its first case.

#### FB-A10-02 — Retire the yfinance/Black-Scholes chain leg
- **Statement.** One options-chain implementation, on Massive native, with the legacy leg deleted rather than deprecated.
- **Row.** A10.
- **Provenance.** `capability-infrastructure-matrix.md` A10 NORMALIZATION: *"Two chain implementations (Massive native + yfinance/BS legacy) collapse to one — Massive native (F10; provider-master-ledger §3.1 class D, 'the most duplicative column in the matrix'); Polygon-direct retires onto Massive."*
- **Today.** Ledger **F10** — status **duplicated**: *"Massive `/v3/snapshot/options/*` (native) beside yfinance + Black-Scholes legacy… two implementations of one data class; `polygon_*` module names are stale."* Reuse note: *"extend (retire the yfinance leg)"*.
- **Mechanism.** None external.
- **Size.** **M** — a deletion plus a parity check across the surfaces that read a chain, and the Polygon-direct key retirement rides with it.
- **Depends on.** Nothing. ⭐ It is the named first cleanup target of D1's retirement queue.
- **Anti-pattern risked.** **DOC-2** (two authorities over one value) is what it closes; **REACH-1** is the risk if the legacy module is left in place documented as live. F-01's structural fix: one table that is the single owner of the claim, with a derived rail.
- **Known it worked.** The displayed chain's provenance field reads Massive, not yfinance (which is what `FB-D1-01`'s licensing-class stamp makes checkable); and the reachability rail fails by name if the legacy module survives with zero importers.

#### FB-A10-03 — `/api/schwab/market-narrative`: 1 KB in 20.8 s cold, 7.5 s warm ⭐
- **Statement.** One route on a member page's load path takes seconds of server compute to produce a kilobyte, reproducibly, and nothing about it is explained by cold caches.
- **Row.** A10 (the surface is `/options-flow`).
- **Provenance.** `10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md` §2.4, measured in a real foreground browser with `document.visibilityState` verified `visible` throughout: *"`/api/schwab/market-narrative` — **20,768 ms** of server time on the first load and **7,531 ms** on the control, for a **1 KB** response, `stall` 2 ms both times. It is the slowest call in both runs and it is **not** explained by the cold packs, because the control had none."* ⭐ *"That is a standalone defect on a member-facing page's load path, and it is the single most actionable thing this run found."* §2.4 adds a second, smaller instance: *"`/api/calendar` at **4,519 ms** on the control."*
- **Today.** The route ships and is on the critical path. Ledger F2 records the related shape independently: `/options-flow` *"reads `/api/calendar` on its critical path (8,005 ms observed)"*.
- **Mechanism.** None to copy — this is a defect, not a capability. ⚠️ The freshness idiom that makes a slow generated narrative acceptable *if it must be slow* is Quartr's and Fiscal.ai's falsifiable form (best-of-breed §2.5): a promise tied to an external event, not an adjective.
- **Size.** **S to diagnose** — the evidence file says explicitly *"Not diagnosed further here: the cause is in code this run did not read"*, and the name suggests a narrative generation. **Unknown to fix**, and ⛔ `schwab_router.py` is partner-owned, so any change routes through the partner boundary rather than being an ordinary edit.
- **Depends on.** ⚠️ `FB-OBS-01` for a standing measurement; the diagnosis itself depends on nothing.
- **Anti-pattern risked.** **PERF-1**'s sibling rule — *"any NEW blocking external call on the request path MUST have a timeout"* — and F-01's warning beside it that a shared global timeout applied to a lane it was not sized for is its own trap (the Desk `generate_insights` case: a 60 s shared client timeout against a 600k-char transcript). ⛔ So the fix is a lane-appropriate bound plus removal from the critical path, not a global constant.
- **Known it worked.** ⭐ The method already exists and was executed: the same Performance-API read plus a **control second load**, with the call under CARD 16's p95 ≤ 250 ms on a pod ≥ 300 s old. The run's own summary metric — *"calls over 3 s: 10 first load / 2 control"* — is the number to watch.

#### FB-A10-04 — The 31 MB cold-pack load, concentrated in the first two shard requests
- **Statement.** A cold `/options-flow` visit pulls ~31 MB of date-sharded packs whose first two requests cost 8.6–10.9 s of server time each, and on a single-process server everything else waits behind them.
- **Row.** A10 (with D4 Caching & Serving as the mechanism's home).
- **Provenance.** `results.md` §2.2 — *"**The problem is 31 MB of cold packs, and the stall is SERVER-SIDE**"*: `/api/barspack/2026-09-25/hot` 1.37 MB / **10,917 ms**; `/api/intradaypack/.../0` 1.93 MB / **8,575 ms**; shard 1 1.79 MB / **8,650 ms**; *"shards 2 through 15 cost 296–628 ms each"*; ⛔ *"`stall` is 1–3 ms on every single call"* on **HTTP/3**, so it is not client queueing. ⭐ *"That is a server-side cache being built by the first shards and hit by the rest. The cold cost is concentrated in the first two requests, not spread across sixteen."* §2.3's control: pack bytes **31.1 MB → 0 MB**, calls over 3 s **10 → 2**. §2.1: the document itself is not the problem — TTFB 63 ms, DCL 100 ms, FCP 140 ms.
- **Today.** The packs ship and there is no warmer for shards 0 and 1 named in any input. Ledger E11 records the same shape solved elsewhere: the enrichment *"130× cold/warm cliff (17.9 s → 0.14 s) re-armed every 300 s without the warmer"*, and the capability matrix's D4 row calls the serve-stale + warmer pair *"the structural fix"*.
- **Mechanism.** Internal and already proven: ledger O6's `serve_stale.py` / `cache_snapshot.py` / `cache_policy` / `source_circuit_breaker`, *"the most valuable code in `api/`"*, *"currently under-adopted at only 5 consumers"* — which is `FB-D4-01`.
- **Size.** **M** — a warmer for two named shard keys plus adoption of an existing pattern. ⛔ Explicitly **not** an aggregation endpoint: ARCH-07 §4 **D5** rules *"keep per-panel access; do not build a board-level aggregation endpoint"*, with the hazard measured — *"`/api/flow/aggregate` serialises its client-side transform verbatim at 23.83 MB"*.
- **Depends on.** `FB-D4-01`.
- **Anti-pattern risked.** **PERF-3** — the obvious fix (one endpoint that returns all the packs) is the recorded trap, and F-01 quotes its mechanism: *"an aggregation endpoint inherits the slowest panel — its latency is the max of its constituents, and its failure mode is all-or-nothing."*
- **Known it worked.** A cold-pod `/options-flow` load with **no call over 3 s**, measured the way `results.md` measured it — in a visible foreground tab, with a control second load. ⚠️ The evidence file's own GAPS bound this: *"No true cold pass"* (45 of 107 resources came from browser cache) and *"Market closed"*, so the RTH magnitude is unestablished.

#### FB-A10-05 — Ask Massive for a second OPRA connection
- **Statement.** A flow-worker deploy gaps the options tape permanently until the T+1 flat file, and a second connection is the only named fix.
- **Row.** A10 / D3 Realtime Streaming.
- **Provenance.** ARCH-07 §3 **Q9**, OPEN and unchanged: *"D-05 names it twice as the only fix for deploy-swap tape gaps. **No artifact records it being requested.** This is the one question on the list that no measurement can answer and no agent can progress: it needs someone to ask Massive."* Ledger F8: *"deploy-swap gaps are the one class the spool cannot cover — needs a second OPRA connection, **never requested** (TD-32)."*
- **Today.** Ledger F8 — an 8 GB tape spool with gap replay ≤120 min, a freeze watchdog that distinguishes freeze from lag, and T+1 flat-file ingest with gap autofill. ⭐ The resilience is real; this is the one class it structurally cannot cover.
- **Mechanism.** None to copy; it is a vendor request.
- **Size.** **S** engineering (a second consumer slot) behind an **owner action that no agent can take**. ⛔ Recorded here because F-01's DOC-4 class is exactly a known gap that reads as handled because it is written down.
- **Depends on.** ⛔ A human asking Massive. Blocked, and the block is named.
- **Anti-pattern risked.** None in the library. ⚠️ The adjacent live hazard: the market-hours push freeze and its double-lock were **removed 2026-08-24 by owner decision**, so *"nothing mechanical stops a mid-session flow-worker deploy"* (ledger F8's neighbourhood, via the capability matrix's A10 row).
- **Known it worked.** A rehearsed flow-worker deploy during RTH that produces zero gap rows in the tape — and the rehearsal, not the vendor's reply, is the evidence.

#### FB-A10-06 — Confluence Radar: extend or delete (a decision, not a build)
- **Statement.** A complete page sits on a live endpoint with no route, no importer and no allow-list entry; the product owes it a decision.
- **Row.** A10 / A11 (it reads confluence across both).
- **Provenance.** Ledger **G9** — *"**Confluence Radar** — a complete page on a live `GET /api/confluence` with **no route, no importer, no allow-list entry**"*, status **dormant** (RG-09), reuse note *"extend or delete (product decision)"*, with *"the reachability rail would fail on it (CLAIM — suite not run)"*.
- **Today.** As above: built, tested-adjacent, connected to nothing.
- **Mechanism.** n/a.
- **Size.** **S** to delete, **M** to mount (a route, an allow-list entry, an owner decision about whether it is a panel or a page).
- **Depends on.** An owner or product call on whether the capability is wanted. ⚠️ Ledger B8 already ships a `confluence` signature signal, so mounting the page without reconciling the two would create a second authority.
- **Anti-pattern risked.** **REACH-2** exactly — *"a feature built, tested, green, and connected to nothing"*. ⭐ F-01 records the distinction that makes this item legitimate: the anti-pattern is *"unmounted **and unrecorded**"*, and the rail models a third state, `AWAITING_A_DECISION`. **This item's whole content is moving G9 into that state explicitly or out of the codebase.**
- **Known it worked.** Either the reachability rail stops naming it because it is gone, or it names it as `AWAITING_A_DECISION` with a dated owner note — and in the mount case, the signature signal and the page derive from one computation, proved by moving the source.

#### FB-A11-01 — Name ONE regime authority
- **Statement.** Two regime classifiers exist; one is named canonical and the other derives from it or is deleted, before any consumer derives from either.
- **Row.** A11 Breadth, Regime & Positioning.
- **Provenance.** `capability-infrastructure-matrix.md` A11 NORMALIZATION: *"**Two regime classifiers exist today** — engine `market_regimes` vs. the dashboard's own classifier (H6, 'a candidate second authority') — this is a normalization/single-authority problem to resolve **BEFORE** any consumer (verdict engine gate, awareness flip rule, screener bar) derives from either."* best-of-breed §6.1 item 2 makes it a precondition: *"⚠️ First resolve the two-classifier problem (`ledger H6`), because a regime with two authorities cannot have one vocabulary."*
- **Today.** Ledger **H6** — *"engine `market_regimes` (148 rows, phase/trend/dist days/VIX), dashboard regime classifier (15-min cache), awareness regime snapshots"*; reuse note *"extend (name ONE regime authority for Terminal-Next)"*; and *"snapshot table grows ~51 rows/weekday unbounded (TD-33)"*.
- **Mechanism.** None external — but the consumer list is why it is urgent: `grade_ticker`'s regime gate, the awareness R4 flip rule and the screener's regime bar all read a regime today.
- **Size.** **M** — one authority, three known consumers, and a derivation for the loser.
- **Depends on.** Nothing. ⭐ It is a precondition for `FB-A11-02` and for any I1 verdict item.
- **Anti-pattern risked.** **DOC-2**. ⛔ F-01's structural fix is the acceptance test: *"derive one from the other and prove it by MOVING the source"*, and its sibling **"a comment claiming agreement is not agreement"** rules out closing this with a docstring.
- **Known it worked.** Moving the canonical value changes every consumer in the same tick; and a rail fails if a second classifier is reachable from a consumer.

#### FB-A11-02 — A fixed, published regime vocabulary, permanently
- **Statement.** A closed enum of regime names, published, with the base rate beside any claim made about one.
- **Row.** A11.
- **Provenance.** best-of-breed §6.1 item 2 — A11 is one of the five closest rows (*"No benchmarked product ships a breadth composite or an exposure recommendation; four ✖ absences are enumerated"*) and its mechanism is *"SpotGamma's fixed named vocabulary, permanently — plus ⛔ never a hit rate without its base rate (its own §N1 is the cautionary case, and UCT's lift ledger already does this correctly)"*.
- **Today.** Ledger H4 — the UCT Exposure Rating (0–150), *"wire is the ONE authority"*, with *"constants have one home each"*; ledger H6's phase labels. No published closed vocabulary across surfaces.
- **Mechanism.** SpotGamma's. ⚠️ Its own cautionary half is the reason the base-rate clause is inseparable: F-01 PROD-C5 quotes SpotGamma's *"The Call Wall has held in **83%** of daily trading sessions"* with ⛔ *"No sample window, no definition of 'held', no comparison to an arbitrary nearby strike."*
- **Size.** **S** once `FB-A11-01` lands — an enum, a publication, and a render.
- **Depends on.** `FB-A11-01`, hard.
- **Anti-pattern risked.** **PROD-C5** and **PROD-C6**. F-01 §4 row 14 names UCT's exposure as ⛔ ACTIVE across four shipped scores and says *"No base rate, sample window or method link is required beside any of them"*; PROD-C6 forbids blending the vocabulary's inputs into one sortable number. ⭐ The counter-precedent is internal and already correct: ledger G6's lift ledger — *"lift, never a hit rate"* under six gates.
- **Known it worked.** Every surface renders a member of the enum (railed on the enum, not on a list of strings); and any published regime statistic carries its window and its null model, which is `FB-A9-02`'s rail applied here.

#### FB-A11-03 — Label a stale or proxied value at the value
- **Statement.** Sentiment and any proxied series carry their as-of and their source name where the number is, not in a FAQ.
- **Row.** A11 (the render half belongs to S8).
- **Provenance.** Ledger **H8** — *"Public sentiment scrapes — NAAIM, AAII, CBOE put/call, CNN fear & greed, Macrotrends, Barchart, YCharts"*, status **active (degraded)**, reuse note *"extend (label staleness)"*, limits *"NAAIM feed **101 days stale**; the column may carry a stale unlabelled value (D-14 §2.5d)"*. The rule to adopt is F-01 **PROD-C7**'s, quoted from the Koyfin dossier: ⭐ *"If UCT ever renders a proxy, the proxy's name belongs beside the value."*
- **Today.** The columns render; the staleness is not labelled.
- **Mechanism.** Koyfin's is the anti-pattern; **SpotGamma's** is the fix — F-01 PROD-C7: *"a two-speed data contract stated out loud, because 'it prevents the worst failure mode: a member trading a stale level believing it is fresh'"*. And **Unusual Whales'**: *"degrade by freshness, not by feature."*
- **Size.** **S** — the values already have an as-of upstream; this is a render plus a threshold.
- **Depends on.** `FB-S8-01` for the primitive, `FB-S8-02` for the maximum age a panel may display without saying so — which ARCH-07 §3 Q3 records as *"a product decision nobody has made"*.
- **Anti-pattern risked.** **PROD-C7** is the fix; **PROD-4** is the adjacent trap — a stale value and a missing value are different facts and must not collapse.
- **Known it worked.** A value older than the stated bound renders its age, asserted as rendered text; and a fixture with a 101-day-old feed cannot render an unlabelled number.

#### FB-A11-04 — Re-source the authoritative EOD breadth row off yfinance
- **Statement.** The row that defines the day's breadth is computed from an X-class input; move it to Massive-native.
- **Row.** A11.
- **Provenance.** `capability-infrastructure-matrix.md` A11 LICENSING: *"CFTC is **A**-class (public domain)… the EOD breadth row's authoritative input is yfinance (**X**-class) — a re-source is named as 'its own project' (F-09 §4 #7)."*
- **Today.** Ledger H1 — the breadth monitor's daily row is **PC-dependent** and written by `breadth_collector.py`; ledger §R lists H1 among the PC-dependent capabilities that *"stop when the owner's machine is off"*.
- **Mechanism.** None external. ⭐ The precedent is in the same row: CFTC/COT is called *"the cleanest lane in the product"* precisely because its input is public-domain.
- **Size.** **L** — F-09 calls it *"its own project"*, and it changes the authoritative value of a published rating, so it needs a parallel-run comparison rather than a swap.
- **Depends on.** `FB-D1-01` (a Massive adapter to route through).
- **Anti-pattern risked.** ⚠️ **INST-7** — reading agreement between the old and new computations as corroboration when both share an input. The parallel run must be designed so agreement is informative.
- **Known it worked.** A stated number of sessions where the two computations are compared *per metric* with disagreements enumerated by name, not counted — and the exposure rating's published value does not move without a recorded reason.

#### A2 Charts & Analytics — deliberately empty
⛔ **No item.** `capability-infrastructure-matrix.md` A2's REMAINING GAP reads *"**No gap.** Data is fully served; the only 'gap' is architectural discipline (do not edit B1's internals)"*, and its binding rule is *"never refactor inside Terminal-Next scope, consume via ChartPane"* — *"binding, not advisory"*. Ledger B1 records `StockChart.jsx` at **15,500 lines / ~120 props** as *"the single largest carried risk"*, with `ChartPane` (B2, 17 importers) as *"mount this, not B1"*. **A discipline is not a backlog item, and an item proposing work inside B1 would violate an accepted constraint.** §5 records the two candidates this removed.
### 3.3 Applications — research and documents: A3, A4, A5, A6, A7, A8, A9

#### FB-A3-01 — Six `_fmp_get` helpers onto one D1 adapter (the named first ACL proof case)
- **Statement.** One FMP adapter with one budget, replacing six independent helper implementations that share none.
- **Row.** A3 Fundamentals & Financial Statements (the adapter itself is D1).
- **Provenance.** `capability-infrastructure-matrix.md` A3 NORMALIZATION: *"Consolidate the six FMP helpers into one D1 adapter (the Readiness Review's own named first ACL proof case, D4)"*; its D1 row names FMP as one of the two highest-priority adapters (*"six independent `_fmp_get` helpers"*). best-of-breed §6.2 item 5: *"consolidate onto one D1 adapter (the named first ACL proof case)."*
- **Today.** Ledger **D2** — *"six independent `_fmp_get` helpers (TD-29)"*, with the coverage monitor observing FMP-primary fill rates of .958–1.0. The reference implementation to copy is internal: `finnhub_client.py`, which the capability matrix's D1 row names *"the internal reference implementation to copy"* (one chokepoint, token bucket, reactive cooldown, 24 h cached-forbidden state).
- **Mechanism.** Internal. ⚠️ The external discipline worth copying at the boundary is Quartr's, per best-of-breed §3.6 X2: *"identifier discipline, `429` with reset headers, cursor pagination."*
- **Size.** **M** — one module, six known call-site families, a budget, and a licensing-class stamp per response.
- **Depends on.** Nothing. ⭐ It is the named proof case, so it is the cheapest way to establish `FB-D1-01`'s pattern.
- **Anti-pattern risked.** **PERF-1**'s sibling — every consolidated call must carry a timeout, and F-01 warns that one global bound applied to a lane it was not sized for is the next trap.
- **Known it worked.** An AST rail — the capability matrix's own wording — *"nothing outside the adapter constructs a vendor URL"*, in the shape of the existing `test_yf_guard_census.py`, with a control; and the six budgets become one observable budget.

#### FB-A3-02 — Figure-to-source-page link on every statement line item
- **Statement.** A displayed fundamentals figure links to the page it came from.
- **Row.** A3.
- **Provenance.** best-of-breed §6.2 item 5: *"adopt Fiscal.ai's figure-to-source-page link, which is architecture rather than a data purchase."* §3's own headline on that row: *"Fiscal.ai delivers auditability the incumbent only reports having, for $49"* (§4 item 1), and §5 prices the mechanism at **$99/mo list** — i.e. the mechanism is cheap and the *copy* is free.
- **Today.** Ledger D2 — `/api/fundamentals*`, `FundamentalSnapshot`, the fundamentals widget; ledger D1's research modal has a Company tab. No figure-level source link anywhere in the inputs.
- **Mechanism.** Fiscal.ai's click-through auditability. ⭐ Its Bloomberg-side twin is best-of-breed's **M8**, *"a near-free provenance upgrade"*: publish **an N and a contributor** beside a consensus figure.
- **Size.** **M** — the link is small; the **provenance record per stored value** it needs is `FB-D2-01`, which is why this item is M and not S.
- **Depends on.** `FB-D2-01` for the addressable row; `FB-S8-01` for the render.
- **Anti-pattern risked.** **PROD-C5** — it is the fix. ⚠️ And **PROD-C8**'s harder half applies: F-01 quotes *"a computed number with no addressable row cannot be cited by any mechanism in the field"*, so a **derived ratio** cannot get this link until D2 addresses it. The item should ship for *reported* line items first and say so.
- **Known it worked.** Every reported line item on the panel resolves to a source page; a rail asserts non-null provenance per displayed reported row and **refuses to render** one without it (the `CoverageLine` arithmetic-refusal idiom, which ledger G2 records as already working that way).

#### FB-A4-01 — Retain the nightly analyst pass into a revision timeline
- **Statement.** The estimate/target snapshot already taken nightly becomes a time series, which is the whole feature.
- **Row.** A4 Estimates & Analyst Actions.
- **Provenance.** `capability-infrastructure-matrix.md` A4 NORMALIZATION: *"the revision timeline is **derivable by retention alone** — retaining the nightly `screener_analyst_pass` snapshot into a time series is 'a storage decision, not a vendor decision' (provider-master-ledger §5)."*
- **Today.** Ledger **D3** — `screener_analyst_pass` runs 02:00 into `screener_analyst.db`, with FMP grades/consensus/PT observed-called at .958–1.0 coverage; and the row's named limit is *"no vendor-neutral revision timeline (D-03 §5 'no provider')"*.
- **Mechanism.** ⭐ Bloomberg's **M8** again — N and contributor beside a consensus figure — which turns a revision series into an auditable one rather than a line on a chart.
- **Size.** **S** for the retention (append instead of replace), **M** for the surface.
- **Depends on.** Nothing for the retention. ⭐ Retention is worth starting **first and alone**, because a timeline cannot be backfilled and every night not retained is permanently lost.
- **Anti-pattern risked.** **PROD-C5** — a revision chart with no method is a published number with no derivation; the window and the contributor set must ship with it. Also **TD-33**'s class (ledger H6, `awareness_regime_snapshots` growing unbounded): a retained series needs a retention policy in the same commit.
- **Known it worked.** The day it holds two dated snapshots it can answer "what changed", and that is the acceptance test; the surface's first assertion is that two snapshots with identical values render as *no revision*, not as a flat line implying coverage.

#### FB-A5-01 — One canonical earnings-date authority (OQ-14)
- **Statement.** The Discord bot's earnings-date context derives from `/api/calendar` through one adapter, or the bot is declared superseded.
- **Row.** A5 Events & Calendar.
- **Provenance.** `capability-infrastructure-matrix.md` A5 REMAINING GAP: *"**PROVISIONAL / OWNER INPUT REQUIRED — OQ-14**: the Discord bot's `get_catalyst_calendar_context` is a second, unreconciled earnings-date authority beside `/api/calendar`; this architecture assumes `/api/calendar`'s reconciled week is canonical and the bot conforms via one adapter (reversible)."* Ledger **K13** carries the same: *"second authority on report dates beside `/api/calendar` (OQ-14)."*
- **Today.** Ledger E1 — `/api/calendar`'s reconciled week, consumed by **nine reader classes**. Ledger K13 — the bot, whose *"**runtime NOT DETERMINED** (no task, no process, no Railway entry — RG-19)"*, reuse note *"avoid until versioned; decide superseded-or-not"*. OI-16 records a real measurement on the owner's box: no scheduled task, no running process, directory unchanged since Feb 2026 — *"Definitively not running on this PC"*.
- **Mechanism.** None external.
- **Size.** **S** if the answer is "superseded" (a decision plus a deletion), **M** if it is "conforms" (one adapter plus a parity test).
- **Depends on.** ⛔ The superseded-or-not decision, which OI-16's default leaves open pending any sign of activity.
- **Anti-pattern risked.** **DOC-2**, and **REACH-1** if the bot is documented as live while not running. ⚠️ F-01's DOC-3 is the specific hazard here — ledger K13 records the bot's own `CLAUDE.md` claiming ChromaDB and *"150 books / 200 channels"* against a different measurement, so two documents disagree and neither is authoritative.
- **Known it worked.** In the conform case, moving a date in `/api/calendar` moves the bot's answer, proved by moving it; in the superseded case, the second authority is gone and the reachability rail says so.

#### FB-A5-02 — Schema assertion on the five server-side `/api/calendar` readers
- **Statement.** Five server-side consumers of the week contract read it with bare `.get()` chains and no schema assertion; give the contract a shape that fails loudly.
- **Row.** A5.
- **Provenance.** Ledger **E1** limits: *"five server-side readers do bare `.get()` chains with no schema assertion (TD-37)"*, in a row whose reuse note is *"**app infrastructure, not a page's data source** — retiring the surface ≠ retiring the contract"*.
- **Today.** Nine reader classes, no assertion. ⛔ `GOVERNING_PRINCIPLES` §13 (via the capability matrix's A5 row) forbids renaming `calendar_*` preference keys, the widget type key `calendar`, or notebook embed params — so the contract is frozen and an assertion is the only safe hardening.
- **Mechanism.** Internal. ⭐ The idiom to copy is in the same family: ledger E3's Wire *"three-state trust line"*, named *"the honesty idiom to generalise"*.
- **Size.** **S** — one schema, five call sites, one test.
- **Depends on.** Nothing. ⭐ Cheapest item in this family and a precondition for any Terminal-Next panel that consumes the week.
- **Anti-pattern risked.** **PROD-4** — a `.get()` chain returning `None` renders as *"nothing today"*; the assertion must distinguish absent from unfetched. And ledger E1 records a second live instance of the same class: *"`is_current_week` inverted on weekends"*.
- **Known it worked.** A fixture week missing a required key fails the reader instead of rendering an empty day; and the failure names the key.

#### FB-A5-03 — Derive the Fed-speaker list instead of hand-typing it
- **Statement.** The economic calendar's curation drops a speaker because a surname is missing from a typed list.
- **Row.** A5.
- **Provenance.** Ledger **E10**: *"Economic calendar — ForexFactory this-week curated to Med/High + Fed, FMP for other weeks… **hand-typed Fed surname list missed Chair Warsh** (correctness bug that presents as absence, TD-29)."*
- **Today.** The typed list ships; ForexFactory's `nextweek` has 404'd since 2026-07-30 (ledger E1's provider list, and the capability matrix's A5 row calls it degraded).
- **Mechanism.** None external.
- **Size.** **S** — one derivation or one data file with a horizon check.
- **Depends on.** Nothing.
- **Anti-pattern risked.** **DOC-1**, in its purest and most expensive form: a hand-typed roster beside the artefact that owns it, where the failure *presents as absence* and is therefore invisible. ⛔ Worth fixing precisely because F-01 ranks DOC-1 the most likely anti-pattern for this product.
- **Known it worked.** A new FOMC member appears without a code change; and a rail fails when the list's source cannot be resolved, printing `unreadable` rather than a plausible default (ARCH-07-OBS G-10's general rule).

#### FB-A5-04 — Make the Wire view reachable by something other than an explicit click
- **Statement.** The calendar's most honest view is unreachable by migration and only reachable if a member already knows to click it.
- **Row.** A5.
- **Provenance.** Ledger **E2**: *"**Wire view unreachable by migration (explicit click only)**; no test on the view-pref migration ladder (TD-37)"*, beside ledger E3's Wire, which is CONFIRMED live and whose three-state trust line is named *"the honesty idiom to generalise"*, with its own *"discoverability gap (E2)"*.
- **Today.** Four views with `calendar_view_v3` persisted; the migration ladder never lands anyone on Wire.
- **Mechanism.** ⭐ Bloomberg's `FFM` shape, per best-of-breed §3.6 X3: *"pegs discovery to **today's** move rather than to a static catalogue"* — i.e. surface the Wire when there is something on it, rather than adding a fifth affordance.
- **Size.** **S** — a migration-ladder rule plus its missing test.
- **Depends on.** Nothing.
- **Anti-pattern risked.** **PROD-3** (present is not showing) in its product form — a view that exists and is never seen. ⚠️ And the migration ladder itself is a **STATE-4**-shaped hazard (a hydration race persisting a pre-hydration default), which is why TD-37's missing test is part of the item.
- **Known it worked.** A member whose stored preference predates Wire lands on it when it has content, proved by a migration-ladder test that currently does not exist; and `page_views` (already populated, 4,949 rows per OI-21) can answer whether the view is reached at all.

#### FB-A6-01 — Say "coverage n=0" instead of rendering an empty transcript panel
- **Statement.** When transcript coverage is zero, the receipt says so in those words rather than showing a panel that looks like silence.
- **Row.** A6 Transcripts & Filings.
- **Provenance.** best-of-breed §6.2 item 3 — A6 is *"The harshest row in the file: coverage **measured n=0** in the one observed monitor cycle"* — and its prescribed order is *"confirm RG-15 before any member-facing claim; make the S8 receipt say 'coverage n=0' rather than render an empty panel; then EDGAR… plus span-anchored citation."* `capability-infrastructure-matrix.md` A6 FRONTEND: *"the S8 receipt must render 'coverage n=0,' never an empty panel that looks like silence."*
- **Today.** Ledger **D6** — transcripts active and reusable, with *"coverage `transcript` had **n=0** in the one observed cycle (RG-15)"*. Ledger D12's coverage monitor is the instrument that saw it.
- **Mechanism.** Internal — `CoverageLine`'s four counts (ledger G2), which best-of-breed §6.1 item 5 says should become a platform primitive.
- **Size.** **S** for the receipt. ⛔ **Confirming RG-15 first is a precondition the source states**, and it is a measurement, not a build.
- **Depends on.** `FB-A9-02` (CoverageLine as a primitive) if it lands first; nothing otherwise.
- **Anti-pattern risked.** **PROD-4** — it is the fix, and F-01's exact wording applies: *"when `answered === 0` with anything not-computable, it says 'that is a gap in what we hold, not a quiet market' **in those words, above the counts**."*
- **Known it worked.** A ticker with no transcript renders the sentence, asserted as rendered text; and the receipt refuses to render if its arithmetic does not close, mirroring `scan_evaluator._assert_coverage_closes`.

#### FB-A6-02 — Span-anchored citation on the call recap (index, do not replace)
- **Statement.** Every generated recap bullet is a jump link into the transcript span it came from.
- **Row.** A6 (rendering via S8, generation via I1).
- **Provenance.** best-of-breed §6.1 item 3: *"add span anchors to the call recap so every generated bullet is a jump link — Bloomberg **M9**, 'the single strongest transferable idea across two leaves'."* F-01 **PROD-C8**'s structural fix names both halves: *"**Index, do not replace** — clicking a summary point **jumps to the corresponding transcript excerpt**"*, and **highlight-to-verify** (AlphaSense M2) — *"select any sentence in a generated answer and the system substantiates **that specific claim**… It converts verification from a chore into a gesture."*
- **Today.** Ledger **D6** — call recaps (Opus + Perplexity), verbatim transcripts, and ⭐ `transcript_index.db` **FTS5**, which is the substrate a span anchor needs; plus word-timed transcripts from `earningscall_timed`. Nothing links a bullet to a span.
- **Mechanism.** Bloomberg M9 + AlphaSense M2, above.
- **Size.** **M** — the index exists, so this is an anchor format, a generation constraint and a renderer.
- **Depends on.** `FB-S8-01` for the render; `FB-I1-02` is the general form and this is its cheapest first case.
- **Anti-pattern risked.** **PROD-C8** — it is the fix for the half that is a wire format. ⛔ **And a rights gap, not an engineering one, bounds it:** best-of-breed §6.2 item 3 says A6 is *"Partly unclosable by building: FMP transcript **storage** is U-class and AI-processing rights are 'the sharpest AI row' in the licensing register — this gap is half rights, and a rights gap does not yield to engineering."* ⚠️ OI-03(b) records the FMP DDLA as confirmed to exist while *"transcript AI"* stays U regardless.
- **Known it worked.** A recap bullet with no resolvable anchor is **refused, not rendered** — and the refusal is the observable, because it is the only version of this that cannot degrade silently.

#### FB-A7-01 — Consume SEC EDGAR Form 4/13F for ownership
- **Statement.** A public-domain source that is already wired for filings is unused for the ownership data it carries.
- **Row.** A7 Ownership.
- **Provenance.** `capability-infrastructure-matrix.md` A7 REMAINING GAP (2): *"**class-C — SEC EDGAR Form 4/13F** is available and genuinely **unused** for ownership (F-09 §3.1 class C) — a zero-cost normalization win to take **before any new-vendor spend**."*
- **Today.** Ledger **D7** — SEC filings (10-K/10-Q/8-K/S-1/DEF 14A + full-text search) on EDGAR, *"free; UA mandated"*, with no recorded limits. Ledger **D8** — ownership served by FMP, Finnhub, an openinsider scrape and Finviz columns, across *"five separate providers… with no single internal symbol type"*.
- **Mechanism.** None external. ⭐ The argument is licensing arithmetic: EDGAR is class-A public domain against a scrape and a U-class column.
- **Size.** **M** — a parser per form type plus a normalization into the existing ownership shape.
- **Depends on.** `FB-S3-01` would make the join reliable (13F names are entity-shaped, not ticker-shaped); `FB-D1-01` for the adapter. ⚠️ Without S3 this lands as ticker-keyed and inherits the ambiguity.
- **Anti-pattern risked.** **DOC-2** — a fifth ownership source that does not replace one is a sixth authority. ⛔ Worth it only if it **retires** a leg (the openinsider scrape or the yfinance `.info` leg the capability matrix's A7 row already queues for retirement).
- **Known it worked.** Ownership rows carry an accession number; coverage is compared against the incumbent providers **per name and enumerated by name**, never as a percentage (F-01's names-not-counts rule, from the desk session audit).

#### FB-A7-02 — Short-interest history off a licensed floor
- **Statement.** Short interest is current-value-only, unretained, and single-sourced to an unlicensed export; FINRA's free bi-monthly release is the floor.
- **Row.** A7.
- **Provenance.** `capability-infrastructure-matrix.md` A7 REMAINING GAP (1): *"**class-G — short-interest history**: current value only, no retention, single-sourced to an unlicensed Finviz export… F-09 §6 item 7 names this 'the rare case where a new vendor REDUCES risk' — replacing a U-class single source with a licensed one (FINRA's free bi-monthly public release as a floor, a paid SI-history vendor as the option) — **the strongest NEW-PROVIDER candidate in this entire matrix by F-09's own ranking**."* It is item 2 of the matrix §6's three-item list of vendors worth evaluating.
- **Today.** Ledger **D8** — *"Finviz single-sources short interest"*; ledger G1 records `rs_rank` NULL and short interest *"single-sourced and sparse"* on the measured box. The capability matrix's A7 licensing cell: Finviz short interest is **U**-class, *"no terms document exists at all… the single largest documentary gap in the audit"*.
- **Mechanism.** FINRA's published bi-monthly release. ⚠️ The paid option is an owner purchase, not an engineering item.
- **Size.** **M** for the FINRA floor plus retention; the paid vendor is an owner decision.
- **Depends on.** `FB-D1-01` for the adapter, `FB-A7-01`'s normalization if it lands first.
- **Anti-pattern risked.** **PROD-C7** — a bi-monthly value rendered beside daily data is a mixed-freshness surface, and the cadence belongs *at the value*. ⭐ That makes `FB-A11-03`'s labelling rule a hard dependency for the display, not a nicety.
- **Known it worked.** A dated short-interest series exists for a name where none existed; the Finviz column is off the display path (AST census); and the rendered value carries its publication cadence.

#### FB-A8-01 — Unify the three taxonomies, and the primary-vs-mentioned bit
- **Statement.** Catalyst tags, themes and cashtags become one taxonomy, and one shared resolver decides whether a ticker is the subject or a mention.
- **Row.** A8 News & Catalyst Intelligence.
- **Provenance.** `product-architecture.md` A8: *"**Owns** the three taxonomies that must unify (catalyst tags, themes, cashtags — synthesis §8.4) and the primary-vs-mentioned ticker bit (C2-01 §10 'needs engineering only')."* `capability-infrastructure-matrix.md` A8 NORMALIZATION says the same.
- **Today.** Ledger **K8** (catalyst tags, deterministic: Earnings > Catalyst > Gapper > News), ledger **H9** (theme taxonomy + membership engine, with owner-precedence merge), ledger **M5** (cashtag regex over curated accounts). Three populations, no shared resolver.
- **Mechanism.** None external. ⭐ The internal precedent for the *bit* is ledger H9's owner-precedence merge, which already keeps one baseline authoritative while an overlay proposes.
- **Size.** **M** — one taxonomy, one resolver, three known consumers, and a migration that must not move the owner's theme baseline (H9's aggregates are owner-only *by rule*).
- **Depends on.** `FB-S2-02` (one ticker resolver) is the natural place for the primary-vs-mentioned bit.
- **Anti-pattern risked.** **DOC-2** is what it closes; **PROD-C6** is what it must not become — three taxonomies must not be blended into one score, only into one vocabulary. F-01 PROD-C6 names the catalyst composite by formula as UCT's live instance.
- **Known it worked.** One taxonomy table with three consumers, railed so a fourth cannot be introduced; and a mention-only ticker is not counted as a subject on any surface, proved on a fixture headline naming two tickers.

#### FB-A8-02 — Migrate the six sibling `.catch(() => null)` call sites onto `sectionFetch.js`
- **Statement.** Six fetchers still render a retrieval failure as an empty result, and any panel that can say "we hold nothing" inherits them.
- **Row.** A8 (the class is app-wide).
- **Provenance.** F-01 **PROD-4**: ⛔ *"`sectionFetch.js` is the fix **and D-12 names six sibling call sites that never migrated**."* F-01 §4 row 9 marks it ⛔ **ACTIVE**: *"Any Terminal-Next panel that can render 'we hold nothing' inherits them."* The recorded cost: ⚰️ *"The idiom rendered 'No recent news for this ticker.' against NVDA while the endpoint returned 15 KB of headlines."*
- **Today.** `sectionFetch.js` exists and six siblings do not use it. ⛔ F-01's detector field is explicit: *"Nothing detects the six un-migrated `.catch(() => null)` sites, which is a named, open, member-facing exposure."*
- **Mechanism.** Internal.
- **Size.** **S** — six known sites and one existing helper.
- **Depends on.** Nothing. ⭐ Among the cheapest items in the file with a measured member-facing cost behind it.
- **Anti-pattern risked.** **PROD-4** — it is the fix. ⚠️ **PROD-5** is the adjacent trap: enriching a refusal that says nothing is right, overwriting one that already says something specific is the recorded defect (*"a cost-budget refusal ('usage limit') became 'nothing was retrieved'"*).
- **Known it worked.** An AST rail counting `.catch(() => null)` in fetchers, at zero, **with a control proving it can see one**; and a fixture where the endpoint 500s renders a failure sentence, not an empty state.

#### FB-A8-03 — "Why isn't X here" as an S8 receipt rather than a tile feature
- **Statement.** The negative answer — why a name is absent from a curated surface — becomes a shared receipt every surface can render, not one tile's affordance.
- **Row.** A8.
- **Provenance.** `capability-infrastructure-matrix.md` A8 FRONTEND WORK: the curated-first-vs-browsable-feed posture is **PROVISIONAL / OWNER INPUT REQUIRED (P-δ)** and *"this architecture supports either by making 'why isn't X here' an S8 receipt rather than a tile feature, so the choice stays reversible."* `product-architecture.md` A8: *"The honest negative for 'why is it moving' is a first-class output."*
- **Today.** Ledger K8 names the catalyst engine's surfaces (the tile, `/catalysts/history`) and `routers/catalysts.py`. ⚠️ **Partly inferred:** a per-symbol explain route and a tile-local affordance are described in the repo's `CLAUDE.md`, which F-01's **DOC-5** records as *"eight recorded facts behind"* master in this very worktree — so this cell is 🟡 and the exact shipped affordance was not verified by this document.
- **Mechanism.** Internal (`CoverageLine`'s four counts). ⭐ The competitor form is Bloomberg's authoring-time honesty (best-of-breed §6.1 item 5) and SpotGamma's two-speed contract stated out loud (F-01 PROD-C7).
- **Size.** **M** — a receipt shape plus adoption across the surfaces that curate.
- **Depends on.** `FB-A9-02` (CoverageLine as a primitive) and `FB-S8-01`. ⚠️ The P-δ posture is owner-bound, but the item is written to be **posture-neutral**, which is the whole point of its source.
- **Anti-pattern risked.** **PROD-4** and **PROD-C6** — a curated list's absence must not be explained by a composite score nobody can decompose. ⛔ F-01 names the catalyst engine's own blend plus its forced 10/5/3/2 quota as *"a blend plus an output-side correction"*.
- **Known it worked.** The same question asked on two curated surfaces returns the same receipt from one component; and a name excluded by the quota rather than by the score says *which*.

#### FB-A9-01 — An authoring-time live match count
- **Statement.** While criteria land in the builder, the screen's strength is legible — before it is saved, not only after it runs.
- **Row.** A9 Screening & Discovery.
- **Provenance.** best-of-breed §6.1 item 5: *"add Bloomberg's authoring-time counterpart (a live match count while criteria land) so a screen's strength is legible during composition and not only after a run."* F-01 §6 appendix item 1 carries the alert-shaped twin: `bloomberg/03-news-alerts.md` §6 shows *"**stories per hour** for the current filter, at authoring time, 'so the user can see whether a search is survivable before saving it'"*, and publishes *"its own noise list of ~13 low-signal topic codes to exclude"*.
- **Today.** Ledger **G4** — the Builder sheet, Concierge (English → a scan) and a CodeMirror editor, active; ledger **G2** — the coverage receipt **after** a run. Nothing at authoring time.
- **Mechanism.** Bloomberg's, above.
- **Size.** **M** — a cheap-count path over the nightly universe plus a debounce; ⚠️ the count must not become a second evaluator (see the anti-pattern).
- **Depends on.** `FB-A9-02` for the receipt vocabulary.
- **Anti-pattern risked.** ⛔ **The breadth drill-down lesson applies exactly**: ledger H2's locked invariant is that *"a drill list MUST come from the mask that produced the count — never a second pass. Two passes drift the moment a definition moves and the failure is SILENT."* An authoring-time count computed by a different path from the run is that defect. **Worth it anyway only if the count and the run share one evaluator.**
- **Known it worked.** The authoring count equals the run's `evaluated`/`answered` for the same definition — a parity assertion, which is the item's real deliverable; and a deliberately divergent second path fails it.

#### FB-A9-02 — `CoverageLine` as a platform primitive, on every result surface
- **Statement.** The four-count receipt becomes an S8 component every result surface routes through, with `withheld` beside the four and never inside.
- **Row.** A9 (evaluator) / S8 (renderer).
- **Provenance.** best-of-breed §6.1 item 5: *"keep it, make it a platform primitive (the ledger's own recommendation), and extend it to every result surface."* Ledger **G2**'s reuse note: *"**`CoverageLine` should be a platform primitive** — D-03 §8"*. `product-architecture.md` A9: *"**Owns** `CoverageLine`'s *evaluator* (S8 owns the renderer)."*
- **Today.** Ledger G2 — the four counts (evaluated · answered · dropped · not-computable) with `withheld` beside, live on `/screener` via `ScanResults`, with two rails (`reachable.test.js`, `Screener.scanmount.test.jsx`). One surface.
- **Mechanism.** Internal, and best-of-breed §6.1 item 5 notes ◻ *"Bloomberg's `EQS` is NOT DETERMINED on that distinction"* — i.e. UCT is ahead here.
- **Size.** **M** — an extraction plus adoption, with a rail per adopting surface.
- **Depends on.** `FB-S8-01` (the component set it belongs in).
- **Anti-pattern risked.** **PROD-4** (⛔ *"Do not collapse them to make the line shorter"*) and **GATE-2** — F-01's *"three copies of one guard"*: the arithmetic refusal must live once. ⭐ Both are in the source, and the component already *"refuses to present a receipt whose arithmetic does not close"*, which is the behaviour to preserve through the extraction.
- **Known it worked.** A rail **derives** the set of result surfaces and fails by name on one that does not route through the component (the `i1S8Boundary.test.js` shape F-01 PROD-6 recommends extending rather than rewriting); and the arithmetic refusal is seen to fire.

#### FB-A9-03 — A second whole-market screener universe
- **Statement.** One unlicensed source with a contested `robots.txt` is the only path to the screener's universe, and its loss deletes the capability rather than degrading it.
- **Row.** A9.
- **Provenance.** `capability-infrastructure-matrix.md` §6 item 1 — the first of only three places a genuinely new vendor is worth evaluating: *"Finviz Elite is the sole source with no terms document at all and a contested `robots.txt`; this is the single point of failure most likely to delete a core capability outright, not degrade one column."* Its A9 row: *"'a Finviz no is a capability deletion, not a swap'… reachability itself is contested, not merely the licence."* best-of-breed §6.2 (b) adds that the desk-tool note *"contains **no licensing or robots posture at all**, which is an open hole in that note rather than a clean finding"*.
- **Today.** Ledger **G1** (the screener's nightly universe) and ledger **G5** (three Finviz scans), with an observed failure: *"a Finviz outage empties the scan (observed 2026-08-31 dry run: 'no results from Finviz' ×3)"* → `SCAN HEALTH FAILED`. ⚠️ best-of-breed §2.2 also records that Finviz is the **one** desk-tool weighting that is measured rather than assumed.
- **Mechanism.** None to copy — this is a sourcing decision.
- **Size.** **L**, and half of it is an owner purchase. ⛔ The engineering half is a universe abstraction behind `FB-D1-01` so a second source is a swap rather than a rewrite.
- **Depends on.** `FB-D1-01`; and an owner decision on spend.
- **Anti-pattern risked.** None in the library. ⚠️ **INST-5** is the design risk: a fallback path with no control, over an empty result, reads as verified. F-01's rule — *"An empty result is a failed invocation until proven otherwise"* — is what the fallback must be built against.
- **Known it worked.** ⭐ **A rehearsed outage**, not a document: with Finviz blocked, the nightly scan produces a non-empty universe from the second source and `CoverageLine` states which source answered. F-01's GATE-1 applies — a fallback nobody has seen fire is not a fallback.
### 3.4 Applications — the member's own record: A12, A13

#### FB-A12-01 — Watchlist alerts onto S7's shared trigger taxonomy
- **Statement.** The watchlist alert path keeps its own delivery seam; move it onto the one trigger taxonomy so there is one queue, one cap set and one receipt.
- **Row.** A12 Watchlists & Lists.
- **Provenance.** `capability-infrastructure-matrix.md` A12 BACKEND WORK: *"move the alert path onto S7's shared trigger taxonomy instead of I3's own duplicated delivery seam."* Its S7 row records *"five-plus independently-built alert subsystems share one delivery function (`deliver_alert_payload`) but **no shared trigger model**"*.
- **Today.** Ledger **I3** — price / line / trendline alerts with in-app `AlertBell`, email, Discord, browser notification and ten sounds; reuse note *"reusable (`deliver_alert_payload` is the shared delivery seam)"*, limit *"delivery runs on the request path (launch-hardening backlog)"*. Ledger B6 is a *second* alert family (indicator alerts) with its own tables.
- **Mechanism.** ⭐ Unusual Whales holds best-in-class **authoring** on S7 (best-of-breed §3.4 S7): *"a small readable `where` grammar over five typed subjects with field-to-field comparison (`volume > open_int`), a machine-readable grammar endpoint beside it, and an AI builder that **compiles to** the text rather than replacing it"* — at **$50/mo list**, which best-of-breed §1 H2 uses to make its point that price is uncorrelated with mechanism quality.
- **Size.** **M** — a migration of one predicate family onto a shipped registry, plus a delivery-path move off the request path.
- **Depends on.** `FB-S7-01`'s foundation, which already ships one of eight types. ⛔ **And the protected-consumer rule binds:** `product-architecture.md`'s S7 record rules that any change to predicate or receipt shape *"ships with a parity test proving filing watch's observable behaviour — **fires, delivery, receipts** — is unchanged. The test goes in BEFORE the change and must fail on regression."*
- **Anti-pattern risked.** **GATE-1** — F-01's and the record's shared point: *"A parity test that has never been seen to fail proves nothing."* Also **PERF-1** — the delivery move must not put a new write on a hot path.
- **Known it worked.** Filing watch's fires, delivery and receipts are unchanged, proved by a parity test that was **seen to fail** before the change; and one queue reports the per-type caps.

#### FB-A12-02 — Declare — and publish — the device-local vs cross-device rule
- **Statement.** Some of a member's work follows the account and some follows the browser, by accident of implementation order; decide it and publish which is which at the surface.
- **Row.** A12 (the contract is S5's).
- **Provenance.** F-01 **PROD-C3** detector field: ⚠️ *"**And UCT already has this defect in the shape D-11 describes:** drawings and `uct.watchlist.cols` are **device-local** while `tracings_doc` **syncs**, and D-11 §4.1 records that boundary as 'an accident of implementation order, not a decision.' C5-03 §8 explicitly declines to rule on it."* `capability-infrastructure-matrix.md` A12: *"columns are device-local 'by accident of order, not by rule' — must be declared explicitly under S5."*
- **Today.** Ledger **B3** — *"drawings device-local, boards cross-device — an accident of order, not a rule"*; ledger C7 — `localStorage['uct.watchlist.cols']` beside `user_preferences`. ⭐ CARD 3's amendment shipped one half: performance columns now *"persist per member (`watchlist_perf_cols`, hydrated after prefs load, written on change)"*, so the *columns* half is partly closed and the *drawings* half is not.
- **Mechanism.** ⭐ LSEG's, via F-01 PROD-C3's structural fix: *"If two are unavoidable, **publish which is which** — ship a **per-surface capability matrix as a product artefact**."*
- **Size.** **S** to publish; **M** to move any boundary (drawings are the expensive one). ⛔ The publication is worth doing even if nothing moves, which is the source's own position.
- **Depends on.** `FB-S5-01` if a boundary moves; nothing to publish.
- **Anti-pattern risked.** **PROD-C3** — it is the fix, and the mechanism F-01 quotes is the reason it matters: *"a trust bug wearing a convenience costume… once a member has lost work once, the auto-saving half stops being trusted too."* ⛔ **DOC-1** on the publication: the matrix must be **derived from the store each key actually uses**, never typed.
- **Known it worked.** The published matrix changes when a key's store changes, with no content edit — that is the whole test; and a fixture moving a key from `localStorage` to the document flips the matrix's cell.

#### FB-A12-03 — Copy-from-source or link-to-source, chosen explicitly at import
- **Statement.** When a list is created from another list, ask once whether it is a snapshot or a subscription, and never guess.
- **Row.** A12.
- **Provenance.** best-of-breed §3.3 A12, the winning mechanism: ⭐ *"**copy-from-source versus link-to-source, chosen explicitly at import.** Bloomberg asks once whether a list is a snapshot or a subscription and never guesses; 'a guessed default is wrong half the time and the wrongness is silent.'"*
- **Today.** Ledger **I1** — watchlists with CSV import/export, a context-menu "copy list", 7-colour tag auto-lists, a flagged shadow list, and monthly-refreshed prebuilt lists. ⚠️ Nothing in the inputs records the copy/link question being asked anywhere; the prebuilt lists' monthly refresh is a *link* semantic applied by default.
- **Mechanism.** Bloomberg's, above. ⭐ Beside it in the same source: `MNRS` restoring up to ten monitor versions, and a **News Heat** column barring current news activity per row (the second is in §6's appendix as unevidenced for UCT).
- **Size.** **S** — one prompt, one flag on the list record, and a refresh path that reads it.
- **Depends on.** `FB-S5-01` if the flag lives in a versioned document; otherwise nothing.
- **Anti-pattern risked.** **PROD-C9** is the adjacent class — *"stage beside; never overwrite"* — and the guessed default is its list-shaped cousin. ⭐ UCT already ships the positive pattern twice (F-01 PROD-C9): the starter library's firm setups arrive as *"ordinary definitions, editable on arrival"*, and Compass's action tools use preview-confirm.
- **Known it worked.** A linked list changes when its source changes and a copied one does not, proved on a fixture by changing the source; and no code path creates a list without a recorded choice.

#### FB-A13-01 — The per-ticker history join ⭐
- **Statement.** One ticker, one timeline: what the wire said, what the setup did, what the book did, what flow did, what the member said — each row keyed by entity and carrying its own provenance.
- **Row.** A13 Journal & Track Record (the deliverable is D2's).
- **Provenance.** best-of-breed §1 **H3(b)** — one of two rows with ⌀ no incumbent across fifteen products, *"several concede they structurally cannot"*, and `product-architecture.md` §1.1 already records that *"every benchmark dossier concedes it cannot have this"*. §6.1 item 4: *"the per-ticker history join, which is a **D2 deliverable** and is **buildable entirely on data UCT already owns**."* `capability-infrastructure-matrix.md` A13 NORMALIZATION: *"**The per-ticker history join does not exist**… This is the single most consequential normalization item in this entire matrix."* Its D2 row: A13's join *"is blocked entirely on this system existing."*
- **Today.** Every lane exists and none is joined. Ledger **N1** (the wire), **N3** (UCT 20 and the Book, *"a track record with the losses in it"*), **G6** (the base-structure lift ledger, 25 measured / 3 published under six gates), **B8** (the append-only signal ledger — *"this signal fired N times" substrate*), **F1–F10** (flow), **J1/J4** (267 modules, 47 `j2_*` tables, the SnapTrade mirror), **L8** (ticker mentions — *"a per-ticker 'what the Desk said' substrate"*, ⚠️ whose door *"is NOT DETERMINED"*).
- **Mechanism.** ⌀ None to copy — that is the point. ⚠️ best-of-breed bounds the claim honestly: trade journals *"are not in the benchmark universe"*, so A13's ⌀ is *"unmatched among benchmarked products"*, ◻ not a world ranking.
- **Size.** **XL** — it is a data-modelling system other systems must be rewritten against, not a feature inside A13.
- **Depends on.** `FB-D2-01` (hard — the source says *blocked entirely*), `FB-S3-01` (every row keyed by entity id, ticker retained only as a dated alias). ⛔ **And one lane is owner-bound:** OI-15 — whether the `#tsdr` corpus's consent basis covers showing members what the room said — with the default *"no member display until answered"*. The join must be buildable without that lane.
- **Anti-pattern risked.** **PROD-C5 and PROD-C6 together.** A five-lane timeline is the most tempting place in the product to emit one composite number, and F-01 names UCT's live instances of both (four shipped scores with no base rate; a catalyst composite with a forced quota). ⭐ The internal counter-precedent is safety-critical and already correct: `portfolio_heat.py` keeps risk-heat and notional exposure as *"two metrics NEVER blended"*.
- **Known it worked.** ⭐ The source supplies the acceptance test before the feature: `capability-infrastructure-matrix.md` D2 — *"pick the ten figures a desk answer most often states and confirm each has a stable id + as-of + inputs today."* Then: one ticker renders all five lanes with per-row provenance, and every figure in it is addressable by `FB-I1-02`'s citation pointer. **If a lane cannot be cited, it does not render.**

### 3.5 Intelligence — I1

#### FB-I1-01 — One provenance renderer; I1 composes on S8 and never renders its own receipt
- **Statement.** Six-plus AI doors each built their own grounding display; one component set serves all of them and the boundary is railed, not documented.
- **Row.** I1 Intelligence Layer (rendering by S8).
- **Provenance.** `capability-infrastructure-matrix.md` I1 NORMALIZATION: *"One provenance renderer every lane routes through — today per-surface (`CoverageLine`, the COT gate, AI-Search's citation chips, each separately built)"*; its FRONTEND WORK names `<VerdictCard posture=…>` and `<Answer provenance=…>`. `product-architecture.md`'s I1 record: *"I1 is the one system the Phase 2 adversarial validation already caught **claiming ownership of the provenance renderer against S8** — the exact defect a spec exists to prevent, and it is now shipping generated prose to members."*
- **Today.** Ledger **K2** (AI Search with *"'grounded on' chips"*), **K10** (COT narratives behind a grounding gate), **G2** (`CoverageLine`), **K4** (Compass), **D6** (call recaps) — five separately-built grounding displays. ⭐ The rail already exists in part: F-01 PROD-6's detector is `i1S8Boundary.test.js`, which *"parses an **AST**, never a grep, and **derives its forbidden vocabulary from S8's own component names**, so a fifth provenance primitive is guarded the day it lands"*, with the instruction *"Extend that rail's roots; do not write this section again."*
- **Mechanism.** LSEG wins S8 in best-of-breed §3.4 (*"quoted at mechanism level"*); the transferable pair is Bloomberg's **M9** (index, do not replace) and AlphaSense's **M2** (highlight-to-verify).
- **Size.** **M** — a component set plus a migration of five known doors, with the rail already written.
- **Depends on.** `FB-S8-01` (they are two halves of one build and should be sequenced together).
- **Anti-pattern risked.** **DOC-2** and **GATE-2** are what it closes. ⭐ **PROD-6** is the discipline: the boundary is *railed, not documented* — *"A paragraph cannot fail, so it is not a boundary."*
- **Known it worked.** `i1S8Boundary.test.js` extended to the new component set, failing by name when a lane renders its own receipt, with a control; and no AI door ships a second grounding display.

#### FB-I1-02 — A machine-checkable citation pointer per claim (P5)
- **Statement.** Every claim in a generated answer carries a pointer something other than a human can check.
- **Row.** I1.
- **Provenance.** F-01 **PROD-C8** detector: ⛔⛔ *"ARCH-05 §0(2) states the gap exactly: grounding is **producer-side only**, and that is the whole trust gap. P5 — a machine-checkable citation pointer per claim — is unshipped, and 'half of closing it is a wire format; the other half is a **data-modelling job** no citation API will do — **a computed number with no addressable row cannot be cited by any mechanism in the field**.'"* F-01 §4 row 16 marks it ⛔ ACTIVE *"and half of it is not a shipping problem"*.
- **Today.** The producer side is strong and F-01 says so: a **blocking** grounding gate over the union of every model-authored free-text field, five coerced response states, a closed member-facing vocabulary, and a fallback-only refusal derivation (PROD-5). The consumer side does not exist.
- **Mechanism.** AlphaSense's **M2** (highlight-to-verify — *"It converts verification from a chore into a gesture"*) and Bloomberg's **M9**. ⚠️ And the marketing half is a named anti-pattern in the same entry: *"'no hallucinations' is unfalsifiable, so the first counterexample costs more trust than the claim ever bought."*
- **Size.** **L** — the wire format is M; the data-modelling half is `FB-D2-01`.
- **Depends on.** `FB-D2-01` (hard, for computed figures), `FB-I1-01` (the renderer), `FB-A6-02` (its cheapest first case, because the transcript index already exists).
- **Anti-pattern risked.** **PROD-C8** — it is the fix. ⛔ And **PROD-C5**: a pointer to a number whose method is unpublished is a citation to nothing.
- **Known it worked.** A claim without a resolvable pointer is refused rather than rendered; a member can select a sentence and be shown the row it rests on; and the golden set that already exists (ledger K12, `ticker_explain_eval/`) gains a case that fails on an unpointed claim.

#### FB-I1-03 — The I1 spec, railed rather than written
- **Statement.** Four clauses — the tool-registry contract, the grounding rule, the refusal shape, and the S8 boundary — each with a check, not a paragraph.
- **Row.** I1.
- **Provenance.** `product-architecture.md`'s I1 IMPLEMENTATION RECORD: *"**I1 DOES need a spec, and it is the highest-value one outstanding**"*, for three named reasons — it was caught claiming S8's renderer; ⭐ *"an eval harness is a specification written in test form, and leaving it as the only spec means the contract lives where no one reads it"*; and it has been extended twice by other workstreams with no shared contract. The record even scopes it: *"The spec should be narrow: the tool-registry contract, the grounding rule (every cited figure through `<Cited>`), the refusal shape, and the boundary that I1 composes on S8 and never renders its own receipt."*
- **Today.** No spec. Ledger **K1** (154 tools, per-door allowlists, *"permissions are per-lane, not per-user/plan"*) and ledger **K12** (the report card, 50 q / 5 rungs, *"exit 1 = do not ship"*; the AI-Search card, 30 q; `--grounding-audit`) are the de-facto contract.
- **Mechanism.** ⚠️ best-of-breed §4 item 4 is why the grounding clause needs a definition at all: *"three vendors use three incompatible definitions of 'grounded'"* — LSEG anchors per value in a table, Bloomberg per bullet to a transcript span, TradingView anchors nothing because its output *is* configuration, AlphaSense anchors on demand.
- **Size.** **S** as a document, **M** as four checks. ⛔ Written as a document alone it is **PROD-6** by construction.
- **Depends on.** Nothing. `FB-I1-01`'s rail is the boundary clause's check.
- **Anti-pattern risked.** **PROD-6** and **GATE-6** (*"a rule stated in a document that no check enforces"*). ⭐ Mitigated by the record's own insight: extend the golden set, because that is where the contract will actually be read.
- **Known it worked.** Each of the four clauses has a case in the golden set or a rail, and each case has been seen to fail; and the report card's deploy gate (`exit 1`) covers the four.

#### FB-I1-04 — Member-visible AI meters, and a population-level cap
- **Statement.** A member can read what they have spent and what remains, and a refusal names the cap; and the population has a cap at all.
- **Row.** I1 (the gate is S9's).
- **Provenance.** F-01 **PROD-C1** — *"the corpus's most-corroborated finding"*, whose rule is stated literally in Bloomberg's own recommendation: ⭐ **"Never ship a hard cap without a meter."** F-01 §4 row 13 marks UCT's exposure ⛔ **ACTIVE**: *"the per-user AI caps already in code sum to **~$610–650/member/month** against a $200 list price, and R-18 records Compass chat as having **no population-level cap**. **None of those caps is member-visible**, and ARCH-05 constraint 15's 'a refusal names who spent the money' is 🟡 — the mechanism exists, the gauge does not."* R-18 (M/H, open) states it independently.
- **Today.** Ledger **K11** — four cost rails (`narrative_cost_guard` with an auth.db ledger, `catalyst/cost_guard`, `compass_cost_guard`), with *"`compass_cost_guard` disabled by default (`COMPASS_COST_CAP_DAILY=0`)"* per ledger K4, *"~40 `*_MODEL` env vars, no router module"* per K10, and *"actual monthly spend NOT DETERMINED"*. Ledger K3 records a *scheduled-vs-member reserve* in one lane only, with the reuse note *"extend the reserve idiom to every lane (TD-42)"*.
- **Mechanism.** Bloomberg's cap-with-a-meter, inverted — F-01 records the failure form precisely: the limits *"cannot be reset"*, *"There is no way of knowing whether the monthly data limit has been reached until it has been exceeded"*, surfacing as a cell value `#N/A Limit`. ⭐ The good half of the same product is its typed error taxonomy (`DAILY_LIMIT_REACHED`, `MONTHLY_LIMIT_REACHED`), which is what makes a refusal nameable.
- **Size.** **M** — a meter surface plus a population cap plus one price table. ⭐ Ledger K11's reuse note makes part of it cheaper: *"collapse five price tables to one module — TD-21"*, which also fixes the recorded mispricing (K8: *"cost guard prices Sonnet 5 at Sonnet 4.6's rate"*).
- **Depends on.** Nothing hard. `FB-S9-*` for where the cap is enforced.
- **Anti-pattern risked.** **PROD-C1** — it is the fix. ⛔ **PROD-C2** is the trap CARD 17 makes unavoidable: *"capping to zero at a tier without saying why, in the same place"* — with **one** paid tier there is no tier to explain the zero, so the reason must be stated at the number or it is stated nowhere. ⚠️ And **PROD-5**: a budget refusal must not be overwritten with *"nothing was retrieved"* — F-01 records exactly that defect shipping once.
- **Known it worked.** A member can read their remaining budget **before** it runs out; a refusal's rendered text names the cap (asserted as text, PROD-2); and the population cap is **seen to fire** in a rehearsal, because a cap nobody has seen fire is not a cap (GATE-1).

### 3.6 Platform core — S3, S4, S5, S6, S7, S8, S9, S11

#### FB-S3-01 — The entity master
- **Statement.** One permanent internal entity id, a dated ticker-alias list, and OpenFIGI as the free external mapping.
- **Row.** S3 Entity Master.
- **Provenance.** best-of-breed §6.2 item 2 — *"Absent; 'the clearest infrastructure gap the research found'; search is ticker-only"* — with the mechanism: *"one permanent internal entity id, a dated ticker-alias list, and **OpenFIGI** as the free MIT-licensed external mapping — with **Quartr's published discipline as the specification to copy** (ticker as ambiguous user input; `companyId` on every response; disambiguate by exchange). ⛔ **Cannot be bought:** CUSIP's terms prohibit maintaining a master file, and no vendor publishes an entity master to license."* `capability-infrastructure-matrix.md` S3: *"This system **IS** the normalization layer — that is its entire purpose"*, and *"Schema locks before implementation; design work can and should start immediately."*
- **Today.** **Absent.** Ledger **A8** — ticker search over `cap_universe.json` (3,742) plus a `ticker_meta` chain, with the limit *"ticker-only; no entity search for screens/notes/layouts"*. The capability matrix records that `cap_universe` is *"a membership **gate**, not an identity registry"*.
- **Mechanism.** Quartr's published discipline, above. ⚠️ best-of-breed §3.4 S3 grades the row 🔴 and says *"⌀ unrankable — internals not observable; **Quartr wins the published half**"*, so what is being copied is a *published API discipline*, not anyone's schema.
- **Size.** **L** — a new system with a schema other systems key against, plus an external mapping integration.
- **Depends on.** ⛔ One open technical question the matrix names and nobody has answered: *"whether Massive/FMP responses already carry a `figi` field is unconfirmed (data-architecture §26 — **a live API read would settle it**)"*. ⚠️ That read was not taken by this document (no network, by instruction).
- **Anti-pattern risked.** **DOC-1** — an alias list is a roster, and it must be dated and generated, never typed. ⛔ And the licensing constraint is structural, not a preference: CUSIP's terms prohibit the file, so the identifier choice is a licensing decision routed through the register.
- **Known it worked.** `companyId` (or its local equivalent) on every response, railed so no response is keyed by a bare ticker; and a ticker that changed hands resolves to the **right entity for the right date** — proved on a dated fixture, which is the only version of this test that can fail for the right reason.

#### FB-S4-01 — Typed context channels, starting with exactly one list-consuming panel
- **Statement.** Four symbol-only colour groups become typed channels — symbol · symbol-set · list-ref · timeframe · range — and the first consumer is one list-consuming panel, not a rewrite.
- **Row.** S4 Context Bus.
- **Provenance.** `capability-infrastructure-matrix.md` S4 NORMALIZATION: *"Typed payload kinds (symbol · symbol-set · list-ref · timeframe · range) — **the FDC3 vocabulary adopted without its container**"*; BACKEND WORK: *"**New (typed)**, on the existing colour-group seed; **start with exactly one list-consuming widget** (synthesis §12.1)"*; FRONTEND: *"retire the 'hydrated once per mount' limit."*
- **Today.** Ledger **C3** — link groups A/B/C/D plus `useAppFocus`, active and reusable, with *"a hard ceiling of four symbol-only groups; no TF/date/filter linking (RG-06); crosshair/aiSearch are ad-hoc buses"* (TD-05). best-of-breed §3.4 S4 calls it *"the strongest existing asset for a terminal"* and grades the row 🟢 with Bloomberg best-in-class and *"Koyfin (the better design)"* as runner-up.
- **Mechanism.** FDC3's vocabulary without its container — and Koyfin's design, which best-of-breed names the better one on this row.
- **Size.** **M** — a typed channel over a proven seed, with one consumer. ⚠️ Ledger B10 records why the ceiling bites today: the multi-chart grid *"composed on `StockChart` directly because link groups cap at 4"*.
- **Depends on.** Nothing. ⭐ Cheapest high-leverage platform item, because the seed is already the estate's strongest asset.
- **Anti-pattern risked.** **PERF-4** — a context bus is a re-render source, and F-01's recorded 4.5-hour navigation freeze came from a registration that re-rendered the registrant. ⛔ The architectural fix from that incident is the rule here: *"reads a separate, never-changing registrar context, so registering cannot re-render the registrant."*
- **Known it worked.** One list-consuming panel follows a `list-ref` channel; a board holds more than four linked contexts; and the render-count rail that exists for the 2026-09-10 class (`CatalystTable.renderLoop.test.jsx`'s shape) is applied to the bus with a bounded assertion.

#### FB-S4-02 — A panel declares a need; it never owns a transport, a budget or a freshness opinion
- **Statement.** Make the panel↔stream interface a subscription handle, not a URL, as a written structural rule before N panels exist.
- **Row.** S4 / D3.
- **Provenance.** ARCH-07 §3 **Q2** (ANSWERED, structurally) and §5.2: ⭐ *"A panel declares a need; it never owns a transport, a budget, or a freshness opinion… **This is one interface decision that forecloses three whole classes of failure, and it is cheap only before N panels exist.**"* The measured basis: *"The client pools already collapse N panels to ~2 connections… and the 16-cell grid measurement confirms it in practice — **16 cells, one SSE**"*; and *"`STREAM_MAX_SUBSCRIBERS = 300` is a per-process budget and a panel-owned stream turns it into 300/N users."* ARCH-07 §3 Q6 adds the field it must carry: *"**Both behaviours are right; the defect is that the distinction lives in a comment**"* — last-value-wins (`bar_broadcaster`, `maxsize=64`, drop-oldest) versus every-message-matters (the OPRA tape, a durable log plus a tailer, because *"Massive OPRA does not replay and a dropped message is a permanent gap"*) — *"It should be a **required field** in the panel contract, because a panel author cannot infer it and will assume whichever their first stream was."*
- **Today.** Ledger **A2** (one browser-wide price SSE pool, 50 tickers/conn, `STREAM_MAX_SUBSCRIBERS=300`), **A5** (the bars push pool, byte-separate by design), **F1** (the tape's tailer SSE). The pools are right; the contract is unwritten.
- **Mechanism.** Internal.
- **Size.** **S** as an interface decision taken now; **L** as a retrofit later. ⭐ That asymmetry is the item's entire argument and it is quoted from its source.
- **Depends on.** Nothing. It is a precondition of `FB-S1-03`.
- **Anti-pattern risked.** **PERF-6** and **PROD-C7** are the two the field closes: a panel that owns a transport also owns a drop counter nobody reads and a freshness opinion nobody reconciles. ⚠️ **STATE-7** is the framing to preserve — per-process hubs and budgets are *correctness guards, not caches*.
- **Known it worked.** A new panel cannot obtain a URL, only a handle (railed at the type level or by an AST check); and the required delivery-semantics field has no default, so a panel author must state it.

#### FB-S5-01 — One versioned workspace document in its own store ⛔ (and it must not be half-shipped)
- **Statement.** The board becomes one versioned document, atomically written, tombstone-deleted, in its own store — with the version-in-place bridge shipped **beside** the destination, never instead of it.
- **Row.** S5 Persistence & User State.
- **Provenance.** `capability-infrastructure-matrix.md` S5: *"**Rebuild the persistence layer, keep every idiom** — named 'the strongest single recommended change in the estate'"*, with *"One versioned document per board, schema version from first commit, tombstoned deletes, atomic writes — 'every ingredient exists and none is applied to the layout'."* F-01 §4 row 3 marks the family ⛔ **ACTIVE** — *"six of seven measured workspace failure modes are in this family"* — and quotes C5-03 §5.2: ⛔ *"anyone who ships step 1 and stops has left the board on a store whose own repo documents why it is wrong for this."*
- **Today.** Ledger **C7** — status **needs-extension**, the only one in the ledger: *"8 loosely-coupled pref keys, non-atomic template apply, localStorage watchlist columns"*, on *"`auth.db user_preferences` (opaque TEXT, no cap, no DELETE route)"*, with ⛔ *"corrupt blob → empty board autosaved within 500 ms; shape-sniffed migrations; `applyTemplate` = 6–7 writes + localStorage, no transaction (TD-03, TD-04)"*. ⭐ Every ingredient exists elsewhere: ledger **B4** (`settingsVersion: 2`, read-time fold, tombstoned instance deletes, union-by-id merge — *"the versioning seed for any workspace document"*), ledger **G3** (append-only versions, AST-asserted no-UPDATE), ledger **C4** (`charts_layouts.db` — *"the atomic-document shape the working state lacks"*).
- **Mechanism.** Internal, three times over. Bloomberg is best-in-class on the row (best-of-breed §3.4 S5) and its transferable half is `MNRS` — which is `FB-S5-02`.
- **Size.** **L** — a store change with a migration and a mandatory read-fallback shim, because `GOVERNING_PRINCIPLES` §13 forbids renaming persisted preference or widget keys.
- **Depends on.** Nothing. It is a dependency of `FB-S1-03`, `FB-S2-03`, `FB-S5-02` and `FB-A12-02`.
- **Anti-pattern risked.** **STATE-1 through STATE-6**, and ⛔ **the half-ship is the named failure mode**, which is why this is one item: the bridge (stamp a version on the existing blob) is cheap and the destination is not. ⚠️ **STATE-2** is the live data-loss path — a parse failure renders as a new user and autosaves over the original within 500 ms.
- **Known it worked.** Two assertions, both of which currently fail: **(a)** a corrupt blob does **not** autosave an empty board — a fixture that must be seen to fail without the fix; **(b)** a member can restore version N−1, which F-01 PROD-C4 names as the class's own detector: *"if a member can restore version N−1, the class is closed."*

#### FB-S5-02 — Workspace version history as a member-facing restore
- **Statement.** Keep N previous versions of a board and let a member restore one.
- **Row.** S5.
- **Provenance.** F-01 **PROD-C4** structural fix: *"**A version history on the workspace document, not a confirm dialog.** ⭐⭐ This is PROD-1 and STATE-2 arriving from the competitive side, and it is the single best external argument for C5-03's commitment 2."* Its evidence is the strongest indirect argument in the corpus: ⭐⭐ *"the strongest available indirect evidence that members destroy their own work is that Bloomberg productised the recovery"* — `MNRS <GO>` keeps *"up to ten previous versions"*, with Bloomberg's own guide naming both triggers, and three separate recovery affordances around that one feature. The conclusion quoted: ⭐ *"**Products do not ship undo for things that never go wrong.**"*
- **Today.** Nothing. Ledger C7 records no history; F-01 §4 row 17 marks the pair with PROD-C10 as ⛔ ACTIVE and notes *"no workspace version history exists (STATE-1), so there is no undo to productise."*
- **Mechanism.** Bloomberg's `MNRS`, with **ten** as its published depth.
- **Size.** **M** once `FB-S5-01` exists (a retention policy plus a restore surface); **impossible** before it.
- **Depends on.** `FB-S5-01`, hard.
- **Anti-pattern risked.** **PROD-1** — a dismissable control with no recovery path — is the class this closes, and F-01 records UCT paying for it once already (the "Hide joystick" incident, hit by the owner on production). ⭐ Its structural fix's third part is the pattern to reuse: a way back must not outlive the kill switch.
- **Known it worked.** A member restores N−1 and gets their board back. That is the whole observable and F-01 states it as the detector.

#### FB-S6-01 — The three documentation-only personalization moves, generated rather than written
- **Statement.** Publish the density ceilings, name the non-autosaving objects, publish the cross-device rule — and derive all three from the code that owns them.
- **Row.** S6 Personalization.
- **Provenance.** `capability-infrastructure-matrix.md` S6: *"three of the seven evidenced moves are **documentation-only and ready now** (C5-02 §9)"*, with BACKEND WORK *"**Consolidate**: documentation-only moves first (publish density ceilings, name non-autosaving objects, publish the cross-device rule), then additive UI moves"* and FRONTEND *"Make autosave visible; split favourites from recents."*
- **Today.** None of the three is published. Ledger N12 records *"no density tokens"*; ledger B3/C7 carry the cross-device accident; ledger C4's global boards exist (*"firm-published boards already exist as a mechanism"*).
- **Mechanism.** LSEG is best-in-class on S6 (best-of-breed §3.4), and its transferable artefact is the one F-01 PROD-C3 also reaches for: *"ship a **per-surface capability matrix as a product artefact**."*
- **Size.** **S** — three publications. ⛔ **M if each must be derived**, and it must, which is the whole caveat.
- **Depends on.** `FB-A12-02` is the cross-device half; they should ship as one artefact.
- **Anti-pattern risked.** ⛔ **PROD-6** head-on: *"Prose cannot fail. A rail can."* A documentation-only move is by definition a paragraph, so each of the three must be generated from its source and railed, or it becomes DOC-4 within a release. ⚠️ **PROD-C1** also applies to the density ceiling — a published ceiling is a cap, and a cap wants a meter.
- **Known it worked.** Changing a density constant changes the published ceiling with no content edit; changing an object's autosave behaviour changes the published list; and a rail fails if any of the three cannot be resolved to a source, printing `unreadable` rather than a default.
#### FB-S7-01 — The remaining seven trigger types, authorized one at a time
- **Statement.** One of eight trigger types is built; the other seven are extensions of a real foundation, and each needs the same two gates.
- **Row.** S7 Alerts & Monitoring.
- **Provenance.** `product-architecture.md`'s S7 Alerts IMPLEMENTATION RECORD: `document-arrival` ✅ built, the other seven ❌ *"not built"*, and *"The registry, predicate store, delivery seam and receipts are generic, so the remaining seven are extensions of a real foundation rather than a rewrite."* ⭐ *"This unblocks S7 Alerts. It does not authorize it — completion is Wave 2, plan-only, with trigger types authorized individually by the owner."* Sequencing is ruled: **CARD 10** makes `catalyst-match` the next increment (58 predicates, 58 verdict-ready, 80 agreed, zero `new_only`/`legacy_only`/`not_comparable` — *"the cleanest absorption in the taxonomy"*), prefers it over `regime-change` and `event-proximity`, and ⛔ *"Not `indicator-condition`: its 0 predicates is its **correct** state, sequenced behind D2."* **CARD 11** re-cuts the scan-membership bar to one the instrument can reach.
- **Today.** `api/services/alert_taxonomy/` ships, Terminal-Next owns it, and **filing watch is a protected consumer, live to members since 2026-09-11 12:07:29 ET**.
- **Mechanism.** Unusual Whales' `where` grammar (best-of-breed §3.4 S7, **$50/mo list**) for authoring; Bloomberg for delivery and lifecycle, with ◻ its `ALRT` condition grammar 🔴 because the documentation page is CAPTCHA-walled.
- **Size.** **M per type**, and they are genuinely independent.
- **Depends on.** ⛔ Per-type owner authorization; `FB-D2-01` for `indicator-condition` specifically; and for every type, the record's two gates — the **filing-watch parity test** and §2a's mandatory checklist (*"shapes pinned at registration, a **named call site with a rail asserting it exists**, and a liveness stamp"*, whose item 3 CARD 10 notes *"caught the only real defect in price-level CP3, so it is not a formality"*).
- **Anti-pattern risked.** **GATE-1** — a parity test never seen to fail proves nothing — and **REACH-2**, which item 3 of the checklist exists to catch. ⚠️ **CARD 9** records the subtler one: a bar that treats correct suppression as a defect is *"measuring the wrong direction"*, because one predicate's 2,344 `legacy_only` ticks turned out to be *"2,344 they would have been spammed with, which the new rule correctly declines to send."*
- **Known it worked.** Per type: `verdict_ready` with `legacy_only == 0` and `new_only == 0`, the named call-site rail existing, and filing watch's observable behaviour unchanged. ⭐ CARD 11's discipline binds the reporting: *"**n is reported as n, always** — a flip packet on this bar says '1 real-member fire', never 'verified'."*

#### FB-S7-02 — Publish the cooldowns, and show fire-frequency at authoring time
- **Statement.** Before saving an alert, a member sees how often it would have fired; and the cooldowns that protect them are published rather than implicit.
- **Row.** S7.
- **Provenance.** F-01 **§6 appendix item 1**, which supplies the counter-patterns: `benzinga-pro/dossier.md` §J/§M *"publishes its cooldowns (price spikes 'fire at most once every 10 minutes for a given symbol', thresholds scaling with average range, a Series variant requiring **≥3 highs within 2s then 1s of quiet**)"*, and `bloomberg/03-news-alerts.md` §6 shows *"**stories per hour** for the current filter, at authoring time, 'so the user can see whether a search is survivable before saving it'"* — and publishes *"its own noise list of ~13 low-signal topic codes to exclude"*.
- **Today.** Cooldowns exist and are not published: ledger K7's awareness engine has an 8/day cap and a 6 h per-symbol cooldown; ledger I3 has none stated; F-01 G-6 records `chart_health_alerts`' 600 s throttle beside a 1800 s Discord cooldown, both in module dicts.
- **Mechanism.** Benzinga's and Bloomberg's, above.
- **Size.** **M** — a historical-frequency query per predicate type plus a publication.
- **Depends on.** `FB-S7-01` (the taxonomy is where a published cooldown belongs), `FB-A9-01` (the same authoring-time idiom, one surface over).
- **Anti-pattern risked.** ⚠️ **F-01 places this class in its "suspected, unevidenced" appendix and says why: the repo records the *mechanism* twice — a grace window, and *"muted inside a week"* — but no member-facing alert-volume incident.** So the *need* is unevidenced for UCT and only the counter-pattern is evidenced. ⭐ Recorded as an opportunity precisely because F-01 says it is *"promotable the moment an incident exists"*, and because `FB-S7-01` will multiply alert volume by seven. **PROD-C1** applies to the published cooldown: a cap wants a meter.
- **Known it worked.** A member can read, before saving, how often the alert fired over the last N sessions; and the cooldown a receipt cites is the one the code applies, derived rather than typed.

#### FB-S7-03 — A second delivery channel, and split ops from business events
- **Statement.** Discord is the sole alerting channel and the first thing to go quiet; add a second, and stop routing pages through the signup channel.
- **Row.** S7 (with S12's observability half).
- **Provenance.** `capability-infrastructure-matrix.md` S7 REMAINING GAP: *"Discord being 'the sole alerting channel and the first thing to go quiet' (TD-43) is an **operational-resilience risk needing a second delivery channel**, not a new data provider."* Its FRONTEND WORK: *"One delivery-channel registry replacing seventeen-plus separate webhook variable names."* ARCH-07-OBS **G-5** measures the second half: `DISCORD_WEBHOOK_URL` referenced by **30** modules, and *"`DISCORD_ADMIN_WEBHOOK`… is the same webhook used by `notify_signup`, `notify_waitlist_signup`, `notify_subscription`, `notify_churn_risk` and `notify_admin_action`. **The operational alert channel is the business-event channel**"* — with the control that **14** distinct `DISCORD_*WEBHOOK*` names exist, *"so the codebase is perfectly capable of routing — it just does not, for ops."*
- **Today.** Ledger **M4** — *"~17–20 URL vars; `discord_notify.py` imported by 16 modules"*, and ⛔ *"**Discord is the sole alerting channel and the first thing to go quiet** — four PC monitors silent for weeks (TD-43)"*. Ledger P9 (Resend) exists as a delivery mechanism already, and ledger I3's `deliver_alert_payload` is the shared seam.
- **Mechanism.** Internal. ⭐ ARCH-07-OBS **OBS-8**'s default is the shape: *"A new **`DISCORD_OPS_WEBHOOK_URL`** carrying PAGE and DIGEST, **falling back to `DISCORD_WEBHOOK_URL` when unset**"* — because *"the fallback means a missing variable degrades to today's behaviour and **never to silence**."*
- **Size.** **S** for the split (ARCH-07-OBS §5 ranks it fifth *"because it is configuration, not code"*, and says the split should land **before** new traffic does); **M** for a genuine second transport.
- **Depends on.** Nothing. ⭐ It is a precondition for `FB-OBS-02`/`FB-OBS-04` being worth building: *"items 3 and 4 begin adding traffic to the channel that G-5 says is already mixed."*
- **Anti-pattern risked.** ⛔ ARCH-07-OBS names the failure exactly: *"**A channel where a page arrives between two signup notifications is muted by the same mechanism, one level up: it is not the individual alert that fires on the normal case, it is the channel.**"* ⚠️ And an operational gotcha to inherit: an outbound post needs a browser User-Agent because `Python-urllib` returns *"HTTP 403 / error code: 1010 — **Cloudflare, not Discord**"*.
- **Known it worked.** A blanked ops webhook degrades to the old channel rather than to silence, proved by blanking it (never by removing the variable); and a page is distinguishable from a signup by channel alone.

#### FB-S8-01 — The shared provenance component set, plus a rail that asserts every panel uses it
- **Statement.** `<Provenance>`, `<FreshnessBadge>`, `<CoverageLine>`, `<Cited row=…>` as one set — and a check that a panel cannot ship without one.
- **Row.** S8 Provenance & Freshness.
- **Provenance.** `capability-infrastructure-matrix.md` S8 FRONTEND WORK, verbatim: *"Build `<Provenance>`, `<FreshnessBadge>`, `<CoverageLine>`, `<Cited row=…>` as one shared component set that every AI/data surface routes through"*, over a NORMALIZATION cell reading *"generalize `CoverageLine`/the COT gate/AI-Search citation chips into one rendering component (Readiness Review §7 D6, 'low controversy, high leverage')"*. best-of-breed §6.1 item 3 puts S8 among the five closest rows and calls the work *"consolidation, not new capability"*. F-01 **PROD-C7** supplies the missing half: ⚰️ the primitives **exist** — *"`app/src/components/provenance/FreshnessBadge.jsx` + `freshnessContract.js` + `sessionStale.js`"* — and ⛔ *"**Nothing asserts that every panel uses them**."*
- **Today.** Real mechanisms, scattered and unshared: ledger **G2** (`CoverageLine`'s four counts), ledger **H5** (the COT grounding gate, which *fails closed* — Bloomberg's own dossier calls that *"the stronger version"*), ledger **K2** ("grounded on" chips), ledger **F7** (`flow_explain`'s facts-first narration). Plus the two shipped primitives above.
- **Mechanism.** LSEG's (best-in-class, 🟢 *"quoted at mechanism level"*), with Bloomberg's **M9** and AlphaSense's **M2** as the citation half.
- **Size.** **M** — ⚰️ **not L**, because §2.4's second correction applies: two of the four primitives exist, so this is extraction plus a rail plus adoption.
- **Depends on.** Nothing. It is a dependency of `FB-A1-01`, `FB-A3-02`, `FB-A6-01`, `FB-A11-03`, `FB-A9-02`, `FB-I1-01`.
- **Anti-pattern risked.** **GATE-2** (three copies of one guard) if the old displays survive; **PROD-3** (present is not showing) on the rail — a component imported is not a component rendered, and F-01's three-way measurement (the `hidden` attribute, the computed `display`, **and** a non-zero box) plus a must-read-SHOWING fixture is the standard.
- **Known it worked.** A rail **derives** the panel set and fails by name on one with no provenance affordance, with a control; and each panel's as-of is readable without opening a FAQ (which is PROD-C7's own test).

#### FB-S8-02 — One shell-level freshness authority, expressed in time units
- **Statement.** One authority decides, for the whole shell, the maximum age a panel may display without saying so.
- **Row.** S8 (the ruling is ARCH-07's).
- **Provenance.** ARCH-07 §3 **Q3** — **OPEN**, *"and it needs one authority"* — and §4 **D8**, which owns the ruling: *"**One shell-level freshness authority.** Per-chart hysteresis is right for one chart and wrong for twelve."* The measured basis: *"Chrome's intensive throttling (once per minute past five minutes hidden) and freezing (timers and fetch callbacks do not run), so **any tick-derived freshness indicator is wrong exactly when it matters**. The shipped mechanism is recency-gated with hysteresis: engage at <120 s since the last bar, disengage only after 150 s."* ⛔ *"the maximum age a panel may display without saying so is **a product decision nobody has made**."*
- **Today.** A good per-chart contract that ARCH-07 says is explicitly *"not a board contract"*: ledger A5's hysteresis pair (`BARS_LIVE_STALE_MS` / `BARS_LIVE_DISENGAGE_MS`).
- **Mechanism.** SpotGamma's two-speed contract stated out loud, and Unusual Whales' degrade-by-freshness-not-by-feature (both via F-01 PROD-C7). ⭐ And the transferable *form* of a speed claim, from best-of-breed §2.5: Quartr's percentile SLAs with a named window and a stated failure rate, and Fiscal.ai's *"3–7 minutes after earnings"* — *"self-auditing… falsifiable by the customer on any earnings day."*
- **Size.** **S** as a constant plus a contract; ⛔ blocked on a product decision that is one sentence.
- **Depends on.** ⛔ The decision. `FB-S8-01` for the render.
- **Anti-pattern risked.** **PROD-C7** — it is the fix, and F-01 marks UCT's exposure ⛔ ACTIVE on this row. ⚠️ **INST-2/INST-3**: a freshness indicator derived from ticks is an instrument pointed at a proxy, and Chrome's throttling makes the proxy wrong exactly when the answer matters.
- **Known it worked.** A hidden-then-restored tab does not display a stale value as fresh — which requires the freshness signal to be **time-derived, not tick-derived**, and is therefore a test that can only pass if the mechanism changed.

#### FB-S9-01 — Make the auth-surface auditor see a GET, and publish its denominator
- **Statement.** The one instrument that audits the auth surface iterates mutating methods only, so it is reassuring in exactly the region a terminal lives in.
- **Row.** S9 Entitlements & Licensing Gate.
- **Provenance.** F-01 **GATE-7** / §4 row 5 (⛔ ACTIVE, **highest severity**): *"ARCH-06 is the entitlement architecture, and the one instrument that audits the auth surface cannot see a GET."* ARCH-07-OBS **G-4** measures it: *"`api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}` and `:248` loops `for method in sorted(m for m in methods if m in MUTATING)`"*, and classifies it as *"a correct artifact read over an incomplete population. Its output is therefore reassuring in the exact region a terminal lives in: **reads**."* ⭐ Item 25's one addition: *"**the widened auditor must publish its population size**, not just its failures. A guard that reports '0 unguarded routes' without saying over how many routes is indistinguishable from a guard that examined nothing."*
- **Today.** The auditor runs at boot over mutating methods. ⚠️ G-4 leaves a known unknown: *"`middleware_guarded_prefixes(app)` exists at `:198` and its population was never enumerated, so some GETs may be covered by a prefix. That is an **unknown coverage set**, which for observability purposes is the same as uncovered until enumerated."*
- **Mechanism.** Internal. Gödel's `ENT` is best-in-class on S9's *mechanism* half (best-of-breed §3.4), but that is `FB-S9-04`'s business.
- **Size.** **S** — a set literal, a loop, and a printed denominator. ⛔ ARCH-07-OBS §5 ranks it eighth *"not because it is unimportant but because item 23 owns the decision"*, and records that item 23's DP-6 already rules the widening *"Engineering — no owner input needed… it is additive and fails closed"*.
- **Depends on.** Ownership (item 23), not evidence.
- **Anti-pattern risked.** **GATE-7** — it is the fix — and **INST-8**/**INST-1**'s family: a count without its population is not a measurement. ⛔ **GATE-1**: the widened auditor must be seen to fire.
- **Known it worked.** ARCH-07-OBS names the proof method: **inject a route with no guard and assert the alert text names it**; and the auditor prints `unguarded / denominator`, with `middleware_guarded_prefixes`' population enumerated rather than assumed.

#### FB-S9-02 — Close the six route families still dependency-less
- **Statement.** Six route families carry no auth dependency in source; R-17 is deliberately not reported closed.
- **Row.** S9.
- **Provenance.** F-01 §4 row 5 and §3 row 3: *"**Vendor real-time market data answering unauthenticated GETs** (R-17, CONFIRMED 2026-09-02, H/H), with **six route families still dependency-less** in the 2026-09-25 source read"*, and *"R-17 is deliberately **not** reported closed"*. `RISK_REGISTER.md` R-17 (H/H, open, confirmed) carries the original measurement: `/api/live-prices?tickers=SPY` 200, `/api/snapshot/SPY` 200, `/api/movers` 200, `/api/gex/data` reaching its handler with a 422.
- **Today.** ⭐ Five of the named endpoints are closed and the closure was measured: OI-17, RESOLVED 2026-09-23, added `Depends(get_current_user)` to `/api/live-prices`, `/api/snapshot`+`/{ticker}`, `/api/movers`+`/api/extended-movers` and `/api/gex/data`, pushed `caebdab16`, *"a real anonymous `curl`… now returns `401`, was `200`"* — with `/api/live/massive/ticker-flow` explicitly out of scope as partner-owned. Ledger §R still enumerates a longer unauthenticated set (A1, A6, A7, E1, E8 `scope=all`, E9, E11–E13, E15, F3, F6, N7, O2/O3) as *"by design or pending intent"*, which is the population this item works against.
- **Mechanism.** Internal.
- **Size.** **M** — per-family, with a decision per family about whether the openness is deliberate (OI-13's `/r/calendar` cookieless read and O2/O3's status routes are the known deliberate cases).
- **Depends on.** `FB-S9-01` (the auditor must be able to see the work).
- **Anti-pattern risked.** **INST-1** — *"an unauthenticated probe of a gated route measures the gate"* — which is the measurement discipline for verifying this, and ARCH-07 §5.3 generalises it: *"Any future edge or latency measurement against a paid surface must authenticate first or declare that it did not."*
- **Known it worked.** An anonymous request returns 401 per family, measured the way OI-17's closure was measured; and `FB-S9-01`'s denominator covers them.

#### FB-S9-03 — Per-route rate limits before any programmatic client
- **Statement.** About 1,150 routes carry no HTTP limit, and a terminal with programmatic clients needs per-route limits.
- **Row.** S9.
- **Provenance.** Ledger **P8** — *"slowapi keyed on `CF-Connecting-IP`, 38 decorators in 6 files (auth, voice, transcripts, earnings, waitlist)"*, reuse note *"extend (**a terminal with programmatic clients needs per-route limits**)"*, limit *"~1,150 routes have no HTTP limit"*. best-of-breed §6.2 item 4 makes it the gate on egress: *"⚠️ Gate it behind S9 first: `ledger P8` records ~1,150 routes with no HTTP limit."*
- **Today.** 38 decorators; ledger O6 records *"slowapi covers 38 routes"* and *"only Finnhub and AV have budgets"*.
- **Mechanism.** ⭐ Quartr's, per best-of-breed §3.6 X2: *"`429` with reset headers, cursor pagination, and an explicit 'poll `updatedAfter` with `limit=500`' incremental-sync recommendation."* A limit a client can *respect* is a different artefact from a limit that merely refuses.
- **Size.** **M** — a default-plus-override policy rather than 1,150 decorators. ⛔ 1,150 hand-applied decorators would be DOC-1 in code.
- **Depends on.** Nothing. It is a hard dependency of `FB-X2-01`.
- **Anti-pattern risked.** **DOC-1** (per-route rosters), **PERF-1** (a limiter that writes per request on the auth path is the recorded outage), and **PROD-C1** — a limit is a cap, so it wants reset headers, which is the meter in API form.
- **Known it worked.** An unlimited route cannot be added — a rail over the route table with a control; and a `429` carries a reset header a client can obey, proved by a client that obeys it.

#### FB-S9-04 — Give `entitlements.py` the column it reads
- **Statement.** The entitlement lookup reads a `toolkit` column the schema lacks, so it always resolves to `"all"`.
- **Row.** S9.
- **Provenance.** `capability-infrastructure-matrix.md` S9: *"`entitlements.py` exists with four axes and one toolkit `"all"`, **reading a `toolkit` column the schema lacks** (capability-ledger G12)"*. best-of-breed §3.4 S9 states the consequence: *"`entitlements.py` reads a `toolkit` column the schema lacks ⇒ **always `"all"`**"*.
- **Today.** Ledger **G12** — entitlement limits on scans (`max_symbols`, a history-depth refusal `ToolkitWithheld`, definition count) with *"refresh cadence **not wired**"*, *"no numbers; one toolkit"*, reuse note *"extend (**the natural home for Terminal-Next tiering**)"*. Ledger **P5** — *"active (mechanism) · **exists-limited** (no numbers)"*, with *"`premium`/`lifetime` strings orphaned"*.
- **Mechanism.** Gödel's `ENT` is best-in-class on the mechanism (best-of-breed §3.4 S9), ⚠️ and its own status is BETA.
- **Size.** **S** — a column, a migration, and the orphaned strings removed. ⭐ **CARD 17 shrinks it further:** the tier axis *"collapses to a **binary**: paid or not"*, so this is about *toolkits and limits*, not tiers.
- **Depends on.** Nothing. ⛔ **The numbers are owner-bound** — CARD 17 leaves price, trial and seat model undecided, and §2.3 records that no item here proposes a metered capability.
- **Anti-pattern risked.** **GATE-4** (a guard that verifies itself instead of the property) — a lookup that cannot fail is not a lookup. ⭐ The capability matrix already warns against the shortcut: *"returning the default unconditionally would be indistinguishable from a lookup that had been deleted."*
- **Known it worked.** A second toolkit value produces a different answer — which requires a fixture with two toolkits, and is impossible today; and `ToolkitWithheld` is seen to fire on a real limit rather than only in a test.

#### FB-S11-01 — The market clock, shipped as code, with a horizon rail
- **Statement.** One versioned session calendar — sessions, half-days, holidays, and the pre/RTH/post/closed boundary — consumed by every panel and injected into every AI answer as a grounded fact.
- **Row.** S11 Session & Market Clock.
- **Provenance.** `capability-infrastructure-matrix.md` S11: **Absent as a system** — *"`calendarTime.js` is 35 lines and 'not a market calendar'; **no AI lane injects session state today**"* — *"This system IS the missing normalization of time itself"*, built as *"**New, small** — a versioned dataset published years ahead, shipped as code"*, with `sessionState(now)`, `nextBoundary`, `isHalfDay` *"consumed by every panel and injected into every AI answer as a grounded fact, **never as a cache salt**"*, and ⭐ *"One of the cheapest genuinely-new systems in the whole matrix — small, well-bounded, zero licensing exposure."*
- **Today.** Ledger N7's neighbourhood holds the seeds (`dashboard/sessionModel.js` survived `MarketStatusBar`'s deletion); `calendarTime.js` is 35 lines. best-of-breed §3.4 S11 grades the row 🔴 and records ◻ *"not established for any product"* — nobody in the benchmark set publishes a mechanism here.
- **Mechanism.** ⌀ None available. The named shape is NYSE's published early-close dates.
- **Size.** **S** — the dataset is small and the API is three functions.
- **Depends on.** Nothing. ⭐ It is a dependency of `FB-S8-02` (a freshness contract needs to know whether the market is open) and of every AI lane that should say "the market is closed".
- **Anti-pattern risked.** **DOC-1** on the dataset, and ⛔ **DOC-4** specifically — *"a record that was true when written, standing in for a live obligation"*: a calendar with a horizon is true until it runs out, silently. ⚠️ The repo already records this class in an adjacent form (an arming condition that names a test and expires).
- **Known it worked.** Every panel and every AI answer reads one session state; and ⭐ **a rail fails when the dataset's horizon falls below a stated number of months** — which is the only test that catches the actual failure mode, since a correct calendar and an expired one look identical on any single day.

### 3.7 Data platform — D1, D2, D3, D4, D5

#### FB-D1-01 — The Massive adapter (and the retirement queue behind it)
- **Statement.** Twenty-plus modules build `api.massive.com` URLs themselves with no token bucket; one adapter owns the boundary, stamps the vendor and the licensing class, and the retirement queue empties behind it.
- **Row.** D1 Provider Abstraction.
- **Provenance.** `capability-infrastructure-matrix.md` D1: *"the two highest-priority adapters to build are Massive (#1 — '20+ modules build `api.massive.com` URLs themselves… **no token bucket at all**') and FMP (#4)"*, over an **Absent, with one working exception** cell naming `finnhub_client.py` as *"the internal reference implementation to copy"* and `alphavantage_client.py` / SnapTrade's client as the second and third precedents. The boundary's purpose is quoted from the licensing register: *"the adapter is where every value gets its vendor-of-origin + data-class field stamped — 'the one place in the request path that always knows which vendor answered'… **provenance is a field, not a memory**."* The retirement queue is named: *"Bullflow #15, Polygon-direct #17, AlphaVantage #7 candidate, Finnhub #6 candidate, yfinance #12 candidate, ForexFactory #39 candidate."*
- **Today.** Ledger A1/A3/A7/F5/F10 all reach Massive directly; ledger F9 records Bullflow as **deprecated** with the router still mounted and an empty buffer; ledger F10 records the Polygon-direct duplicate.
- **Mechanism.** Internal (`finnhub_client.py`). Quartr's published API discipline at the boundary.
- **Size.** **L** — one adapter plus a migration of 20+ modules, and it is the substrate for five other items.
- **Depends on.** Nothing. ⭐ `FB-A3-01` is the *named first proof case*, so the pattern should be established there and applied here.
- **Anti-pattern risked.** **DOC-2** is what it closes. ⚠️ **PERF-1**'s sibling: the token bucket that does not exist today is a correctness guard, and per **STATE-7** a per-process bucket silently doubles if the pod ever multi-instances — so the trigger belongs in a comment beside it (ARCH-07 §3 Q8).
- **Known it worked.** An AST rail — *"nothing outside the adapter constructs a vendor URL"* — in the `test_yf_guard_census.py` shape, with a control; every response carries a vendor and a licensing class; and a retired provider's key can be removed without a code change.

#### FB-D2-01 — The canonical model and metric address book, ten figures first
- **Statement.** One canonical schema per data class, a typed provenance record per stored value, and an address for every computed metric — starting with the ten figures a desk answer most often states.
- **Row.** D2 Canonical Data Model & Metric Address Book.
- **Provenance.** `capability-infrastructure-matrix.md` D2 — **Absent**, with the measurement: *"~55 distinct SQLite files, ~200 `sqlite3.connect` call sites, no ORM, 286 distinct `CREATE TABLE` names, 'no single place that knows what the data model is'"*, one partial counter-example in `bars.db`'s newer-wins design. The build: *"**New; explicitly on the critical path**… `bar_provenance.py`'s shape is the internal template to generalize; **scope to NEW Terminal-Next classes first** — the ~55 legacy files are consumed through D1-shaped readers until each class is migrated, never migrated by fiat."* And the verdict: *"**No provider gap — but the single most consequential build item in this entire matrix.**"* ⭐ Its own first test: *"pick the ten figures a desk answer most often states and confirm each has a stable id + as-of + inputs today."*
- **Today.** Absent as a system; `bar_provenance` and `bars.db`'s provenance table (ledger A10) are the template. ⭐ CARD 12 records D2's last open item flipped and executed — `D2_DUAL_COMPUTE_WARM_READER_ENABLED`, a dark log-only dual-compute comparison — so a dual-compute discipline already exists to build on.
- **Mechanism.** XBRL-borrowed names for statement line items; the W3C PROV shape for the provenance record. Both are named in the source.
- **Size.** **XL** — it is the system other systems are rewritten against, and F-01's PROD-C8 says half of the citation problem *"is a data-modelling job no citation API will do"*.
- **Depends on.** Nothing, and everything depends on it: `FB-A13-01`, `FB-I1-02`, `FB-A3-02`, `FB-S2-03`'s metric addresses, and `indicator-condition` in `FB-S7-01`.
- **Anti-pattern risked.** ⛔ **STATE-3** (one conceptual write that is physically eight, with no transaction) is the class it must not reproduce at a larger scale. ⚠️ And *"never migrated by fiat"* is in the source because migrating 55 files at once is how a canonical model becomes a second authority over all of them.
- **Known it worked.** ⭐ The ten-figure test, and it is answerable today: each of the ten has a stable id, an as-of and its inputs. Then: a new Terminal-Next data class is unrepresentable without a provenance record, railed.

#### FB-D3-01 — Emit `id:` on the streams so resume becomes possible
- **Statement.** The SSE streams emit no event ids, so `Last-Event-ID` resume is unavailable by construction.
- **Row.** D3 Realtime Streaming.
- **Provenance.** ARCH-07 §3 **Q4** (NARROWED): *"`Last-Event-ID` resume remains unavailable **until the streams emit `id:` at all**, which C7-01 §1 lists as open and this document does not close."* The adjacent measurement that bounds its urgency: *"uptime resets inside 60 s and fresh-pod page loads are 3.1–3.7 s, **so a full refetch on resume is affordable**."*
- **Today.** Ledger A2 (`stream_prices`, a 250 ms loop with a 15 s heartbeat) and A5 (`stream_bars`, a 10 Hz emit throttle, `Queue(64)` drop-oldest) — no ids.
- **Mechanism.** The SSE specification itself. ⚠️ ARCH-07 §3 Q6's distinction decides whether resume even *means* anything per stream: last-value-wins (bars) versus every-message-matters (the tape).
- **Size.** **S** to emit; **M** to honour on reconnect.
- **Depends on.** `FB-S4-02` (the delivery-semantics field tells a consumer whether resume is meaningful).
- **Anti-pattern risked.** ⚠️ **PERF-6** — an id makes a gap *detectable*, which creates a counter, which then needs a reader (`FB-OBS-02`). ⛔ Emitting ids without reading the gaps is the recorded shape of instrumenting loss and not watching the instrument.
- **Known it worked.** A reconnect with `Last-Event-ID` returns the missed events for an every-message-matters stream, or declares a gap — and for a last-value-wins stream it declares that resume is not applicable rather than silently refetching.

#### FB-D4-01 — Widen `serve_stale` adoption past five consumers
- **Statement.** The serve-stale-plus-warmer pair is the estate's proven fix for cold cliffs and is adopted at five sites.
- **Row.** D4 Caching & Serving.
- **Provenance.** `capability-infrastructure-matrix.md` D4: *"`serve_stale.py`, `cache_snapshot.py`, `cache_policy`, `source_circuit_breaker` are named 'the most valuable code in `api/`' (O6), **currently under-adopted at only 5 consumers**"*, with BACKEND WORK *"**Extend** — wider adoption of the already-proven serve-stale + warmer pair, which the calendar-enrichment case (E11) already validated as 'the structural fix'"*, and NORMALIZATION *"Pair every data class with a coverage floor, echoing the existing per-field-floor pattern already proven in `provider_coverage_monitor`."*
- **Today.** Ledger **O6** — active and strong, five consumers, *"`serve_stale` under-adopted (5 sites); only Finnhub and AV have budgets"*. The validated case is ledger **E11**: a *"130× cold/warm cliff (17.9 s → 0.14 s) re-armed every 300 s without the warmer"*. The unfixed cases are `FB-A10-04`'s 31 MB packs and ledger E1's *"cold 4.5–8 s (8,005 ms observed from OptionsFlow)"*.
- **Mechanism.** Internal, and the coverage-floor pattern is internal too (ledger D12, 13 fields with per-field floors, self-heal and alert-on-change).
- **Size.** **M** — adoption per data class, with a floor per class.
- **Depends on.** Nothing. ⭐ It is the mechanism `FB-A10-04` needs and the cheapest route to CARD 16's p95.
- **Anti-pattern risked.** ⚠️ **PROD-C7** — served-stale is a freshness state and must be visible at the value, not only in a cache tier; CARD 16 ruled `stale-swr` counts as **SERVED** *and* that the tier mix is reported beside the latency gate *"never as a pass/fail"*. ⛔ **INST-4**: a warm-ratio gate a healthy system fails is what CARD 16 retired, and a coverage floor set from a cold sample repeats it.
- **Known it worked.** A cold-pod load of the adopting surface has no call over 3 s (the `results.md` metric); and the tier mix is reported beside the p95, which is `FB-OBS-01`.

#### FB-D5-01 — Adjustment as a labelled policy, with the sentence already decided
- **Statement.** Split/dividend adjustment becomes a labelled policy (detected → confirmed → applied) with a display label, and raw-and-adjusted views run in parallel.
- **Row.** D5 Reference & Corporate-Actions Data.
- **Provenance.** `capability-infrastructure-matrix.md` D5 NORMALIZATION: *"Adjustment stored as a labelled policy (detected → confirmed → applied) with an explicit display label ('split-adjusted, 2026-09-02' / 'as reported'), **replacing the current silent fallback-trigger symptom** (`_is_intraday_stale()`)"*; BACKEND *"**New, small** — TradingView's explicit-confirm and Bloomberg's labelled raw-plus-adjusted views are 'cheaper-than-a-full-corporate-actions-engine responses'"*. ⭐ **CARD 7** already decided the copy: *"stays deferred to S8/S10 per its own approval, and the copy is decided now so the deferral costs nothing later. When a surface renders `GET /api/bars/{ticker}/adjustment-basis`, the sentence is: **'Prices reflect splits and dividends as of {basis_date}. Source: {vendor}.'** Two facts, both from the endpoint, no adjective."*
- **Today.** The endpoint exists (CARD 7 names it) and no surface renders it. Ledger A3 records the symptom this replaces: *"**Stale intraday detection**: `_is_intraday_stale()` checks if Massive data is >5 days old (catches pre-split bars), falls back to yfinance"* — i.e. a split is currently detected as staleness.
- **Mechanism.** TradingView's explicit-confirm; Bloomberg's labelled raw-plus-adjusted views.
- **Size.** **S** for the label (the sentence and the endpoint exist); **M** for the parallel raw view.
- **Depends on.** `FB-S8-01` / `FB-S10-*` — CARD 7's re-open trigger is *"S8/S10 mounting the basis on a member surface"*, so this item **is** that trigger.
- **Anti-pattern risked.** **PROD-C7** — the label belongs at the value. ⚠️ **CARD 5** rules the adjacent thing **not built**: *"the inert corp-actions ledger… Nothing reads it; a table with no consumer is a second authority waiting to drift"* — so this item must not create a ledger, only a policy field on values that are read.
- **Known it worked.** A split-affected chart renders CARD 7's sentence with real values; and `_is_intraday_stale()` stops being the split detector, proved by a fixture split that does not trigger a staleness fallback.

#### FB-D5-02 — Route dividends off yfinance onto Massive reference
- **Statement.** Two modules still call yfinance for splits and dividends, while the one Massive class already licensed for external publication sits unused for it.
- **Row.** D5.
- **Provenance.** `capability-infrastructure-matrix.md` D5 — **B-class, underutilized**: *"the capability exists and is called for other classes, but `breadth_dividends.py`/`dividends_calendar.py` still route to yfinance instead of Massive today"*, over a licensing cell reading *"Massive reference is the one class whose external-publication column is already **LA** even at Individual tier — the least licensing-exposed part of the entire Massive relationship."*
- **Today.** Ledger **E9** (month view, IPO and dividend/split overlays) and the capability matrix's D5 provider cell name yfinance for dividends; yfinance is X-class with *"no purchasable remedy"* and OI-03's answer records it as an explicit **risk-acceptance** (D-004), not a licence.
- **Mechanism.** None external.
- **Size.** **S** — two modules, one already-licensed source.
- **Depends on.** `FB-D1-01` for the adapter, though the swap does not strictly require it.
- **Anti-pattern risked.** None in the library. ⚠️ **INST-7** applies to the verification: comparing the two sources' dividend histories is only informative if they do not share an upstream.
- **Known it worked.** No yfinance call on the dividends path, by the existing AST census shape; and the dividend series matches the incumbent per name, with disagreements enumerated by name rather than counted.
### 3.8 Observability and measurement — all S12, collected because they read better together

⚠️ **Every item here belongs to the S12 row of the taxonomy**; none is a new capability family. ⛔ And one thing is deliberately **not** proposed anywhere in this section: ARCH-07-OBS §5's closing note — *"One item deliberately absent from this list: **anything that changes the deploy cadence.** Item 24 §4 D9 re-scored frequent recycling as partly load-bearing against the leak, and §4.2 (3) says the fix for a counter a deploy destroys is to **move the counter**, never to deploy less."* This backlog adopts that position.

#### FB-OBS-01 — Make CARD 16's p95 gate measurable (two constants and one print) ⭐
- **Statement.** The programme's only performance gate cannot be evaluated because nothing computes a latency percentile.
- **Row.** S12.
- **Provenance.** ARCH-07 GAPS: ⛔ *"**No p95 anywhere.** CARD 16 replaces a warm-ratio gate with a p95 latency gate, and no p95 is currently computed for any surface. **The gate is therefore specified and not yet measurable.**"* ARCH-07-OBS **G-2** + **§5 item 1** name the exact change: *"In `tools/bars_warmth_audit.py`: move `"stale-swr"` from `COLD` to `WARM` (`:27-28`) per the ruling that already exists, print a p95 for **both** buckets (`:109-116`), and print `n` and which quantity is being reported (OBS-1)."* The three-way divergence is measured: **bucketing** (`if warm_ms:` at `:109` means *"on daily `warm_ms` is **empty** and **no p95 is printed at all**"*), **statistic** (*"A max on n = 40 and a p95 on n = 40 are different numbers and only one of them is the gate"*), and **quantity** (`wall` includes TLS/Cloudflare/network while the `Server-Timing` `dur` is *"parsed away and thrown out"* — *"Neither is wrong… What is wrong is that the gate does not name one"*). ⭐ Confirmed with a control: *"`grep -rn "p95\|percentile" api/`… returns hits in exactly one module: `api/baselines.py`… option-premium percentiles — a product feature, not a latency metric… **Nothing in the serving process computes a latency percentile for any surface.**"*
- **Today.** CARD 16's gate is ruled (**p95 ≤ 250 ms per timeframe, on a pod ≥ 300 s old**) and unmeasurable. The raw material exists and is discarded: *"`/api/bars/{ticker}` emits `Server-Timing: bars;desc="<layer>";dur=<ms>`… **Per-request timing exists; nothing aggregates it.**"*
- **Mechanism.** None external. ⭐ Quartr's percentile SLAs (best-of-breed §2.5) are the form a *published* latency claim should take once one exists.
- **Size.** **S** — ARCH-07-OBS ranks it **first** and says *"The fix is small."*
- **Depends on.** Nothing. ⛔ OBS-1's default names the quantity: *"**Client wall-clock**, n ≥ 60 per timeframe, `stale-swr` counted as SERVED per CARD 16, with the tier mix reported beside and never as pass/fail"* — overturnable by a ruling that the gate is a server-compute budget.
- **Anti-pattern risked.** **INST-4** — a definition of done a healthy system fails — is what CARD 16 escaped and what an unmeasurable gate re-creates *"one level up"*. ⚠️ **INST-8/DOC-1**: a percentile must declare its N, because *"on n = 40 that is index 38, the **second largest of forty**"* and *"two runs are not comparable"* otherwise.
- **Known it worked.** ARCH-07-OBS names the control: *"a fixture of 40 `stale-swr` samples must produce a p95 line, **which today's code cannot**."*

#### FB-OBS-02 — Read the drop counters on a schedule (S1 + S2 as one job)
- **Statement.** The counters that tell you the live-bars rail is dead exist, are correct, and nothing reads them.
- **Row.** S12.
- **Provenance.** ARCH-07 §3 **Q10** answered *"the counters exist and are currently unread"* and assigned the design forward. ARCH-07-OBS **G-1** measures it with a control: the status getters are called *"exactly two hits, both inside the route that serves them"*, and outside `api/` the endpoint appears *"at exactly one place: `tools/market_open_chart_check.py:247`"*, while the same sweep *"finds one scheduled workflow"* elsewhere — *"The instrument sees schedules where they exist."* The route's own docstring: *"is it actually EMITTING… vs silently dead while users invisibly fell back to Finnhub. **`bars_dropped_total` > 0 = slow-consumer data loss.**"* F-01 **PERF-6** is the entry: *"⭐ 'A quiet drop is worse than a crash'… A crash is reported; a drop is a smaller number."*
- **Today.** `bars_emitted_total`, `bars_dropped_total`, `last_emit_age_s` and subscriber counts on `/api/admin/bars-stream-status`; `fh_budget_denied_total` beside them; ledger A5/A10's rails. ⚠️ ARCH-07-OBS is careful about the negative: a Windows Task Scheduler state was **not** read, so the honest claim is *"no standing schedule is recorded **in this repository**"*, and the one runbook naming the endpoint lists it as **held** — *"Needs RTH."*
- **Mechanism.** ⭐ Internal and already built next door: ARCH-07-OBS **G-9** — *"the design for the bars stream does not need inventing, it needs **porting**"* from `liveflow_monitor`, whose docstring claims it *"Would have caught all 16 downtime windows on 2026-07-06"*, and the two differ in exactly one respect (last-value-wins drops are conflation → digest; a tape gap is permanent → page).
- **Size.** **M** — one decision function plus a job on an existing schedule (OBS-9: on `terminal-next-monitor`, *"**not** a new service"*, because *"a sixth service is five more things to forget"*).
- **Depends on.** `FB-S7-03` (the channel split should land before the traffic).
- **Anti-pattern risked.** **PERF-6** is the fix. ⛔ **INST-3** is the trap to avoid: the counter is per-process and *"reset to 0 by every deploy"*, so a total must be read as a delta and the reader must copy `desk_session_audit`'s posture — re-read the **artifact**, never a streak counter a redeploy resets. ⚠️ And the severity inversion is named: *"paging on drops trains the channel to be ignored, which is how the page that matters gets muted."*
- **Known it worked.** A pure decision function unit-tested with a control, plus the AST-over-the-scheduler rail (ARCH-07-OBS §4.6 methods 1 and 3); and OBS-2's thresholds fire — *"**Any** Δ`bars_dropped_total` → DIGEST. `bars_emitted_total` flat across **3** consecutive 60 s RTH polls with `subscriber_pairs > 0` → PAGE."*

#### FB-OBS-03 — An RSS-slope reader, and per-subsystem attribution for the leak
- **Statement.** The pod leaks 7.9 MB/min; the sampler writes to stdout, nothing reads it, and a deploy ends the series.
- **Row.** S12 (the decision it unblocks is ARCH-07 §5.1's).
- **Provenance.** ARCH-07 §2.2: *"**76 `[mem]` samples across 104 minutes**"*, quartile medians *"2,429 → 2,746 → 2,956 → 3,028 MB"*, *"**+599 MB over ~76 minutes = +7.9 MB/min, monotonic across quartiles**"*, threads *"min 41 / median 124 / max 178 — the 200 burst line was never crossed"*; it *"refutes D-05 §4.3's 2.2 MB/s by roughly seventeen times"* and *"corroborates its 11,665 MB long-lived endpoint almost exactly"*. ARCH-07-OBS **G-3** reframes it: *"a leak that needs 104 minutes to see, on a pod that lives 26"*, *"The sampler is `print(f"[mem] rss_mb=… threads=…")` every 60 s (`api/main.py:4517`). It writes to **stdout only**. Nothing reads it; nothing stores it; a deploy ends the series"*, and ⭐ *"**That is not a memory finding; it is an observability requirement.**"* ARCH-07 §5.1 states the ordering: *"**Fix the leak before choosing a process topology.** Q7 cannot be answered honestly while the monolith grows ~470 MB an hour, because 'give the terminal its own long-lived process' and 'the long-lived process is the problem' are the same sentence… the next step is **one held window with per-subsystem attribution, not a topology decision**."*
- **Today.** `/api/health/memory` exists with `?deep=1` (a GC type histogram and per-cache byte estimates) and `?trim=1` (*"the one call that separates 'allocator is hoarding freed pages' from 'a C extension is genuinely holding this'"*). `_web_memwatch` logs every 60 s; ledger O2's `/api/health` carries a point-in-time `rss_mb`.
- **Mechanism.** Internal, and ARCH-07-OBS supplies the sampling rules: **OBS-3** *"**≥ 40 `[mem]` samples within one deployment id** before a slope is emitted, and report `deployments_sampled`"* (because *"5 samples on a 5-minute pod read flat-to-declining on a pod leaking 7.9 MB/min"*); **OBS-4** *"**PAGE** at threads > 200… and at RSS > **3,500 MB**"*; **OBS-5** *"**90 days** per signal, **max 400 rows**"* (because the volume has *"a measured 33 GB runaway in its history"*).
- **Size.** **L** — the slope reader is M; **per-subsystem attribution is the hard half and is what §5.1 actually asks for.** ⚠️ ARCH-07 is explicit that the measurement *"does not identify **what** leaks"*.
- **Depends on.** `FB-OBS-04` (a slope with no cadence contract and no `deployments_sampled` is *"item 24's `n = 1` again"*), and `FB-OBS-07`.
- **Anti-pattern risked.** **PERF-5** exactly — *"measuring memory over a window shorter than the leak's signal"* — plus **INST-9** (a measurement longer than the interval between disturbances). ⛔ And the *ordering* is the anti-pattern's real content: fixing the topology first would be acting on a measurement that does not exist.
- **Known it worked.** A monotonic slope across quartiles over a window of at least the 104-minute sample, carrying `deployments_sampled`; a ceiling crossing pages; and **the attribution names a subsystem** — without that the item has not been done, only instrumented. ⚠️ Citation caution: OBS-4's *"max RSS 3,401 MB"* rationale does not appear in ARCH-07 §2.2's published table, which prints quartile **medians**; the 3,401 figure is ARCH-07-OBS's alone.

#### FB-OBS-04 — The cadence heartbeat and the daily dead-man roll-up
- **Statement.** No signal has a cadence contract, so "no alert since Tuesday" and "the cron has not fired since Tuesday" are currently the same observation.
- **Row.** S12.
- **Provenance.** ARCH-07-OBS **G-7**, whose severity is **PAGE**: *"It is the failure that hides every other failure."* The measured basis: *"`liveflow_monitor:20-22` is the only production construct in this repo under which an **absent** report is itself an alarm. Every other monitor surveyed is silent-on-healthy by design and says so."* §4.8's spec: each signal writes a marker on the volume every period *"the same atomic `os.replace` idiom as `desk_session_audit._write_state`"*, and `terminal-next-monitor` posts *"**one** daily roll-up naming every signal that did **not** report in its window"*, which ⭐ *"**posts even when everything is fine**… it is not an alert, it is the cadence proof"* — *"**Exactly one such message per day, on the ops channel.**"* The precedent quoted: liveflow's scorecard posts *"EVERY trading day — its ABSENCE by 4:30 PM ET is itself the alarm"*, and the runbook's rule *"silence should never need interpreting."*
- **Today.** Ledger **L4** records the best-designed audit in the repo (*"reads the ARTIFACT with a 3 h grace"*) and its known limitation: *"a quiet run and nothing-to-check look identical in Discord"* — which is precisely this gap, already named in a shipped system. Ledger **O11**: *"**four jobs failing silently for weeks; two terminated on battery; nothing reads `LastTaskResult`**"*.
- **Mechanism.** Internal (liveflow's dead-man scorecard).
- **Size.** **M** — one marker convention plus one roll-up job. ⭐ ARCH-07-OBS ranks it **fourth** *"and not later, because it is what makes items 3, 5 and 6 verifiable."*
- **Depends on.** `FB-S7-03` (it needs an ops channel to be one message rather than noise).
- **Anti-pattern risked.** **INST-3** — it is the structural answer to a health check reading a proxy. ⚠️ **PROD-C1**'s cousin: a roll-up that posts daily can itself be muted, which is why the split channel is a dependency and not a nicety.
- **Known it worked.** ⭐ The recursive test ARCH-07-OBS states: *"The monitor must be able to answer the question about **itself** — S6 exists so that 'when did this signal last report?' has an answer that does not depend on the signal being healthy."* A deliberately stopped job appears by name in the next roll-up.

#### FB-OBS-05 — Durable cooldowns for `chart_health_alerts`
- **Statement.** Two alert cooldowns live in module dicts, so a standing critical re-pages on the first cycle after every deploy.
- **Row.** S12.
- **Provenance.** ARCH-07-OBS **G-6**: *"`_alerts: deque = deque(maxlen=200)` with `_throttle` and `_discord_last` as module dicts"*, and the file's own header — *"the in-memory deque was admin-pull-only, so a bars-store problem paged no one — **the gap that let the 2026-08-11 daily freeze run for a week**"*. The defect: *"**Both cooldowns are module dicts.** A redeploy clears `_discord_last`, so a standing critical re-pages on the first cycle after every deploy… **The same fix is available and is one table**"* — the `fundamentals_monitor.monitor_meta` shape.
- **Today.** Discord paging exists for CRITICAL only, with a 1800 s per-key cooldown beside a 600 s deque throttle, both per-process. Ledger O3 lists the monitor family.
- **Mechanism.** Internal (`monitor_meta`).
- **Size.** **S** — one table.
- **Depends on.** `FB-S7-03` — ARCH-07-OBS ranks it **seventh** *"because it is a duplicate-page problem, and duplicate pages only matter once the channel is worth listening to."*
- **Anti-pattern risked.** **STATE-7** — a per-process dict read as a cache when it is a correctness guard; *"a second instance silently doubles each bound."* ⚠️ And **INST-3**, since a cooldown a deploy resets is a proxy for "we already told you".
- **Known it worked.** A standing critical does not re-page across a deploy, proved by a fixture that simulates the restart; and the cooldown's state survives in a table rather than a dict.

#### FB-OBS-06 — The loop-lag distribution, so CARD 18's arming window can exist
- **Statement.** A max-since-boot cannot span days on a process that lives 26 minutes, so the number the arming decision rests on has never existed.
- **Row.** S12.
- **Provenance.** ARCH-07-OBS **S5** / §0 finding 2: *"`event_loop_watchdog._state["max_lag_ms"]` starts at `0.0`… and only ever ratchets up in-process. Its own arming runbook, in the same file, instructs the operator to 'Watch `GET /api/watchdog/status` → `max_lag_ms` **for a few days** across a market open and a heavy-job window' and then to set the kill threshold at '3-5x' the observed maximum. Item 24 §2.5 carries the measurement that makes this impossible: **median pod life 26 minutes.**"* ARCH-07 §2.3 records the observed state: *"**max lag 14.9 ms over 330 checks**, against a `wedge_sec` of 30 — three orders of magnitude of headroom — with `enabled: false`."* **CARD 18** rules **NOT YET** and names the condition: *"one observation window that **spans a market open** and a **heavy-job window**"*, with ⛔ *"The runbook's '3–5× observed max_lag' heuristic must **not** be applied to a 27-minute after-hours sample."*
- **Today.** Protocol G is armed in observe mode (`WATCHDOG_OBSERVE=1`, `enabled:false`) and ARCH-07-OBS records *"`/api/watchdog/status`: no scheduled reader in this repo"*.
- **Mechanism.** Internal. ⭐ The design rule it generalises is the document's one new idea (see `FB-OBS-*`'s shared tiering): *"per-process state is fatal for a **CUMULATIVE** quantity (a leak slope, a drop total, a max over days) and perfectly adequate for a **DISTRIBUTIONAL** one measured inside one pod's life (a latency p95)."*
- **Size.** **M** — a sampler plus out-of-process accumulation, on `terminal-next-monitor`.
- **Depends on.** `FB-OBS-04` (cadence) and `FB-OBS-07` (the window). ⛔ **It must not arm anything** — ARCH-07-OBS is explicit: *"S5 exists to **produce** that window rather than to pre-empt the ruling. Nothing here arms the killer."*
- **Anti-pattern risked.** ⛔ **INST-3 and GATE-8 together** — arming a killer on a threshold derived from an after-hours sample would set ~60 ms against a shipped 30 s, and *"the failure mode of an over-tight watchdog is killing a healthy member-facing pod."* **DIGEST until CARD 18's condition is met** is the severity the source assigns.
- **Known it worked.** A percentile over at least one trading day exists, spanning an open and a heavy-job window — which is CARD 18's own condition, and the item's deliverable is the window, not a decision.

#### FB-OBS-07 — Declare a quiet window for any capacity or memory measurement
- **Statement.** The measurement environment is itself a finding, and the programme keeps treating it as a scheduling detail.
- **Row.** S12 (a process rule with a real deliverable).
- **Provenance.** ARCH-07 §2.5, measured: *"**Fourteen deploys in six and a half hours; median pod life 26 minutes; roughly half of them this session's.** A valid Protocol A window took ~17 minutes of waiting."* And the statement: ⭐ *"**Any capacity or memory measurement needs a declared quiet window, and the programme must stop treating that as a scheduling detail** — it is the difference between a 104-minute sample and no sample at all."* F-01 §4 row 12 marks it ⛔ **ACTIVE**: *"it is a scheduling decision nobody has made."*
- **Today.** Nothing. The one 104-minute sample exists because a deployment *happened* to live that long.
- **Mechanism.** None to copy. ⚠️ ARCH-07-OBS §4.2 adds the covariate discipline: *"Any T2 slope must report `deployments_sampled` beside the slope, because a slope pooled over three 30-minute pods and a slope from one 104-minute pod are different measurements even when they agree."*
- **Size.** **S** as a convention; ⛔ it is an **owner/scheduling** decision, not an engineering item, and it is listed because F-01 records that nobody has made it.
- **Depends on.** ⛔ A person. It gates `FB-OBS-03`, `FB-OBS-06`, `FB-S1-02`'s panel curve and CARD 18's condition.
- **Anti-pattern risked.** **INST-9** and **PROC-4** — F-01 §3 row 4 records the worst measured instance of the aggregate-resource class (*"11,854 MB RSS climbing, `app/node_modules` swept to 0 entries, a worktree's `.git` file destroyed"*). ⛔ *"Scoping each job does not bound the sum of the jobs."*
- **Known it worked.** A measurement window is declared, held, and **stated in the artefact** with its `deployments_sampled`; and a measurement taken outside one is void by rule rather than by argument — which ARCH-07 already demonstrated by voiding its own first Protocol A run at 112 s uptime.

#### FB-OBS-08 — Read the Cloudflare rule and cache key; then rule on the four-hour browser TTL
- **Statement.** A member's browser holds a 5.3 MB live options tape for four hours under a rule nobody in this programme chose, and the mechanism is unread.
- **Row.** S12 / D4.
- **Provenance.** ARCH-07 §1.3's authenticated wire read: *"1st, authenticated | 200 | `public, max-age=14400, s-maxage=60, stale-while-revalidate=600` | **MISS**… 2nd… **HIT** | 0 | 5,289,793"*, against an origin that *"sets **`max-age=0`**"*. §1.5: *"`max-age=14400` is a **browser** TTL of four hours on a 5.3 MB options tape, overriding an origin that deliberately said `max-age=0`. The edge revalidates every 60 s; **a member's browser does not, for four hours**… **a four-hour browser TTL on a live tape is a decision nobody in this programme made.** It is a Cloudflare rule, not code, so it is one dashboard edit either way."* ⛔ §1.6: *"**Not established:** whether a Cache Rule exists on `/api/flow/*` today, what it says, and whether the zone's cache key includes the session cookie… **Nothing should be changed at the edge until they are read.**"* ⭐ §1.5's durability point: *"**A behaviour that is correct for an unknown reason can change when somebody edits the rule.**"* **CARD 20** rules on the TTL itself (*"✅ RULED: TAKE IT OFF"*).
- **Today.** The rule is in effect and unread. ⭐ The security alarm is cleared by measurement: two cookie-free retries after the cache was populated returned *"**401** | BYPASS | **30**"* bytes — *"30 bytes cannot be a tape"* — so there is no anonymous exposure. ⚠️ F-01 §1's own note: the withdrawn Protocol D claim *"has already travelled into four artifacts"*, and CARD 19 is **WITHDRAWN**, not amended.
- **Mechanism.** None to copy. ⚠️ ARCH-07 §1.6 retains the design options for the underlying question: *"A `private` directive, or a sealed-URL scheme that removes the credential from the equation, are the two shapes worth designing"* — recorded as retained reasoning, **not** a live finding.
- **Size.** **S** — a dashboard read then one edit. ⛔ Blocked on a credential this programme did not have.
- **Depends on.** ⛔ A dashboard or Cloudflare-API read by someone who can authenticate to it.
- **Anti-pattern risked.** ⛔ **INST-1** is the recorded cost of getting this wrong: *"an unauthenticated probe of a gated route measures the gate"*, and the paired misreading *"pointed at a change that could have re-served 3.07 MB of the firm's paid options tape from the edge"* (F-01 §3 row 3). **PROD-C7**: a four-hour-stale tape is a freshness contract nobody stated.
- **Known it worked.** The rule text and the cache key are written down; the TTL is whatever CARD 20 ruled **by intention**; and the `MISS → HIT` signal still holds afterwards, which ARCH-07 names as *"§8's exact stated success signal"*.

#### FB-OBS-09 — Prove every guard can fire — a shipping precondition, not an item
- **Statement.** By its own standard, every signal ARCH-07-OBS proposes is an unproved guard until four named proof methods are discharged.
- **Row.** S12.
- **Provenance.** ARCH-07-OBS **§4.6** and its **GAPS**: ⛔ *"**No guard was proved to fire.**… By this document's own standard, **every signal in §4.3 is an unproved guard until §4.6 is discharged** — a precondition of shipping any of them, not a footnote."* The four methods: a pure decision function unit-tested **with a control** (*"S1, S2, S5, S6 and S10 are all this shape and must be written this way"*); a clamp/classifier proved at its boundaries (S3's percentile-on-N, S4's minimum-sample rule); ⭐ **mutation-checking the wire** — *"**The wire is the part that has actually been cut in this repo** — the insights pass was 'written, documented as scheduled, wired into no scheduler' for weeks — so **every signal needs the AST-over-the-scheduler rail, not only a logic test**"*; and a live trigger with an injected verdict (S7, S9). Plus the seam rule: *"a default argument bound at import makes `monkeypatch.setattr` reach nothing… **Every injected seam in a new monitor must be `=None` and resolved in the body**, or its proof is theatre."*
- **Today.** Ledger **L4** is the exemplar that already does this (*"the best-designed audit in the repo"*, with an AST over `api/main.py` proving the `add_job` id exists **and** a non-vacuity control). Nothing else does.
- **Mechanism.** Internal.
- **Size.** **M** in aggregate, and it is **per signal**, which is why it is stated once here rather than repeated in six items.
- **Depends on.** Each of `FB-OBS-01` … `FB-OBS-06`, as their shipping condition.
- **Anti-pattern risked.** **GATE-1** — *"a guard nobody has seen fire"* — and **PROC-9** (*"a default argument bound at import defeats every monkeypatch"*, which F-01 §1 records as *"a day of 'flakiness'"*). ⭐ F-01's own framing: *"⛔ **An audit nobody runs is worse than none: it reads as coverage.**"*
- **Known it worked.** Each signal has a test that has been **observed red** before it was green, and an AST-over-the-scheduler rail with a control. Nothing ships without both.

### 3.9 The three declared extension rows — X1, X2, X3

⛔ **These are `best-of-breed.md` §3.6's rows, and that file is explicit about their status:** *"These are **additions to this document only**. `capability-infrastructure-matrix.md` remains the single owner of the taxonomy; if these rows are adopted they belong in that file, added there, not mirrored here."* ⚠️ So an item below is a candidate against a **proposed** row, and adopting any of them implies adopting the row — which is the taxonomy owner's call, not this file's.

#### FB-X1-01 — Mark the community's shared calls to market, publicly, including the losses
- **Statement.** A shared call gets scored against the tape beside the poster's name, losses included, which is what turns a chat room into a track record.
- **Row.** X1 Collaboration & Publishing (proposed).
- **Provenance.** best-of-breed §3.6 X1: ⭐ *"**The non-obvious runner-up mechanism is better value for UCT.** Unusual Whales marks the community's shared calls **to market, publicly, including −99% and −91% beside the poster's name** — 'a stronger trust signal than a curated wins feed', and the thing that converts a chat room into a track record."* ⛔ And the row's binding constraint: *"**N4 binds.** Building an IB-shaped widget only the desk is on reproduces the form of the moat and none of its substance."*
- **Today.** Ledger **M1** — The Floor (boards, reactions, mentions, live chat over SSE), active, with ⛔ *"**no backup rail** for member posts"*. ⭐ The honesty doctrine already ships twice: ledger **F3** (the public flow scoreboard — *"public hit rates, grade calibration, honest tape incl. losers"*, reuse note *"**the honesty doctrine, three sentences**"*) and ledger **N3** (the Book, *"a track record with the losses in it"*). ⚠️ What does not exist is the per-member version.
- **Mechanism.** Unusual Whales', above.
- **Size.** **M** — a scoring path over existing posts plus a per-poster surface. ⛔ It is **not** small, because a public per-member record is a member-safety decision before it is a feature.
- **Depends on.** `FB-X1-02` (do not build a public record on a store with no backup), and ⛔ **an owner decision**: publishing a member's losing call beside their name is a member-safety call. ⚠️ The nearest recorded analogue is OI-15's posture on the `#tsdr` corpus — *"no member display until answered"* — which is about a different corpus but the same class of question.
- **Anti-pattern risked.** ⛔ **PROD-C5** hard: a scored call needs its method, its window and its base rate, and F-01 marks UCT ⛔ ACTIVE on exactly this. ⭐ Ledger **G6**'s discipline is the standard to copy — *"lift, never a hit rate"*, under six gates, with a cluster bootstrap and a moving-block null. **PROD-C6**: per-poster scores must not be blended into a leaderboard number.
- **Known it worked.** Negative rows are present and visible (their absence is the tell, which is F-03's own doctrine); and every published figure carries its window and null model, checkable by `FB-A9-02`'s rail.

#### FB-X1-02 — A backup rail for member posts, and for the ~50 unbacked databases
- **Statement.** Member-authored content lives in databases with no backup rail, and no leaf has observed a backup object landing.
- **Row.** X1 (but the exposure is estate-wide).
- **Provenance.** best-of-breed §3.6 X1's UCT cell names it in the row itself: *"The Floor (48 routes, 400-subscriber hub, **no backup rail for member posts**)"*. Ledger **M1** carries *"**no backup rail** for member posts (TD-28)"*; ledger **O5** measures the scope: `auth.db`, `flow.db` and J2 attachments are backed up, and ⛔ *"**no leaf observed an R2 object landing**; **~50 other DBs** incl. `community.db`, `modelbook.db`, `charts_layouts.db`, `user_definitions.db`, `education.`"* are not. Ledger **L5** repeats it for `education.db`; ledger **N4** for Model Book curation.
- **Today.** Three backed-up stores out of roughly fifty-three, and no observed restore.
- **Mechanism.** Internal (ledger O5's existing R2 schedule).
- **Size.** **M** — a generalised schedule plus, ⭐ **the part that is the actual deliverable, a restore rehearsal.**
- **Depends on.** Nothing. ⭐ It is a precondition of `FB-X1-01`, `FB-S5-01` (a versioned document is worth little in an unbacked store) and `FB-A13-01`.
- **Anti-pattern risked.** ⛔ **GATE-1** in its purest form: a backup nobody has restored is not a backup, and *"no leaf observed an R2 object landing"* is the recorded state. ⚠️ **INST-3**: a backup job's exit code is a proxy; the artefact is the object.
- **Known it worked.** ⭐ A **restore rehearsal** into a scratch database, from the object store, per database class — and the rehearsal, not the schedule, is the evidence. An artefact-first check names any database with no object newer than N days (the `desk_session_audit` posture, names not counts).

#### FB-X2-01 — A skill file with an endpoint whitelist, then an MCP surface over the existing registry
- **Statement.** Publish the product to somebody else's agent, and make the whitelist the load-bearing half.
- **Row.** X2 Data Egress & Programmatic Access (proposed).
- **Provenance.** best-of-breed §6.2 item 4: *"**X2 Data Egress & Programmatic Access.** No member API, no MCP server, no skill file… **Mechanism:** the cheapest high-leverage item in this document — publish a skill file **with an endpoint whitelist**, because **the whitelist is the load-bearing half**; then an MCP surface over the existing 154-tool registry with Fiscal.ai's entitlement-inheritance rule ('your assistant can only retrieve what you could retrieve yourself'). ⚠️ Gate it behind S9 first."* §3.6 X2's mechanism cell: *"221 documented REST/WebSocket paths, an MCP server, named build recipes, a free one-week API trial — and ⭐ **a published `skill.md` whose load-bearing half is an endpoint whitelist that exists to stop an agent inventing endpoints.** 'UW's most credible AI investment is not the chatbot — it is making the product legible to somebody else's agent.'"*
- **Today.** Nothing. Ledger **K1** — the 154-tool registry with per-door allowlists — is the substrate, and ledger E8's ICS token is the only egress credential that exists.
- **Mechanism.** Unusual Whales' `skill.md` + whitelist; Fiscal.ai's entitlement inheritance and named skills catalogue; Quartr's API rigour. ⚠️ And two ✖ with different meanings: SpotGamma refuses an API to protect an interpretation moat (*"a **commercial** decision… not an architectural one to copy"*), while Gödel's has been *"Coming soon"* across two asks nine months apart with two live pages disagreeing.
- **Size.** **S** for the skill file plus whitelist; **M** for the MCP surface over a registry that already exists.
- **Depends on.** ⛔ `FB-S9-03` (per-route limits) — the source makes this a hard gate, not a preference; and `FB-S9-02`, because an egress surface over unauthenticated routes is a redistribution question, not a feature.
- **Anti-pattern risked.** **DOC-1** — a whitelist is a roster, and it must be **generated from the registry**, or it becomes the thing it exists to prevent. ⚠️ **PROD-C1**: an API is a cap-bearing surface, so `429`-with-reset-headers is part of the item, not a follow-up.
- **Known it worked.** ⭐ An agent given only the skill file reaches a real answer, **and when asked for an endpoint not on the whitelist it refuses rather than inventing one** — which is the whitelist's stated purpose and is directly testable; and entitlement inheritance holds, proved by an agent acting for a member who cannot see a surface.

#### FB-X2-02 — TTL and rotation on the ICS export token
- **Statement.** The one export credential that exists has no TTL, so a session paywall becomes a permanent bearer token.
- **Row.** X2.
- **Provenance.** best-of-breed §6.2 item 4: *"the one export credential that exists (ICS) **has no TTL** and converts a session paywall into a permanent bearer token."* Ledger **E8**: *"`export-token` (paid, HMAC(`PUSH_SECRET`,user_id), **no TTL**), `export.ics?scope=all|mine`"*, with gate *"token = permanent bearer; **`scope=all` unauthenticated**"*, reuse note *"extend (add TTL/rotation)"*, and *"no row bound on `scope=all`"* (TD-27).
- **Today.** As above. Ledger P7 records the adjacent class: `CHART_RENDER_TOKEN` is *"effectively public by the module's own header"* with three out-of-repo consumers.
- **Mechanism.** None to copy. ⚠️ The general form is best-of-breed §3.6 X2's warning that egress is where a licensing posture becomes observable, and the capability matrix's S9 row keeps every member-facing data class Restricted-pending-contract until D5 resolves.
- **Size.** **S** — a TTL, a rotation path, and a bound on `scope=all`.
- **Depends on.** Nothing. ⚠️ Rotation breaks live subscriptions, so it needs a member-facing re-subscribe path in the same change — which is **PROD-1**'s rule (a recovery path in the same commit).
- **Anti-pattern risked.** **PROD-1** exactly: revoking a credential without a way back is a dismissable control with no recovery path, and F-01 records UCT paying for that class once already.
- **Known it worked.** An expired token returns 401; a rotation invalidates the old token and the member can re-subscribe from the UI without support; and `scope=all` is either bounded or gated, measured by an anonymous request.

#### FB-X3-01 — One sentence in the wire naming the surface that explains today's move
- **Statement.** Peg discovery to today's move rather than to a catalogue, using content the product already ships daily.
- **Row.** X3 Learning & Onboarding (proposed).
- **Provenance.** best-of-breed §3.6 X3: ⭐ *"**Mechanism.** `FFM` — 'Functions for the Market' — pegs discovery to **today's** move rather than to a static catalogue. **It is the cheapest onboarding idea in the whole corpus and it rides content UCT already ships daily: one sentence in the wire naming the surface that explains today's move.**"* Beside it: per-persona cheat sheets curating ~90 of ~30,000 functions (*"the map, not the menu, is how the surface stays learnable"*), and ⭐ SpotGamma's runner-up, which best-of-breed says *"is arguably better for a small product"* — *"A numbered 'how to trade with this' checklist article per analytic surface — 'the ritual is what converts a page into a habit'."*
- **Today.** Ledger **N1** — the Morning Wire, the **only** free page, active and CONFIRMED running, with per-segment feedback. Nothing in it names a surface.
- **Mechanism.** Bloomberg's `FFM`; SpotGamma's per-surface checklist as the cheaper variant.
- **Size.** **S** — one sentence in a template plus a link, and ⚠️ the wire is engine-side and PC-dependent, so the change lands in a different repo's template.
- **Depends on.** Nothing. ⭐ And CARD 17 raises its value: with one paid tier, *"which page is free is the only remaining lever on acquisition"*, and the free page is exactly where this sentence goes.
- **Anti-pattern risked.** **PROD-C10** — it is the counter-pattern: *"If a capability needs a course, the capability needs a redesign."* ⚠️ And the wire's own house rules bind the copy (an em-dash cap of zero, a mentor register), which are recorded in ledger N1's feedback notes.
- **Known it worked.** ⭐ Measurable **today**: `page_views` already holds 4,949 rows (OI-21), so a click-through from the wire sentence to the named surface is observable without new instrumentation — which makes this the rare item whose observable exists before the feature.

#### FB-X3-02 — First-run is a fork of an expert's board, never a blank form
- **Statement.** A new member's first board is pre-built, opinionated and editable in place — because the mechanism already exists and only the default is missing.
- **Row.** X3 / S1.
- **Provenance.** F-01 **PROD-C10**'s structural fix: ⭐⭐ *"`bloomberg/02-monitors-workspaces.md` §7 names the anti-pattern to avoid as 'a read-only demo board or a guided tour', and ships instead **pre-built, opinionated, editable desks segmented by what you trade** — 'the sample view is not a read-only demo; it is a live view you immediately customise, which means the sample doubles as the teaching artefact: you learn the model by taking one apart.'"* And §6's validation: Bloomberg's example screens are addressed through *"**the same API parameter** as a user's private screens"*, so ***"a new user's first screen is therefore a fork of an expert's, not a blank form."*** ⛔ F-01's detector names the exposure: *"C5-01 §4 names the blank canvas as 'the known-hard problem', and C5-03 §2's option table records hybrid's first-run as 'seeded **or empty**' — **the 'or empty' is the exposure, and nothing has chosen.**"*
- **Today.** ⭐ **The mechanism ships and the default does not.** Ledger **C4** — named layouts with an admin-published **global** scope (`charts_layouts.db`, `UNIQUE(scope,user_id,name)`); the capability matrix's S6 row says *"firm-published boards already exist as a mechanism (`charts_layouts` `scope=global`, C4)"*. Ledger **G3** is the same idiom one surface over and is the precedent F-01 PROD-C9 praises: the starter library ships firm setups as *"ordinary definitions, editable on arrival (not a special read-only class)"*.
- **Mechanism.** Bloomberg's Sample Views; UCT's own starter library, applied to boards instead of screens — which best-of-breed §3.4 S1 spells out: *"the same posture as UCT's own `starter_library.py`, applied to boards instead of screens."*
- **Size.** **S–M** — a first-run default plus curation of two or three boards. ⛔ Not a build: an owner or desk curation decision plus a default.
- **Depends on.** ⛔ The *"seeded or empty"* decision, which F-01 says nothing has made. `FB-S5-01` if the seeded board must be versioned from birth (it should be).
- **Anti-pattern risked.** **PROD-C10** — it is the fix — and ⛔ **PROD-C9** is the trap on the other side: a seeded board must be editable in place and must never be re-applied over a member's edits. ⚠️ **STATE-5** (a breakpoint ladder overwriting the only saved layout) is the specific way a seeded default can destroy work.
- **Known it worked.** A new account's first board is non-empty and editable in place, and editing it does not fight a re-seed — proved on a fixture that edits then reloads; ⭐ and the measurement already exists in the shape C5-03 §5 used (*"17 of 29 accounts hold a board, none empty, modal 5 widgets, 0 versioned"*), so the aggregate can be re-taken after the change.
---

## 4. ⛔ Items this product should NOT build — each with the reason

⭐ **Why this section exists.** A backlog without an explicit not-list silently re-proposes every
rejected idea, and this programme has already ruled several things out in writing. Every row below
was a real candidate during this pass — most of them were drafted as items and removed — and each
names the artefact that rules it out. ⚠️ A "no" here is a **no on the current evidence**, and where
the ruling carries a re-open trigger the trigger is stated.

| # | Not this | Why not, and who ruled it |
|---|---|---|
| 1 | **Any tier-comparison surface** — a pricing table, an upgrade affordance, a locked-behind-a-higher-tier state, per-tier entitlement rows | ⛔ **CARD 17**, owner ruling 2026-09-26: *"there is one paid tier only that is it."* The card's own foreclosure: *"With one paid tier there is nothing to compare… A design leaving room for a second tier is carrying dead weight."* **No re-open trigger** — it is an owner decision and changing it needs a new owner instruction. |
| 2 | **Metering a capability as a product mechanism** — "removing the limit is what the higher tier buys" | ⛔ CARD 17, as above. best-of-breed §5 already refused to propose it: *"⛔ None of this is a proposal: UCT's tiering is owner-bound."* ⚰️ This removed half of `FB-A10-01`'s own source sentence (§2.3). |
| 3 | **A board-level aggregation endpoint** | ⛔ ARCH-07 §4 **D5**: *"keep per-panel access; do not build a board-level aggregation endpoint yet"*, with the hazard measured — *"`/api/flow/aggregate` serialises its client-side transform verbatim at **23.83 MB**"* and *"an aggregation endpoint inherits the slowest panel"*. ⚠️ F-01 §4 row 8 flags this as **INFERRED exposure**: *"a board of N panels is the single most natural place for someone to propose one, and the ruling is in a draft document rather than a rail."* |
| 4 | **Matching best-in-class *data*** — a research corpus, a broker-research library, a journalist network | ⛔ best-of-breed §5 conclusion 1: *"Matching best-in-class **data** is out of reach and should not be a goal"* — 2,700 journalists, 10,000 Reuters sources, 1,500 broker-research providers and 300k expert transcripts *"a competitor cannot copy"*. ⭐ Conclusion 2 is what this backlog is built on instead: *"Matching best-in-class **mechanisms** mostly costs engineering and no licence at all."* |
| 5 | **Per-broker (analyst-level) estimates** | ⛔ class-G with no provider in the estate; F-09 recommends **DEFER/INTEGRATE(future)** because *"consensus already covers the median workflow"*, and best-of-breed §6.2 item 5 states it plainly: *"**The honest answer is that this gap should stay open.**"* |
| 6 | **A Bloomberg-IB-shaped chat/collaboration widget** | ⛔ best-of-breed §6.2's third unclosable gap and anti-pattern **N4**: *"not clonable without the network, per the corpus's own most experienced voice"*, and §3.6 X1 — *"Building an IB-shaped widget only the desk is on reproduces the form of the moat and none of its substance."* ⭐ The runner-up mechanism survives as `FB-X1-01`. |
| 7 | **A corporate-actions ledger** | ⛔ **CARD 5** (2026-09-25): *"**not built.** Nothing reads it; a table with no consumer is a second authority waiting to drift."* **Re-open trigger:** *"a consumer PRD that names the ledger as its source."* |
| 8 | **Merger / `relation_added` corporate-action events** | ⛔ **CARD 6**: *"closed on the current plan. No vendor signal exists — **verified live against two real M&A tickers (both 404)**. Not a cost decision this program makes."* **Re-open trigger:** a Massive plan change, *"re-probe the same two tickers first, build nothing until one answers."* |
| 9 | **Anything inside `StockChart.jsx`** — including the two candidates this pass drafted and cut: a props-surface reduction, and a chart-settings unification across the grid and the pane | ⛔ `capability-infrastructure-matrix.md` A2: *"never refactor inside Terminal-Next scope, consume via ChartPane"* is *"**binding, not advisory**"*, and its REMAINING GAP is *"**No gap.**"* Ledger B1 records 15,500 lines / ~120 props as *"the single largest carried risk"*; ledger B2 is *"mount this, not B1"*. |
| 10 | **A14 Portfolio & Risk beyond the shipped `/portfolio-heat` door** | ⛔ **CARD 4**: *"**out of this program, and that is a scope statement, not a deferral.**"* ⚠️ §2.3 item 4 records that CARD 17 answers the *tier-count* half of CARD 4's stated blocker without firing its trigger — S9 still has no gate and D8 is unlifted. |
| 11 | **Arming the event-loop watchdog** | ⛔ **CARD 18**: *"leave `WATCHDOG_ENABLED` unset. `enabled:false` is the correct state today"* — max lag **14.9 ms over 330 checks** against a 30 s threshold means *"arming buys no protection today and adds a process that can `os._exit` the member-facing pod."* **Re-open trigger:** one window spanning a market open and a heavy-job window, which is `FB-OBS-06`'s deliverable. |
| 12 | **An absolute production capacity number, or a second Railway environment to get one** | ⛔ **CARD 15**: *"an absolute production capacity number is **OUT OF SCOPE for this program** and should stop being treated as a missing deliverable. It requires a second Railway environment, which the coexistence work already rejected on member-data grounds."* |
| 13 | **A read-only demo board, or a guided tour, as the first-run experience** | ⛔ F-01 **PROD-C10**, quoting Bloomberg's own leaf: the anti-pattern to avoid is *"a read-only 'demo' board or a guided tour"*. ⭐ `FB-X3-02` is the counter-pattern. |
| 14 | **A course, certification or learning tab as the answer to complexity** | ⛔ F-01 **PROD-C10**, with **five vendors** independently recorded doing it and the verdict: *"If a capability needs a course, the capability needs a redesign"*; a certification is *"the vendor's own admission that the product is not learnable by exploration — **a warning marker, not a feature to copy**"*; and *"for a challenger, difficulty is pure churn."* ⚠️ This is **not** an argument against ledger L6's curriculum, which the ledger calls *"the asset most ready to become a product"* — it is an argument against answering a learnability defect with one. |
| 15 | **Mobile workspace parity** | ⛔ C5-03 §8 *"explicitly declines a mobile workspace model"* (F-01 §6 item 5), and the corpus argues parity is the wrong goal: Bloomberg, *"with vastly more resources, explicitly did **not** chase it"* — on a phone a workstation should be *"reachable and monitorable, with a conversational front door — not operable."* ⚠️ See §5: mobile is a **missing row**, not a rejected capability. |
| 16 | **Any change to the deploy cadence** | ⛔ ARCH-07-OBS §5's closing note and §4.2(3): *"the fix for a counter a deploy destroys is to **move the counter**, never to deploy less"*, because ARCH-07 §4 D9 re-scored frequent recycling as *partly load-bearing against the leak*. |
| 17 | **Any member-facing AI lane on the owner's subscription seat** | ⛔ `GOVERNING_PRINCIPLES` §12 via `capability-infrastructure-matrix.md` I1: the subscription seat *"is explicitly barred from member-facing traffic"*, and ESC-17 is a standing owner question now covering **two** PC tasks. ⚠️ Ledger K11 records *"member traffic never on the owner's seat (CONFIRMED at code level)"*, so this is a constraint to preserve, not a defect to fix. |
| 18 | **E1 People / Company Intelligence** | ⛔ `capability-infrastructure-matrix.md` E1: *"**Genuinely undecided, not a §13 exclusion**… it is a Bloomberg/institutional-research pattern, not confirmed table-stakes here"*, and *"the honest answer is 'we don't yet know'… **and it should stay that way** until a competitive dossier finding makes it decision-relevant."* **Unlike** FX/fixed-income/crypto it is not excluded — it is unevidenced, which is a different reason for the same absence. |
| 19 | **FX, fixed income, crypto, and execution / order routing** | ⛔ `GOVERNING_PRINCIPLES` §13 via best-of-breed §2.1 and GAPS 8: *"No execution or order management"*, *"no FX, fixed income, or crypto in V1"* — recorded as **⊘ out of scope**, which best-of-breed insists is *"not ✖ and not ◻"*. **Re-open trigger:** OI-05 widening the asset-class scope. |
| 20 | **"No hallucinations", or any unfalsifiable trust claim** | ⛔ F-01 **PROD-C8**: *"'no hallucinations' is unfalsifiable, so the first counterexample costs more trust than the claim ever bought"*, with AlphaSense as the recorded instance and ⭐ the observation that *"**The help centre is the honest one.**"* |
| 21 | **Emoji or icons as data semantics; one colour carrying two meanings across surfaces** | ⛔ best-of-breed §3.6's compressed list: `Bid 🦴` / `🐂 %` as **column names** is *"a screen-reader and an internationalisation problem, and it makes the filter set unsearchable by text"*; and SpotGamma's red meaning *"danger/negative gamma"* in one surface and *"below-average IV"* — an opportunity — in another, *"both documented, neither reconciled."* |
| 22 | **A hand-assembled reachability or unreachable-code table** | ⛔ F-01 **REACH-1**: *"**Do not re-derive this table from a stale audit**"* — the last hand census reported *"48 modules unreachable"* including `components/ui/*`, where `UIcon` has **222 import statements**, and acting on it *"would have stripped the icon system off every screen."* The rail exists; extend it. |

---

## 5. Where the backlog is thin, and why — solved, ruled out, and unexamined are three different facts

⭐ **A capability with no items is not one fact but three**, and conflating them is how an unexamined
area becomes a silent assumption.

**Thin because SOLVED (the evidence says there is no gap):**

- **A2 Charts & Analytics — zero items, and it is the only zero I am confident about.** `capability-infrastructure-matrix.md` A2: *"**No gap.** Data is fully served; the only 'gap' is architectural discipline."* The row is well-served by four providers and its risk is carried, named and fenced (ledger B1's AST-railed six-writer invariant). ⚠️ The thing that would change this is not a feature but a decision: ledger B1's *"rebuild-behind-contract"* verdict is a standing liability nobody has scheduled.
- **D3 Realtime Streaming — one item.** ARCH-07 §3 Q2 answers the panel question **structurally** and the measurement agrees: *"16 cells, one SSE."* The transports are right; only the *contract* around them is unwritten (`FB-S4-02`) and event ids are missing (`FB-D3-01`).
- **A5's econ/earnings coverage, A9's screener depth, A10's tape depth.** Each row's own matrix cell says *"No new-provider gap"* or names the differentiator. The items here are consolidation and honesty, not capability.

**Thin because RULED OUT in writing (and the ruling has a trigger):**

- **A14 Portfolio & Risk — zero items.** CARD 4: out of programme, not deferred. §4 row 10.
- **D5's event calendar — no item beyond the two that exist.** CARD 5 and CARD 6 rule both halves, each with a re-open trigger.
- **E1 — zero items.** §4 row 18, and it is the one row where "unexamined" is itself the ruling.

**Thin because the ROW IS ONE ITEM, and that item is enormous:**

- **D2 (1 item), D1 (1), S3 (1), A13 (1).** These are not thin in coverage — they are XL and L items that swallow their rows. `FB-D2-01` is on the critical path for four other items and `FB-A13-01` is H1. ⚠️ Reading "one item" as "little work" here would invert the truth, which is why the size band is in every item.
- **S11 (1 item)** genuinely is the whole system, and its matrix cell says so: *"One of the cheapest genuinely-new systems in the whole matrix."*

**Thin because it is UNEXAMINED, and these are the ones that should worry a reader:**

1. ⛔ **Mobile is not a row and probably should be.** best-of-breed GAPS 9 says so in those words, and enumerates what the absence hides: Bloomberg (Anywhere + the Professional app), TradingView, Unusual Whales, Quartr (*"a free app that is the whole funnel"*) and Benzinga all have mobile stories; ✖ SpotGamma *"not one help-centre article addresses mobile"*; and UCT's own state is ledger **C8**/**N11** — four unmounted primitives and *"**209 stylesheets handle ≤640 vs 131 ≤1024** (tablet under-covered)"*. best-of-breed left it out *"because it cuts across every row rather than being one, which is a judgement that could reasonably be reversed."* **I have no items for it, because it has no row to hang them on, and that is a taxonomy decision belonging to `capability-infrastructure-matrix.md`.** ⚠️ Not the same as §4 row 15: *parity* is rejected; *a mobile row* is missing.
2. ⛔ **Community (M1) is outside every boundary.** `product-architecture.md` §4.2 places it *"OUTSIDE EVERY BOUNDARY (consumed through contracts, never modified here)"*, and §1.4 leaves Bloomberg's network effect as *"an open product-vision question"*. So the two X1 items sit on a row best-of-breed had to invent, against a system this architecture does not own. **Anything more than those two needs the boundary revisited first.**
3. ⛔ **Partner-owned surfaces are recorded as existence only.** Ledger F1, F2, F6 and the Schwab router: *"wrapped, never described or edited"*. `FB-A10-03`'s defect sits behind that boundary, and `FB-A10-01` is written to land on the rendering side for the same reason. **There may be opportunities inside those files that this programme structurally cannot see.**
4. ⚠️ **The proprietary-advantage synthesis does not exist yet.** `MASTER_CHECKLIST.md` row 15: the raw inventory is ACCEPTED but *"F-05 synthesis into the final inventory **NOT STARTED**"*. So every moat claim here arrives through best-of-breed's reading of D-13 rather than through the finished item 15. **If item 15 lands and ranks the assets differently, `FB-A13-01`'s standing changes and this file does not know it.**
5. ⚠️ **No member ever asked for anything in this file.** §2.6's evidence ceiling, restated because it belongs here: OI-21's five queries ran once and are existence-checks (`calendar_seen` 16 rows, `ai_search_log` 79), and there is no member research anywhere in the programme. ⭐ The single exception is a *negative* signal that is genuinely evidenced: OI-19 measured **6,131 production option strategies — 98%+ directional single-leg, essentially zero spreads**, which is why no item here proposes structure-selection tooling.
6. ⚠️ **`11-risks-and-open-questions/` is empty** (listed: `.gitkeep`, 0 bytes). So the risks consulted are `RISK_REGISTER.md`'s, and any risk-shaped opportunity that directory was meant to hold is invisible to this file. F-01 recorded the same emptiness and did the same thing.

---

## 6. Appendix — unevidenced or unhoused, proposed by me

⛔ **Three items, and they are not in §3.** Of the three: **two have no provenance in any programme
artefact** (A-1, A-2) and **one has provenance but no capability row to live in** (A-3). They are
listed so a future reader can promote one, and so nobody mistakes their absence from §3 for a
judgement that they are unimportant.

**A-1. Render — or retire — the daily broker net-liq snapshots that are written and drawn by nothing.**
⚠️ **Provenance is the problem.** The claim (a `j2_broker_equity_snapshots` table written daily whose
renderer was deleted, leaving *"the data outlived the renderer… a product decision waiting to be
made"*) comes from the **`CLAUDE.md` in this research worktree**, which F-01's **DOC-5** records as
*"eight recorded facts behind"* master's, and which F-01 deliberately never cites for that reason
(*"only `_merge-master`'s is cited here"*). Ledger **J4** records the broker-sync tables without
confirming this one's renderer state. ⛔ **So this is unverified and must be checked against master
before it becomes an item.** If true it is an **S** item and a clean instance of F-01's REACH family
inverted — data with no consumer rather than code with no caller.

**A-2. A board share/export path.** ⚠️ No incident and no direct evidence. F-01 §6 item 4 is the
closest thing and is itself qualified: C5-01 §7 failure 5 (discoverability decay) is *"🟡 — inferred
from three vendors independently building mitigations, not from a study"*. Best-of-breed §3.6 X1's
UCT cell does record that definition and chart share links exist, so the *mechanism* precedent is
in-house. ⭐ Promotable the moment a member asks, or the moment `FB-S2-03` makes a board addressable
— at which point sharing is nearly free. ⛔ Also carries the warning from best-of-breed §3.6's
compressed list: *"don't make export a per-screen accident, because 'the picture becomes the
interchange format'."*

**A-3. A `file:line` resolver sweep over the programme's own documents.** ⭐ **This one is
evidenced** — F-01's **PROD-6** detector field names it: ⛔ *"the **general** detector does not exist:
nothing sweeps the programme's documents for `file:line` citations that no longer resolve. **That
would be a high-value, low-cost tool for this programme specifically.**"* ARCH-07-OBS **§1** supplies
a second live instance (two artefacts citing `api/main.py:3639-3644` for a comment at `:4510`), and
PROD-6's own recorded instance is seven of nine citations moving in two days. ⛔ **It is unhoused,
not unevidenced:** it is a programme tool, not a product capability, so it has no row in
`capability-infrastructure-matrix.md` and does not belong in §3. **This document is itself a reason
to build it** — its evidence ceiling says no address here was resolved by it.

---

## GAPS

1. ⛔⛔ **THE LARGEST: no source file was opened.** Not one `file:line`, not one `api/**` or `app/**`
   module, and no production surface. Every "what exists today" is a restatement of an artefact's
   measurement at that artefact's date. Given F-01's PROD-6 (seven of nine citations moving in two
   days) and ARCH-07-OBS §1 (a line number drifted ~870 lines), **assume every address here is
   approximate and re-derive before depending on one.**
2. ⛔ **`capability-ledger.md` is 24 days old and I found four superseded cells in the four places I
   checked** (§2.4). I did not sweep it — I checked only where a candidate item would have
   duplicated something. ⚠️ **There are almost certainly more, and the ones I did not find are
   exactly the ones that would produce a duplicate-a-shipped-capability item.** A ledger refresh is
   the single highest-value input this file could have had and does not.
3. ⛔ **Item 9 (the Cross-Product Capability Matrix) does not exist**, which best-of-breed's own
   GAPS 2 records: *"A best-of-breed verdict properly sits on top of a per-product cross-tab."*
   Every competitor mechanism here inherits that gap at one further remove.
4. ⚠️ **Five documents named in the inputs of my inputs were not read by me**, and F-01's GAPS says
   each *"probably carries anti-patterns this document does not have"*: `command-grammars.md`,
   `information-architecture.md`, `personalization-patterns.md`, `data-architecture.md`,
   `licensing-register.md`. ⛔ The last is the one that matters most here — F-01 says it *"almost
   certainly holds redistribution-shaped product anti-patterns"*, and three items in §3 touch egress
   or publication (`FB-X1-01`, `FB-X2-01`, `FB-X2-02`) without having read it.
5. ⚠️ **ARCH-07 and ARCH-07-OBS were read by a delegated agent, not by me.** Its report carried
   verbatim quotes and anchors, and I used those; I opened neither file. ⭐ It also flagged one
   internal inconsistency I am carrying forward per its advice: ARCH-07 §1.3 reports the
   authenticated production read as done while the same document's GAPS still says *"No authenticated
   production read"* — **§1.3 is the live layer and GAPS is the stale one**, per that document's own
   `evidence_ceiling`.
6. ⚠️ **The OBS items' anchors include one figure I could not corroborate.** ARCH-07-OBS's OBS-4
   justifies a 3,500 MB page threshold with *"item 24 §2.2 measured max RSS 3,401 MB"*; ARCH-07 §2.2
   as quoted to me publishes quartile **medians** (2,429 / 2,746 / 2,956 / 3,028 MB) and no 3,401.
   Recorded in `FB-OBS-03` rather than resolved.
7. ⚠️ **Size bands are judgements and none was validated against anything.** No item was estimated,
   scoped or reviewed by anyone. ⛔ **Item 17 should treat every band as an input to be challenged,
   not a measurement to be multiplied.**
8. ⚠️ **Some observables are incomplete, and the count of them is a floor rather than a census.**
   §2.6 measures it the only way it can be measured — one item says *"No observable stated"*
   outright and five more name a fixture or measurement that does not exist — but an item can have an
   unreachable observable without the field admitting it, and every item depending on `FB-OBS-01`
   inherits its unmeasurability silently. ⚰️ **An earlier draft of this document asserted "eleven"
   here and in §2.6 from no derivation at all** — a hand-typed count beside the list it described, in
   the file whose own §2.2 makes DOC-1 a filter. Corrected by grep. ⛔ An item whose success cannot be
   defined is not yet a candidate; it is a topic, and item 17 should treat it as one.
9. ⚠️ **No cost, no revenue, no member-demand input anywhere.** OI-10 (spend baseline and the AI
   ceiling) is unanswered; OI-01's tier mix is unknown; CARD 17 leaves price, trial and seat model
   open. ⛔ **So nothing here can be scored on value or ROI from this file's contents alone**, which
   is a fact item 17 needs before it starts.
10. ⚠️ **`MASTER_CHECKLIST.md` says gate 13 for items 16 and 17; the dispatch said gate 16.** Both
    are recorded in the frontmatter and neither is reconciled. ⛔ Whichever is right, **a second
    authority over one value already exists here** (DOC-2) and the checklist is the artefact that
    owns it.
11. ⚠️ **No SHA is pinned** (no git by instruction), so this file cannot state the provenance of its
    own inputs the way an artefact with a fingerprint can. Every claim is a claim about a worktree on
    2026-09-26.

---

## SOURCES

All inputs are internal programme artefacts in
`C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`, read **2026-09-26**.
⛔ No network request, no production call, no git command, no test, no script. Cited inline by file
and section anchor throughout.

**Primary (the two the dispatch named, and they earned it):**
`05-product-strategy/capability-matrix/best-of-breed.md` (F-05, item 10) — §0 markers, §1 H1/H2/H3,
§2.1–§2.6, §3.3, §3.4, §3.6, §4 items 1–9, §5, §6.1 items 1–5, §6.2 items 1–5 and its three
unclosable gaps, GAPS 1–9 ·
`05-product-strategy/anti-patterns.md` (F-01, item 11) — §0, §1 (the entry shape and the detector
tally), §2.4 REACH-1/REACH-2, §2.6 PERF-1…PERF-6, §2.7 PROD-1…PROD-6, §2.8 PROD-C1…PROD-C10, §3 (the
five most expensive), §4 (all 17 exposure rows), §5, §6 (the appendix), GAPS, SOURCES.

**The spine and the state of the estate:**
`05-product-strategy/capability-infrastructure-matrix.md` (WS-CAPINFRA) — §0 (the row list and the
nine-column discipline), §1 (A1–A14, E1), §2 (S1, S2, S10, S12), §3 (S3–S9, S11), §4 (D1–D5), §5
(I1), §6 (the three new-vendor candidates), §7 ·
`01-existing-system/capability-ledger.md` (F-03a, 178 rows — that file's own measurement) — rows
A1–A13, B1–B12, C1–C9, D1–D12, E1–E17, F1–F10, G1–G12, H1–H9, I1–I6, J1–J10, K1–K13, L1–L11, M1–M8,
N1–N13, O1–O12, P1–P11, and §R ·
`05-product-strategy/product-architecture.md` — §4.2 (the map and the build-condition tags), the
**four retroactive IMPLEMENTATION RECORDS** (S1/S2 2026-09-03, S7 Alerts 2026-09-03, A8 and I1
2026-09-04), and the A8/A9/S2/S7 system entries.

**Measurement (hours old at the time of writing):**
`07-technical-architecture/realtime-performance-architecture.md` (**ARCH-07**, item 24 — its own
`role` line says gate item 15) — §1.3, §1.5, §1.6, §2.1–§2.5, §3 Q1–Q10, §4 D1–D10, §5.1–§5.3, §6,
GAPS · `10-roadmap/observability-plan.md` (**ARCH-07-OBS**, item 25) — §0, §1, §2.1–§2.4, G-1…G-10,
§4.1–§4.9 (S1–S10, OBS-1…OBS-9), §5 items 1–9, §6, GAPS ·
`10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md` — §1, §2.1–§2.4, §3, GAPS.
⚠️ The first two were read by a delegated read-only agent (GAPS 5).

**Decisions and control:**
`12-decisions/DECISION_CARDS_2026-09-26.md` — CARD 9, 10, 11, 12, 14, 15, 16, **17**, 18, 19, 20 ·
`12-decisions/DECISION_CARDS_2026-09-25.md` — CARD 3, 4, 5, 6, 7, 8 and "What is NOT decided here" ·
`00-program-control/CRITICAL_PATH.md` (CP-01…CP-12) ·
`00-program-control/OWNER_INPUTS_REQUESTED.md` (OI-01…OI-21, incl. the Answered table) ·
`00-program-control/MASTER_CHECKLIST.md` rows 15–17 ·
`00-program-control/RISK_REGISTER.md` R-17, R-18, R-19 ·
`11-risks-and-open-questions/` — **listed, not assumed: `.gitkeep` only, 0 bytes.**

⚠️ **Two inherited hygiene notes, restated because they bind this file.** (1) F-01's rule for reading
`CLAUDE.md` as evidence: *"a corrected claim must never be cited as live"*, and this worktree carries
an older copy that disagrees with master on at least eight recorded facts (**DOC-5**) — the one place
this file leans on it is flagged in §6 A-1 and in `FB-A8-03`. (2) best-of-breed's exclusion list is
inherited whole: affiliate and comparison-page sources *"may be used to **locate** a primary source;
**never to support a claim**."* No such source is cited here, because no external source is cited
here at all.

---

## ⛔ What this document does NOT decide

1. ⛔⛔ **It does not score, rank, prioritise, sequence or pick an MVP. Item 17
   (`05-product-strategy/feature-scoring.md`) owns all five and will be written from this output.**
   §1's H1–H3 are an argument about *consequence* — how many other items change if one exists — and
   §2.6's size bands are claims about *shape*. Neither is a priority, neither is an estimate, and the
   order items appear in §3 is the taxonomy's order, not a queue. **If a sentence in this file reads
   like "build this first", it is a defect in the sentence.**
2. **It does not authorise any work.** Every item is a candidate. Several carry explicit
   authorisation gates that live elsewhere and are named in their **Depends on** field —
   per-trigger-type owner authorisation for `FB-S7-01`, the filing-watch parity precondition, item
   23's ownership of `FB-S9-01`, the taxonomy owner's call on any X row.
3. **It does not change the capability taxonomy.** `capability-infrastructure-matrix.md` §0 remains
   the single owner of the 33 rows. §3.9's X1–X3 are best-of-breed's **proposals** to that file, and
   §5's mobile finding is a proposal for a new row — ⛔ adopting either means editing *that* file, and
   maintaining a row in two places is the DOC-2 defect the architecture's own §3.1 test exists to
   prevent.
4. **It does not resolve any owner-bound or PROVISIONAL item.** Named where they bite: OI-05
   (asset-class scope), OI-10 (spend and the AI ceiling), OI-15 (`#tsdr` member-safety), OI-18 (the
   trials), OQ-14 (the earnings-date authority), P-δ (curated versus browsable feed), D1 (the
   workspace model's final lock), D8 (portfolio-risk timing), D9 (decisiveness posture), and CARD
   17's three explicit leftovers — **price, trial and seat model**.
5. **It does not decide the panel count, the freshness contract, the conflation rate or the process
   topology.** ARCH-07 §6 owns all four and leaves them open; `FB-S1-02`, `FB-S8-02`, and the absence
   of any topology item reflect that rather than resolving it.
6. **It does not close R-17, or claim any security finding is resolved.** ARCH-06 owns R-17 and
   explicitly declines to close it. `FB-S9-01`/`FB-S9-02` are candidates against an open, confirmed,
   H/H risk.
7. **It does not decide whether the `user_preferences` → own-store migration happens before or after
   anything else.** C5-03 §5 sequences it; `FB-S5-01` only refuses to be half-shipped.
8. **It does not rule on the ⚠️ it raised about CARD 4.** §2.3 item 4 records that CARD 17 answers
   the tier-count half of CARD 4's stated blocker. **That is my inference across two cards and it is
   labelled as one.** Whether it re-opens A14 is CARD 4's owner's call, not this file's, and §4 row
   10 keeps A14 out until it is made.
9. **It says nothing about the running service.** Nothing was probed, by instruction. Every "today"
   is a claim about a worktree on 2026-09-26, and every ⚰️ in §2.4 is a demonstration that such
   claims decay in days.
10. **It does not decide what to do about the two items in §6 that have no evidence.** They are in an
    appendix precisely so that promoting one is a visible act.
