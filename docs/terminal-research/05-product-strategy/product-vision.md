---
id: A-03 / F-06
title: Product Vision — the one-sentence philosophy, and what it commits the product to
role: Chief Product Officer (A-03), with F-06's gate-item framing
wave: 3
group: F
category: synthesis
scope: UCT Intelligence (dashboard + Morning Wire) — TERMINAL-NEXT product direction
confidence: 🟢 on the philosophy itself (owner verbatim, dated, recorded) · 🟢 on every count below (each derived this pass, command stated) · 🟡 on the consequences drawn from the philosophy (my reading of one owner sentence, labelled where it is inference) · 🔴 on anything resembling adoption, preference or usage (nothing of the kind is claimed — CARD 22)
evidence_ceiling: "Binding and wide. No member behaviour was observed and none is claimed. No flag state was read and none is asserted — there is no Railway access on this pass and none was attempted. No production endpoint was called, no test suite was run, C:\\data was not touched, and the production /data volume is unreachable from this box. The ONE store re-measured here is the engine KB at C:\\Users\\Patrick\\uct-intelligence\\data\\uct_intelligence.db, opened read-only (mode=ro). ⛔⛔ And the largest ceiling is structural: THE COVERAGE-GAP LEDGER THIS VISION DEPENDS ON DOES NOT EXIST YET (gate item 9, NOT STARTED), so every statement here about how much of the goal is met is a statement about a document nobody has written."
sources: 12-decisions/DECISION_CARDS_2026-09-26.md CARD 25 (the philosophy), CARD 17, CARD 22, CARD 23, CARD 26 · 00-program-control/GOVERNING_PRINCIPLES.md §9, §13 · 00-program-control/charter/OWNER_SEED_FACTS.md §6 (line 61) · 00-program-control/charter/C-master-directive.md Parts XLVI, CLXXXVI, CXCV, CCXLVIII, CCXLIX · 00-program-control/MASTER_CHECKLIST.md rows 9, 10, 13, 15, 16, 17, 18, 27 · 05-product-strategy/product-architecture.md §1.1–§1.4 and its closing "not reproduced" list · 05-product-strategy/proprietary-advantage-inventory.md §0.0, §1, §5, §5.1 · 05-product-strategy/feature-opportunity-backlog.md §2.3, §4 · 05-product-strategy/feature-scoring.md · 04-workflows/jobs-to-be-done.md §4 · 09-security-licensing-cost/licensing-register.md · C:\\Users\\Patrick\\uct-intelligence\\data\\uct_intelligence.db (read-only) · origin/master:api/data/cap_universe.json
uct_relevance: high
status: draft
date: 2026-09-26
---

# UCT Intelligence (TERMINAL-NEXT) — Product Vision

**Vocabulary (GOVERNING_PRINCIPLES §1, mandatory).** TERMINAL-CURRENT = the existing surface at
route `/calendar`, display-named "UCT Terminal" since 2026-09-01; the rename was display-only, so the
route, the dashboard door key `calendar`, the widget keys, `/api/calendar/*`, the filenames and the CSS
classes are unchanged. TERMINAL-NEXT = the product this programme designs. UT is the parent brand;
UCT Intelligence is the product. Nothing in this file modifies either surface.

**What this file is.** The product-vision half of `MASTER_CHECKLIST.md` row 18 (Document B gate item
13). That row was PARTIALLY SATISFIED because `05-product-strategy/product-architecture.md` (Phase 2,
ACCEPTED 2026-09-02) already carries a sharpened product thesis (§1.1–§1.4) and an explicit
"not reproduced" list. ⛔ **This file does not restate that thesis and does not replace it.** It does
the one thing that file could not: it renders the owner's own one-sentence philosophy, stated
2026-09-26 — twenty-four days after `product-architecture.md` was accepted — and draws out what it
commits the product to. What it forecloses is the sibling file, `05-product-strategy/non-goals.md`,
which is row 18's other half and is the half that will actually get used.

**What this file is not.** Not a feature list — that is item 16 (`feature-opportunity-backlog.md`).
Not a ranking — item 17 (`feature-scoring.md`). ⛔ **Not the coverage-gap ledger this philosophy
requires** — that is item 9 (`05-product-strategy/capability-matrix/capability-matrix.md`, NOT
STARTED, promoted by CARD 25 to the most goal-aligned unstarted deliverable in the programme); this
file points at it and deliberately does not pre-empt it. Not a metric set
(`10-roadmap/success-metrics.md`). Not a definition of done — CARD 22 ruled the rule and item 27
(`10-roadmap/mvp.md`) operationalises it. ⛔ **And it states no adoption fact and claims no member
preference**, for the reason in §5.

---

## 0. THE ONE PAGE

### 0.1 The philosophy, in the owner's own words — verbatim, unedited, 2026-09-26

> **"the goal is to aggreagte all the best features so someone can only use our site instead of the
> others."**

⛔ **Quoted as spoken, typo included.** It is the primary source, it is dated, and this file is not
entitled to improve it or to restate it in more flattering language. Recorded in
`12-decisions/DECISION_CARDS_2026-09-26.md` CARD 25, which also carries its three companion owner
facts: *"We have 750 members in discord paying."* · *"Dont worry aobut anything else on costs or
uses."* · *"Assume that i personally use every other site mentioned."*

### 0.2 The vision in five sentences, each a commitment rather than a slogan

1. **The unit of success is a CLOSED TAB, not a shipped feature.** "Only use our site" is a statement
   about what a member *stops* opening, so every capability is judged by whether it removes a reason
   to leave — not by whether it exists, demos well, or happens to be ours.
2. **Coverage is the binding constraint; depth is what keeps the win once it happens.** Any capability
   a competitor has and this product lacks is a live reason to keep another tab open, so **one missing
   feature can defeat a hundred proprietary ones.** Proprietary depth answers *"why not them instead
   of us"*; only coverage answers *"why open them at all"*.
3. **Full substitution lands on research and analysis and stops at execution.** That boundary is
   structural, not a backlog item (§2). A workflow whose last step is placing the trade leaves this
   site **by design**.
4. **The strongest asset this programme can evidence currently reaches no member.** Closing that is a
   surface and a permission model — not a data-collection programme (§4).
5. **Nobody has measured a member preferring this product to anything.** The four sentences above are
   an **intent**; not one of them is a finding about behaviour, and this file never upgrades one into
   the other (§5).

### 0.3 The ceiling, stated here rather than in an appendix

⛔⛔ **"Only use our site" cannot include placing the trade.** No execution and no order management is
a standing governing default (`GOVERNING_PRINCIPLES.md` §13). It is why gate item 13's desk-tool pass
verdicts thinkorswim **structurally undisplaceable**: the platform is inseparable from a funded
brokerage account. Full substitution is therefore achievable for **research and analysis** and bounded
at **execution**. ⚠️ Moving that boundary is an owner decision; nothing in this file proposes it, and
nothing in this file softens it.

---

## 1. WHAT THE SENTENCE SAYS, READ PLAINLY

Three readings are available for the phrase *"all the best features"*, and the choice between them is
the whole strategy — so it is made explicitly rather than left to the reader.

| Reading | What it would mean | Verdict |
|---|---|---|
| **Feature parity with each named product** | Rebuild each competitor's feature set | ⛔ Rejected. `GOVERNING_PRINCIPLES` §9: *"Workflow superiority for the UCT niche, not benchmark parity"*, and charter Part CCXLVIII forbids a Frankenstein terminal assembled from best-of-breed parts with no philosophy. |
| **The best MECHANISM for each job the desk and members actually do** | Take the mechanism that wins a job, wherever it comes from, and express it in one grammar | ✅ **Adopted.** It is the only reading that satisfies both CARD 25 and Part CCXLVIII: what is aggregated is **jobs covered**, not interfaces copied. Item 10's own conclusion supports it — *"Matching best-in-class **mechanisms** mostly costs engineering and no licence at all"* (carried from `best-of-breed.md` §5 via `feature-opportunity-backlog.md` §4 row 4; not re-derived here). |
| **The best DATA each product holds** | Match research corpora, journalist networks, broker research | ⛔ Rejected, and it is a **structural** non-goal rather than a deferral — `non-goals.md` NG-11. Item 10's conclusion 1: *"Matching best-in-class data is out of reach and should not be a goal"*. |

⭐ **The reconciliation that matters, stated because two Level-1 instructions look opposed.** CARD 25
demands breadth; Part CCXLVIII forbids a pasted-together product. They are compatible on exactly one
axis: **aggregate the JOBS, express them in ONE grammar.** A member who can do a job here has no
reason to open the other tab; a member who must learn a different grammar per job has been handed a
Frankenstein and will keep the tab they already know. ⚠️ Labelled: this reconciliation is my inference
over two charter sources, not a ruling in either.

### 1.1 The three consequences the philosophy has already forced on other documents

These are not proposals. They are re-rankings CARD 25 has already caused, recorded so this file stays
consistent with them:

1. **Item 9, the Cross-Product Capability Matrix, became the most goal-aligned unstarted deliverable
   in the programme.** It IS the coverage ledger this thesis requires, and its inputs are recorded as
   complete. ⛔ **This file does not duplicate it, does not estimate it, and does not guess its
   headline.** Any sentence of the form "our coverage is N%" is unwritable until it lands.
2. ⛔ **A harden/bridge verdict is not a success state.** A bridge keeps the incumbent permanently in
   the loop, which is the opposite of substitution. Of the five desk-tool rows in gate item 13,
   exactly one is *absorb outright*; two are *harden* or *bridge*; one is structurally undisplaceable;
   one has never been studied as a desk tool at all. Under this philosophy three of the five read
   **unmet**, not *done differently*. The row count is derived, not carried:

   ```python
   import re
   jt = open("docs/terminal-research/04-workflows/jobs-to-be-done.md", encoding="utf-8").read()
   sec = jt.split("| Tool (owner-confirmed) | Jobs it holds |")[1].split("What the list says")[0]
   print(len(re.findall(r"(?m)^\| \*\*(.+?)\*\*", sec)))
   # -> 5   ['thinkorswim / Schwab', 'TradingView', 'Finviz Elite', 'Unusual Whales',
   #         '"Many many many others"']
   ```

3. **An advantage inventory stops being the plan.** The canonical inventory says so itself (§0.0:
   *"ACCUMULATED does not decide whether the goal is met. GAPS decide that."*). This file agrees, and
   §4 says what the moat is still for.

---

## 2. THE CEILING IN FULL — WHY SUBSTITUTION STOPS AT EXECUTION

**The default.** `GOVERNING_PRINCIPLES.md` §13, defaults in force: *"No execution or order
management."* Confirmed present this pass:

```bash
grep -c "No execution or order management" \
  docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md      # -> 1
```

**Why the boundary is structural rather than a gap somebody could fund.** Gate item 13's desk-tool
section, quoting `03-competitive-research/desk-tools/thinkorswim.md` §4–§5 — so these words are one
remove from source and are attributed, not re-derived:

> the platform is inseparable from a funded Schwab account — *"a brokerage-transfer decision, not a
> tool-preference decision"* — and §5's realistic ceiling is *"feature-parity on
> charting/scanning/options-analysis, never full displacement, as long as the member's capital sits at
> Schwab."*

⭐ **Read against CARD 25 this is the sharpest fact in the programme.** The one tool the desk opens
that no feature can displace is the one that holds the money. So the honest shape of the goal is:
**"only use our site" for deciding; the broker for doing.**

### 2.1 The rule this produces — and it is a rule the coverage ledger needs

⛔ **A workflow step that requires a funded brokerage account is a STRUCTURAL BREAK-OUT and must never
be counted as a coverage failure somebody could close.** Item 9 needs this as a distinct cell value,
the same discipline item 10 already applies in keeping *"not offered"* and *"not established"* as
separate cells. Three values, not two:

* **COVERED** — the job can be done here.
* **GAP** — a competitor does it, we do not, and closing it is work. This is the row that keeps a tab
  open, and the row the goal is measured on.
* **STRUCTURAL BREAK-OUT** — the job leaves this site by design: execution, order management,
  funded-account operations. ⛔ Not a gap. Not a failure. Not a backlog item.

### 2.2 What the boundary does NOT forbid — because a vague ceiling gets softened by accident

* It does not touch the **Schwab data path**. `schwab_router.py` is an existing, partner-owned data
  router (`GOVERNING_PRINCIPLES` §5); reading a broker's market data is not order management. The
  non-goal is an **order path**, not a vendor.
* It does not forbid **risk arithmetic on a hypothetical position** — that is analysis, and gate item
  13 records the desk doing that arithmetic by hand today. ⚠️ It is nonetheless **not proposed here**:
  A14 Portfolio & Risk beyond the shipped `/portfolio-heat` door is ruled out of this programme by
  CARD 4, *"a scope statement, not a deferral"* (`non-goals.md` NG-13).
* It does not forbid **alerting**, journaling, or the record of what a member decided. Those are the
  research loop, and §4 is about one of them.

### 2.3 ⚠️ One thing this programme has not researched at all — stated as a gap, not as a legal claim

An order path would create obligations for UCT itself that no artifact in this programme classifies.
Derived this pass:

```bash
# files mentioning broker-dealer / FINRA / the Investment Advisers Act, anywhere in the programme
grep -rli "broker-dealer\|FINRA\|Investment Advisers Act" docs/terminal-research | wc -l   # -> 19

# ... and in the three directories that would hold UCT's OWN obligations
grep -rli "broker-dealer\|FINRA\|Investment Advisers Act" \
  docs/terminal-research/09-security-licensing-cost \
  docs/terminal-research/11-risks-and-open-questions \
  docs/terminal-research/12-decisions | wc -l                                              # -> 2
```

Both of those two are about **vendor terms and professional/exchange classification**
(`realtime-and-exchange-classification.md`, `vendor-terms-evidence.md`), and most of the wider 19 are
competitor facts — Gödel's `$30/mo FINRA surcharge` among them. ⛔ **So this is an evidence vacuum, not
a cleared area.** It is one more reason the ceiling holds by default: the programme would have to open
a research area it has not begun before anyone could responsibly argue about moving it.

---

## 3. THE THREE THINGS THAT BOUND "ALL THE BEST FEATURES" — SCOPE, LICENCE, TIER

### 3.1 Asset-class scope — a V1 bound with a named re-open path

US equities primary; options active; indices and ETFs as context; futures positioning (COT) as a
research rail; **no FX, no fixed income, no crypto in V1** (`GOVERNING_PRINCIPLES` §13;
`OWNER_SEED_FACTS` §6). Re-open trigger: **OI-05**. ⭐ Consequence for the goal: a member whose day
includes FX or crypto cannot be fully substituted in V1 — and that is a **known, dated, reversible**
bound, unlike §2's ceiling, which is not.

### 3.2 ⛔⛔ The licensing frontier — cleared behind us, open in front of us

The owner cleared licensing for the current estate, verbatim 2026-09-26: *"in terms of license and
compliance we already have everythign checked off and are good everywhere that already has access and
data and information so we are good."* ⛔ **That is an owner risk decision, it is recorded (CARD 26),
and no document downstream of it may treat licensing as a blocker on what already runs.** The
register's size, derived here rather than carried:

```bash
grep -cE "^\| (T|N|M|O)-[0-9]+" \
  docs/terminal-research/09-security-licensing-cost/licensing-register.md    # -> 118
```

⭐⭐ **But the clearance is scoped to what the estate already has, and an aggregation thesis needs
things it does not.** A coverage gap is frequently a **data** gap rather than a code gap. So:

> **Licensing is CLEARED for the current estate and OPEN for each new data source coverage requires.**

⛔ **That is the rate limit on this vision.** Coverage cannot grow faster than the slower of
engineering and a new feed's permission. It belongs in the vision because it changes what a roadmap is
allowed to promise: a gap closed with data already held is a **schedule** question; a gap needing a new
source is a **permission** question with the owner in the loop.

⚠️ Two register rows make the point permanent rather than procedural: **LIC-06** (*"no terms document
exists at all"*) and **LIC-08** (*"no purchasable remedy at any price"*) — carried from item 15 §5, not
re-derived. A gap with no purchasable remedy is a product boundary, like §2's ceiling.

### 3.3 One paid tier — so the entitlement axis is a binary

Owner ruling, verbatim 2026-09-26 (CARD 17): **"there is one paid tier only that is it."** Restored
rather than invented: `charter/OWNER_SEED_FACTS.md:61`, §6, dated 2026-09-01, already read *"one paid
tier"*. Price is settled at **$200/month or $2,000/year** (CARD 23). ⛔ **The product therefore has no
tier axis to design against** — no pricing table, no upgrade affordance, no locked-behind-a-higher-tier
state, no per-tier entitlement rows, no tier metric. `non-goals.md` NG-05 and NG-06 carry it as a
permanent foreclosure; cohorts are not tiers.

⭐ **Why this belongs in the VISION and not only on a pricing page:** under one tier, *"you can only use
our site"* must be true for **the one paid member**, with nothing held back for an upsell. Every
capability either ships to that member or does not exist. **There is no tier in which a gap can be
parked.**

### 3.4 Costs and usage — de-scoped by the owner

*"Dont worry aobut anything else on costs or uses."* ⛔ **This file therefore sets no cost goal, no
usage goal, no spend target and no ARPU inference**, and none of its arguments runs through one. ⚠️
Licensing is **not** covered by that de-scoping (§3.2): *can this feed legally serve members* is a
permission question, not a cost question.

---

## 4. THE MOAT'S ROLE UNDER THIS PHILOSOPHY — AND THE FINDING THE VISION MUST RECKON WITH

Gate item 15 (`05-product-strategy/proprietary-advantage-inventory.md`, landed 2026-09-26) sorts the
estate's advantage claims into four classes. Re-derived over that file this pass, never carried:

```python
import re
t = open("docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md",
         encoding="utf-8").read()
for p in ("ACC", "BLT", "LIC", "CLM"):
    print(p, len(re.findall(r"(?m)^\| \*\*%s-\d\d\*\* \|" % p, t)))
print("NO-SURFACE-FOUND", len(re.findall(r"(?m)^\| \*\*ACC-\d\d\*\*.*NO-SURFACE-FOUND", t)))
# -> ACC 14 · BLT 20 · LIC 18 · CLM 19   (71 rows in total) · NO-SURFACE-FOUND 5
```

⛔⛔ **The shape is the finding, and the vision has to say it out loud: the quarantine — 19 advantage
claims that cannot be traced to an artifact reachable from this box — is LARGER than the moat, the 14
assets that exist only because time passed.** A vision that recites the moat and skips the quarantine
is decoration.

⚠️ And the totals are a function of how finely rows were split, which was item 15's judgement. They are
quotable for **shape** (quarantine > moat) and not as measurements of the product.

### 4.1 The single strongest asset — re-measured here, and it reaches no member

**The decision record: `wire_universe` × `wire_issues`.** Re-derived this pass against the one readable
production-shaped store, opened read-only:

```python
import sqlite3
DB = r"C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db"
con = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True)
c = con.cursor()
print(c.execute("SELECT COUNT(*) FROM wire_universe").fetchone())            # (22574,)
print(c.execute("SELECT COUNT(*) FROM wire_issues").fetchone())              # (60,)
print(c.execute("SELECT dropped_at_stage, COUNT(*) FROM wire_universe "
                "GROUP BY 1 ORDER BY 2 DESC").fetchall())                    # [(2, 19611), (None, 2963)]
print(c.execute("SELECT MIN(sent_at), MAX(sent_at) FROM wire_issues").fetchone())
# ('2026-04-29 03:39:57', '2026-09-26 15:12:14')
print([r[1] for r in c.execute("PRAGMA table_info(wire_universe)").fetchall()])
# ['issue_id', 'ticker', 'sources', 'feature_vector', 'dropped_at_stage', 'drop_reason',
#  'is_exploration', 'created_at']
```

**22,574 rows across 60 issues, of which 19,611 carry `dropped_at_stage = 2`** — names the desk
**considered and rejected**, each with the stage it died at, a `drop_reason`, and the `feature_vector`
it had at the time. ⭐ That is a record of judgement under uncertainty. No vendor sells it and no scrape
recovers it; it exists only because 60 mornings happened.

⛔⛔ **And its consumption cell is `NO-SURFACE-FOUND`. The most defensible thing this programme can
measure reaches no member.** Five of the fourteen accumulated rows are in that state — item 15 §5.1:
ACC-02, ACC-06, ACC-08, ACC-10, ACC-13.

⭐ **The vision's consequence, and it is the one product statement in this file that is not a
restatement of somebody else's:** under *"only use our site"*, **an asset no route reads contributes
nothing to closing a tab, however defensible it is.** So the first move on the moat is **a surface and
a permission model, not more collection.** The data is already accruing daily; the exposure is not.

⚠️ **Three honesty clauses on that paragraph, none of them optional.**

1. **Depth is five months, not five years.** The 60 issues span 2026-04-29 → 2026-09-26, which is
   **108 weekdays** — derived, not carried:

   ```bash
   python -c "import datetime; a=datetime.date(2026,4,29); b=datetime.date(2026,9,26); print(sum(1 for i in range((b-a).days+1) if (a+datetime.timedelta(i)).weekday()<5))"
   # -> 108      (about 104 sessions once market holidays are removed — item 15's figure)
   ```

   ⛔ **So the archive is not every session.** The *shape* is irreplaceable; the *depth* is young, and
   a pitch implying otherwise makes exactly the mistake item 15 names.
2. **`NO-SURFACE-FOUND` is an absence of evidence from one pass**, not proof that no reader exists —
   and whether AI Search already retrieves across these trails for a ticker query is recorded **NOT
   DETERMINED** (item 15, CLM-14).
3. ⛔ **The per-ticker history join does not exist**, so "the record changes what the next read says"
   is a design intent, not a shipped behaviour. Item 16 ranks the join its most consequential
   opportunity and item 17 scores it; neither is a claim that it works.

### 4.2 ⛔ A ledger cell is a dated measurement whose error has no reliable sign

This vision depends on knowing what already ships, and the obvious source for that —
`01-existing-system/capability-ledger.md` — **is not authoritative, and its own banner must not be
believed.** Item 15 re-derived seven of its cells: five understated, two were exact, and **one
OVERSTATED**. Re-derived here independently, because it is the one that breaks the comforting rule:

```bash
python -c "import json,subprocess; print(len(json.loads(subprocess.run(['git','show','origin/master:api/data/cap_universe.json'],capture_output=True).stdout)))"
# -> 3640        (the ledger's row A8 records 3,742)
```

⛔ **So no statement in this vision reads a ledger cell as a floor.** Where "what exists today" matters,
either the artifact and its date are named, or the number is re-derived, or the sentence is not
written.

---

## 5. WHO THIS IS FOR, AND WHO IS ALLOWED TO SAY IT WORKED

### 5.1 ⛔⛔ Two products, two populations, never one denominator

* **UCT Intelligence** — the dashboard and the Morning Wire — is this programme's subject and the
  **$200/month or $2,000/year** product (owner-ratified, CARD 23). Its population is **~26 accounts,
  13 with any page-view row, six of those the roster admins** (carried from
  `verification/2026-09-14/OI-06-telemetry-derived-defaults.md` through items 13 and 15; **not**
  re-derived here — this pass has no production telemetry access).
* **The Whop live-trading Discord** — *"We have 750 members in discord paying"*, owner verbatim — is
  **a separate product, outside this programme's boundary.** It is merely promoted through the wire's
  Substack.

⛔ **A rate computed across both is meaningless and no document may compute one.** With 13 accounts
carrying any page-view row, one account moves any rate by several points, which is why item 15 refuses
usage arguments outright and why this file makes none.

⭐ **The vision-relevant fact, stated without merging the products:** those ~750 are the realistic
**subject pool** for any future adoption claim — already paying, already reachable, already transacting
with the firm. That is why CARD 22's blocker is no longer *"there may be no non-builder subject at
all."* ⚠️ Naming one is an owner decision about a real person, and the panel's requirements are
unchanged.

### 5.2 ⛔⛔ No invented users, no simulated preference, and therefore no adoption claim in this file

CARD 22's three-reviewer panel refused the simulation half of its own commission: *"A simulated trader
preferring a simulated terminal is evidence about the simulation."* ⭐ **A panel can decide the RULE;
only a person can supply the VERDICT.**

So this file is careful about a distinction that is easy to lose in a document of this genre:

| Allowed here | ⛔ Not allowed here |
|---|---|
| "The goal is that a member stops opening the other tab." | "Members prefer our charts." |
| "Coverage is what decides whether the goal is met." | "We have closed N% of the gap." |
| "The decision record is the strongest measured asset." | "Members value the decision record." |
| "~750 paying Discord members are the reachable subject pool." | "~750 members would adopt this." |

⛔ **Everything in the right column is unwritten, and the absence is deliberate.** The measurement
design belongs to CARD 22 and item 27: preference is a **subtraction**, established by a **withdrawal**
test — turn the surface off, unannounced, and see whether anybody asks for it back — never by an
addition, because *"I use it every morning" is true of five open tabs*. This file neither restates that
design nor pre-empts its verdict; with no non-subject adjudicator the honest answer is
**INCONCLUSIVE-BY-CONSTRUCTION**, which is not a failure of the vision but the current state of the
evidence.

---

## 6. HOW THIS VISION WOULD BE FALSIFIED

Falsifiers, not metrics — metrics are `10-roadmap/success-metrics.md`. Each names what would have to be
*observed*, and none of them can be observed from this box.

1. **A member closes no tab.** If a capability ships, is reachable, and the incumbent stays open, the
   coverage claim for that job is false regardless of feature quality.
2. **The gap ledger (item 9) shows the remaining gaps are structural or data-licensed rather than
   engineering.** Then coverage is not the binding constraint, this philosophy's central consequence is
   wrong, and the plan becomes a permissions plan rather than a build plan.
3. **The decision record gets a surface and nobody uses it.** That falsifies §4's claim that
   defensibility is bottlenecked on exposure, and relocates the problem to demand.
4. **The per-ticker join proves too sparse to render** — carried from `product-architecture.md` §1.2's
   falsifier list: *"fewer than a few hundred names with all four histories"*.
5. **An owner ruling moves the execution boundary.** Then §2 is wrong in kind rather than in degree,
   and the vision's shape changes with it.

⛔ **None of the five is testable today**, and two need a named non-builder subject. They are recorded
open, not assumed closed.

---

## 7. WHAT THIS FILE DOES NOT DECIDE

* **Coverage, and how much of it exists** — item 9, NOT STARTED. Nothing here estimates it.
* **Which capabilities, and in what order** — items 16 and 17. The backlog's size, derived:

  ```bash
  grep -oE "FB-[A-Z0-9]+-[0-9]{2}" \
    docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md \
    | sort -u | wc -l          # -> 85
  ```

* **Tier S–X priorities** — the remaining half of gate item 13, carried by items 16/17, not by this
  file.
* **Price, trial and seat model** — undecided and owner-bound (CARD 17 §4).
* **Information architecture** — item 19 (ACCEPTED); item 20's hybrid lock is PROVISIONAL pending red
  team.
* **The MVP and its definition of done** — CARD 22 (the rule) and item 27 (the ledger).
* ⛔ **Anything about a flag's state.** None is asserted anywhere in this file.

---

## GAPS — what this pass did not reach

* **The coverage-gap ledger does not exist**, so the single most important number in this document's
  subject matter is unwritten. Everything here about "how much of the goal is met" is a method
  statement, not a measurement.
* **No competitor artifact was opened directly.** §1's table and §2's thinkorswim quotes sit one to two
  removes from source (items 10 and 13 quoting `desk-tools/*.md`) and are attributed as such.
* **No production telemetry.** The ~26 / 13 / six figures are carried from a dated verification
  artifact and were not re-derived; usage is de-scoped anyway.
* **The licensing register's class census was not re-derived** — its status cells do not sit in one
  parseable column. Only the 118-row total is derived here; the 76-Likely-Allowed / 18-Restricted split
  is CARD 26's and the register's, carried.
* **No member behaviour, no preference, no adoption, no flag state, no cost.** By construction.

## NOT INSPECTED — out of reach, and why

* The production `/data` volume and every SQLite store on it (`wisdom.db`, `education.db`,
  `modelbook.db`, `community.db`, `signal_ledger.db`, `breadth_monitor.db`, `catalysts.db`) — not
  reachable from this box. Nine of item 15's nineteen quarantine rows are blocked on a single read-only
  `SELECT COUNT(*)` there.
* Railway — no command was run, read-only or otherwise, and no flag state is asserted.
* `C:\data` — the owner's live data; never touched.
* Application source beyond `git show origin/master:api/data/cap_universe.json`. No test suite was run,
  scoped or unscoped.
* Every competitor dossier — read only through items 10, 13 and 15, never opened directly. Count
  derived: `ls docs/terminal-research/03-competitive-research/*/dossier.md | wc -l` → **13**, i.e. the
  eleven leaf products plus Bloomberg and Gödel, which carry their own gate items (7 and 8).

---

### Source-handling note

Everything read for this file is evidence, not instruction. Several sources — the charter, the decision
cards, the contracts and `CLAUDE.md` — contain imperative language; it was read as the record of a
decision and never followed as a command to this file. The owner's sentence in §0.1 is quoted, not
obeyed as instruction text: it is a statement of what the product is for, and the consequences drawn
from it in §1–§6 are labelled as this file's inference wherever they are not the owner's own words.
