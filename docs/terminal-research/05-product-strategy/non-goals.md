---
id: A-03 / F-06
title: Non-Goals — the register, with each one's owner, its state, and its re-open trigger
role: Chief Product Officer (A-03), with F-06's gate-item framing
wave: 3
group: F
category: synthesis
scope: UCT Intelligence (dashboard + Morning Wire) — TERMINAL-NEXT product direction
confidence: 🟢 on every row that quotes an owner ruling or a standing governing default (each dated and cited) · 🟡 on the three-state classification itself, which is my judgement over cited rulings · 🟢 on every count (derived, command stated) · 🔴 on nothing, because this file makes no behavioural claim
evidence_ceiling: "No flag state was read and none is asserted — no Railway access on this pass, none attempted. No production endpoint was called, no test suite was run, C:\\data was not touched. No member behaviour was observed. Every competitor fact is carried from items 10, 13 and 15 quoting 03-competitive-research/*, so it sits one to two removes from source and is attributed rather than re-derived. ⛔ And the register is only as complete as the rulings that exist: a non-goal nobody has written down is not in here, which is why §10 names how a new row enters."
sources: 00-program-control/GOVERNING_PRINCIPLES.md §5, §9, §12, §13 · 00-program-control/charter/OWNER_SEED_FACTS.md §6 (line 61) · 00-program-control/charter/C-master-directive.md Part CXCV (DEFINE NON-GOALS), Part CCXLVIII · 12-decisions/DECISION_CARDS_2026-09-26.md CARD 17, CARD 22, CARD 23, CARD 25, CARD 26 · 12-decisions cards 4, 5, 6, 15, 18 as cited per row · 05-product-strategy/product-vision.md (this file's sibling) · 05-product-strategy/product-architecture.md §1.3 and its closing "not reproduced" list · 05-product-strategy/feature-opportunity-backlog.md §2.3, §2.4, §4 · 05-product-strategy/proprietary-advantage-inventory.md §0.4, §5, §6.3 · 05-product-strategy/anti-patterns.md (PROD-C8, PROD-C10, DOC-1, REACH-1 as cited) · 04-workflows/jobs-to-be-done.md §4 · 00-program-control/RESEARCH_GAPS.md RG-10 · 00-program-control/OWNER_INPUTS_REQUESTED.md OI-05
uct_relevance: high
status: draft
date: 2026-09-26
---

# Non-Goals — UCT Intelligence (TERMINAL-NEXT)

**Vocabulary (GOVERNING_PRINCIPLES §1, mandatory).** TERMINAL-CURRENT = the existing surface at route
`/calendar`, display-named "UCT Terminal" since 2026-09-01 (display-only rename; route, door key
`calendar`, widget keys, `/api/calendar/*`, filenames and CSS classes unchanged). TERMINAL-NEXT = the
product this programme designs. UT is the parent brand; UCT Intelligence is the product.

**What this file is.** The non-goals half of `MASTER_CHECKLIST.md` row 18 (Document B gate item 13),
and the sibling of `05-product-strategy/product-vision.md`. Charter Part CXCV requires explicit
non-goals and says why: *"Non-goals prevent runaway scope."* Under the owner's aggregation thesis
(`product-vision.md` §0.1) that requirement gets sharper, not softer — **a goal phrased as "all the
best features" has no natural edge, so the edges have to be written down.**

**What this file is not.** Not a veto list for engineering work — item 16 §4 holds that, and this file
points at it (§9) rather than copying it. Not a re-litigation: every row cites the ruling that made it,
and where a ruling belongs to the owner this file records it and stops. Not a place to invent a
boundary: a row exists here only because a cited artifact put it somewhere first.

### How to read a row

Each row carries a **STATE**, and the state is the load-bearing field:

| State | Meaning | What it takes to change |
|---|---|---|
| **PERMANENT** | An owner decision, or a standing governing default. | A new owner instruction. Nothing in this programme can move it. |
| **V1 BOUND** | Out of scope for V1 with a named re-open trigger. | The trigger firing. |
| **STRUCTURAL** | No purchasable remedy exists at any price, or the thing is not clonable without an asset we cannot obtain. | Nothing. It is a product boundary, like the execution ceiling. |
| **PROGRAMME SCOPE** | Out of *this programme*, which is a scope statement, not a deferral. | A later programme, or the named trigger. |
| **METHOD** | A rule about what may be claimed, not about what may be built. | Nothing — these exist to keep the other rows honest. |

⚠️ **A "no" here is a no on the evidence cited.** Where the source ruling names a re-open trigger, the
trigger is reproduced verbatim; where it names none, the row says **no re-open trigger** and means it.

---

## 1. ⛔⛔ THE ONE BOUNDARY EVERYTHING ELSE HANGS OFF

**"Only use our site" cannot include placing the trade.** It is the ceiling the goal runs into, it is
in the vision rather than in an appendix (`product-vision.md` §0.3, §2), and it is the reason gate item
13 verdicts thinkorswim **structurally undisplaceable**: that platform is inseparable from a funded
brokerage account, which item 13 quotes as *"a brokerage-transfer decision, not a tool-preference
decision"*.

⭐ **So full substitution lands on research and analysis and stops at execution.** ⚠️ Moving the
boundary is an owner decision. Nothing in this file proposes it, and nothing in this file softens it.

---

## 2. THE HARD BOUNDARY — EXECUTION

| # | Not this | Why, and who ruled it | State |
|---|---|---|---|
| **NG-01** | **No execution. No order entry, no order routing, no trade placement — in any surface, for any asset class, at any tier.** | ⛔ `GOVERNING_PRINCIPLES.md` §13, defaults in force: *"No execution or order management."* A standing governing default, restated in `product-architecture.md` §1.3 (*"It does not mean order entry (§13: no execution or OMS)"*) and carried by item 16 §4 row 19 as **⊘ out of scope**, which item 10 insists is *"not ✖ and not ◻"*. | **PERMANENT** (owner-movable only) |
| **NG-02** | **No order management: no order or position lifecycle, no fills, no position-of-record, no product surface that is the authority on what a member holds.** | ⛔ Same §13 clause — *"order management"* is its second half and is a distinct capability from order entry, so it gets its own row. ⭐ Precision that matters: the non-goal is being the **authority**; the existing broker-mirror doctrine elsewhere in the estate already records that a mirror which recomposes from vendor marks is not one. | **PERMANENT** |
| **NG-03** | **No broker write path of any kind, including a "send this to my broker" bridge, a basket hand-off, or a one-click stage-the-order affordance.** | ⛔ This row exists because NG-01 has exactly one softening vector and it is a convenience feature. An order path routed through a bridge is still an order path. ⭐ And under CARD 25 a bridge is not even a win: *"a harden/bridge verdict is not a success state"* — a bridge keeps the incumbent permanently in the loop, which is the opposite of substitution. | **PERMANENT** |

### 2.1 ⛔ The rule NG-01 to NG-03 hand to the coverage ledger

**A workflow step that requires a funded brokerage account is a STRUCTURAL BREAK-OUT, never a coverage
failure.** Item 9's matrix needs it as a third cell value beside COVERED and GAP
(`product-vision.md` §2.1). ⛔ A break-out must not be counted as a gap, because a gap is a promise and
this one cannot be kept.

### 2.2 What these three rows do NOT forbid

* **Reading a broker's market data.** `schwab_router.py` is an existing, partner-owned data router
  (`GOVERNING_PRINCIPLES` §5). The non-goal is an order path, not a vendor.
* **Risk arithmetic on a hypothetical position** — that is analysis. ⚠️ Not proposed here either; see
  NG-13.
* **Alerts, journaling, and the member's record of what they decided.** Those are the research loop and
  the vision's §4 is about one of them.

---

## 3. PERMANENT — OWNER DECISIONS

| # | Not this | Why, and who ruled it | State |
|---|---|---|---|
| **NG-04** | **No free tier.** | ✅ CARD 17, owner verbatim 2026-09-26: **"there is one paid tier only that is it."** The card spells it out: *"ONE paid tier. No free tier. No second paid tier."* ⚠️ **Do not read this as "no free page":** DL-010 records that the code makes the Morning Wire the only free route (`AuthGuard.jsx` `FREE_PAGES = ['/morning-wire']`) and paid-gates everything else server-side. CARD 17 adds that *which* page is free is now the only remaining acquisition lever and is a marketing decision, *"deliberately untouched"*. | **PERMANENT** — no re-open trigger |
| **NG-05** | **No tier axis, and no tier-comparison surface, ever: no pricing table inside the product, no upgrade affordance, no locked-behind-a-higher-tier state, no per-tier entitlement rows, no tier metric.** The entitlement axis is a **binary**. | ⛔ CARD 17's foreclosure, verbatim: *"With one paid tier there is nothing to compare: no pricing table, no upgrade affordance, no locked-behind-a-higher-tier state, no per-tier entitlement rows. A design leaving room for a second tier is carrying dead weight."* Restored rather than invented — `charter/OWNER_SEED_FACTS.md:61`, §6, dated 2026-09-01, already read *"one paid tier"*. Item 16 §4 row 1 carries it as its first not-build row. ⭐ **Cohorts are not tiers** — a named cohort inside the single paid tier is still how Terminal-Next ships dark, and item 23's rung analysis stands. | **PERMANENT** — no re-open trigger. ⛔ Not a V1 deferral. |
| **NG-06** | **No metering as a product mechanism** — nothing whose justification is *"and removing the limit is what the higher tier buys"*. | ⛔ CARD 17, as above. Item 10 had already refused to propose it (*"None of this is a proposal: UCT's tiering is owner-bound"*), and item 16 §2.3 records the consequence in the sharpest available form: one backlog item **lost half of its own source sentence**, because best-of-breed prescribed making the removal of an assumption label *the upgrade* and **there is no tier to upgrade to**. ⭐ **A meter is not a tier gate.** A member-visible usage meter that explains a cap is an honesty mechanism and survives; item 16 §2.3 argues it becomes *more* necessary under one tier, because with one tier there is no "why" available anywhere else. | **PERMANENT** |
| **NG-07** | **No public Substack wire. Ever.** | ⛔ `GOVERNING_PRINCIPLES.md` §13, defaults in force: *"No public Substack wire."* ⚠️ Scope precision: this is about the **wire** being public. The Substack channel itself already carries other, existing traffic — including the promotion of a separate product (`morning-wire/substack/promo.py`) — and none of that is touched by this row. | **PERMANENT** |
| **NG-08** | **No renaming of persisted preference keys or widget keys.** | ⛔ `GOVERNING_PRINCIPLES.md` §13. The precedent is in the vocabulary itself: the 2026-09-01 "UCT Terminal" rename was **display-only** precisely so the door key `calendar`, the widget keys, `/api/calendar/*`, the filenames and the CSS classes could stay put. ⚠️ The programme's own record notes that any rename would need a read-fallback shim on the persisted keys *before* the rename lands; that is stated as the cost, not as a proposal. | **PERMANENT** |

---

## 4. V1 BOUNDS — WITH A NAMED RE-OPEN TRIGGER

| # | Not this | Why, and who ruled it | Re-open trigger |
|---|---|---|---|
| **NG-09** | **No FX, no fixed income, no crypto.** US equities primary; options active; indices and ETFs as context; futures positioning (COT) as a research rail. | ⛔ `GOVERNING_PRINCIPLES.md` §13 and `OWNER_SEED_FACTS` §6. `product-architecture.md` §1.3 already designs the Entity Master so that widening later is *"an alias-table change"*, which is what makes this a bound rather than a wall. ⭐ Consequence for the goal, stated in the vision §3.1: a member whose day includes FX or crypto **cannot** be fully substituted in V1, and that is a known, dated, reversible bound. | **OI-05** widening the asset-class scope. |
| **NG-10** | **No mobile workspace parity.** The phone is reachable and monitorable, not operable. | ⛔ C5-03 §8 *"explicitly declines a mobile workspace model"* (via item 11 §6 item 5), and RG-10 records the owner default as desktop-first with phone = monitoring only, *"record in non-goals"* — this row is that record. Item 16 §4 row 15 carries the corpus argument: Bloomberg, *"with vastly more resources, explicitly did not chase it"*. ⚠️ **Mobile is a missing ROW, not a rejected capability** (item 16 §5) — this row declines *workspace parity*, not mobile. | An owner ruling that TERMINAL-NEXT is a phone product, or telemetry distinguishing mobile from desktop sessions, which no artifact in this programme currently holds. |

---

## 5. STRUCTURAL — NO PURCHASABLE REMEDY

| # | Not this | Why | State |
|---|---|---|---|
| **NG-11** | **Not matching best-in-class DATA** — no research corpus, no broker-research library, no journalist network, no expert-transcript library. | ⛔ Item 10's conclusion 1: *"Matching best-in-class **data** is out of reach and should not be a goal"* — 2,700 journalists, 10,000 Reuters sources, 1,500 broker-research providers and 300k expert transcripts *"a competitor cannot copy"* (carried through item 16 §4 row 4; not re-derived here). ⭐ Its conclusion 2 is what the whole backlog is built on instead: *"Matching best-in-class **mechanisms** mostly costs engineering and no licence at all."* This row is therefore the negative half of the vision's adopted reading of *"all the best features"* (§1 of the vision). | **STRUCTURAL** |
| **NG-12** | **No Bloomberg-IB-shaped chat or collaboration widget, and no attempt to manufacture a network effect.** | ⛔ Item 10's third unclosable gap plus item 11's anti-pattern N4: *"not clonable without the network, per the corpus's own most experienced voice"*, and item 16 §3.6 X1 — *"Building an IB-shaped widget only the desk is on reproduces the form of the moat and none of its substance."* ⭐ `product-architecture.md` §1.4 had already left this as *"a product-vision question"* rather than designing it; this row is the answer to that question. ⚠️ A runner-up mechanism survives in item 16 as a backlog item; declining the widget is not declining every collaborative affordance. | **STRUCTURAL** |

⚠️ **Two licensing rows belong in this class for the same reason and are named so nobody schedules
them:** **LIC-06** (*"no terms document exists at all"*) and **LIC-08** (*"no purchasable remedy at any
price"*), carried from item 15 §5. ⛔ **A gap with no purchasable remedy is a product boundary, not a
backlog item** — exactly like NG-01.

---

## 6. OUT OF THIS PROGRAMME'S SCOPE — A SCOPE STATEMENT, NOT A DEFERRAL

| # | Not this | Why, and who ruled it | Re-open trigger |
|---|---|---|---|
| **NG-13** | **A14 Portfolio & Risk beyond the shipped `/portfolio-heat` door.** | ⛔ CARD 4 (2026-09-25): *"out of this program, and that is a scope statement, not a deferral."* ⚠️ Item 16 §2.3 item 4 records that CARD 17 answers the **tier-count** half of CARD 4's stated blocker **without firing its trigger** — S9 still has no gate and D8 is unlifted — so the tier-count half should stop being cited as open while the row itself stays closed. | CARD 4's own trigger: an entitlements decision in which *tiers exist and S9 gets a gate*. ⛔ NG-05 forecloses the tier half of that, so in practice the trigger is S9 shipping a gate. |
| **NG-14** | **An absolute production capacity number, or a second Railway environment to obtain one.** | ⛔ CARD 15: *"an absolute production capacity number is OUT OF SCOPE for this program and should stop being treated as a missing deliverable. It requires a second Railway environment, which the coexistence work already rejected on member-data grounds."* | None stated. A capacity question would have to be answered without a second environment. |
| **NG-15** | **Per-broker (analyst-level) estimates.** | ⛔ Class-G with no provider in the estate; item 4's master ledger recommends DEFER/INTEGRATE(future) because *"consensus already covers the median workflow"*, and item 10 §6.2 item 5 states it plainly: *"**The honest answer is that this gap should stay open.**"* ⭐ Under the aggregation thesis this is the cleanest example of a gap that is a **licensing and data** question rather than an engineering one — the vision's §3.2 rate limit in one row. | A provider in the estate acquiring the data class, which makes it a licensing question rather than a class-G absence. |

---

## 7. PRODUCT-BEHAVIOUR NON-GOALS — THINGS THE PRODUCT MUST NOT DO TO ITS USERS

| # | Not this | Why |
|---|---|---|
| **NG-16** | **No course, certification or learning tab as the answer to complexity.** | ⛔ Item 11's PROD-C10, with **five vendors** independently recorded doing it: *"If a capability needs a course, the capability needs a redesign"*; a certification is *"the vendor's own admission that the product is not learnable by exploration — a warning marker, not a feature to copy"*; and *"for a challenger, difficulty is pure churn."* ⚠️ **This is not an argument against the curriculum asset**, which item 15 measures (ACC-13) and which D-13 calls the asset most ready to become a product. It is an argument against answering a **learnability defect** with one. ⛔ Also declined in the same family: a read-only demo board or a guided tour as the first-run experience (item 16 §4 row 13). |
| **NG-17** | **No unfalsifiable trust claim — "no hallucinations" and its relatives.** | ⛔ Item 11's PROD-C8: *"'no hallucinations' is unfalsifiable, so the first counterexample costs more trust than the claim ever bought"*, with a named vendor as the recorded instance and the observation that *"the help centre is the honest one."* ⭐ The positive form the estate already ships is provenance: a receipt on the number, not a promise about the model. |
| **NG-18** | **No surface that publishes two counts of itself, and no second authority over one value.** | ⛔ `product-architecture.md`'s closing "not reproduced" list names *"any surface that publishes two counts of itself"* explicitly, and §3.1 identifies *"second authority over one value"* as the estate's most expensive defect class, live in nine-plus places. ⭐ This is a product non-goal and not only an architecture rule: a member who can see two numbers for one thing has been given a reason to go and check somewhere else — which is precisely the tab this product exists to close. |
| **NG-19** | **No emoji or icon as data semantics, and no colour carrying two meanings across surfaces.** | ⛔ Item 16 §4 row 21, from item 10 §3.6: `Bid 🦴` / `🐂 %` as **column names** is *"a screen-reader and an internationalisation problem, and it makes the filter set unsearchable by text"*; and one vendor's red means *"danger/negative gamma"* on one surface and *"below-average IV"* — an opportunity — on another, *"both documented, neither reconciled."* |

---

## 8. METHOD NON-GOALS — THE ROWS THAT KEEP THE OTHER ROWS HONEST

These constrain what may be **claimed**, not what may be built. They are in a product document because
the vision's own success statement depends on them.

| # | Not this | Why |
|---|---|---|
| **NG-20** | ⛔⛔ **No invented or simulated users, and no claimed preference nobody measured.** | CARD 22's three-reviewer panel refused the simulation half of its own commission: *"A simulated trader preferring a simulated terminal is evidence about the simulation."* ⭐ *"A panel can decide the RULE. Only a person can supply the VERDICT."* A vision may state an intent; it may not report a preference. ⛔ And with no non-subject adjudicator the verdict is **INCONCLUSIVE-BY-CONSTRUCTION** — *"It does not become a PASS because nobody was available to disagree."* |
| **NG-21** | ⛔ **No hand-typed count.** | This programme's signature defect is a number typed beside the artifact that owns it. Recorded instances: the capability-ledger row that said 211 beside 178; a matrix row that said 317 lines beside 1,259; a setup catalog saying 24 beside 26 **in its own file header**. Every count in this file and in `product-vision.md` is derived with its command printed (§10). |
| **NG-22** | ⛔ **No treating a ledger cell as authoritative, and no reading a small cell as a floor.** | Item 15 re-derived seven cells of `01-existing-system/capability-ledger.md`: five understated, two exact, and **one OVERSTATED** — row A8 records `cap_universe.json` at 3,742 where `origin/master` holds **3,640** (derived in
`product-vision.md` §4.2, with the command printed there). ⭐ **A ledger cell is a dated measurement whose error has no reliable sign**, and the old "it always understates" framing licensed exactly the wrong inference. ⚠️ Item 11 files the same class as DOC-1, and notes that **agents are dispatched with these rows as their brief**, so a wrong cell is an active wrong-precedent source. |
| **NG-23** | ⛔ **No asserted flag state.** | No document in this pair reads or asserts one; there is no Railway access here and none was attempted. A code default is not a flag state, and a past decision is not a flag state. ⭐ Item 15's `ADMIN-MOUNTED` is the honest third state between *absent* and *serving members*, and it is available without asserting anything. |
| **NG-24** | ⛔ **No merging of the two products' populations into one denominator.** | UCT Intelligence is ~26 accounts, **13** with any page-view row, six of those the roster admins
(carried from a dated telemetry verification artifact through items 13 and 15; **not** re-derived here
— this pass has no production telemetry access). The Whop live-trading Discord is *"750 members in discord paying"* (owner verbatim) and is **a separate product outside this programme's boundary**. ⛔ A rate across both is meaningless. ⭐ Those ~750 remain the realistic **subject pool** for a future adoption claim — a vision-relevant fact that does not merge the products. |

---

## 9. ⛔ WHAT IS *NOT* A NON-GOAL — AND IS ROUTINELY MISTAKEN FOR ONE

This section exists because a non-goals register is the easiest document in a programme to misuse: it
gets cited to veto things nobody ever ruled out.

1. ⚰️ **Four capabilities recorded as "absent" somewhere that actually SHIP.** Item 16 §2.4 caught four
   near-misses on exactly this error: **the command palette, the freshness badge, per-widget error
   boundaries, and the print explainer.** Per-widget error boundaries is the documented case —
   `ErrorBoundary` wraps `WidgetBody` at `WidgetHost.jsx:107-111` with the header rendered outside it,
   in a commit that is an ancestor of `origin/production`, while a checklist row asserted *"there are
   currently zero per-widget error boundaries"*. ⛔ **Absent-in-a-document is not absent-in-the-product,
   and this register never implies it is.**
2. **E1 People / Company Intelligence is undecided, not excluded.** `capability-infrastructure-matrix.md`
   E1: *"Genuinely undecided, not a §13 exclusion… the honest answer is 'we don't yet know'… and it
   should stay that way until a competitive dossier finding makes it decision-relevant."* ⛔ Unevidenced
   and excluded are two different reasons for the same absence, and only one of them belongs in this
   file.
3. **Mobile, as such.** NG-10 declines *workspace parity*. Item 16 §5 records mobile as a **missing row**
   in the backlog, not a rejected capability.
4. **The Schwab data path** (NG-02's note) and **the Substack channel** (NG-07's note). Both are live,
   both are untouched, and neither is inside the non-goal that sits next to it.
5. **Coverage gaps themselves.** ⛔ A gap is not a non-goal. Under the aggregation thesis a gap is the
   unit the goal is measured on, and the ledger that enumerates them is item 9 — **NOT STARTED**, and
   the most goal-aligned unstarted deliverable in the programme. **Nothing in this file may be cited to
   close a gap by declaring it out of scope.**

### 9.1 The engineering veto list lives elsewhere — pointer, not a copy

`05-product-strategy/feature-opportunity-backlog.md` §4 holds a longer not-build list at the level of
individual engineering items, each with its own ruling and, where one exists, its re-open trigger. Its
size, derived rather than carried:

```python
import re
bl = open("docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md",
          encoding="utf-8").read()
sec = bl.split("Items this product should NOT build")[1].split("## 5.")[0]
print(len(re.findall(r"(?m)^\| \d+ \|", sec)))
# -> 22
```

⛔ **This file promotes to an NG id only the rows that are product-level boundaries.** The rest — a
board-level aggregation endpoint, a corporate-actions ledger, `relation_added` events, anything inside
`StockChart.jsx`, arming the event-loop watchdog, changing the deploy cadence, a member-facing AI lane
on the owner's subscription seat, a hand-assembled reachability table — stay item 16's rows with item
16's reasons. **Two registers, one authority each; derive, do not restate.**

---

## 10. THE ROW COUNT, AND HOW A NEW ROW ENTERS

⛔ Never typed. Derived over the finished file:

```bash
grep -cE "^\| \*\*NG-[0-9]{2}\*\*" docs/terminal-research/05-product-strategy/non-goals.md   # -> 24

# duplicate-id check (must print nothing):
grep -oE "^\| \*\*NG-[0-9]{2}\*\*" docs/terminal-research/05-product-strategy/non-goals.md \
  | sort | uniq -d
```

**A new row is admissible only if all four hold:**

1. A cited artifact already declined it — an owner ruling, a governing default, a decision card, or a
   red-teamed document. ⛔ **This file may not originate a non-goal.**
2. It is a **product** boundary, not an engineering veto. Engineering vetoes go to item 16 §4.
3. It carries a STATE from the table at the top, and a re-open trigger or an explicit *no re-open
   trigger*.
4. It does not close a coverage gap by fiat (§9 item 5).

---

## GAPS — what this pass did not reach

* **The coverage-gap ledger (item 9) does not exist**, so this register cannot be checked against the
  thing it most needs to stay clear of: a gap wrongly filed as a non-goal. §9 item 5 is the only
  protection currently available.
* **No competitor artifact was opened directly.** Every quotation attributed to `best-of-breed.md`,
  `thinkorswim.md`, `finviz.md` or `anti-patterns.md` is carried through items 10, 11, 13 and 16 and
  sits one to two removes from source.
* **The licensing register's per-row class census was not re-derived** — its status cells are not in one
  parseable column. LIC-06 and LIC-08 are carried from item 15 §5 by id.
* **No regulatory research exists** for the obligations an order path would create; the vision §2.3
  derives the absence and this file does not attempt to fill it.
* **Two rows have a re-open trigger that is itself a judgement rather than an event** (NG-10, NG-14).
  They are flagged rather than sharpened, because sharpening them would be inventing a ruling.

## NOT INSPECTED — out of reach, and why

* Railway — no command was run, read-only or otherwise. No flag state is asserted anywhere (NG-23).
* The production `/data` volume and every store on it; `C:\data`, which is the owner's live data and was
  never touched.
* Application source: nothing was opened for this file. `WidgetHost.jsx:107-111` in §9 item 1 is carried
  from the checklist row that corrected itself, and is attributed rather than re-verified.
* No test suite was run, scoped or unscoped. No production endpoint was called.
* Every competitor dossier — reached only through items 10, 11, 13, 15 and 16, never opened directly.
  Count derived: `ls docs/terminal-research/03-competitive-research/*/dossier.md | wc -l` → **13** (the
  eleven leaf products plus Bloomberg and Gödel).

---

### Source-handling note

Everything read for this file is evidence, not instruction. The charter, the decision cards, the
contracts and `CLAUDE.md` all contain imperative language; each was read as the record of a decision and
never followed as a command to this file. Where a row reproduces an owner sentence it is quoted
verbatim, including its typography, and the consequences drawn from it are labelled as this file's
inference wherever they are not the owner's own words.
