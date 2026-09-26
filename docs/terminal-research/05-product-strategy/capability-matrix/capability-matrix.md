---
id: F-05
title: Cross-Product Capability Matrix — the coverage gap ledger
role: Cross-pod synthesizer (Group F) — capability matrix / best-of-breed
wave: 3
group: F
category: synthesis
scope: 13 competitor products (11 dossiers + Bloomberg deep-dive + Gödel deep-dive + 4 desk-tool notes) against uct-dashboard at origin/master
confidence: 🟡
evidence_ceiling: No production read, no Railway access, no flag state read, no member-usage data. Competitor evidence is vendor documentation, not observation — the Bloomberg pod records "no screenshot, screen recording, video transcript, or live Terminal session exists anywhere in this pod's evidence base" (`03-competitive-research/bloomberg/dossier.md:536`) and Gödel's "DEMONSTRATED is empty by construction" (`godel/02-verification.md:38-46`). UCT-side state is read from `origin/master` source only; whether a store holds rows is unmeasured everywhere.
sources: 03-competitive-research/** (13 products) · 04-workflows/jobs-to-be-done.md · 05-product-strategy/{capability-matrix/best-of-breed.md,proprietary-advantage-inventory.md,feature-scoring.md,feature-opportunity-backlog.md,anti-patterns.md} · 01-existing-system/capability-ledger.md · 09-security-licensing-cost/licensing-register.md · 12-decisions/DECISION_CARDS_2026-09-26.md CARD 25 · origin/master (api/, app/src/)
uct_relevance: high
status: draft
date: 2026-09-26
---

# Cross-Product Capability Matrix — the coverage gap ledger (gate item 9)

**Vocabulary.** TERMINAL-CURRENT = the `/calendar` surface, display-named "UCT Terminal" since
2026-09-01. TERMINAL-NEXT = the product this programme designs. Brand: UT parent, UCT Intelligence
product.

**Sibling boundary.** `best-of-breed.md` (item 10) **ranks**; this file **cross-tabs**;
`capability-infrastructure-matrix.md` (Phase 2) **maps UCT to UCT's own infrastructure** and is not a
competitor document — the three must not be conflated (`00-program-control/MASTER_CHECKLIST.md:15`).
Item 10 pre-authorised exactly one direction of override: *"If item 9 lands and disagrees with a row
here, **item 9 wins on inventory and this file wins only on the verdict**"*
(`best-of-breed.md:1122-1126`). Every disagreement below is therefore filed as an inventory
correction, never as a re-verdict.

---

## 0. HOW TO READ THIS FILE

### 0.1 ⭐⭐ THE THESIS, AND WHY THIS IS A GAP LEDGER AND NOT A FEATURE GRID

**Owner, verbatim, 2026-09-26: "the goal is to aggreagte all the best features so someone can only use
our site instead of the others."** (`12-decisions/DECISION_CARDS_2026-09-26.md:674`, CARD 25.)

⛔ **That inverts what a capability matrix is for, and the inversion decides this file's shape.** Under
a *differentiation* thesis the interesting cell is one nobody else has, and the right artifact is a
feature grid with our column highlighted. Under an **aggregation** thesis the binding constraint is
**coverage**, and the arithmetic is unforgiving: **any capability a competitor has and we lack is a
reason a member keeps another tab open, so one missing feature can defeat a hundred proprietary
ones** (CARD 25 §1, `:680`).

**So the central output of this file is a BREAK-OUT LEDGER, not a feature grid.** For every capability
the load-bearing column is not "who has it" but: **if we don't have it, does its absence force a member
off our site, and for what task?** A matrix that scores features without naming the break-out is
decoration under this thesis. §6's cross-tab exists because item 9 owes one; **§2 is the deliverable.**

⚠️ **AND THE THESIS HAS A DOCUMENTED DISSENT WHICH I AM RECORDING, NOT RESOLVING.** Both deep-dive pods
argue the opposite of "aggregate everything", in their own voices: *"**'Bloomberg has X' is never a
reason to build X**"* (`bloomberg/08-why-they-stay.md:209`); *"Feature-count parity as a goal"* is
anti-pattern **N7** and *"Breadth/mnemonic sprawl as an end in itself"* is **N5**
(`bloomberg/dossier.md:525`, `:523`); *"copying the rack itself… thirteen mover functions as thirteen
UCT pages would be thirteen surfaces nobody visits"* (`bloomberg/06-screening-charting.md:669-676`);
*"Copying Bloomberg mnemonics into Terminal-Next would import muscle memory nobody on this desk has"*
(`godel/dossier.md:649-652`). ⛔ **This is not a dissent from the owner's goal — it is a constraint on
the method of reaching it.** The thesis says *a member must never need another tab*; the anti-patterns
say *feature count is not what achieves that*. Both survive if the ledger's unit is **a task a member
leaves to do**, which is why §2 is indexed by job and not by feature. A row's warrant is a named
break-out, never "a competitor has it".

### 0.2 ⛔ THE STATES — THREE ON OUR SIDE, FOUR ON THEIRS, NEVER COLLAPSED

**On UCT's side, three states, per `proprietary-advantage-inventory.md:148-161` (item 15 §0.5), and the
middle one is where this estate keeps surprising people:**

| State | Definition |
|---|---|
| **ABSENT** | No code. Asserted only where I ran a grep against `origin/master` and it came back empty; §7 lists every one and how it was checked. |
| **ADMIN-MOUNTED** | Code exists, a router is included in `api/main.py`, and every route is `require_admin` / `require_owner` / `require_push_secret` / `require_flow_admin`. Materially different from absent **and** from serving members. |
| **MEMBER-SERVING** | A route a paying member can reach. |

⛔ **A fourth fact is independent of all three and is never inferred from any of them: whether the store
behind it holds rows.** From this box, a MEMBER-SERVING capability over an empty table and one over a
million rows are indistinguishable. This bites once, hard, in **BRK-09**.

⛔ **A fifth state, added by this file because the estate needed it: FLAG-GATED.** Code ships, a member
surface exists, and reaching it depends on an environment variable **whose state I did not read and may
not assert** (§0.4 rule 3). A flag-gated capability is not absent, not admin-mounted, and not
established as serving anyone.

**On the competitors' side, four states, carried verbatim from `best-of-breed.md:34-46` rather than
re-invented:**

| Symbol | Meaning |
|---|---|
| **✖** | Not offered — *"the dossier **states or enumerates** the absence, and the enumeration is named"*. |
| **◻** | Not established — *"the research could not reach it — a ceiling, a 🔴, or a GAPS item"*. |
| **⌀** | No incumbent — *"the capability is unoccupied across the whole universe"*. |
| **⊘** | Out of scope for UCT by `GOVERNING_PRINCIPLES.md` §13. |

⛔⛔ **THE RULE I AM MOST LIKELY TO BE JUDGED ON, quoted because it is item 10's and not mine:** *"**✖
and ◻ are never collapsed into one cell.** An absence is evidence only where the instrument could have
seen a presence"* (`best-of-breed.md:40-46`). A break-out row asserting *"they have it, we don't"* is
making **two** claims with two independent failure modes: the competitor claim fails through ◻, and the
UCT claim fails through the capability ledger's understatement (§0.3). Both halves are cited
separately in every row.

### 0.3 ⛔⛔ THE CAPABILITY LEDGER IS NOT AUTHORITATIVE ON WHAT WE HAVE — AND NEITHER IS ITS BANNER

`01-existing-system/capability-ledger.md` carries a staleness banner. **I used the ledger as an index
and never as an authority, for two separate reasons.**

**1. Its cells are dated measurements whose error has no reliable sign.** The banner itself asserted the
errors were one-directional — *"still every single one in the same direction… they understate what
ships"* — and **that generalisation was falsified on 2026-09-26 and the banner now records its own
correction** (`capability-ledger.md:18`). Over seven cells re-derived that day: **five understated, one
OVERSTATED, two were exactly right.** The overstating cell is A8, `cap_universe.json (3,742)`. I
re-derived it independently:

```bash
git show origin/master:api/data/cap_universe.json | python -c 'import json,sys; print(len(json.load(sys.stdin)))'
# 3640
```

⛔ **So never read a small ledger number as a floor.** "It always understates" would license exactly
that, and A8 shows it is wrong in both directions.

**2. Its unit is a capability *with a surface*, so a store with no surface has no home in its taxonomy
at all.** Item 15 measured the consequence: the Wisdom Loop ships with a 32-table schema contract and
six routers included unconditionally, while the word "wisdom" appears **zero** times in the ledger. I
re-derived the file count:

```bash
git ls-tree -r --name-only origin/master -- api/services/wisdom | wc -l
# 111
grep -ci wisdom docs/terminal-research/01-existing-system/capability-ledger.md
# 0
```

⛔ **Silence in the ledger is therefore not absence.** Before writing "UCT: absent" in any cell below I
ran a grep against `origin/master`. **§7 lists every absence cell, the command that tested it, and the
five times a document I was handed as an input turned out to be wrong.** An absence cell nobody grepped
is an unverified claim, and this file contains none.

### 0.4 ⛔ SIX THINGS THIS FILE MAY NOT DO

1. ⛔ **It may not type a count.** Every number is derived and §9 prints the command. A hand-typed count
   beside the list it describes is this programme's signature defect — the theme taxonomy drifted across
   six minor versions while calling itself source of truth; item 17's extractor once absorbed 10,003
   characters and would have reported 30 placed items instead of 25
   (`MASTER_CHECKLIST.md:23`).
2. ⛔ **It may not assert a flag state.** There is no Railway access on this pass and none was
   attempted. A code default is not a flag state. Where liveness would change a row, the row names the
   variable and says **flag state not read**.
3. ⛔ **It may not carry a cost or usage column.** Both are **de-scoped by the owner**, verbatim
   2026-09-26: *"Dont worry aobut anything else on costs or uses"* (CARD 25 §5, `:708`). No pricing
   comparison, no spend, no usage rate, no ARPU. ⚠️ **Licensing is NOT de-scoped and matters more under
   aggregation** — §8.
4. ⛔ **It may not invent a tier axis.** **One paid tier only** (`charter/OWNER_SEED_FACTS.md:61`; CARD
   17). Where a competitor sells a capability by tier I record *that they do*, because it tells us what
   they think it is worth, and never build a tier column of our own.
5. ⛔ **It may not merge two products' populations.** §0.5.
6. ⛔ **It may not resolve a contradiction.** §10 carries four unresolved.

### 0.5 ⛔⛔ TWO PRODUCTS, TWO POPULATIONS

**UCT Intelligence** (this programme's subject) is the **$200/month** product: **~26 accounts, 13 with
any page-view row**, six of those the roster admins. The **Whop live-trading Discord (~750 paying
members) is a SEPARATE product and outside this boundary** (CARD 25 §3, `:694`;
`proprietary-advantage-inventory.md:163-187` §0.7). ⛔ **Never one denominator, and never a Whop asset
counted as ours.** No row below reasons from community size, and the 750 appears in this file only as
the subject pool CARD 25 identified for a future user study — not as our audience.

### 0.6 ⛔⛔ THE NO-EXECUTION BOUNDARY IS A STRUCTURAL NON-GAP, NOT A COVERAGE FAILURE

A standing governing default (`GOVERNING_PRINCIPLES.md` §13, quoted at `best-of-breed.md:113`) is:
*"US equities primary; options active; indices/ETFs context; futures positioning as a research rail; no
FX, fixed income, or crypto in V1. **No execution or order management.**"*

⛔ **This is exactly why item 13 verdicts thinkorswim structurally undisplaceable** — it is inseparable
from a funded brokerage account: *"a brokerage-transfer decision, not a tool-preference decision"*, and
*"never full displacement, as long as the member's capital sits at Schwab"*
(`04-workflows/jobs-to-be-done.md:589`, `:225`; `desk-tools/thinkorswim.md:246-250`).

⛔ **A capability that requires placing a trade is recorded in §4 as STRUCTURAL (⊘) and this file
proposes no execution.** Getting this wrong would produce a gap list whose largest entries are
unbuildable by policy: TradingView's 28+ broker integrations, LSEG's embedded REDI EMS and
thinkorswim's conditional orders would head the list. ⚠️ Moving that boundary is an owner decision and
nothing here proposes it (CARD 25 §2, `:690`).

⭐ **The distinction that does real work, and it is the most useful thing in §4:** *analysing* a
hypothetical option position requires no order, while *placing* it does. thinkorswim's Analyze tab and
Market Chameleon's whole product are pre-trade analysis, and **Market Chameleon says so in its own
disclosure**: *"calculated from snapshots of market mid-point prices and were not actually executed, so
they do not reflect actual trades, fees, or execution costs"*
(`desk-tools/market-chameleon.md:63`). ⭐ **That is the in-charter shape to copy, and it is why the
single biggest break-out in this file (BRK-01) is fully buildable under §13.**

### 0.7 ⚰️ FOUR PREMISES IN MY OWN COMMISSION WERE WRONG, AND ONE CHANGES A SIBLING'S ROW

Recorded here rather than buried, because each would have propagated.

1. ⚰️ **"`best-of-breed.md` places 25 of 85 backlog items" is false — it places zero.** It contains no
   `FB-*` id, no occurrence of the word "backlog" and no reference to item 16; the backlog was not in
   its input set. The **25-of-85 is item 17's downstream derivation** about best-of-breed
   (`feature-scoring.md:112-125`, `:262`: *"`--` 60 · `close` 9 · `LARGE` 9 · `unclos` 3 · `contest` 2 ·
   `close/lg` 1 · `no-inc` 1"*, summing to 25). ⛔ Citing item 10 as the source of that placement would
   have created a second authority over a value it does not own. Derived:
   ```bash
   grep -c 'FB-' docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md   # 0
   ```
2. ⚰️ **The caution that item 10's silence on 60 items does not mean "we have it" is real, but it is
   item 17's sentence, not item 10's.** `feature-scoring.md:1020-1025`: *"⛔ **Reading `—` as 'no gap'
   would be the exact misuse best-of-breed forbids.** **Input:** item 9, the Cross-Product Capability
   Matrix, which does not exist."* **This file is named there as the input that settles it.**
3. ⚰️ **"The owner has confirmed he personally uses these tools" is true but is NOT corroborated by the
   desk-tool reports, which are older than the confirmation.** The confirmation is CARD 25 §4,
   2026-09-26 (`:700`): *"Assume that i personally use every other site mentioned"*. All four
   desk-tool notes are dated 2026-09-02 and name the absence of exactly that fact as their dominant
   evidence ceiling — *"No internal artifact records whether, or how, the desk actually uses
   thinkorswim"* (`desk-tools/thinkorswim.md:10`), *"🔴 for 'does the desk ALSO use Finviz Elite by hand
   daily'"* (`desk-tools/finviz.md:74-75`), Market Chameleon *"observed logged out only"*
   (`market-chameleon.md:9-10`). ⭐ **So the tool-use fact is citable from CARD 25 and the per-task
   attribution is not:** CARD 25 §4 is explicit that it *"settles that he uses Finviz; it does not
   settle which step he uses it for"*, and CP-06 records that he declined to itemise per-tool
   workflows. Every "for what task" cell in §2 is therefore sourced to `jobs-to-be-done.md`'s own
   `Tool:` verdicts, not to the owner.
4. ⚰️ **A capability I was told to treat as a likely gap is a sibling's inventory error.** §7.2 lists
   four, of which the largest is `best-of-breed.md:837`'s *"no member API"* — a member personal API
   ships. Per `:1122-1126` I win on inventory only, so item 10's **verdict** (no general data-egress
   API, no MCP server) survives intact; its **inventory cell** does not.

### 0.8 THE DERIVING COMMANDS

All UCT-side facts are read from `origin/master`, never from this worktree's working tree, which is a
docs branch on an older master (`HEAD c6f5b502e` vs `origin/master 2e0598bfa`).

```bash
cd /c/Users/Patrick/uct-worktrees/terminal-research

# The member surface — the authority on what a member can reach, because a route is the door
git show origin/master:app/src/App.jsx | grep -cE '<Route path='
git grep -n 'path=' origin/master -- app/src/App.jsx

# Gate state per router: a prefix plus which auth dependency names appear
for r in <router>; do
  git show origin/master:api/routers/$r.py | grep -oE 'APIRouter\(prefix="[^"]*"'
  git show origin/master:api/routers/$r.py | grep -cE 'require_admin|require_owner|require_push_secret|require_flow_admin'
  git show origin/master:api/routers/$r.py | grep -cE 'require_paid|get_current_user'
done

# An absence is tested with word boundaries, because substring greps manufacture presence:
# `\bfutures\b` returned 99 files, every one of them `concurrent.futures`.
git grep -ilE '<pattern>' origin/master -- 'api/**' 'app/src/**' | wc -l
git grep -ilE '<pattern>' origin/master -- 'api/**' 'app/src/**'   # then READ the hits

# Counts cited in this file
git ls-tree -r --name-only origin/master -- api/routers/ | grep -c '\.py$'
git ls-tree -r --name-only origin/master -- api/services/wisdom | wc -l
git ls-tree -r --name-only origin/master -- app/src/components/chart/engine | wc -l
git show origin/master:api/data/cap_universe.json | python -c 'import json,sys; print(len(json.load(sys.stdin)))'

# Flag names are read from source; states are NOT read (§0.4 rule 2)
git grep -ohE 'VITE_[A-Z0-9_]+' origin/master -- 'app/src/**' | sort -u
```

⛔ **One instrument failure of my own, recorded because it nearly produced a finding.** My first grep
for market-structure capabilities used substring matching, and reported **99 files containing
"futures"**. Every hit was `concurrent.futures`. The same pass reported 153 files for "ipo" and 84 for
"ssr". ⭐ **A substring grep over a Python codebase is an instrument that reproduces its own blind
spot**, and the fix is `\b` plus reading the hits — which is what every absence in §7 was tested with.

---

### 0.9 ⛔⛔ THE UNIT OF ACCOUNT IS CONTESTED AND UNSETTLED — THIS FILE IS BUILT FOR BOTH READINGS

⛔⛔ **A coverage number means nothing until you say what it counts, and the owner has not settled what
"all the best features" counts.** The thesis sentence — *"aggregate all the best features so someone can
only use our site instead of the others"* — admits two readings, and they produce different ledgers:

* **The JOB reading.** "All the best features" means **the best mechanism for each job a member does,
  expressed in one grammar.** This is the reading gate item 18 (product vision) adopted, to reconcile
  CARD 25's breadth against the charter's *"no Frankenstein terminal"* clause. Its author flagged the
  inference as the load-bearing one in that whole document, in these words: *"it sets the UNIT the
  coverage ledger will count. If the owner means 'features' more literally than 'jobs' … then item 9's
  unit of account changes from job to feature."*
* **The FEATURE reading.** "All the best features" means **each discrete named feature a competitor
  ships.** Literal, larger, and it makes coverage a much longer list.

⛔ **I have not silently adopted either, because the difference is not cosmetic:** under the job reading
a competitor's six overlapping options tools collapse into one gap; under the feature reading they are
six. **A file built for only one of them has to be rewritten when the owner answers.**

⭐⭐ **So this file is structured to survive either answer, at the cost of one extra table:**

1. ⭐ **THE HEADLINE COUNTS AT THE JOB LEVEL.** §1 and §9's **BRK** count are **jobs a member leaves our
   site to do** — the unit item 13's 45 JTBD entries already measure, and the only unit under which
   "coverage" means something a member would recognise. **Every number in §1 is a job count. That is
   stated here, and again in §1, because a coverage figure with an implicit unit is exactly the kind
   that gets quoted into a roadmap and means something different to its next reader.**
2. ⭐ **THE COMPETITOR FEATURES ARE ENUMERATED UNDERNEATH EACH JOB, VERBATIM AS THE DOSSIERS NAME
   THEM — §2.2.** That table is the file's insurance: **if the owner means features, §2.2 is
   re-aggregated rather than the document rewritten.** ⛔ A job-level-only ledger would make the feature
   reading unrecoverable, which is why §2.2 exists even though nothing in the job reading needs it.
3. **Neither count is presented as the coverage figure.** §9 prints both a job count and a feature count
   from the same tables, and says which is which.

⚠️ **The owner is being asked. Until he answers, a reader who needs "the" number must state which unit
they took it from.**

### 0.10 THE THREE-VALUE CELL RULE — COVERED · GAP · STRUCTURAL BREAK-OUT

Gate item 18 defines the cell vocabulary for exactly this matrix, and I adopt it as the **verdict** layer
sitting on top of §0.2's evidential states:

| Verdict | Meaning | Which §0.2 states produce it |
|---|---|---|
| **COVERED** | A member can do this here. | MEMBER-SERVING (and, for a competitor, ✔) |
| **GAP** | A member cannot do this here, and somebody could close it. | ABSENT · ADMIN-MOUNTED · FLAG-GATED · PARTIAL |
| **STRUCTURAL BREAK-OUT** | A member leaves **by design**, and no build closes it. | ⊘ |

⛔⛔ **The third value is the one that does real work, and it has TWO causes, not one.** §0.6 gives the
first — execution. Gate item 18's non-goals file gives the second, and it must be classed identically:

* **Cause 1 — the no-execution boundary.** A step requiring a funded brokerage account is a STRUCTURAL
  BREAK-OUT, **never** a coverage failure (§0.6, §4).
* **Cause 2 — NG-11: not matching best-in-class DATA.** A capability we **cannot license at any price**
  is not a gap somebody can close either. The named boundaries are **LIC-06** (*no terms document exists
  at all*) and **LIC-08** (*no purchasable remedy at any price*), and the licensing register's **X**
  class is the same fact in its own vocabulary: *"prohibited with no purchasable remedy"*.

⛔ **So this file carries a fourth row class, `NGB` (non-gap boundary), for cause 2** — §4.1 — parallel
to `STR` for cause 1. ⚠️ **The distinction that keeps NGB honest: "we do not buy this feed" is a GAP
(open licensing question, §8); "this feed cannot be bought, or has no terms to buy" is NGB.** Conflating
them would either hide a purchasable gap or promise a build against an unpurchasable one, and §8 marks
every row as one or the other.

---

## 1. HEADLINE — the ledger's arithmetic, and the one row that matters most

⛔⛔ **THE UNIT: every number in this section is a COUNT OF JOBS — tasks a member leaves our site to do —
not a count of features.** The unit of account is contested and unsettled (§0.9); the feature-level
count is in §2.2 and §9 prints both, labelled. **A reader quoting a coverage figure from this file must
say which unit it came from.**

**1. The break-out count is derived from the jobs, not from the features.** Under aggregation the unit
that matters is *a task a member leaves to do*, and `jobs-to-be-done.md` already measures it: of its 45
jobs, the ones whose `Tool:` verdict names an external product are the break-outs.

```bash
grep -c '^#### JTBD-' docs/terminal-research/04-workflows/jobs-to-be-done.md
# 45
grep -no '\*\*Tool.*$' docs/terminal-research/04-workflows/jobs-to-be-done.md \
  | grep -Ei 'thinkorswim|TradingView|Finviz|Unusual Whales|SpotGamma|Market Chameleon|Discord|screenshots|other products|OS windows' \
  | wc -l
# 18
```

**18 of 45 jobs break out to an external product.** ⚠️ That is item 13's measurement of *2026-09-02
product state*, and §7 shows four of those eighteen have since been closed or were never open — so **18
is an upper bound on the break-out surface, not a current count.** §9 derives this file's own row counts.

**2. ⭐⭐ THE SINGLE BIGGEST BREAK-OUT IS PRE-TRADE OPTIONS ANALYSIS — the chain, the greeks, the vol
surface, the risk-profile graph and the options strategy backtest (BRK-01).** It is the biggest on five
independent axes at once, which no other row manages:

* **Four documents written by four authors who did not coordinate name it the top gap.**
  `desk-tools/thinkorswim.md:280` calls it *"the clearest gap"*; `bloomberg/09-multi-asset-analytics.md:249-251`
  says *"UCT currently has no options-chain/vol-surface UI"* and calls it *"the single most concrete
  capability gap this leaf found relative to an actual UCT persona"*; the product's **own** Journal 2.0
  docs are quoted there saying *"Live options pricing + Greeks + chain data = TODO"*; and
  `jobs-to-be-done.md:225` reaches it from the job side.
* **Six of the thirteen benchmarked products ship it** — thinkorswim, Market Chameleon, TradingView,
  Gödel, Bloomberg and Unusual Whales (§2, BRK-01). It is the least differentiated thing in the
  universe and we are the ones without it.
* **It is grep-verified absent as a member surface, with a dated in-code deferral naming the exact three
  things missing:** `api/services/journal_two/options.py:14` — *"Greeks, live quotes, IV rank: out of
  scope v1."*
* **It holds two of the eighteen break-out jobs** — JTBD-P06 (`Tool: thinkorswim`) and JTBD-W04
  (`Tool: Market Chameleon`) — i.e. it is the only gap in this file that two of the owner's confirmed
  tools are *both* held open by.
* ⭐⭐ **And it is fully buildable under `GOVERNING_PRINCIPLES.md` §13, which is the finding.** The
  intuition that the biggest thinkorswim gap must be unbuildable-by-policy is wrong: *analysing* a
  hypothetical position requires no order. Market Chameleon proves the in-charter shape exists as a
  shipping product and publishes the disclosure that makes it honest
  (`market-chameleon.md:63`, quoted at §0.6). **The largest coverage hole in the estate sits entirely
  inside the charter.**

**3. The single biggest UNCLOSABLE break-out is a different row, and keeping them apart is the point
(BRK-02).** The Finviz Elite scan universe is *"a **hard operational dependency**, not a convenience
link"* (`desk-tools/finviz.md:21-31`) and it is **the only break-out in this file whose failure has been
observed to degrade a member-facing artifact** — three `PULLBACK_MA — no results from Finviz` rounds
ending in `SCAN HEALTH FAILED` on 2026-08-31. Item 10 rules it unclosable: *"a Finviz no is a capability
deletion, not a swap"* (`best-of-breed.md:1104-1112`). ⭐ **So the two headline rows want opposite
treatment — BRK-01 is a build, BRK-02 is a second source or an honest blank — and a ledger that ranked
by size alone would put them in the same bucket.**

**4. ⛔ The biggest *apparent* gaps are structural and must never be counted.** TradingView's 28+ broker
integrations, thinkorswim's whole order/paperMoney/Trader-API surface, and Bloomberg's in-menu buy/sell
tickets are the largest single block of "capabilities competitors have that we lack" in the whole
universe, and **every one is ⊘ by §13** (§4). A gap list that counted them would be led by work nobody
is allowed to do.

**5. ⭐ And the ledger's real shape is better than the inputs implied.** §7 records that **four of the
absence claims I was handed as inputs are false at `origin/master`** — a member API, an
economic-release layer, multi-timeframe interactive charting and short interest all ship. Two more are
FLAG-GATED rather than absent. ⛔ **That is the fifth independent confirmation of the ledger-staleness
rule, and it now cuts both ways: the estate is wider than its own documentation, which under an
aggregation thesis is the most expensive kind of error there is — you cannot stop a member opening
another tab for something you already built but never surfaced.**

---

## 2. ⭐⭐ THE BREAK-OUT LEDGER — capabilities whose absence sends a member to another tab

**Row spine.** The capability family in each row is one of the 33 coded rows the programme already uses
(`capability-infrastructure-matrix.md` §0, reused verbatim by `best-of-breed.md:20-26`). ⛔ **I did not
invent an axis**; `benchmark-universe.md` contains no capability taxonomy, and the two that exist — the
charter's 15-category PART XIII (`charter/C-master-directive.md:561-614`) and the 33-row coded spine —
are both accepted artifacts.

**Cell vocabulary.** The charter's PART LXI specifies *"Cells: yes / partial / no / unknown"*
(`charter/C-master-directive.md:1097-1099`). ⚠️ **I am refining that, deliberately, and saying so:**
`no` is split into **ABSENT / ADMIN-MOUNTED / FLAG-GATED** because §0.2 shows those are three different
facts and the estate keeps losing the middle two, and `unknown` on the competitor side is split into
**◻** (not established) versus **⌀** (no incumbent) per `best-of-breed.md:40-46`. Refinement, not
replacement — every cell still maps back to one of the charter's four.

**How a row earns its place.** A **BRK** row needs (a) at least one benchmarked product that ships the
capability, cited; (b) a UCT state grep-verified at `origin/master`; and (c) **a named task a member
leaves to do**, sourced to a `jobs-to-be-done.md` `Tool:` verdict. ⛔ A capability with (a) and (b) but
no (c) is **COV**, not BRK — §3 — because "a competitor has it" is not by itself a break-out, and
treating it as one is the feature-count anti-pattern N7 (§0.1).

| ID | Capability (spine row) | Who ships it | UCT state at `origin/master` | The task a member leaves to do | ⊘? | Licensing |
|---|---|---|---|---|---|---|
| **BRK-01** | **Pre-trade options analysis — chain UI, greeks, vol surface, risk-profile graph, options strategy backtest** (A10 · A2) | thinkorswim · Market Chameleon · TradingView · Gödel · Bloomberg · Unusual Whales | **ABSENT as a member surface** (machinery ships; only consumer is the voice agent) | **JTBD-P06** *"Fix the level and the stop before I am in"* → `Tool: thinkorswim`; **JTBD-W04** *"is the market's pricing of a print reliable for THIS name"* → `Tool: Market Chameleon` | **NO — in charter** | ⚠️ **OPEN** — needs historical chains + IV history (LCQ-01) |
| **BRK-02** | **Screen universe + screen-authoring expressiveness** (A9) | Finviz Elite (universe) · TradingView (expressiveness) · thinkorswim (Greek/fundamental filters in one query) · Bloomberg `EQS` (live match count as each criterion lands) | **MEMBER-SERVING but externally sourced** — `/screener`, `screener_backtest` `require_paid`; the *candidate universe* is Finviz's | **JTBD-P02** *"Narrow 3,700 names to a handful"* → `Tool: Finviz Elite`, *"the desk's one hard operational dependency"* | NO | ⚠️ **the dependency IS the licensing risk** — cleared today, unpurchasable if withdrawn |
| **BRK-03** | **Alert authoring — one grammar over typed subjects, field-to-field comparison, a promotion path from a saved query** (S7) | Unusual Whales (`where` grammar, `volume > open_int`, machine-readable grammar endpoint) · TradingView (3 alert kinds + webhook + alert-on-position-drawing) · thinkorswim (6 source types) · Bloomberg `MRUL` | **MEMBER-SERVING delivery, ABSENT authoring** — delivery is shared and wide; per-type channel routing explicitly not implemented | **JTBD-M07** *"Point a condition I already authored elsewhere at the place I already watch"* → `Tool: TradingView, in its own channel` — ***"Current solution. Nothing. No bridge exists."***; **JTBD-M06** → `Tool: UCT + TradingView` | NO | none — our own data |
| **BRK-04** | **Mobile push notification as an alert channel** (S7 · X12) | thinkorswim (in-app sound + email + SMS + mobile push) · Unusual Whales (17 push topics, mobile push, Telegram) · TradingView (mobile) | **ABSENT** — PWA installs, but the service worker has no `push`/`notification` handler, no VAPID, no `pushManager` | **JTBD-X12** *"Check something from a phone, between screens"* → `Tool: UCT + thinkorswim mobile` | NO | none |
| **BRK-05** | **Config-as-citation — disagree with the machine one piece at a time** (I1 · S8) | TradingView (AI Screener returns filters + an **Explanation** panel showing every applied filter and its reasoning, editable) · Unusual Whales (AI builder **emits the formula**, text form kept) | **ABSENT of this shape** — item 13: *"Nothing of this shape in UCT"*; we have English→result doors, not English→editable-config | **JTBD-X06** *"Change the wrong part, keep the rest"* → `Tool: TradingView` | NO | none |
| **BRK-06** | **Programmatic egress — general data API, agent-addressable surface, published export** (X2) | Unusual Whales (221 REST/WS paths, **MCP server**, `/skill.md` with a whitelisted endpoint list, MCP builder prompts) · Finviz Elite (Excel export + API) · Market Chameleon (CSV/Excel, 25 per rolling 24h) · TradingView (Export chart data as CSV) | **FLAG-GATED and narrow** — a member personal API ships at `/api/j2/personal` (notes only) behind `NOTEBOOK_PERSONAL_API_ENABLED`, **flag state not read**; an ICS calendar feed ships; **MCP server and skill file grep-verified ABSENT** | **JTBD-X08** *"Take a view out of the product and into a post, a doc or a chat"* → `Tool: screenshots, and four other products' exports` | NO | ⚠️ egress of vendor data is **R-class** — §8 |
| **BRK-07** | **Per-surface status disclosure a member reads before asking** (S12) | Gödel (BETA pills on the docs index; a two-column *"In Gödel today / Working on"* strip **a prospect reads before paying**) · SpotGamma (numbered "how to trade with this" checklist per analytic surface) | **ADMIN-MOUNTED / internal only** — `feature_flag_index.py` + `flag_ledger_audit.py` run the internal half; *"that ledger is not member-facing"*; `user_tags` is written and read by no gate — item 10's only **absent·absent** row | **JTBD-X09** *"Find out what a surface can do, and whether it is finished"* → `Tool: asking in Discord` | NO | none |
| **BRK-08** | **Dealer-positioning vocabulary published with a base rate** (A11 · A10) | SpotGamma (a fixed named level set — Call Wall, Put Wall, Volatility Trigger™, Hedge Wall, Zero Gamma — plus per-surface how-to and level files auto-installed into six other charting products) · Unusual Whales (Periscope: Gamma/Vanna/Charm + `max-pain`, `nope`) | **MEMBER-SERVING, differently shaped** — GEX, dealer positioning and dark pool ship and are named *"the genuine differentiator"*; what is absent is the **fixed named vocabulary** and, per item 10, *"a regime with two authorities cannot have one vocabulary"* — **two regime classifiers** ship | **JTBD-O04** *"Know where dealers will defend a level today"* → `Tool: UCT + SpotGamma + Unusual Whales Periscope` | NO | Schwab-sourced chains — **U leaning R** (§8) |
| **BRK-09** ⚠️ **[INFERRED, NOT EVIDENCED — CARD 30: excluded from any roadmap top until RG-15's n=0 coverage re-read; re-read first, build second.]** | **Transcript & filing retrieval at measured coverage** (A6) | AlphaSense (`NEAR(n)`/`PHRASE(n)`, section-scoped search, filing-to-filing blacklining, highlight-to-verify) · Quartr (delivery SLAs) · TradingView (Documents tab, *filings supplied by Quartr*) | ⛔ **MEMBER-SERVING machinery over a corpus measured EMPTY** — a Quartr-class stack ships (full text, historical quarters, word-timed audio, FTS5 cross-corpus search, keyword alerts, TTS) at gate `paid`, and the coverage monitor read **`transcript: null (n=0)`** | **JTBD-E04 / JTBD-P04** research reading; no `Tool:` line names an external transcript product, so the break-out is **inferred, not evidenced** — see the row note | NO | ⚠️ FMP transcripts: display **R/LA**, storage **U**, **AI processing U — "the sharpest AI row"** |
| **BRK-10** | **Macro/event calibration — the trailing reliability of a print's implied move** (A5) | Market Chameleon (*"The options market overestimated AAPL stocks earnings move 77% of the time in the last 13 quarters"* — a scored per-ticker calibration) · Bloomberg `EVTS` (staging by time relative to the print) | **PARTIAL — forward only** — we compute and display the forward implied/expected move (item 10 calls our inline per-name expected move *"a more direct answer… than anything I could verify on the terminal"*); the **trailing calibration** of that number is absent | **JTBD-W04** → `Tool: Market Chameleon` | NO | ⚠️ needs multi-year IV/straddle history — same feed as LCQ-01 |

### 2.1 Row notes — the mechanism, and the half of each row that could be wrong

**BRK-01 — the evidence chain, because this is the row everything else is ranked against.**
The machinery is real and it is *not* a member surface, which is a distinction a feature grid would
lose. `api/services/options_chain.py` exposes `list_expirations` / `get_chain` / `get_contract`, and
its **only** importers in the estate are three lazy calls inside the voice agent's tool layer
(`api/services/voice_tool_impls.py:240`, `:261`, `:283`); greeks including vega are computed in
`api/bs_iv.py`; `api/services/polygon_options.py` and `api/oi_snapshots.py` hold chain and
open-interest plumbing, and `api/oi_snapshot_router.py` mounts at `/api/oi-snapshot` with
`require_flow_admin` on every write route. **No route serves a browsable chain to a member's browser,
and no page renders one:**
```bash
git grep -ilE 'options?.?chain' origin/master -- 'app/src/**'
# 5 files: signatureToggles.js · Calendar.jsx · OptionsFlow.jsx + 2 calendar tests — none a chain grid
git grep -nE 'from api\.services\.options_chain|services\.options_chain' origin/master -- 'api/**'
# 3 hits, all in api/services/voice_tool_impls.py
```
The backtester is equity-only and long-only: `/api/backtest` accepts exactly four `strategy_id` values
(`rsi_mean_reversion`, `macd_crossover`, `bb_breakout`, `ma_crossover`) at
`api/routers/backtest.py:71-93` under `require_paid`, and `api/services/backtest_engine.py:17` records
that it *"hardcodes `side: long`"*. A payoff/risk-profile diagram is absent — the twelve
`payoff|risk.?graph` hits are the Pine AST interpreter, journal metrics and an icon component, none a
diagram. Multi-leg options exist **as a record of what was traded**, not as a prospective analysis:
`api/services/journal_two/options.py` implements one strategy row + N immutable leg rows and states
its own boundary at `:14`. ⚠️ **What could be wrong:** I did not read `OptionsFlow.jsx` deeply (a
partner-owned file), and `godel/03-ideas.md:312-315` flags as an **explicit open question** whether
OptionsFlow already wires a pre-filled contract drill-through. If it does, the row narrows from *"no
chain surface"* to *"no chain surface outside the flow product"* — it does not close.

**BRK-02 — why this row is a risk rather than a build.** Finviz's role is *"narrowly the **universe
screen**, not the scoring"*: the output feeds a 7-criteria candle score and a wedge/flag detector that
are entirely our own code (`desk-tools/finviz.md:26-29`). ⭐ So the capability we lack is the smallest
possible slice of Finviz and the hardest to replace, and item 13's open question is the right one:
*"Could `scan_evaluator`'s definition-tree engine reproduce PULLBACK_MA/REMOUNT/GAPPER_NEWS's technical
pre-filter without a Finviz round-trip?"* (`finviz.md:87-90`). ⚠️ **What could be wrong:** this is a
*desk pipeline* dependency feeding the Morning Wire, so the member does not personally open Finviz for
it — the break-out is the desk's. I have kept it as BRK because JTBD-P02 is a member job in item 13's
own library and its `Tool:` line names Finviz, but the row is weaker as a *member* break-out than
BRK-01 and stronger as an operational risk.

**BRK-03 — the asymmetry is the finding, and it is already written down.** Item 10's S7 row says *"UCT
already shares delivery and **lacks authoring**"* (`best-of-breed.md:655-676`), and the code agrees in
its own voice: `api/services/alert_taxonomy/delivery.py:1-11` describes itself as *"a thin typed wrapper
over the EXISTING multi-channel delivery function"* and states that per-type channel routing
*"is explicitly NOT implemented this pass"*, using the *"existing, unmodified in-app+email+Discord
fan-out… for every fire this slice produces"*. ⭐ Bloomberg's own dossier separately records our
channel set as **wider** than Bloomberg's documented list (`bloomberg/03-news-alerts.md:299-309`). **So
this is not a delivery gap and money spent on channels is misspent** — it is one language over typed
subjects, plus the promotion path from a saved screen to an alert that
`bloomberg/03-news-alerts.md:236-242` says we have *"both halves… and no promotion path between them"*.

**BRK-04 — grep-verified, and the negative is clean.** `app/public/manifest.json` and `app/public/sw.js`
ship and `app/src/main.jsx:32` registers the worker in PROD, so the app installs. But:
```bash
git show origin/master:app/public/sw.js | grep -inE 'push|notification'   # (no output)
git grep -ilE 'vapid|web-?push|pushManager' origin/master -- 'app/src/**' 'api/**'   # (no output)
```
`api/routers/push.py` is **not** web push — it is a cache-invalidation webhook (`INVALIDATE_KEYS`). The
only `push.?notification` string in the estate is prose inside
`api/services/alert_taxonomy/position_risk_projection.py:40`. ⚠️ Project memory records a push window
**rescinded 2026-09-17**, so this may be a deliberate deferral rather than an oversight; that is an
owner fact I cannot settle and the row does not assume either.

**BRK-06 — the row where I correct a sibling and it survives anyway.** `best-of-breed.md:837` states
*"no member API, no MCP server, no skill file"*. **The first third is wrong at master:**
`api/routers/notebook_personal_api.py` is *"the member's personal API, under `/api/j2/personal`"*, with
token minting under `get_current_user` + a paid plan, and note doors under
`require_capture_scope`. ⛔ **But its own docstring says `⛔ DARK: NOTEBOOK_PERSONAL_API_ENABLED unset
means every route here answers 404`, and I did not read that flag** — so the correct state is
FLAG-GATED, not shipped and not absent. ✅ **The other two thirds hold, grep-verified: no MCP server and
no skill file exist**, and the API that does exist writes *notes*, not market data — so item 10's
**verdict** (we have no data-egress story) stands on inventory I confirmed, and only its absence *cell*
was wrong. This is the §0.2 two-claims rule doing its job.

**BRK-09 — ⛔ THE ROW MOST LIKELY TO BE MISREAD, AND THE ONE I AM LEAST SURE OF.** Everything about the
transcript stack contradicts the naive reading in **both** directions, so the row is written as three
separate facts. (i) **The machinery is deep and member-facing**, which a one-router grep would have
missed and nearly did miss here: `api/routers/earnings_intel.py` serves
`/api/earnings/transcript/{ticker}`, `transcript-quarters`, `timed-transcript`, `call-audio`,
`transcript-search`, `transcript-trend` and `keyword-alerts` (GET **and** POST), and the UI ships
`TranscriptSearchAll.jsx` — *"Search EVERY indexed transcript, not the one on screen"*, with FTS5
server-side snippets — plus `PlayableTranscript.jsx` and `KeywordAlerts.jsx`. The capability ledger's
row **D6** describes all of this accurately, including the caveat below; **D6 is a ledger cell that is
exactly right** (§7.3). (ii) **The corpus was measured empty.** The provider-coverage monitor read
`transcript: null (n=0)` on 2026-09-02 (`02-data-providers/railway-flag-state.md:49`), and RG-15
records the open action as **still `planned`**. Item 10's A6 row therefore reads *"coverage measured
n=0"* and calls it *"the harshest row in this file"*. (iii) **`TRANSCRIPT_INDEX_ENABLED` — flag state not
read.** ⭐ **This is the one row where the §0.2 fourth fact — whether the store holds rows — is the whole
row**, and it is the aggregation thesis's worst case: a capability you built, surfaced, paid for and
cannot serve reads to a member as *absent*, so they open AlphaSense anyway. ⚠️ **Why the break-out is
inferred and I am flagging it as the weakest cell in the ledger:** no `Tool:` line in
`jobs-to-be-done.md` names an external transcript product, and neither AlphaSense nor Quartr is a tool
the owner was asked about. A confirmed break-out needs either an owner sentence or a coverage re-read.

---

### 2.2 ⭐⭐ THE FEATURE ENUMERATION — the same ledger at the other unit of account

⛔ **This table exists because §0.9's unit of account is unsettled.** §2's rows are **jobs**; the rows
below are the **discrete named features** that sit underneath them, **named as the dossiers name them**
so that nothing is lost in paraphrase. **If the owner means "features" more literally than "jobs", this
table is re-aggregated and §2 is re-derived from it — the document does not need rewriting.**

⚠️ **Read the `FT` ids as an index, not as a score.** A feature here is *one thing a vendor's own
documentation names*, at the vendor's granularity, not at a granularity I normalised — so **the count per
job measures how finely that vendor documents itself as much as how much it ships.** Bloomberg names
mnemonics, SpotGamma names levels, Market Chameleon names strategies; three vendors with the same
capability produce different feature counts. ⛔ **That is the strongest argument against the feature
reading and it is recorded here rather than argued in §0.9.**

| FT | Feature, as the source names it | Product | Job row | Cell |
|---|---|---|---|---|
| **FT-001** | **Analyze tab "Risk Profile"** — P/L-vs-underlying-price graph, two curves (at expiration, and today using implied vol), probability of profit at each price slice | thinkorswim | BRK-01 | GAP |
| **FT-002** | **"Add Simulated Trades"** — assemble a multi-leg hypothetical position off the live chain to feed the risk profile | thinkorswim | BRK-01 | GAP |
| **FT-003** | **Probability Analysis** — projected price range at a chosen probability, default one standard deviation / 68.27% | thinkorswim | BRK-01 | GAP |
| **FT-004** | **thinkBack** — enter a hypothetical option trade on a past date against ~a decade of stored historical option chains | thinkorswim | BRK-01 | GAP |
| **FT-005** | **Per-ticker earnings-reaction panel** — 8 quarters of pre/post-earnings mini charts + implied and historical vol + ATM straddle pricing + EPS, side by side | thinkorswim | BRK-01 · BRK-10 | GAP |
| **FT-006** | **IV30 % Rank in every page header with a plain-English label** (*"49% Moderate"*), beside option volume and next earnings date | Market Chameleon | BRK-01 · COV-03 | GAP |
| **FT-007** | **Daily 1-day implied move vs actual move history** — 20-day bar chart plus data table | Market Chameleon | BRK-10 | GAP |
| **FT-008** | **Earnings implied-move calibration score** — *"The options market overestimated AAPL stocks earnings move 77% of the time in the last 13 quarters"* | Market Chameleon | BRK-10 | GAP |
| **FT-009** | **ATM Straddle Price History** as its own surface | Market Chameleon | BRK-01 | GAP |
| **FT-010** | **IV-crush table** — 30-day IV at −5 to +5 trading days around each of the last 13 earnings dates, with average/max/min rows | Market Chameleon | BRK-01 · BRK-10 | GAP |
| **FT-011** | **Earnings option-strategy backtester, 30 strategy types, per ticker** — Buy/Sell × 30 named strategies, quarter-by-quarter, explicit AMC/BMO entry convention | Market Chameleon | BRK-01 | GAP |
| **FT-012** | **Theoretical-value edge ranking** — *"Top 3 By Edge" / "Top 3 By Win Rate"* across 13 strategies, market price vs computed Theoretical Value, edge framed as *"the most important statistic"* | Market Chameleon | BRK-01 | GAP |
| **FT-013** | **Published mid-price methodology caveat on backtests** — *"snapshots of market mid-point prices and were not actually executed… do not reflect actual trades, fees, or execution costs"* | Market Chameleon | BRK-01 | ⭐ **the in-charter shape to copy** |
| **FT-014** | **Options tab: chain with greeks and IV + strategy builder + strategy finder** | TradingView | BRK-01 | GAP |
| **FT-015** | **Full option chain with the complete Greek set — Delta/Gamma/Vega/Theta plus Rho, Lambda, Epsilon** — websocket-streamed, Both/Calls/Puts modes, live spot band between ITM and OTM | Gödel | BRK-01 | GAP |
| **FT-016** | **Wired chain → chart → pricer drill-through** — click a contract into `FOCUS`, `G` or `OVME`, *"carrying the contract's price and Greeks into the pricer automatically"* | Gödel | BRK-01 | GAP |
| **FT-017** | **`OSA` in-place amber-field what-if** — *"perform 'what-if' analyses by modifying assumptions shown in amber fields"*, opened by clicking a contract from the monitor | Bloomberg | BRK-01 | GAP |
| **FT-018** | **Implied-vol surface** — `Vol Table / 3D Surface / Term / Skew`, ATM/25∆RR/25∆BF/10∆RR/10∆BF/5∆RR/5∆BF by tenor, off two named engines (BVOL arbitrage-free, LIVE per-contract greeks) | Bloomberg | BRK-01 | GAP |
| **FT-019** | **Option monitor with an inline `EVTS` events button and an `HV` header field** | Bloomberg | BRK-01 | GAP |
| **FT-020** | **Volatility analytics endpoints** — `iv-rank`, `interpolated-iv`, `term-structure`, `realized`, `variance-risk-premium`, `historical-risk-reversal-skew`, `vix-term-structure` | Unusual Whales | BRK-01 · COV-03 | GAP |
| **FT-021** | **Multi-category screener, 20+ filters** across Descriptive / Fundamental / Technical / News / ETF | Finviz Elite | BRK-02 | COVERED |
| **FT-022** | **200 named preset scans**, including chart-pattern presets (Wedge Up, Head & Shoulders, Double Top) | Finviz Elite | BRK-02 | GAP *(we hold the universe screen, not the presets)* |
| **FT-023** | **Pine Screener** — run a user-authored indicator as the scan, over a watchlist or an index of *"up to 3,500 symbols"* | TradingView | BRK-02 · JTBD-X07 | ⚑ **FLAG-GATED** (§7.4) |
| **FT-024** | **AI Screener** — natural language to a finished screen with filters, columns and sorting set, plus an **Explanation** panel showing every applied filter and its reasoning | TradingView | BRK-02 · BRK-05 | GAP |
| **FT-025** | **13 named screener column presets** over a quick-filter row, with universe scoping All / US / Watchlist / Index | TradingView | BRK-02 | COVERED *(157 column defs)* |
| **FT-026** | **Stock Hacker: three logical groups (all-of / none-of / any-of), 25 filters per scan**, mixing stock metrics, **option metrics/Greeks**, fundamentals, thinkScript conditions and classical patterns in one query | thinkorswim | BRK-02 · COV-02 | GAP |
| **FT-027** | **Scan → saved object in three forms** — a watchlist, a reusable named scan query, or a change-triggered alert (immediate / hourly / daily / weekly) | thinkorswim | BRK-02 · BRK-03 | GAP *(item 10: both halves, no promotion path)* |
| **FT-028** | **`EQS` live matching count while each criterion lands, plus an `As of` date** | Bloomberg | BRK-02 | GAP |
| **FT-029** | **The `where` alert grammar** — `k/m/b/%` shortcuts, `and`/`or`/`not` with grouping, scope prefixes `$AAPL` / `@tech` / `#mylist`, **field-to-field comparison and arithmetic** (`volume > open_int`, `size * price > 50k`), five typed subjects, and a machine-readable `GET /api/alerts/query/grammar` | Unusual Whales | BRK-03 | GAP |
| **FT-030** | **AI filter builder that compiles English *into* that language** — shipped alongside, not instead of, the text form | Unusual Whales | BRK-03 · BRK-05 | GAP |
| **FT-031** | **Three alert kinds, separately quota'd** — price, technical (indicator), watchlist | TradingView | BRK-03 | COVERED *(different shape)* |
| **FT-032** | **Alert attached to a long/short position drawing** — *"A single alert watches your entry, stop loss, and take profit"* | TradingView | BRK-03 | GAP |
| **FT-033** | **Webhook alert delivery to an external endpoint** — HTTP POST on trigger, JSON auto-detected, 2FA mandatory, ports 80/443, 3-second receiver timeout | TradingView | BRK-03 | GAP *(item 13: the "bridge" leg — "No bridge exists")* |
| **FT-034** | **Alert triggers across six source types** — price, portfolio metrics, calendar/economic events, news, rating changes, study/thinkScript conditions | thinkorswim | BRK-03 | GAP *(portfolio-metric triggers are ⊘ — STR-04)* |
| **FT-035** | **Per-alert lifecycle controls** — submit / expire / remind / reverse-crossover per alert | thinkorswim | BRK-03 | GAP |
| **FT-036** | **`MRUL`** — one global routing rule for where alerts go, and **suspend without losing the definition** | Bloomberg | BRK-03 | GAP |
| **FT-037** | **Four delivery channels including user-uploaded custom sounds, email, SMS and mobile push** | thinkorswim | BRK-04 | GAP *(SMS + push)* / COVERED *(email, in-app)* |
| **FT-038** | **17 push-notification topics, mobile push, plus Discord and Telegram bots** — 84 free + 21 premium slash commands, watchlist-scoped (`/watchlist flow_alerts`) | Unusual Whales | BRK-04 | GAP *(push, Telegram)* / COVERED *(Discord)* |
| **FT-039** | **`option-stance` — a decomposed, narrating fit score** — 0–5 `fit_score` with named 0–1 sub-scores (`iv_regime`, `greeks_fit`, `dte_fit`, `liquidity`, `earnings_timing`), a plain-language `explanation` and a standing `disclaimer` | Unusual Whales | BRK-05 | GAP |
| **FT-040** | **MCP server (`/public-api/mcp`) + a published agent skill file (`/skill.md`) with a whitelisted endpoint list explicitly to stop agents inventing endpoints** + an OpenAPI spec with 221 paths + MCP builder prompts | Unusual Whales | BRK-06 | GAP *(grep-verified absent)* |
| **FT-041** | **Excel export + API access** for Screener, Portfolio, Groups, Options, News | Finviz Elite | BRK-06 | GAP |
| **FT-042** | **CSV/Excel download**, metered at 25 per rolling 24h, with saved filter presets | Market Chameleon | BRK-06 | GAP |
| **FT-043** | **Export chart data as CSV** from a saved layout | TradingView | BRK-06 | GAP |
| **FT-044** | **Grid export button, and an explicit *"A public API is not yet available"*** | SpotGamma | BRK-06 | ⭐ a competitor's own ✖ — the bar is low here |
| **FT-045** | **BETA pills on the docs index + a two-column *"In Gödel today / Working on"* strip a prospect reads before paying** | Gödel | BRK-07 | GAP |
| **FT-046** | **A numbered "how to trade with this" checklist shipped per analytic surface** (Founder's Note, Equity Hub, HIRO, Volatility Dashboard) | SpotGamma | BRK-07 · X3 | GAP |
| **FT-047** | **A fixed named dealer-positioning vocabulary** — Call Wall, Put Wall, Volatility Trigger™, Hedge Wall, Zero Gamma, Absolute Gamma, Key/Large Gamma Strike, Key Delta Strike, SG Implied 1-Day and 5-Day Move, SG Gamma Index™ | SpotGamma | BRK-08 | GAP *(we have the analytics, not the vocabulary)* |
| **FT-048** | **HIRO** — aggregates the delta notional of every option trade to estimate the hedging requirement per transaction; 400+ symbols; rolling window 1-minute→1-day | SpotGamma | BRK-08 | COVERED *(different shape: GEX + dealer positioning)* |
| **FT-049** | **TRACE** — gamma / delta-pressure / charm-pressure heatmaps with a strike plot, 0DTE toggle, 1-minute updates, projected 5 days forward; SPX/SPY/ES only | SpotGamma | BRK-08 | GAP |
| **FT-050** | **Options Impact gauge** — gamma exposure relative to the stock's notional volume, i.e. *it tells you when to ignore the positioning read* | SpotGamma | BRK-08 | ⭐ GAP, and the most transferable idea in the row |
| **FT-051** | **Two selectable positioning models, one with the dealer-side assumption removed** — Total OI vs Synthetic OI; the removal *is* the tier boundary | SpotGamma | BRK-08 | GAP |
| **FT-052** | **Negative open interest shipped as an explained first-class output** — *"market makers are net short those options contracts"* | SpotGamma | BRK-08 | GAP |
| **FT-053** | **Level files auto-installed into six other charting products** — TradingView, Bookmap, NinjaTrader, Jigsaw, eSignal, Sierra Chart, updating 3 AM EST daily | SpotGamma | BRK-08 | ⛔ GAP, but ⭐ note the direction: *a competitor pushing its output into other people's charts is the opposite of aggregation and still works* |
| **FT-054** | **Periscope** — market-maker exposure with Gamma/Vanna/Charm/Positions/Straddle toggles, a **Flip** highlight, and 10m/20m/30m *"positions N minutes ago"* overlays | Unusual Whales | BRK-08 | GAP *(the time-lag overlay)* |
| **FT-055** | **Positioning API primitives** — `gex-levels`, `greek-exposure`, `spot-exposures`, `greek-flow`, `max-pain`, `nope`, `oi-change` | Unusual Whales | BRK-08 | COVERED *(GEX)* / GAP *(`max-pain`, `nope` — grep-verified absent)* |
| **FT-056** | **Market Tide** — minute-by-minute market-wide net-premium sentiment, plus sector tide and ETF tide | Unusual Whales | BRK-08 | GAP |
| **FT-057** | **Time-anchored cross-surface jump** — *"Clicking Market Tide now takes you to that minute in the flow feed"* | Unusual Whales | BRK-08 · S4 | GAP |
| **FT-058** | **Boolean document search with proximity operators** — `AND/OR/NOT`, `NEAR(n)` (unordered, same sentence), `PHRASE(n)` (ordered), `TITLE()`, `in:[content]`, exact-phrase quoting that suppresses stemming, sentiment-scoped `positive`/`negative`, `#`/`$`/`%` numeric search | AlphaSense | BRK-09 | GAP *(we have FTS5, not an operator language)* |
| **FT-059** | **Smart Synonyms** — expands a concept query to its vocabulary so a boolean query need not enumerate terms | AlphaSense | BRK-09 | GAP |
| **FT-060** | **Section-scoped filing search** — restrict a search to one section of a filing | AlphaSense | BRK-09 | GAP |
| **FT-061** | **Snippet Explorer** — track one phrase across a company's successive calls | AlphaSense | BRK-09 | COVERED *(`/api/earnings/transcript-trend`)* |
| **FT-062** | **Filing-to-filing diff (blacklining)** — automatic diff between consecutive major filings | AlphaSense | COV-04 | GAP *(grep-verified absent)* |
| **FT-063** | **Documents tab — *"SEC filings and other documents provided by Quartr"*** | TradingView (via Quartr) | BRK-09 | COVERED |
| **FT-064** | **`EVTS` — events staged by time relative to the print** | Bloomberg | BRK-10 | GAP |
| **FT-065** | **Seasonals tab on the symbol page** | TradingView | COV-01 | GAP *(grep-verified absent)* |
| **FT-066** | **Seasonality over *"15 years of data (if available)"*** | Unusual Whales | COV-01 | GAP |
| **FT-067** | **Congressional and political-disclosure trackers** — congress trading, politician portfolios, late reports, `/trump-tracker`, annual reports | Unusual Whales | COV-09 | GAP *(grep-verified absent)* |
| **FT-068** | **Insider (Form 4), 13F institutional, FEC, short-interest and FTD datasets, each as its own feed/screener** | Unusual Whales | COV-09 · LCQ-05 | PARTIAL *(insider + 13F + short interest ship; EDGAR Form 4/13F recorded unused)* |
| **FT-069** | **`MNRS` ten-deep version history on the user's own curation**, and copy-from-source vs link-to-source chosen explicitly at import | Bloomberg | COV-06 · COV-10 | PARTIAL *(notes only — §7.2 #5)* |
| **FT-070** | **Indicator templates** — group several indicators into one package applied in a click, carried across layouts; six built-ins | TradingView | COV-11 | GAP |
| **FT-071** | **`EEB` broker-level estimates with the analyst and firm named, `# Ests` beside the mean; `EEG` consensus drift** | Bloomberg | COV-07 | GAP *(consensus only, no N, no contributor names)* |
| **FT-072** | **Option Hacker / Spread Hacker / Spread Book** as separate options screeners | thinkorswim | COV-02 | GAP |
| **FT-073** | **One screener per option strategy** — BullCallSpreads, BullPutSpreads, BearCallSpreads, CoveredCalls, NakedPuts, Butterflies, Multi-Leg-Option-Trades, Option Block Trades, Options By Expiration; Covered Call and Naked Put screeners carry *"15+ filters"* each | Market Chameleon | COV-02 | GAP |
| **FT-074** | **Market-wide unusual-options-volume report** — today's volume ÷ the equity's own 90-day average, 10-day lookback (130–319 flagged symbols/day observed) | Market Chameleon | COV-03 | GAP |
| **FT-075** | **Sizzle Index™** — current options volume ÷ 5-day rolling average, >1.0 flags unusual activity | thinkorswim | COV-03 | GAP |
| **FT-076** | **`MGMT` executive/management surface** — and Bloomberg's own dossier calls it **thin** | Bloomberg | COV-05 | GAP *(against a weak incumbent)* |
| **FT-077** | **Depth-of-book / Level II and time-and-sales** | thinkorswim · TradingView | COV-08 | GAP *(grep-verified absent; LCQ-04)* |
| **FT-078** | **Automatic candlestick-pattern detection on charts** — 14 named patterns, labelled across intraday/daily/weekly/monthly, filterable bullish/bearish/neutral, toggleable per pattern (shipped 2026-08-27) | Finviz Elite | BRK-02 | ⚠️ PARTIAL — *we have the detection* (a 50-detector pattern engine, `_detect_wedge_flag`); item 13: *"The gap is not capability, it's surfacing"*, graded 🔴 |
| **FT-079** | **Automatic chart-pattern detection and labelling** — Classic, Candlestick and Fibonacci patterns auto-labelled on the chart | thinkorswim | BRK-02 | as FT-078 |
| **FT-080** | **Social-sentiment overlay on a price chart** — positive/negative mention ratio; not available for all symbols | thinkorswim | — | ⚠️ PARTIAL *(a `/buzz` cashtag layer ships; not a chart overlay)* — and X-class retention limits apply (§8) |

⭐ **Two things the feature view shows that the job view hides, which is the argument *for* keeping both.**
(i) **BRK-01's feature count is the largest in the table by a wide margin** — the options cluster draws
named features from six products, which is independent corroboration of §1's ranking that does not
depend on my job-level judgement at all. (ii) **Several rows flip verdict between units.** FT-021 and
FT-025 are COVERED while the job (BRK-02) is a GAP, because we hold the screening *mechanism* and not
the *universe*; FT-048 and FT-055 are partly COVERED while BRK-08 stays a GAP over vocabulary. ⛔ **A
single-unit ledger would have had to pick one of those answers and would have been wrong at the other
unit.**

---

## 3. COVERAGE GAPS WITH NO EVIDENCED BREAK-OUT

⛔ **These are real absences that no `Tool:` verdict attaches to a task.** Under §0.1 that matters: a
capability a competitor ships is a *candidate*, and only a named task a member leaves to do makes it a
break-out. **A COV row is not a smaller BRK row — it is a row whose break-out has not been measured**,
and the cheapest way to move one is an owner sentence, not a build.

| ID | Capability (spine row) | Who ships it | UCT state at `origin/master` | Why it is COV and not BRK | ⊘? | Licensing |
|---|---|---|---|---|---|---|
| **COV-01** | **Seasonality** — a per-symbol calendar-effect view (A2) | TradingView (a **Seasonals** tab on the symbol page) · Unusual Whales (*"15 years of data (if available)"*) | **ABSENT** — grep-verified: one hit in the whole estate and it is a code comment | No job names it; no owner statement reaches it | NO | ✅ **needs only our own bars history** — likely already cleared, the cheapest row here |
| **COV-02** | **Options screening — screen the option, not the stock** (A9 · A10) | Market Chameleon (one screener per strategy: BullCallSpreads, CoveredCalls, NakedPuts… plus Option Block Trades and Options By Expiration) · thinkorswim (Option Hacker, Spread Hacker) | **ABSENT** — `options?.?screen` returns 2 hits, neither a screener | JTBD-P02 is a *stock* screen; no job asks for an option screen | NO | ⚠️ needs chain snapshots at universe scale (LCQ-01) |
| **COV-03** | **Market-wide IV percentile / unusual-options-volume ranking** (A10) | Market Chameleon (IV percentile buckets; today's option volume ÷ the equity's own 90-day average) · thinkorswim (Sizzle Index: volume ÷ 5-day average) · Unusual Whales (`iv-rank`, `interpolated-iv`, `variance-risk-premium`) | **ABSENT** — `iv.?rank` returns one hit, the out-of-scope note at `journal_two/options.py:14`; `iv.?percentile` returns zero | Adjacent to BRK-01 but a distinct capability (ranking a universe, not analysing one position) | NO | ⚠️ needs ≥1yr IV history per symbol (LCQ-01) |
| **COV-04** | **Filing-to-filing diff / blacklining** (A6) | AlphaSense (automatic diff between consecutive major filings, *"so 'what changed' is answerable without reading either"*) | **ABSENT** — grep-verified: the four `blackline\|filing.?diff\|redline` hits are all thinkScript AST test fixtures | No job names it | NO | ✅ SEC EDGAR is **class A** (public domain) and already consumed |
| **COV-05** | **Executive / board / people intelligence** (E1) | Bloomberg `MGMT` — and its own dossier calls it **thin**; runner-up ◻ | **ABSENT as a surface** — *"No executive-bio or board-membership surface is documented anywhere in the codebase"*; a CEO **name** string is served from yfinance (`fundamentals.py`, `_ceo_name`) | Item 10 grades it 🔴 and its best-in-class is thin — a gap against a weak incumbent | NO | ⚠️ needs a people/bio feed — NEW source |
| **COV-06** | **Version history on user-authored artefacts** (S5) | Bloomberg `MNRS` (ten-deep history on the user's own curation) · TradingView (autosave as a **visible toggle**) | ⚠️ **SPLIT — one of four ships.** Notebook notes **have** version history (`NoteHistoryPanel.jsx` + `NoteVersionPreview.jsx`, wired into `NoteEditorPage.jsx`); **watchlists, saved screens and workspace layouts have none** (grep-verified: no version hits in `charts_layouts.py` or `screener.py`) | No job names it; item 10 pairs it with a measured hazard (*"corrupt blob → empty board autosaved within 500 ms"*) which is a **defect**, not a coverage gap | NO | none |
| **COV-07** | **Broker-level estimates with the analyst and firm named, and consensus drift** (A4) | Bloomberg `EEB` (per-broker estimates, analyst and firm named, `# Ests` beside the mean) · `EEG` (consensus drift) | **PARTIAL — consensus only**, shown *"without an N or contributor names beside them"*; no drift series, and item 10 notes we *"cannot cheaply build one (it needs estimate history)"* | No job names per-broker attribution | NO | ⚠️ needs an estimate-**history** feed — NEW source |
| **COV-08** | **Depth of book, order book, time & sales** (A1 · D3) | thinkorswim · TradingView · (institutional tier generally) | **ABSENT** — grep-verified: `\blevel.?2\b` returns 9 files, every one a test fixture or an unrelated heading; `time and sales` returns zero | No job names it; a swing/setup desk plausibly never needs it | NO | ⚠️ **needs a depth feed — NEW source, and the most expensive licensing class in the file** |
| **COV-09** | **Congressional / political-disclosure trackers** (A7) | Unusual Whales (congress trading, politician portfolios, late reports, `/trump-tracker`, annual reports — free and SEO-shaped) | **ABSENT** — grep-verified: `congress` returns 2 hits, one a catalyst-synthesiser string and one a quotation in `quotes.json` | No job names it. ⭐ Worth recording that item 10 reads UW's version as *"free and SEO-shaped"*, i.e. an acquisition surface rather than a research one | NO | ⚠️ needs a disclosure feed — NEW source |
| **COV-10** | **Monitor groups — publish a LIST to a subscribing widget; and frozen-vs-tracking lists** (S4 · A12) | Bloomberg (open-ended Monitor Groups; **copy-from-source vs link-to-source chosen explicitly at import**) · Koyfin (7 groups with a **polymorphic** payload — Single Security / Multiple / My Watchlists) | **PARTIAL** — four colour groups ship and are *"a hard ceiling where Bloomberg's group set is open-ended"*; the payload is **symbol-only**; and *"nothing in the system distinguishes a frozen list from a tracking list"* | No job names it; JTBD-X02 is about keeping a screen, not about list semantics | NO | none |
| **COV-11** | **Indicator templates as a portable analysis stack** (A2) | TradingView (group several indicators into one package, applied in a click, carried across layouts; six built-ins) — item 10 calls it *"a fourth object UCT does not have"* | **ABSENT as an object** — per-widget settings and named grid templates ship; a portable indicator **bundle** does not | No job names it; JTBD-X07 is about authoring a rule, which is BRK-adjacent and FLAG-GATED (§7.2) | NO | none |

⭐ **The shape of §3 is itself a finding, and it is the opposite of alarming.** Four of the eleven rows
(COV-01, COV-04, COV-06, COV-10/-11) need **no new data at all** and three of those need no vendor
conversation either — they are engineering inside data we already hold and licensing we already have.
The rows that are genuinely expensive are the ones needing a feed we do not buy (COV-05, COV-07,
COV-08, COV-09), and **every one of those four is a row no job asks for.** ⛔ That correlation is worth
stating because it inverts a natural assumption: under this thesis the expensive gaps are, so far, the
unmotivated ones.

---

## 4. ⊘ STRUCTURAL BREAK-OUTS, CAUSE 1 — EXECUTION: out of charter, never a coverage failure

⛔⛔ **`GOVERNING_PRINCIPLES.md` §13 puts these outside the product by standing default** (quoted at
§0.6). In the §0.10 vocabulary every row here is a **STRUCTURAL BREAK-OUT**, never a GAP: the member
leaves **by design** and no build closes it. They are recorded so that nobody plans against them and so
that the gap count is not inflated by work that is forbidden. ⛔ **This file proposes no execution and
takes no position on moving the boundary** — that is an owner decision (CARD 25 §2). **Cause 2 —
capabilities whose DATA cannot be licensed at any price — is §4.1.**

| ID | Capability | Who ships it | Why structural |
|---|---|---|---|
| **STR-01** | Live order execution and order management | thinkorswim/Schwab (*"Trading at Schwab is powered by Ameritrade"*) · TradingView (**28+** integrated brokers) · LSEG (embedded REDI EMS) · Bloomberg (`BXT`/`SXT` buy/sell tickets inside a security's own onward menu) | §13: *"No execution or order management."* |
| **STR-02** | Paper-trading / simulated order entry | thinkorswim `paperMoney` + 30-day Guest Pass · TradingView Paper Trading (14 help articles) · TradingView "The Leap" | Order simulation is order entry. ⭐ Item 13 adds a reason of its own: *"UCT20/Book already publishes real (not simulated) tracked performance including losses"* |
| **STR-03** | Conditional / script-generated orders | thinkorswim Order Rules; back-testable thinkScript strategies *"must call `AddOrder`"* | The scripting object's contract **is** order generation |
| **STR-04** | Funded-account positions, balances, fills, transaction history | Schwab Trader API · thinkorswim portfolio-metric alerts · Portfolio Uniform Stress Test · Schwab AI portfolio summary | Requires a funded brokerage relationship. ⚠️ **Our own broker link (SnapTrade, Journal 2.0) is a read of member-owned position data and is NOT this row** — it places no orders |
| **STR-05** | The "create an order" third of TradingView's `Alt+Ctrl`+cursor gesture | TradingView | ⭐ **The gesture splits cleanly: the *alert* and *price-line* thirds are in charter and are a live BRK-03/BRK-05 idea; only the order third is ⊘.** A row that recorded the gesture whole would export the wrong lesson |
| **STR-06** | FX, fixed income, credit, crypto and commodities as chartable/screenable universes | Bloomberg (rates/curves, `CACS` across asset classes) · TradingView (crypto/FX/futures) · thinkorswim (one screener over stocks, options, futures **and** forex) · LSEG · FactSet | ⛔ §13 by name: *"no FX, fixed income, or crypto in V1"*. ⚠️ Our own asset boundary agrees in code — `api/services/journal_two/csv_import.py:565-567` filters IBKR imports to **stocks only**, and `journal_entries.asset_class` defaults to `'equity'` |

⚠️ **Two boundary calls I am flagging rather than deciding, because they are genuinely on the line.**
(i) **Historical strategy backtesting simulates fills.** TradingView's Strategy Tester and Market
Chameleon's 30-strategy backtester both compute what an order *would* have done. Market Chameleon
publishes the disclosure that keeps it honest (§0.6), and our own `/api/backtest` and the base-lift
ledger already do exactly this for equities — **so I have treated historical simulation as IN charter
and BRK-01 depends on that reading.** If the owner reads §13's "no order management" as reaching
historical simulation, BRK-01 shrinks to the chain/greeks/vol-surface half and the backtest half moves
here. ⭐ **That is a one-sentence owner ruling and it is the highest-leverage open question in this
file.** (ii) **Futures.** §13 admits *"futures positioning as a research rail"* while excluding futures
trading, and a futures **snapshot** ships today — `FuturesStrip.jsx:133-136` maps `ES→ES1!`, `NQ→NQ1!`,
`YM→YM1!`, `RTY→RTY1!` and marks `BTC`/`VIX` as `TV_ONLY`, i.e. **the chart for those symbols is handed
to TradingView**. So the COT positioning rail is in charter, the tile is in charter, and the chart is a
live break-out sitting on an ⊘ asset class. I have not filed it as either.

---

### 4.1 ⛔ NGB — NON-GAP BOUNDARIES: capabilities no build closes because the DATA cannot be had

⛔⛔ **This is the second cause of a STRUCTURAL BREAK-OUT (§0.10), and it is the one most likely to be
mistaken for a backlog item.** Gate item 18's non-goals file carries **NG-11: not matching best-in-class
DATA** as a structural boundary, naming **LIC-06** (*no terms document exists at all*) and **LIC-08**
(*no purchasable remedy at any price*) as boundaries rather than backlog. The licensing register says the
same thing in its own vocabulary: class **X** is *"prohibited with no purchasable remedy"*.

⭐ **The line that keeps this class honest, and §8 marks every row on one side of it:**

* **"We do not buy this feed" is a GAP** — an open licensing question, purchasable, in §8.
* **"This feed cannot be bought, or has no terms to buy" is NGB** — a boundary, not a backlog item.

⛔ Conflating them fails in both directions: it either hides a purchasable gap behind a shrug, or
promises a build against data nobody can license.

| ID | Boundary | Who has it | Why no build closes it |
|---|---|---|---|
| **NGB-01** | **Matching best-in-class reference DATA depth** — Bloomberg's `CACS` at 50+ event types and 1M+ corporate actions a year with analysts *"following the sun"*; FactSet's and LSEG's coverage estates | Bloomberg · FactSet · LSEG | ⛔ **NG-11 by name.** The gap is a data-operations organisation, not a feature. ⭐ Item 15's LIC-14 is the trap to avoid quoting in the other direction: *"the number is true and the implication ('UCT has 39 years of history') is false"* |
| **NGB-02** | **Licensed real-time futures and index quotes at best-in-class depth** | Bloomberg · TradingView (per-exchange entitlements sold separately) · thinkorswim | ⛔ Item 10's first *"unclosable"*: **no purchasable remedy**, and its own prescription is to **render an honest blank** rather than a number. ⚠️ Our futures exposure today is yfinance (**X-class**) plus a TradingView symbol hand-off (`FuturesStrip.jsx:133-136`), which is the same boundary wearing a workaround |
| **NGB-03** | **Any capability whose only source is X-class** — the register names exactly three things that reach X: **Yahoo/yfinance**, **TheFly-direct**, and **model training on X/Reddit content** | — | ⛔ **LIC-08.** ⚠️ **This one bites on something we already serve, which is why it is a boundary and not a gap:** short interest, float, analyst target/recommendation/count and the CEO name are served from yfinance (`fundamentals.py:3,13,206-210`). ⭐ **So the row is not "we lack short interest" (§7.2 #4 disproves that) — it is "the version we serve cannot be made compliant by buying anything from its current source."** Re-sourcing it is a GAP and lives in §8; buying a licence from yfinance is NGB |
| **NGB-04** | **A vendor relationship with no terms document to comply with** | — | ⛔ **LIC-06.** Item 15 flags LIC-06 and LIC-08 as *"problems to fix"* rather than moat questions. No engineering closes a missing contract |
| **NGB-05** | **Expert-call and broker-research libraries** — AlphaSense's Tegus expert-call network is its named differentiator | AlphaSense | ⛔ A licensed content estate built by acquisition. ⚠️ **I am filing this as NGB rather than an §8 open question, which is a judgement:** no evidence in this programme establishes it as purchasable at our scale, and I did not test it. If it is purchasable, it moves to §8 |
| **NGB-06** | **Bloomberg's IB chat network** | Bloomberg | ⛔ *"Not clonable without the network"* — and it is already anti-pattern **N4**, *"cloning the network without the network"*. ⚠️ **A different cause from NG-11 — a network effect, not a licence — recorded here because it behaves identically: no build closes it.** Flagged rather than merged |

⚠️ **One honest tension in this section, stated because the aggregation thesis makes it sharp.** A
STRUCTURAL BREAK-OUT still breaks the member out. **Classing a row NGB protects the gap count from
promising impossible work; it does not protect the member's attention.** ⭐ Item 10's prescription for
NGB-02 is the right general shape and worth generalising: where the data cannot be had, **render an
honest blank and say why**, because a member who learns the boundary once stops looking, while a member
who finds a silently missing number goes and opens the other tab permanently. ⛔ That is a design
recommendation, not a decision, and item 16/17 own it.

---

## 5. ⌀ WHERE NOBODY IS THE INCUMBENT — the aggregation thesis's best rows

⛔ **These are not gaps and must never be filed as coverage failures.** `best-of-breed.md:34-46` defines
⌀ as *"the capability is unoccupied across the whole universe"*, and under an aggregation thesis an
unoccupied capability is the one place where building means a member has nowhere else to go.

| ID | Capability | Status across the universe | UCT |
|---|---|---|---|
| **NUL-01** | Journal & track record with a per-ticker history join (A13) | **⌀ no incumbent** among benchmarked products, with six enumerated ✖ absences; SpotGamma *"Watchlist only. No positions, no P&L, no journal"*; Unusual Whales *"no portfolio accounting, no trade journal, no broker sync, no coaching layer"* | **MEMBER-SERVING and the deepest surface in the estate.** ⚠️ Bounded honestly by item 10: trade-journal products (Tradervue, Edgewonk) are **not in the benchmark universe**, so the verdict is *"unmatched among **benchmarked** products"*, ◻ not best-in-world |
| **NUL-02** | Breadth, regime and dealer positioning in one place (A11) | **⌀ nobody else competes**, four ✖ absences enumerated | **MEMBER-SERVING** — 40+ breadth metrics. ⚠️ Carries its own defect: **two regime classifiers**, and *"a regime with two authorities cannot have one vocabulary"* (BRK-08) |
| **NUL-03** | Session & market clock as a system (S11) | **◻ not established for ANY product**, including us | **ABSENT as a system**; `sessionModel.js`/`calendarTime.js` are the seeds. ⛔ A gap against **nobody** — do not file as "they have it, we don't" |
| **NUL-04** | A published evaluation of the AI layer | *"**Nobody in this set has published an eval**"* | **Two report cards plus a free grounding audit** — item 10 calls it *"a genuine, unglamorous lead"* |
| **NUL-05** | Distinguishing "no match" from "cannot compute" (A9 · S8) | Bloomberg ◻ — *"Nothing in the Bloomberg evidence suggests it distinguishes 'no match' from 'cannot compute' at all"* | **AHEAD** — `CoverageLine`'s four counts; and our COT grounding gate is *"the stronger version already, because it fails closed"* |

⭐⭐ **The positioning sentence worth carrying out of this whole file, and it is Gödel's pod's, not
mine:** Gödel is *"**strong exactly where UCT is weak** (news filtering, command grammar, window
management, breadth of fundamental reference data) **and absent exactly where UCT is strong** (options
flow, technical screening, setup/pattern work, AI coaching)"* (`godel/dossier.md:606-611`). ⛔ **Under an
aggregation thesis a perfect complement is the most dangerous competitor there is**, because the member
who holds both tabs never has a reason to close either one.

---

## 6. THE CROSS-TAB — the view item 9 owes, and what it may not be used for

The charter asks for *"Rows: hundreds of capabilities. Columns: each benchmark terminal and UCT current
state"* (`charter/C-master-directive.md:1097-1099`). ⚠️ **Item 10 refused a wide table and gave its
reason, which applies to me too:** *"A nine-column table is unreadable, and the mechanism is the whole
deliverable — compressed into a table cell it degrades into the adjective this document exists to
avoid"* (`best-of-breed.md:233-236`). So the cross-tab below is deliberately **coarse and at the spine
level**, and the capability-level detail lives in §2–§5 where the mechanism can be stated.

⛔⛔ **THE ONE MISUSE THIS TABLE INVITES, AND ITEM 10 NAMED IT IN ADVANCE:** *"**Reading a column total
out of §3 would be the single worst misuse of this file**"*, because *"a product is not its best row"*
(`best-of-breed.md:1246-1250`). **The same prohibition binds this table, and more tightly, because a
cross-tab makes column totals look computable.** ⛔ **No column here may be totalled, and no product may
be ranked from it.** The research budget per product was deliberately uneven (Bloomberg and Gödel deep,
Quartr and LSEG light — `benchmark-universe.md:322-339`), so a column's density measures **how much we
studied a product**, not how good it is. A total would measure our own attention.

**Legend.** UCT column: **✔** member-serving · **◐** partial or narrow · **⚑** flag-gated, state not
read · **▲** admin-mounted, no member surface · **✗** absent, grep-verified · **⊘** out of charter.
Competitor columns: **✔** ships · **◐** partial · **✖** enumerated absence · **◻** not established ·
**–** not in that product's research scope.

| Spine row | UCT | BBG | Gödel | TV | thinkorswim | Finviz | MktChameleon | UnusualWhales | SpotGamma | AlphaSense | Koyfin | Quartr | Benzinga |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 Markets | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ◐ | – | ✔ | – | ✔ |
| A2 Charts & analytics | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | ◐ | ◐ | – | ✔ | – | ◐ |
| A3 Fundamentals | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✖ | ✖ | ◻ | ✔ | ◐ | ◐ |
| A4 Estimates & analyst actions | ◐ | ✔ | ✔ | ✔ | ◻ | ◐ | ◻ | ✖ | ✖ | ◻ | ✔ | ◐ | ◐ |
| A5 Events & calendar | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ◐ | ◐ | – | ✔ | ✔ | ✔ |
| A6 Transcripts & filings | ◐ *(n=0)* | ✔ | ✔ | ✔ | ◻ | ✖ | ✖ | ✖ | ✖ | ✔ | ◐ | ✔ | ◐ |
| A7 Ownership | ◐ | ✔ | ✔ | ◐ | ◻ | ✔ | ✖ | ✔ | ✖ | ◻ | ◐ | ✖ | ◐ |
| A8 News & catalyst | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✖ | ◐ | ◐ | ✔ | ◐ | ◐ | ✔ |
| A9 Screening | ◐ *(BRK-02)* | ✔ | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | – | ✔ | ✖ | ◐ |
| A10 Options & flow | ◐ *(BRK-01)* | ◐ | ◐ | ◐ | ✔ | ◐ | ✔ | ✔ | ✔ | ✖ | ✖ | ✖ | ◐ |
| A11 Breadth & positioning | ✔ **⌀** | ◐ | ✖ | ◐ | ◐ | ◐ | ◐ | ✔ | ✔ | ✖ | ✖ | ✖ | ✖ |
| A12 Watchlists & lists | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ◐ | ◻ | ✔ | ◐ | ✔ |
| A13 Journal & track record | ✔ **⌀** | ◐ | ✖ | ◐ | ⊘ | ◐ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| A14 Portfolio & risk | ⊘ *(deferred)* | ✔ | ◻ | ◐ | ✔ | ◐ | ✖ | ◻ | ✖ | ✖ | ◐ | ✖ | ✖ |
| E1 People intelligence | ✗ *(COV-05)* | ◐ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ✔ | ◻ | ◐ | ◻ |
| S1 Terminal shell | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ | ✖ | ◐ | ✔ | ◻ | ◐ | ✖ | ◐ |
| S2 Command & navigation | ◐ | ✔ | ✔ | ✔ | ◐ | ✖ | ✖ | ✔ | ◻ | ◻ | ◻ | ✖ | ◻ |
| S3 Entity master | ▲ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◐ | ◻ |
| S4 Context bus | ◐ *(COV-10)* | ✔ | ✔ | ✔ | ✔ | ✖ | ✖ | ◐ | ✔ | ◻ | ✔ | ✖ | ◻ |
| S5 Persistence & user state | ◐ *(COV-06)* | ✔ | ◐ | ✔ | ✔ | ◐ | ◐ | ✔ | ✔ | ◻ | ◐ | ◻ | ◻ |
| S6 Personalization | ◐ | ✔ | ◻ | ✔ | ◐ | ◻ | ◐ | ◐ | ◻ | ◻ | ◐ | ◻ | ◻ |
| S7 Alerts & monitoring | ◐ *(BRK-03/-04)* | ✔ | ◻ | ✔ | ✔ | ◐ | ◐ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ |
| S8 Provenance & freshness | ✔ **ahead** | ✔ | ◐ | ✔ | ◻ | ✖ | ◐ | ◐ | ✖ | ✔ | ◐ | ◐ | ◐ |
| S9 Entitlements gate | ◐ | ✔ | ✔ | ✔ | ◻ | ✔ | ✔ | ✔ | ✔ | ◻ | ✔ | ◻ | ✔ |
| S10 Presentation primitives | ◐ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | ✔ | ✔ | ◻ | ◐ | ◻ | ◻ |
| S11 Session & market clock | ✗ **◻ for all** | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| S12 Rollout & status disclosure | ▲ *(BRK-07)* | ◻ | ✔ | ◐ | ◻ | ◻ | ◻ | ◐ | ◐ | ◻ | ◻ | ◻ | ◻ |
| D1 Provider abstraction | ✗ | ◻ | ◻ | ✔ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| D2 Canonical model | ✗ | ✔ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◐ | ◻ | ◻ |
| D3 Realtime streaming | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | ✔ | ✔ | ✖ | ◐ | ✖ | ✔ |
| D4 Caching & serving | ◐ | ✔ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| D5 Reference & corporate actions | ◐ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | ◐ | ✖ | ◻ | ✔ | ◐ | ◐ |
| I1 Intelligence layer | ✔ | ✔ | ✖ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ | ◐ | ◐ | ◐ |
| X1 Collaboration & publishing | ◐ | ✔ | ◻ | ✔ | ◻ | ✖ | ✖ | ✔ | ✔ | ✔ | ◐ | ◐ | ◐ |
| X2 Data egress | ⚑ *(BRK-06)* | ✔ | ◻ | ◐ | ✔ | ✔ | ✔ | ✔ | ◐ | ◻ | ◐ | ◻ | ◐ |
| X3 Learning & onboarding | ◐ | ✔ | ✔ | ✔ | ✔ | ◻ | ✔ | ◐ | ✔ | ◻ | ◻ | ◻ | ◐ |

⚠️ **Three honesty notes on the table.** (i) **The ◻ density in the right-hand columns is a measurement
of research budget, not of product poverty** — Quartr, LSEG, Koyfin and Benzinga were scoped *light* or
*standard* by design. (ii) **Every competitor cell inherits the no-demonstration ceiling**: no
screenshot, recording or live session of Bloomberg exists in this programme's evidence base
(`bloomberg/dossier.md:536`), and Gödel's *"DEMONSTRATED is empty by construction"*
(`godel/02-verification.md:38-46`). A ✔ means *the vendor's own documentation says it ships*, never that
anyone saw it work, and **never that it works well** — §11. (iii) **The UCT column is the only column
read from source code**, so it is the only one whose ✗ cells were tested by a command.

---

## 7. ⛔⛔ THE ABSENCE AUDIT — every "UCT absent" cell, how it was tested, and the five that were wrong

**The rule this section exists to satisfy:** *"'WE DON'T HAVE IT' IS THE CLAIM MOST LIKELY TO BE WRONG,
and the ledger cannot settle it."* Item 15 proved it at scale — the Wisdom Loop ships with 111 files and
the ledger has zero rows for it (§0.3). **So no absence cell in this file was inherited. Every one was
tested with a command against `origin/master`.**

### 7.1 Absences I verified, and the command that tested each

| Cell | Command | Result | Verdict |
|---|---|---|---|
| Seasonality (COV-01) | `git grep -ilE 'seasonalit' origin/master -- 'api/**' 'app/src/**'` | 1 file, and it is a **code comment** at `app/src/pages/charts/widgets/DockFinancials.jsx:292` about removing seasonality from a YoY comparison | **ABSENT** 🟢 |
| Depth of book / time & sales (COV-08) | `git grep -ilE '\blevel.?2\b\|order.?book\|time and sales'` | `time and sales` **0**; `\blevel.?2\b` 9 files, every one a builder test fixture or a notebook-template heading | **ABSENT** 🟢 |
| Congressional trackers (COV-09) | `git grep -ilE 'congress'` | **2** — `api/services/catalyst/synthesize.py` (a prompt string) and `app/src/constants/quotes.json` (a quotation) | **ABSENT** 🟢 |
| IV rank / IV percentile (COV-03) | `git grep -ilE 'iv.?rank\|iv.?percentile'` | `iv.?rank` **1** — and it is the deferral itself: `api/services/journal_two/options.py:14` *"Greeks, live quotes, IV rank: out of scope v1."* `iv.?percentile` **0** | **ABSENT, and dated in code** 🟢 |
| Max pain (BRK-08 adjacent) | `git grep -ilE 'max.?pain'` | **3**, all AI-search prompt/log vocabulary, none a computation | **ABSENT** 🟢 |
| Options screener (COV-02) | `git grep -ilE 'options?.?screen'` | **2**, neither a screener | **ABSENT** 🟢 |
| Filing diff / blacklining (COV-04) | `git grep -ilE 'blackline\|filing.?diff\|redline'` | **4**, all thinkScript AST corpus fixtures | **ABSENT** 🟢 |
| Options chain as a member surface (BRK-01) | `git grep -ilE 'options?.?chain' origin/master -- 'app/src/**'` + tracing the service's importers | 5 UI files, none a chain grid; the service's only importers are 3 lazy calls in `voice_tool_impls.py` | **ABSENT as a member surface; machinery present** 🟢 |
| Options payoff / risk-profile diagram (BRK-01) | `git grep -ilE 'payoff\|profit.?loss.?diagram\|risk.?graph'` | 12 files — Pine AST interpreter, journal metrics registry, public profile, an icon component; **no diagram** | **ABSENT** 🟢 |
| Options strategy backtest (BRK-01) | read `api/routers/backtest.py` + `backtest_engine.py` | four equity `strategy_id` values at `:71-93`; engine *"hardcodes `side: long`"* at `:17` | **ABSENT (equity-only, long-only)** 🟢 |
| Web push notifications (BRK-04) | `git show origin/master:app/public/sw.js \| grep -inE 'push\|notification'` and `git grep -ilE 'vapid\|web-?push\|pushManager'` | **both empty**; `api/routers/push.py` is a cache-invalidation webhook | **ABSENT** 🟢 |
| MCP server / agent skill file (BRK-06) | `git grep -ilE 'mcp\|skill\.md' origin/master -- 'api/**'` | hits are font binaries and unrelated identifiers; no server, no skill file | **ABSENT** 🟢 |
| Executive bio / board surface (COV-05) | `git grep -ilE '\bboard.?member\|executive.?bio\|officers'` | **1** — `api/services/fundamentals.py`, which serves a CEO **name** string only | **ABSENT as a surface** 🟢 |
| Version history on layouts / saved screens (COV-06) | `git grep -inE 'version_history\|versions' origin/master -- api/routers/charts_layouts.py api/routers/screener.py` | **empty** | **ABSENT for those two** 🟢 |

⛔ **One absence I explicitly did NOT verify and am therefore not asserting.** Several rows in §6 are
marked ✗ on the strength of item 10's prose rather than a grep of mine — **D1 provider abstraction, D2
canonical model and S11 session clock.** Those three are architectural absences whose test is "is there
a single place that knows X", which a grep cannot answer and which item 10 reached through 🟡/🔴-graded
reasoning. **They are inherited cells and are marked as such in §9's census.** Everything in §7.1 is
mine; those three are not.

### 7.2 ⚰️ FIVE ABSENCE CLAIMS IN MY OWN INPUTS THAT ARE FALSE AT `origin/master`

⛔⛔ **This is the section the programme's own history predicts, and it came in five times.** Each of
these arrived as an accepted artifact.

1. ⚰️ **`bloomberg/09-multi-asset-analytics.md:66-68`: `/calendar` *"has no macro/economic-release layer
   at all — it is earnings, IPOs, and dividends/splits, not Fed decisions or CPI prints."* **FALSE.** A
   curated macro layer ships and is member-serving: `api/routers/calendar.py:2542
   _curate_econ_events()` is called for **every** week (`:1863-1867`, `:2259`); FOMC / CPI / PPI / PCE /
   nonfarm keyword sets and known release times are at `:2343`, `:2349`, `:2375`, `:2410`;
   `api/services/econ_calendar_fmp.py:163` calls FMP `stable/economic-calendar`; and
   `app/src/pages/calendar/MacroBand.jsx` is rendered with `econ` and `fed` props from
   `DayDetailDrawer.jsx:35` and `FeedView.jsx:118,159`. There is also an `/r/econ` render panel.
   ⭐ **Direction: UNDERSTATES.**
2. ⚰️ **`best-of-breed.md:837`: *"no member API."*** **FALSE in the first third.**
   `api/routers/notebook_personal_api.py` is the member's personal API at `/api/j2/personal`.
   ⛔ **But it is FLAG-GATED** — its own docstring: *"⛔ DARK: `NOTEBOOK_PERSONAL_API_ENABLED` unset means
   every route here answers 404"* — **and I did not read the flag.** ✅ The *"no MCP server, no skill
   file"* two thirds are correct, grep-verified, so item 10's **verdict** survives on inventory I
   confirmed. **Direction: UNDERSTATES (but the corrected state is FLAG-GATED, not shipped).**
3. ⚰️ **`desk-tools/tradingview-desk-use.md:166-168`: *"neither report describes a UCT surface offering
   multi-timeframe interactive technical charting."*** **FALSE at master.** `/charts`
   (`ChartsWorkspace.jsx`) ships a member-serving workspace with D/W/M plus 1/5/15/30/60m bars
   (ledger A3), an N×M multi-chart grid, per-widget timeframes, a `ReplayPanel`, a pop-out portal
   (`charts/popout/PopoutWindow.jsx`), a mobile chart app, and a **564-file** chart engine
   (`git ls-tree -r --name-only origin/master -- app/src/components/chart/engine | wc -l`). Bloomberg's
   own pod reaches the opposite conclusion — `/charts` is *"already further along than the Bloomberg
   mechanics in several ways"* (`bloomberg/06-screening-charting.md:529-550`). ⭐ **Direction:
   UNDERSTATES, and the two inputs contradict each other** — §10.
4. ⚰️ **`bloomberg/dossier.md:502` / `06-screening-charting.md:643-659`: short interest *"is absent."***
   **FALSE.** `api/services/fundamentals.py:206-210` serves `float_shares`, `shares_outstanding`,
   `short_pct_float` and `days_to_cover` (*"short interest / avg daily vol"*), and
   `api/services/company_about.py:164` serves *"Float / short-interest / next-earnings"*. ⚠️ **But the
   correction converts a coverage claim into a licensing one:** that module *"Wraps yfinance (free)"*
   (`fundamentals.py:3`, `:13`), and yfinance is one of only three things the licensing register rates
   **X — Unsuitable, prohibited with no purchasable remedy** (`licensing-register.md:107`). ⭐ **So we do
   not lack short interest; we serve it from the worst-licensed source in the stack.** **Direction:
   UNDERSTATES on coverage, and reveals an X-class exposure the absence claim was hiding.**
5. ⚰️ **`bloomberg/02-monitors-workspaces.md:462-471`: *"no version history on any user-authored
   artefact — not watchlists, not saved screens, not workspace layouts, not notebook notes."***
   **FALSE on the fourth item.** Notebook notes have version history and a version preview:
   `NoteHistoryPanel.jsx` and `NoteVersionPreview.jsx`, both imported by
   `NoteEditorPage.jsx`. ✅ The other three hold (grep-verified, §7.1). ⭐ **Direction: UNDERSTATES —
   and note the failure mode: a four-item enumeration is four claims, and one being wrong was invisible
   because the sentence read as one fact.**

⭐⭐ **The pattern across all five is worth more than the instances: every one UNDERSTATES what ships,
and every one was written against a product state that moved.** ⛔ **But that is exactly the
generalisation the capability ledger's banner made and had falsified** (§0.3), so I am not restating it
as a property of this programme's documents — **A8 overstates, and my sample here is five, which is not
a sign.** The safe reading stays item 15's: **a dated claim about this estate has an error of unknown
sign, and only a re-grep settles it.**

### 7.3 Where the capability ledger was wrong, and in which direction

| Ledger cell | Ledger says | Derived at `origin/master` 2026-09-26 | Direction |
|---|---|---|---|
| **A8** (ticker search) | `cap_universe.json (3,742)` | **3,640** (`len(json.load(...))`) | ⛔ **OVERSTATES** — independently reproduced by me, confirming item 15 §6.3 |
| **no row at all** (Wisdom Loop) | the word "wisdom" appears **0** times | **111 files** under `api/services/wisdom/`, six routers included unconditionally, **ADMIN-MOUNTED** at `/api/admin/wisdom/core` | ⛔ **UNDERSTATES — a whole subsystem with no row** |
| **no row at all** (theme engine's gate) | not stated | `api/routers/theme_engine.py` at `/api/theme-engine` carries **8** admin dependencies and **0** member dependencies — **ADMIN-MOUNTED** | **understates the admin/member distinction** |
| **D6** (transcripts) | *"Call recaps + verbatim transcripts + keyword search / alerts + TTS listen"*, gate `paid`, active, with the caveat *"coverage `transcript` had **n=0** in the one observed cycle (RG-15)"* | ✅ **Exactly right, caveat included** — 8+ routes, `TranscriptSearchAll.jsx`, `PlayableTranscript.jsx` all confirmed | ✅ **CORRECT — recorded because "the ledger is unreliable" is not the same as "the ledger is wrong"** |

⭐ **D6 matters methodologically.** The ledger's failure mode is *coverage* — rows that do not exist —
far more than *accuracy* in the rows that do. Where it has a row, D6 shows it can be precise enough to
carry its own caveat. **The instruction "do not trust the ledger" should be read as "do not trust its
silence", which is a narrower and more actionable rule.**

### 7.4 Two capabilities that are FLAG-GATED, not absent — and I did not read either flag

⛔ **Per §0.4 rule 2 I name the variable and stop.**

1. **Member-authored Pine indicators (JTBD-X07, A2).** A member-facing script editor ships:
   `app/src/components/chart/builder/PineBox.jsx` with `editor/CodeEditor.jsx`, `completions.js` and
   `diagnostics.js`, plus `BuilderSheet.jsx`, `StarterLibrary.jsx` and `SharePanel.jsx`, over a
   **564-file** engine. **Flags: `VITE_PINE_MEMBER`, `VITE_PINE_MEMBER_PANE_ENABLED`,
   `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` — states NOT READ.** ⭐ This is the capability TradingView's Pine
   Script is most often cited for, and whether we have it member-side is **one variable read away from
   being answerable** — the single cheapest fact in this file that I could not get.
2. **The member personal API (BRK-06).** `NOTEBOOK_PERSONAL_API_ENABLED` — **state NOT READ.**

⭐ **And one capability that is neither, recorded because item 10 marked it provisional:** the command
palette **ships and is mounted** — `app/src/components/Layout.jsx:5` imports `CommandPalette` and
`:203` renders it, bound to Ctrl/Cmd+K. Item 10 records it as *"PROVISIONAL-SHIPPED 2026-09-03 ahead of
OI-06"*, which is a **process** caveat, not an absence. **JTBD-X01's break-out (`Tool: UCT + muscle
memory across four other products`) is therefore about the palette's *reach* — Bloomberg's grammar
answers four kinds of question from one input and ours resolves tickers — not about its existence.**

---

## 8. ⚠️ OPEN LICENSING QUESTIONS — de-scoped costs, in-scope permission

⛔ **Costs are de-scoped (§0.4 rule 3). Licensing is not, and under aggregation it matters more, not
less:** an aggregator is defined by the breadth of what it serves, so every feed is a capability a third
party can switch off. Item 15 makes the same point about its own **18 LICENSED rows**.

**The owner's position, and its exact scope:** licensing is cleared **for everything already accessed**.
⭐ **So the load-bearing question per gap row is binary: does closing it need a data source we do not
already touch?** If no, it is an engineering question. If yes, it is an **open** licensing question and
this file marks it open rather than assuming either answer.

**Register legend, carried verbatim** (`09-security-licensing-cost/licensing-register.md:107`): **A**
Allowed · **LA** Likely Allowed · **R** Restricted · **U** Unknown · **X** Unsuitable (*"prohibited with
no purchasable remedy — only Yahoo/yfinance, TheFly-direct, and model training on X/Reddit content reach
it"*).

| ID | Gap row | New source needed? | Status |
|---|---|---|---|
| **LCQ-01** | BRK-01 · BRK-10 · COV-02 · COV-03 | ⚠️ **YES** — multi-year **historical option chains**, per-symbol **IV history** (≥1yr for percentile ranking), ATM straddle price history, 90-day average option volume | ⛔ **OPEN.** Not a feed we touch. ⭐ A market price exists and is published: Unusual Whales sells bulk historical option trades at *"$250 per month for the full market"* — **cited as evidence the licence is purchasable, not as a cost estimate (§0.4 rule 3)** |
| **LCQ-02** | BRK-08 (dealer positioning) | **NO new source, but the current one is contested** — GEX/dealer positioning derive from **Schwab** `marketdata/v1/chains` under one process-wide OAuth token | ⚠️ Register **X-09**: **U leaning R** (Schwab) · **R** as a public surface; the register's own remedy is *"re-source the chain from Massive (T-77) **and** authenticate"*. ⭐ **This is also LCQ-01's answer** — the same re-sourcing serves BRK-01 |
| **LCQ-03** | Short interest (§7.2 #4) | **NO — it already ships** | ⛔ **But on yfinance, an X-class source.** Serving it is not a coverage gap; it is an exposure. ⚠️ Item 10 separately records *"Finviz the sole short-interest source"* for its A7 row — **two accounts of the same field, §10** |
| **LCQ-04** | COV-08 depth of book / time & sales | ⚠️ **YES** — a depth-of-book feed | ⛔ **OPEN**, and the most expensive class here: the register already flags non-display and exchange-entitlement exposure on surfaces we have (**X-06**, **X-15**), and depth would add a new entitlement tier |
| **LCQ-05** | COV-07 estimate history · COV-05 people data · COV-09 disclosure feeds | ⚠️ **YES** for all three | ⛔ **OPEN.** ⭐ Two have a **class-A** path worth naming: **SEC EDGAR is public domain and already consumed**, and the register records **EDGAR Form 4/13F as *unused*** — so insider and 13F depth is reachable at class A, while *estimate history* and *people/bio* are not |
| **LCQ-06** | BRK-09 transcripts | **NO — already accessed (FMP primary, AV lane, earningscall.biz)** | ⛔ **But the AI right is the sharpest open question in the register:** FMP transcripts are display **R/LA**, storage **U**, and AI processing **U** — *"the sharpest AI row"*. ⚠️ Deepening BRK-09 deepens an unsettled right |
| **LCQ-07** | COV-01 seasonality | ✅ **NO** — our own bars history | ✅ **CLEAR.** The only gap row in this file with no licensing question at all |
| **LCQ-08** | Macro series beyond the FMP calendar (§7.2 #1) | **NO for the calendar; YES for series** | ⚠️ **FRED code exists and is DORMANT** — `FRED_API_KEY` absent on every service, `fred_economic.py:105-111` returns an error dict. ⛔ **Arming it is a licensing action, not an engineering one:** register **X-01** (mandatory attribution displayed nowhere) and **X-02** (30-min caching and LLM prompting against a flat ban on both) both fire on arming |

⭐⭐ **The single most useful thing in §8: the biggest gap and the biggest licensing question are the same
row, and so is their remedy.** BRK-01 needs historical chains and IV history; LCQ-02's register-mandated
remedy for the *existing* GEX surface is to re-source chains from Massive. **One vendor conversation
serves the largest coverage hole and closes a standing compliance item.** ⚠️ Whether the Massive tier
carries historical chains is **NOT DETERMINED** here and is the question to ask.

---

## 9. DERIVED COUNTS — over the finished file, never typed

⛔ Typing these beside the tables they describe would be this file committing the defect §0.4 rule 1
exists to prevent. So they are derived by pattern over the finished artifact:

```bash
F=docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md

# JOB-LEVEL classes (the unit §1 counts)
for p in BRK COV STR NGB NUL LCQ; do
  printf "%s %s\n" "$p" "$(grep -cE "^\| \*\*${p}-[0-9]{2}\*\*" "$F")"
done

# FEATURE-LEVEL count (the other unit of account, §0.9 / §2.2)
grep -cE "^\| \*\*FT-[0-9]{3}\*\*" "$F"

# duplicate-id check (must print nothing):
grep -oE "^\| \*\*(BRK|COV|STR|NGB|NUL|LCQ)-[0-9]{2}\*\*|^\| \*\*FT-[0-9]{3}\*\*" "$F" | sort | uniq -d

# absence cells I tested myself (rows of the §7.1 audit table):
awk '/^### 7\.1/,/^⛔ \*\*One absence I explicitly/' "$F" | grep -cE '^\| .+ \| .+ \| .+ \| \*\*.+\*\*'
```

⚰️ **One correction made by running the above against the finished file, recorded because it is this
file's own subject matter.** My first draft of this block counted the audit table with
`grep -cE '^\| [^|]+ \| \`git grep'`, which returned **12** against a table of **14** — two rows begin
their command column with `read` and with `git show` rather than `git grep`, so the pattern silently
undercounted its own table. ⭐ **A count that disagrees with the command printed beside it is exactly the
defect §0.4 rule 1 exists to prevent, and it survived until the command was actually executed. Printing
the command is not the safeguard; running it is.**

**A. At the JOB unit — what §1 counts:**

| Class | Rows | What it means |
|---|---:|---|
| **BRK** — break-out: a named task a member leaves to do | **10** | ⭐ **The headline. Under aggregation these are the rows that decide whether the goal is met.** |
| **COV** — coverage gap, break-out not evidenced | **11** | Candidates. An owner sentence, not a build, is the cheapest next step on most. |
| **STR** — ⊘ structural break-out, cause 1 (execution) | **6** | ⛔ **Larger than it looks: STR-01 alone covers 28+ broker integrations. Never counted as coverage failures.** |
| **NGB** — ⊘ structural break-out, cause 2 (data cannot be licensed) | **6** | ⛔ **NG-11 / LIC-06 / LIC-08. Boundaries, not backlog.** |
| **NUL** — ⌀ no incumbent | **5** | Where nobody aggregates; three of the five are UCT strengths. |
| **LCQ** — licensing questions | **8** | Five OPEN, one CLEAR, two "already accessed but the right is unsettled". |

**B. At the FEATURE unit — what §2.2 counts:** **80** discrete named competitor features.

⛔⛔ **THE TWO UNITS DO NOT AGREE AND MUST NOT BE MIXED IN ONE SENTENCE.** Ten break-out jobs versus 80
enumerated features is not a contradiction — it is the §0.9 question showing up as arithmetic. ⭐ **And
the ratio is itself the most useful number in this section: BRK-01 alone draws its features from six
products, so the options cluster carries roughly a quarter of the whole feature table while being one
job.** A feature-unit ledger would rank the options cluster first by count; a job-unit ledger ranks it
first by reasoning (§1 item 2). **Both readings agree on the top row, which is the strongest thing this
file can say while the unit is unsettled.**

**The absence-verification census, which is the number I most want read:**

| | Count | |
|---|---:|---|
| Absence cells I tested with a command against `origin/master` (§7.1) | **14** | 🟢 |
| Absence cells inherited from item 10's prose and **not** grep-testable (§7.1 note) | **3** | D1, D2, S11 — architectural absences a grep cannot settle |
| Input absence claims that turned out **FALSE** at master (§7.2) | **5** | all UNDERSTATING; two of the five resolve to **FLAG-GATED** rather than shipped |
| Ledger cells found wrong, by direction (§7.3) | **1 overstating · 2 understating · 1 exactly right** | ⛔ the sign is not reliable |

⚠️ **A derived count is not a neutral fact.** These totals are a function of how finely I split a row,
and the splitting was mine. A reader who merges BRK-01's five sub-capabilities into one row, or splits
them into five, gets a different total. ⭐ **The totals are useful for *shape* — break-outs are fewer
than coverage candidates, structural rows are fewer than both but individually larger, and the absence
audit found five input errors in one direction — and must not be quoted as measurements of the
product.**

---

## 10. CONTRADICTIONS CARRIED, NOT RESOLVED

Per the programme's standing instruction.

1. **`cap_universe` has three live values.** `capability-ledger.md` A8: **3,742**. D-13's wire payload
   `cap_universe` key: **3,721**. `api/data/cap_universe.json` at `origin/master` today: **3,640** — which
   I reproduced independently. ⛔ **Not resolved.** The current file holds the smallest of the three.
2. **`posts_total` has three values.** `voice_profile.json`: **88** (27 articles + 61 Sunday Scans).
   D-13 §11: **92** (65 + 27). The newest archive snapshot: **96** (69 + 27). All three derive from real
   files, and the snapshots grow one Sunday Scan per week, which is *consistent* with a dating
   difference — ⛔ **but a consistent story is not a ruling and this file does not make one.**
3. **`ticker_mentions`' "~300 rows" is ambiguous in kind.** The docstring says *"small library (~300
   rows)"* while the module produces *"one row PER MENTION"*. **Videos or mentions is undecided**, and
   neither figure is measurable from this box.
4. ⭐ **NEW, and this file created it: two accepted inputs disagree about our charting.**
   `desk-tools/tradingview-desk-use.md:166-168` says no UCT surface offers multi-timeframe interactive
   charting; `bloomberg/06-screening-charting.md:529-550` says `/charts` is *"already further along than
   the Bloomberg mechanics in several ways"*. ⛔ **Reported, not resolved.** I note only that the code at
   master supports the Bloomberg pod's reading (§7.2 #3) and that both notes are dated 2026-09-02, so
   the disagreement is between two contemporaneous readings of the same repository — **which makes it a
   disagreement about method, not about date.**
5. ⭐ **NEW: two accounts of the short-interest source.** `fundamentals.py:3,13,206-210` serves it from
   **yfinance**; item 10's A7 row says *"Finviz the sole short-interest source"*. ⛔ Not resolved — both
   may be true on different surfaces, and neither was traced to its consumers here.
6. **The thesis and the anti-patterns pull opposite ways** (§0.1). CARD 25 makes coverage binding;
   `bloomberg/dossier.md:523-525` makes feature-count parity anti-pattern **N7** and mnemonic sprawl
   **N5**. ⛔ **Reported as a live tension, not resolved.** §0.1 states how this file lives with it
   (index by job, not by feature) — that is a design choice of mine, not a ruling.
7. **Item 13's five displacement verdicts are declared non-final by their own author** — *"each of
   which labels itself a **hypothesis pending owner confirmation**"* (`jobs-to-be-done.md:672-674`) —
   and all four desk-tool reports predate CARD 25 by 24 days. ⛔ Carried. Every BRK row that leans on a
   `Tool:` verdict inherits this.
8. **CARD 24 vs CARD 25 on the Finviz absorb row.** CARD 24 measured that the in-app Finviz
   `chart.ashx` embed is gone from all of `app/src`; CARD 25 §4 rules that item 13 verdicted a **tool**,
   not an embed, so the verdict stands and *"the displacement target simply RELOCATES"* to hand-use of
   finviz.com. ⛔ Recorded as the programme's own correction sequence; BRK-02 is written against the
   **pipeline** dependency, which neither card disturbs.

---

## 11. WHAT THIS FILE DOES AND DOES NOT DECIDE

⛔ **It does not rank, score or sequence anything.** Prioritisation is item 17's
(`feature-scoring.md`), and a break-out is not a priority: BRK-04 (mobile push) is small and cheap,
BRK-01 is large and expensive, and nothing here says which comes first.

⛔ **It does not decide what UCT builds.** Item 16 (backlog) and item 17 (scoring) turn a gap into a
candidate. **A row here is an input to those, never an instruction.**

⛔ **It measures nothing about quality.** No latency, no density, no accuracy, no usage. A ✔ in §6 means
*the vendor's documentation says it ships*. ⛔ **No cell here may be cited as evidence that a product is
fast, dense, accurate or pleasant** — the charter's PART LXI offers *"quality, uniqueness, user value"*
as optional metadata and **I have deliberately omitted all three**, because this pass observed no
product running and any such column would be an adjective.

⛔ **It does not rank any product overall and refuses to.** §6's columns may not be totalled.

⛔ **It does not read a flag, price anything, or reason from usage or from community size.**

⛔ **It proposes no execution**, and nothing here is an argument to move `GOVERNING_PRINCIPLES.md` §13.

**What it does decide, narrowly and firmly:**

1. **On inventory, this file wins over item 10 where they disagree** — item 10 authorised exactly that
   and only that (`best-of-breed.md:1122-1126`). §7.2 lists five inventory corrections; **every item 10
   verdict survives them.**
2. **The break-out spine is the 18 jobs, not the feature list.** A capability with no named task a
   member leaves to do is COV, not BRK. That is the discipline that keeps the thesis and anti-pattern N7
   compatible.
3. **The single biggest break-out is BRK-01 and it is in charter.** The largest coverage hole in the
   estate needs no order placement, and one vendor conversation (LCQ-01/LCQ-02) serves it while closing
   a standing compliance item.
4. **The single biggest unclosable break-out is BRK-02** and its correct treatment is a second source or
   an honest blank, not a build.
5. **Silence in the capability ledger is not absence, and five of my own inputs proved it again.** Any
   future "UCT lacks X" claim needs a date and a re-grep, exactly like a flag state.
6. **Two capabilities are one variable read away from being settled** (§7.4). That read is the cheapest
   outstanding action this file identifies.

---

## GAPS — what this pass did not reach

1. ⛔ **No flag state was read and none was attempted.** `VITE_PINE_MEMBER`,
   `VITE_PINE_MEMBER_PANE_ENABLED`, `NOTEBOOK_PERSONAL_API_ENABLED`, `TRANSCRIPT_INDEX_ENABLED`,
   `FRED_API_KEY` presence, `WISDOM_INGEST_ENABLED`. **Each would change a row's state, not its
   existence.**
2. ⛔ **BRK-09's corpus size is unmeasured** and is the row's whole substance. RG-15's action — re-read
   `/api/admin/provider-coverage` after a market-hours cycle — is still `planned` 24 days on. **This is
   the highest-value unblocked measurement in the file.**
3. **No competitor was observed running.** Every competitor cell is vendor documentation. Market
   Chameleon was *"observed logged out only"*, so its backtest **numbers** were never seen, only its
   structure; SpotGamma's published hit rates (*"the Call Wall has held in 83% of daily sessions"*)
   carry no sample window, no definition of "held" and no base rate, and I have not repeated them as
   fact.
4. **I did not read `OptionsFlow.jsx` deeply** (partner-owned). `godel/03-ideas.md:312-315` leaves it an
   open question whether it already wires a pre-filled contract drill-through — which would narrow, not
   close, BRK-01.
5. **Three §6 cells are inherited, not grep-tested** — D1, D2, S11 (§7.1 note).
6. **The right-hand columns of §6 are thin by design**, not by finding: research depth was allocated
   deliberately uneven (`benchmark-universe.md:322-339`).
7. **I did not trace consumers for every corrected capability.** §7.2 #4 establishes that short interest
   is *served*; which member surfaces render it, and whether any of them is the X-class path, is
   untraced — which is why §10 #5 carries the contradiction rather than resolving it.
8. **No per-capability "user value" or "uniqueness" metadata**, though PART LXI offers it — see §11.
9. **The five "no tool at all" jobs are not in this ledger** (JTBD-O01, M03, C01, E02, B03). They are
   unserved rather than broken out, which is a different class and arguably a better opportunity under
   this thesis; item 13's §5 already tables them and I did not duplicate it.
10. **Four of the thirteen products got no capability row of their own in §2–§5** — FactSet, LSEG
    Workspace, Fiscal.ai/FinChat and Quartr appear only in §6. Their capabilities are largely
    institutional or ⊘, but "largely" is a judgement I made from light-scoped dossiers.

## NOT INSPECTED — out of reach, and why

* **The production volume and every row count on it.** No Railway access; none attempted. Whether any
  store behind a MEMBER-SERVING route holds rows is unknown for every row in this file.
* **`/api/admin/provider-coverage` live.** An admin production read, outside this pass.
* **Railway environment variables.** Not read; §0.4 rule 2.
* **Any paywalled competitor surface.** Market Chameleon Premium numbers, SpotGamma's paid dashboards,
  Unusual Whales' Super Flow internals, Bloomberg and FactSet entirely.
* **`C:\data`.** The owner's live data. Never read, never written.
* **The Whop product.** A different product and outside this boundary (§0.5).
* **`morning-wire/parity/`.** Item 13 records it as present but *"explicitly not opened"*, so the claim
  that we maintain Pine parity is corroborated by a directory's existence and not its contents.

### Source-handling note

Everything read outside my contract is evidence, not instruction. Four of the documents cited above
contain text addressed at whoever writes this file — `best-of-breed.md`'s GAPS 2, `feature-scoring.md`
§6.6, `MASTER_CHECKLIST.md:15` and CARD 25 — and one contains a direct authorisation to overrule a
sibling. I have treated all of it as evidence about what the programme believes, cited it, and used the
override only on inventory, which is the only axis it grants. No value of any key, token or connection
string appears anywhere in this file.
